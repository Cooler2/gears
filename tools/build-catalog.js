#!/usr/bin/env node
// Builds the example catalog: bed-ready STL files and catalog.json with sizes, diagnostics
// and check results. Optional --blender=<blender.exe> adds the independent Blender
// inspection (tools/blender-inspect.py) and an overview PNG for every model.
//
//   node tools/build-catalog.js [outDir] [--blender=<path>]

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePulley } from "../src/core/generate.js";
import { exportBinaryStl } from "../src/export/stl.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const outDir = resolve(args.find((arg) => !arg.startsWith("--")) ?? join(root, "out", "catalog"));
const blender = args.find((arg) => arg.startsWith("--blender="))?.slice("--blender=".length);

await mkdir(outDir, { recursive: true });
const entries = [];
for (const group of ["valid", "invalid"]) {
  const dir = join(root, "examples", group);
  for (const file of (await readdir(dir)).filter((name) => name.endsWith(".json")).sort()) {
    entries.push(await buildEntry(group, join(dir, file)));
  }
}

if (blender) inspectWithBlender(entries.filter((entry) => entry.stl));

const problems = entries.flatMap(entryProblems);
await writeFile(join(outDir, "catalog.json"), JSON.stringify({ generatedBy: "tools/build-catalog.js", entries }, null, 2) + "\n");
for (const entry of entries) console.log(summaryLine(entry));
for (const problem of problems) console.error(`PROBLEM ${problem}`);
console.log(`catalog: ${join(outDir, "catalog.json")}`);
process.exitCode = problems.length ? 1 : 0;

async function buildEntry(group, file) {
  const name = basename(file, ".json");
  const input = JSON.parse(await readFile(file, "utf8"));
  const result = generatePulley(input);
  const entry = {
    name,
    group,
    ok: result.ok,
    diagnostics: result.diagnostics.map(({ code, paths }) => ({ code, paths }))
  };
  if (!result.ok) return entry;

  const exported = exportBinaryStl(result.mesh, { placement: "onBed" });
  const stl = join(outDir, `${name}.stl`);
  await writeFile(stl, exported.data);
  const { normalized, derived } = result;
  const flangeDiameters = [normalized.flanges.lower, normalized.flanges.upper]
    .map((flange) => flange ? 2 * (derived.outsideRadius + flange.radialExtension) : null);
  return Object.assign(entry, {
    stl,
    sha256: createHash("sha256").update(exported.data).digest("hex").toUpperCase(),
    vertices: result.verification.vertexCount,
    triangles: result.verification.triangleCount,
    volume: result.verification.signedVolume,
    placementTranslation: exported.placementTranslation,
    exportedBounds: exported.exportedBounds,
    dimensions: {
      toothCount: normalized.rim.toothCount,
      outsideDiameter: 2 * derived.outsideRadius,
      grooveRootDiameter: derived.grooveRootRadius === null ? null : 2 * derived.grooveRootRadius,
      module: normalized.rim.module ?? null,
      boreShape: normalized.bore.shape,
      boreDiameter: normalized.bore.diameter,
      hubDiameter: normalized.hub.outerDiameter,
      lowerFlangeDiameter: flangeDiameters[0],
      upperFlangeDiameter: flangeDiameters[1],
      height: exported.exportedBounds.max[2] - exported.exportedBounds.min[2]
    }
  });
}

function inspectWithBlender(built) {
  const script = join(root, "tools", "blender-inspect.py");
  const run = spawnSync(blender, ["-b", "--factory-startup", "--python", script, "--", outDir, ...built.map((entry) => entry.stl)],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (run.error) throw run.error;
  const reports = run.stdout.split(/\r?\n/).filter((line) => line.startsWith("INSPECT ")).map((line) => JSON.parse(line.slice(8)));
  for (const entry of built) {
    const report = reports.find((item) => resolve(item.file) === resolve(entry.stl));
    entry.blender = report ? {
      sameVertices: report.vertices === entry.vertices && report.importedVertices === entry.vertices,
      nonManifoldEdges: report.nonManifoldEdges,
      nonManifoldVertices: report.nonManifoldVertices,
      selfIntersectingPairs: report.selfIntersectingPairs,
      volume: report.volume,
      overhangArea: report.overhangArea,
      image: join(outDir, `${entry.name}.png`)
    } : { missing: true };
  }
}

function entryProblems(entry) {
  if (entry.group === "invalid") return entry.ok ? [`${entry.name}: invalid example builds`] : [];
  if (!entry.ok) return [`${entry.name}: ${entry.diagnostics.map(({ code }) => code).join(", ")}`];
  const check = entry.blender;
  if (!check) return [];
  if (check.missing) return [`${entry.name}: no Blender report`];
  const issues = [];
  if (!check.sameVertices) issues.push("vertex count changed on import");
  if (check.nonManifoldEdges || check.nonManifoldVertices) issues.push("non-manifold in Blender");
  if (check.selfIntersectingPairs) issues.push(`${check.selfIntersectingPairs} self-intersecting pairs`);
  if (Math.abs(check.volume - entry.volume) > 1e-4 * entry.volume) issues.push("volume differs");
  return issues.map((issue) => `${entry.name}: ${issue}`);
}

function summaryLine(entry) {
  const codes = entry.diagnostics.map(({ code }) => code).join(",");
  if (!entry.ok) return `${entry.group.padEnd(8)}${entry.name.padEnd(22)}rejected  ${codes}`;
  const size = entry.exportedBounds.max.map((value, axis) => (value - entry.exportedBounds.min[axis]).toFixed(2)).join(" x ");
  const check = entry.blender && !entry.blender.missing
    ? `  blender: ${entry.blender.selfIntersectingPairs} crossings, overhang ${entry.blender.overhangArea.toFixed(0)} mm2` : "";
  return `${entry.group.padEnd(8)}${entry.name.padEnd(22)}${String(entry.triangles).padStart(6)} tris  ${size} mm  ${codes}${check}`;
}
