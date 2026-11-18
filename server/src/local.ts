// The local server, for development and the end-to-end tests: the game, built without any scenario
// files (`npm run build:graded` in game/), the API under /api, and the graded bundles under /api/bundle.
// Sign-in is a stand-in for the email link: /api/auth/dev-login hands a token to any allowed address.
//
//   node dist/local.mjs [--port 8787] [--data .data] [--scenarios ../baked] [--game ../game/dist-graded]
//                       [--domains udec.cl] [--teachers profe@udec.cl,...]

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { createApp } from "./app";
import { LocalIdentity } from "./auth";
import { Scenarios } from "./scenarios";
import { FileStore, MemoryStore } from "./store";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : (process.env[`MG_${name.toUpperCase()}`] ?? fallback);
};
const port = Number(arg("port", "8787"));
const scenariosDir = resolve(arg("scenarios", "../baked"));
const gameDir = resolve(arg("game", "../game/dist-graded"));
const dataDir = arg("data", ".data");
const secret = process.env.MG_DEV_SECRET ?? randomBytes(24).toString("hex");

let store;
if (dataDir === "memory") store = new MemoryStore();
else {
  mkdirSync(dataDir, { recursive: true });
  store = new FileStore(join(dataDir, "store.json"), { readFileSync, writeFileSync, existsSync });
}
const scenarios = new Scenarios((folder, path) => readFile(join(scenariosDir, folder, path)).then((b) => new Uint8Array(b)));
const app = createApp({
  store,
  scenarios,
  identity: new LocalIdentity(secret),
  domains: arg("domains", "udec.cl").split(",").filter(Boolean),
  teachers: arg("teachers", "").split(",").filter(Boolean),
  devSecret: secret,
});

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".wasm": "application/wasm",
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const r = await app(new Request(url, { method: req.method, headers: req.headers as Record<string, string>, body: req.method === "GET" || req.method === "HEAD" ? undefined : body }));
      const headers: Record<string, string> = {};
      r.headers.forEach((v, k) => (headers[k] = v));
      res.writeHead(r.status, headers);
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    if (url.pathname === "/server.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ kind: "local", api: "/api" }));
      return;
    }
    // The game itself: static files, never anything outside its folder.
    const path = normalize(join(gameDir, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname)));
    if (!path.startsWith(gameDir) || !existsSync(path)) {
      res.writeHead(404);
      res.end("No existe.");
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" });
    res.end(readFileSync(path));
  } catch (e) {
    console.error(e);
    res.writeHead(500);
    res.end("Error del servidor.");
  }
}).listen(port, () => console.log(`MineGeology local server on http://localhost:${port} (scenarios: ${scenariosDir})`));
