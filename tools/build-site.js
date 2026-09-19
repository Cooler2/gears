#!/usr/bin/env node
// Gears — (c) 2026 Ivan Polyacov, Elastic License 2.0, see LICENSE
// Builds the public site: a static directory with the page at its root.
//
//   node tools/build-site.js [outDir]      default dist/, emptied first
//
// Nothing is bundled or minified: the browser loads the same modules as locally.
// Only the page moves to the root, so its links to the style, the script and the
// icon get the src/ui/ prefix; the modules find the schema and the examples by
// their own URLs. The result is served by any static server, e.g. under /gears/.

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const out = resolve(process.argv[2] ?? join(root, "dist"));
if (out === root || root.startsWith(out)) throw new Error(`refusing to empty ${out}`);

const COPIED = ["LICENSE", "src/about.js", "src/core", "src/export", "src/worker", "src/ui", "schemas", "examples/valid"];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const path of COPIED) {
  await cp(join(root, path), join(out, path), { recursive: true });
}
await rm(join(out, "src/ui/index.html")); // the page lives at the root only

const page = await readFile(join(root, "src/ui/index.html"), "utf8");
// relative links only: absolute addresses (canonical, GitHub) stay as they are
const moved = page.replace(/(href|src)="(?![a-z]+:|\/|#)([^"]+)"/g, '$1="src/ui/$2"');
await writeFile(join(out, "index.html"), moved);
console.log(out);
