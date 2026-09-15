import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { generatePulley, validateDescription, verifyMesh } from "../src/core/generate.js";
import { buildCircleContour, buildGt2Contour, circleSegmentCount } from "../src/core/contours.js";
import { exportBinaryStl } from "../src/export/stl.js";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

test("documented stage-2 example builds a deterministic closed solid", async () => {
  const input = await readJson("../examples/valid/solid-basic.json");
  const first = generatePulley(input);
  const second = generatePulley(input);
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
  assert.deepEqual(first.mesh, second.mesh);
  assert.equal(first.contours.toothVertexCount, 19 * input.rim.toothCount);
  assert.equal(first.contours.circleSegments.rimInner, 2 * input.rim.toothCount);
  assert.equal(first.verification.vertexCount, 1070);
  assert.equal(first.verification.triangleCount, 2140);
  const profile = buildGt2Contour(input.rim.toothCount, first.derived.outsideRadius);
  const grooveCenters = profile.filter((_, index) => index % 19 === 9);
  assert.equal(grooveCenters.length, input.rim.toothCount);
  for (const point of grooveCenters) {
    assert.ok(Math.abs(Math.hypot(...point) - first.derived.grooveRootRadius) < 1e-12);
  }
  const coordinateKeys = new Set();
  for (let index = 0; index < first.mesh.vertices.length; index += 3) {
    coordinateKeys.add(first.mesh.vertices.slice(index, index + 3).join(","));
  }
  assert.equal(coordinateKeys.size, first.verification.vertexCount, "base mesh must not contain coincident duplicate vertices");
  assert.equal(first.mesh.bounds.min[2], -3);
  assert.equal(first.mesh.bounds.max[2], 3);
  assertHorizontalBoundaryOrientation(first.mesh, first.derived);
  assert.deepEqual(first.verification.errors, []);
  assert.equal(first.verification.connectedComponents, 1);
  assert.ok(first.verification.signedVolume > 0);
  assert.deepEqual(verifyMesh(first.mesh), first.verification);
});

test("thin centered web creates valid shared-boundary steps", async () => {
  const input = await readJson("../examples/valid/solid-basic.json");
  input.web.axialThickness = 2;
  const result = generatePulley(input);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.derived.webLowerZ, -1);
  assert.equal(result.derived.webUpperZ, 1);
  assert.equal(result.verification.connectedComponents, 1);
  assert.equal(result.verification.errors.length, 0);
});

test("supported tooth-count and placement boundaries build closed meshes", async () => {
  const base = await readJson("../examples/valid/solid-basic.json");
  const minimum = structuredClone(base);
  minimum.rim.toothCount = 14;
  minimum.rim.radialThickness = 1;
  minimum.rim.toothedWidth = 2;
  minimum.web.axialThickness = 2;
  minimum.hub.boreDiameter = 0.5;
  minimum.hub.outerDiameter = 2.5;
  minimum.generation.maxChordError = 0.25;
  const maximum = structuredClone(base);
  maximum.rim.toothCount = 120;
  maximum.rim.toothedWidth = 50;
  maximum.rim.radialThickness = 25;
  maximum.web.axialThickness = 1;
  maximum.web.axialOffset = 24.5;
  maximum.hub.boreDiameter = 0.5;
  maximum.hub.outerDiameter = 2.5;
  maximum.generation.maxChordError = 0.01;
  for (const input of [minimum, maximum]) {
    const result = generatePulley(input);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.equal(result.verification.errors.length, 0);
    assert.equal(result.verification.connectedComponents, 1);
    assertHorizontalBoundaryOrientation(result.mesh, result.derived);
  }
});

test("concave rim caps stay outward across representative tooth counts", async () => {
  const base = await readJson("../examples/valid/solid-basic.json");
  base.rim.radialThickness = 1;
  base.hub.boreDiameter = 0.5;
  base.hub.outerDiameter = 2.5;
  for (const toothCount of [14, 15, 16, 20, 24, 40, 60, 80, 120]) {
    base.rim.toothCount = toothCount;
    const result = generatePulley(base);
    assert.equal(result.ok, true, `${toothCount}: ${JSON.stringify(result.diagnostics)}`);
    assertHorizontalBoundaryOrientation(result.mesh, result.derived);
  }
});

test("profile and circle discretization follow the geometry contract", () => {
  const radius = 24 / Math.PI - 0.254;
  const profile = buildGt2Contour(24, radius);
  assert.equal(profile.length, 456);
  assert.deepEqual(profile[9], [0, radius - 0.75]);
  assert.equal(circleSegmentCount(3, 0.05), 18);
});

test("rim support vertices keep their tooth-tip phase", async () => {
  const input = await readJson("../examples/valid/solid-basic.json");
  const result = generatePulley(input);
  const count = result.contours.circleSegments.rimInner;
  const points = buildCircleContour(result.derived.rimInnerRadius, count);
  assert.equal(count % (2 * input.rim.toothCount), 0);
  const verticesPerHalfPitch = count / (2 * input.rim.toothCount);
  for (let tooth = 0; tooth < input.rim.toothCount; tooth += 1) {
    const index = (2 * tooth + 1) * verticesPerHalfPitch;
    const actualAngle = Math.atan2(points[index][0], points[index][1]);
    const expectedAngle = (2 * tooth + 1) * Math.PI / input.rim.toothCount;
    const wrappedDifference = Math.atan2(Math.sin(actualAngle - expectedAngle), Math.cos(actualAngle - expectedAngle));
    assert.ok(Math.abs(wrappedDifference) < 1e-12, `tooth ${tooth} has no opposite support vertex`);
  }
});

test("12 and 13 grooves stay below the supported tooth-count range", async () => {
  const input = await readJson("../examples/valid/solid-basic.json");
  for (const toothCount of [12, 13]) {
    input.rim.toothCount = toothCount;
    const result = validateDescription(input);
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some(({ code, paths }) => code === "E_SCHEMA_VALUE" && paths.includes("/rim/toothCount")));
  }
});

test("cross-field invalid examples return their documented diagnostics", async () => {
  const cases = {
    "hub-wall.json": "E_HUB_WALL",
    "radial-order.json": "E_RADIAL_ORDER",
    "web-outside-rim.json": "E_WEB_AXIAL_RANGE",
    "spoke-overlap.json": "E_SPOKE_OVERLAP",
    "spoke-fillet.json": "E_SPOKE_FILLET",
    "schema-extra-field.json": "E_SCHEMA_VALUE"
  };
  assert.deepEqual(await exampleNames("invalid"), Object.keys(cases).sort(), "every invalid example needs an expected code");
  for (const [name, expected] of Object.entries(cases)) {
    const result = validateDescription(await readJson(`../examples/invalid/${name}`));
    assert.equal(result.ok, false, name);
    assert.equal(result.anchors, null, name);
    assert.ok(result.diagnostics.some(({ code }) => code === expected), `${name}: ${JSON.stringify(result.diagnostics)}`);
  }
});

test("solid webs need 0.5 mm of radial span, spokes keep 1 mm", async () => {
  const solid = await readJson("../examples/valid/trial-20t.json");
  const rimInnerRadius = 20 / Math.PI - 0.254 - 0.75 - solid.rim.radialThickness;
  const codes = (input) => validateDescription(input).diagnostics.map(({ code }) => code);
  solid.hub.outerDiameter = 2 * (rimInnerRadius - 0.5);
  assert.ok(!codes(solid).includes("E_RADIAL_ORDER"));
  solid.hub.outerDiameter = 2 * (rimInnerRadius - 0.45);
  assert.ok(codes(solid).includes("E_RADIAL_ORDER"));

  const spokes = await readJson("../examples/valid/trial-60t.json");
  const spokeRimInner = 60 / Math.PI - 0.254 - 0.75 - spokes.rim.radialThickness;
  spokes.web.filletRadius = 0.5;
  spokes.hub.outerDiameter = 2 * (spokeRimInner - 0.9);
  assert.ok(codes(spokes).includes("E_RADIAL_ORDER"));
});

test("validation is finite, strict, and does not mutate its input", async () => {
  const input = await readJson("../examples/valid/solid-basic.json");
  const snapshot = structuredClone(input);
  input.hub.boreDiameter = NaN;
  input.web.axialThickness = Infinity;
  input.rim.extra = 1;
  const result = validateDescription(input);
  assert.equal(result.ok, false);
  for (const path of ["/hub/boreDiameter", "/web/axialThickness", "/rim/extra"]) {
    assert.ok(result.diagnostics.some(({ code, paths }) => code === "E_SCHEMA_VALUE" && paths.includes(path)), path);
  }
  delete input.rim.extra;
  input.hub.boreDiameter = snapshot.hub.boreDiameter;
  input.web.axialThickness = snapshot.web.axialThickness;
  assert.deepEqual(input, snapshot);
});

test("anchors come with the normalized description, without building a mesh", async () => {
  const input = await readJson("../examples/valid/spokes-flanged.json");
  const { anchors, derived } = validateDescription(input);
  assert.deepEqual(anchors.zLevels, {
    lowerHub: -6.5, lowerFlange: -5.3, rimLower: -4.5, webLower: -2,
    webUpper: 2, rimUpper: 4.5, upperFlange: 5.7, upperHub: 7.5
  });
  assert.equal(anchors.radii.bore, 2.6);
  assert.equal(anchors.radii.pitch, derived.pitchRadius);
  assert.deepEqual(generatePulley(input).anchors, anchors);
});

test("a pinched vertex is reported even when every edge is paired", () => {
  // two tetrahedra touching only at the origin
  const vertices = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, -1, 0, 0, 0, -1, 0, 0, 0, -1];
  const faces = (a, b, c, d) => [a, c, b, a, b, d, b, c, d, a, d, c]; // outward for right-handed (a, b, c, d)
  const indices = [...faces(0, 1, 2, 3), ...faces(0, 5, 4, 6)];
  const mesh = { vertices, indices, bounds: { min: [-1, -1, -1], max: [1, 1, 1] } };
  const report = verifyMesh(mesh);
  assert.ok(report.errors.some(({ details }) => details?.rule === "vertexFan"), JSON.stringify(report.errors));
  assert.ok(!report.errors.some(({ details }) => details?.edge), "edges themselves are paired");
});

test("binary STL has valid size, triangle count, bounds, and optional bed placement", async () => {
  const input = await readJson("../examples/valid/solid-basic.json");
  const result = generatePulley(input);
  const model = exportBinaryStl(result.mesh);
  const bed = exportBinaryStl(result.mesh, { placement: "onBed" });
  const modelRead = readBinaryStl(model.data);
  const bedRead = readBinaryStl(bed.data);
  assert.equal(model.data.byteLength, 84 + 50 * result.verification.triangleCount);
  assert.equal(modelRead.triangleCount, result.verification.triangleCount);
  assert.ok(Math.abs(modelRead.bounds.min[2] + 3) < 1e-6);
  assert.ok(Math.abs(modelRead.bounds.max[2] - 3) < 1e-6);
  assert.ok(Math.abs(bedRead.bounds.min[2]) < 1e-6);
  assert.ok(Math.abs(bedRead.bounds.max[2] - 6) < 1e-6);
  assert.deepEqual(bed.placementTranslation, [0, 0, 3]);
  assert.deepEqual(model.sourceBounds, result.mesh.bounds);
});

test("flanges and independent hub extensions build one closed solid", async () => {
  const input = await readJson("../examples/valid/asymmetric.json");
  const result = generatePulley(input);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.mesh.bounds.min[2], -4);
  assert.equal(result.mesh.bounds.max[2], 6);
  assert.equal(result.verification.connectedComponents, 1);
  assert.deepEqual(result.verification.errors, []);
});

test("every valid example builds a closed solid of the expected size", async () => {
  const extraWarnings = { "trial-20t.json": ["W_THIN_FEATURE"] };
  for (const name of await exampleNames("valid")) {
    const input = await readJson(`../examples/valid/${name}`);
    const result = generatePulley(input);
    assert.equal(result.ok, true, `${name}: ${JSON.stringify(result.diagnostics)}`);
    assert.deepEqual(result.verification.errors, [], name);
    assert.deepEqual(result.diagnostics.map(({ code }) => code), [...(extraWarnings[name] ?? []), "W_EXPERIMENTAL_PROFILE"], name);

    // sizes straight from the contract formulas, not from derive()
    const { rim, flanges, hub } = input;
    const outsideRadius = rim.toothCount / Math.PI - 0.254;
    const flangeRadii = [flanges.lower, flanges.upper].filter(Boolean).map((flange) => outsideRadius + flange.radialExtension);
    const radius = Math.max(outsideRadius, ...flangeRadii);
    const bottom = -rim.toothedWidth / 2 - Math.max(hub.lowerExtension, flanges.lower?.axialThickness ?? 0);
    const top = rim.toothedWidth / 2 + Math.max(hub.upperExtension, flanges.upper?.axialThickness ?? 0);
    const { min, max } = result.mesh.bounds;
    assert.ok(Math.abs(max[0] - radius) < 1e-9 && Math.abs(min[0] + radius) < 1e-9, `${name}: radius ${max[0]} vs ${radius}`);
    assert.ok(Math.abs(min[2] - bottom) < 1e-12 && Math.abs(max[2] - top) < 1e-12, `${name}: height`);
  }
});

async function exampleNames(group) {
  return (await readdir(new URL(`../examples/${group}/`, import.meta.url))).filter((name) => name.endsWith(".json")).sort();
}

function readBinaryStl(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const triangleCount = view.getUint32(80, true);
  assert.equal(data.byteLength, 84 + triangleCount * 50);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let offset = 84;
  for (let face = 0; face < triangleCount; face += 1) {
    offset += 12;
    for (let vertex = 0; vertex < 3; vertex += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = view.getFloat32(offset, true);
        offset += 4;
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
      }
    }
    offset += 2;
  }
  return { triangleCount, bounds: { min, max } };
}

function assertHorizontalBoundaryOrientation(mesh, derived) {
  const topLevels = new Set([mesh.bounds.max[2], derived.webUpperZ]);
  const bottomLevels = new Set([mesh.bounds.min[2], derived.webLowerZ]);
  for (let face = 0; face < mesh.indices.length; face += 3) {
    const points = mesh.indices.slice(face, face + 3).map((id) => mesh.vertices.slice(id * 3, id * 3 + 3));
    if (!(points[0][2] === points[1][2] && points[1][2] === points[2][2])) continue;
    const ab = points[1].map((value, axis) => value - points[0][axis]);
    const ac = points[2].map((value, axis) => value - points[0][axis]);
    const normalZ = ab[0] * ac[1] - ab[1] * ac[0];
    const expected = topLevels.has(points[0][2]) ? 1 : bottomLevels.has(points[0][2]) ? -1 : 0;
    assert.notEqual(expected, 0, `unexpected horizontal level at z=${points[0][2]}`);
    assert.ok(normalZ * expected > 0, `horizontal face ${face / 3} has an inward normal`);
  }
}
