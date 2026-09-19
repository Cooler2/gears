#!/usr/bin/env node
// Gears — (c) 2026 Ivan Polyacov, Elastic License 2.0, see LICENSE
// Builds the public site: a static directory with the pages at its root.
//
//   node tools/build-site.js [outDir]      default dist/, emptied first
//
// Nothing is bundled or minified: the browser loads the same modules as locally.
// Only the pages move to the root, so their links to the style, the script and the
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
const PAGES = ["index.html", "index_ru.html"]; // English at the root address, Russian beside it
for (const name of PAGES) {
  await rm(join(out, "src/ui", name)); // the pages live at the root only
  const page = await readFile(join(root, "src/ui", name), "utf8");
  // relative links only: absolute addresses (canonical, GitHub) and the other page stay as they are
  const moved = page.replace(/(href|src)="(?![a-z]+:|\/|#|\.\/|index)([^"]+)"/g, '$1="src/ui/$2"');
  await writeFile(join(out, name), moved);
}
console.log(out);
