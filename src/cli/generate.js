#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generatePulley } from "../core/generate.js";
import { exportBinaryStl } from "../export/stl.js";

const args = process.argv.slice(2);
if (args.length < 2 || args.includes("--help")) {
  console.error("Usage: node src/cli/generate.js <input.json> <output.stl> [--placement=model|onBed]");
  process.exit(args.includes("--help") ? 0 : 2);
}

const [inputName, outputName] = args;
const placementOption = args.find((arg) => arg.startsWith("--placement="));
const placement = placementOption ? placementOption.slice("--placement=".length) : "model";

try {
  const input = JSON.parse(await readFile(resolve(inputName), "utf8"));
  const result = generatePulley(input);
  if (!result.ok) {
    console.error(JSON.stringify({ ok: false, diagnostics: result.diagnostics }, null, 2));
    process.exitCode = 1;
  } else {
    const exported = exportBinaryStl(result.mesh, { placement });
    await writeFile(resolve(outputName), exported.data);
    console.log(JSON.stringify({
      ok: true,
      output: resolve(outputName),
      vertices: result.verification.vertexCount,
      triangles: result.verification.triangleCount,
      bounds: exported.exportedBounds,
      placement: exported.placement,
      warnings: result.diagnostics.filter((item) => item.severity === "warning")
    }, null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
}
