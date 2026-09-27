/**
 * Minimal path-based HTTP proxy for E2E testing.
 *
 * Routes:
 *   /api/*  → http://localhost:API_PORT  (API server)
 *   /*      → http://localhost:FE_PORT   (frontend preview)
 *
 * Usage:
 *   PROXY_PORT=4000 API_PORT=3001 FE_PORT=5173 node e2e/proxy.mjs
 */

import http from "http";

const PROXY_PORT = Number(process.env["PROXY_PORT"] ?? 4000);
const API_PORT = Number(process.env["API_PORT"] ?? 3001);
const FE_PORT = Number(process.env["FE_PORT"] ?? 5173);

function forward(req, res, targetPort) {
  const options = {
    hostname: "127.0.0.1",
    port: targetPort,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `localhost:${targetPort}` },
  };

  const proxy = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxy.on("error", (err) => {
    console.error(`[proxy] upstream error (port ${targetPort}):`, err.message);
    if (!res.headersSent) res.writeHead(502);
    res.end(`Bad Gateway: ${err.message}`);
  });

  req.pipe(proxy, { end: true });
}

const server = http.createServer((req, res) => {
  const url = req.url ?? "/";
  if (url.startsWith("/api")) {
    forward(req, res, API_PORT);
  } else {
    forward(req, res, FE_PORT);
  }
});

server.listen(PROXY_PORT, "127.0.0.1", () => {
  console.log(`[proxy] listening on http://127.0.0.1:${PROXY_PORT}`);
  console.log(`[proxy] /api → :${API_PORT}  |  /* → :${FE_PORT}`);
});
