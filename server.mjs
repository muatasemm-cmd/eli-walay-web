import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = Number(process.env.PORT || 8787);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

async function fetchLatestRates(symbols) {
  const uniqueSymbols = [...new Set(symbols.filter(Boolean))];
  const response = await fetch(`https://api.frankfurter.dev/v2/rates?base=ILS&quotes=${uniqueSymbols.join(",")}`, {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`Frankfurter HTTP ${response.status}`);
  }

  const payload = await response.json();
  const rates = {};
  let latestDate = null;

  for (const item of Array.isArray(payload) ? payload : []) {
    if (!item?.quote) continue;
    const rate = Number(item.rate);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    rates[item.quote] = 1 / rate;
    if (item.date && (!latestDate || item.date > latestDate)) {
      latestDate = item.date;
    }
  }

  return {
    source: "frankfurter",
    date: latestDate,
    rates
  };
}

async function serveStaticFile(reqPath, res) {
  const relativePath = reqPath === "/" ? "/iphone-v6.html" : reqPath;
  const safePath = path.normalize(relativePath).replace(/^(\.\.[\\/])+/, "");
  const fullPath = path.join(__dirname, safePath);

  if (!fullPath.startsWith(__dirname)) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }

  try {
    const fileInfo = await stat(fullPath);
    if (!fileInfo.isFile()) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    const content = await readFile(fullPath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=300"
    });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: "not_found" });
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/api/health") {
      sendJson(res, 200, { ok: true, service: "eli-walay-backend" });
      return;
    }

    if (url.pathname === "/api/exchange-rates/latest") {
      const symbols = (url.searchParams.get("symbols") || "USD,JOD,EUR")
        .split(",")
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean);

      try {
        const payload = await fetchLatestRates(symbols);
        sendJson(res, 200, payload);
      } catch (error) {
        sendJson(res, 502, {
          error: "exchange_rates_unavailable",
          message: "تعذر جلب سعر الصرف من الإنترنت.",
          details: error instanceof Error ? error.message : "unknown_error"
        });
      }
      return;
    }

    await serveStaticFile(url.pathname, res);
  } catch {
    sendJson(res, 500, { error: "internal_error" });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Eli Walay backend running on http://localhost:${port}`);
});
