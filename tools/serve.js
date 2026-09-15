#!/usr/bin/env node
// Static file server for the local form: the page loads ES modules, the schema and
// the examples, which browsers refuse to do from file://. Serves the project root.
//
//   node tools/serve.js [port]      then open http://localhost:<port>/src/ui/

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.argv[2] ?? process.env.PORT ?? 8080);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".stl": "model/stl"
};

createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/") {
    response.writeHead(302, { location: "/src/ui/" });
    response.end();
    return;
  }
  const relative = normalize(decodeURIComponent(url.pathname)).replace(/^[\\/]+/, "");
  let file = join(root, relative);
  if (file !== root && !file.startsWith(root + sep)) {
    response.writeHead(403);
    response.end();
    return;
  }
  if (url.pathname.endsWith("/")) file = join(file, "index.html");
  try {
    const body = await readFile(file);
    response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`http://localhost:${port}/src/ui/`));
