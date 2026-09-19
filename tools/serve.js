#!/usr/bin/env node
// Gears — (c) 2026 Ivan Polyacov, Elastic License 2.0, see LICENSE
// Static file server for the local form: the page loads ES modules, the schema and
// the examples, which browsers refuse to do from file://. Serves the project root.
//
//   node tools/serve.js [port]      then open http://127.0.0.1:<port>/src/ui/
//   node tools/serve.js 8517 dist   the built site (tools/build-site.js), pages at the root

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const root = resolve(project, process.argv[3] ?? ".");
const port = Number(process.argv[2] ?? process.env.PORT ?? 8517);
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
  if (url.pathname === "/" && root === project) {
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
}).listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}/${root === project ? "src/ui/" : ""}`)); // not localhost: it may resolve to ::1, served by someone else
