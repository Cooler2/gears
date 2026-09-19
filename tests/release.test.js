import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { GENERATOR, VERSION } from "../src/about.js";
import { generatePulley, validateDescription } from "../src/core/generate.js";
import { exportBinaryStl } from "../src/export/stl.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const readJson = async (path) => JSON.parse(await readFile(join(root, path), "utf8"));

test("the version in about.js is the package version", async () => {
  assert.equal(VERSION, (await readJson("package.json")).version);
  assert.ok(GENERATOR.includes(VERSION));
});

test("STL header names the program, its version and the units", async () => {
  const result = generatePulley(await readJson("examples/valid/solid-basic.json"));
  const header = new TextDecoder().decode(exportBinaryStl(result.mesh).data.slice(0, 80)).replace(/\0+$/, "");
  assert.equal(header, `${GENERATOR}; units mm`);
  assert.ok(!header.startsWith("solid"), "a binary STL header must not look like ASCII STL");
});

test("the optional generator field is accepted, checked and dropped on normalization", async () => {
  const input = await readJson("examples/valid/solid-basic.json");
  const signed = validateDescription({ generator: GENERATOR, ...input });
  assert.equal(signed.ok, true, JSON.stringify(signed.diagnostics));
  assert.deepEqual(signed.normalized, validateDescription(input).normalized);
  assert.equal(Object.hasOwn(signed.normalized, "generator"), false);
  const wrong = validateDescription({ ...input, generator: 1 });
  assert.equal(wrong.ok, false);
  assert.deepEqual(wrong.diagnostics.map((item) => item.paths[0]), ["/generator"]);
});

test("the built site has the page at its root and every module import resolves", async () => {
  const out = await mkdtemp(join(tmpdir(), "gears-site-"));
  try {
    await promisify(execFile)(process.execPath, [join(root, "tools/build-site.js"), out]);
    const page = await readFile(join(out, "index.html"), "utf8");
    for (const [, url] of page.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (/^[a-z]+:/.test(url)) continue;
      await stat(join(out, url)); // throws when the link is broken
    }
    assert.match(page, /<link rel="canonical" href="https:\/\/apus-software\.com\/gears\/">/);
    await assert.rejects(stat(join(out, "src/ui/index.html")));
    await assert.rejects(stat(join(out, "tests")));

    const modules = await listFiles(join(out, "src"), ".js");
    for (const module of modules) {
      const text = await readFile(module, "utf8");
      const links = [
        ...[...text.matchAll(/\bfrom\s+"(\.[^"]+)"/g)].map((match) => match[1]),
        ...[...text.matchAll(/new URL\(`?"?(\.[^"`$]+)/g)].map((match) => match[1])
      ];
      for (const link of links) {
        await stat(join(dirname(module), link)).catch(() => assert.fail(`${module}: ${link} is missing`));
      }
    }
    await stat(join(out, "examples/valid/solid-basic.json"));
    await stat(join(out, "LICENSE"));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

async function listFiles(directory, extension) {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(extension)).map((entry) => join(entry.parentPath, entry.name));
}
