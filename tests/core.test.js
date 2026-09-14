import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("12 and 13 grooves are statically rejected because no v1 hub can fit", async () => {
  const input = await readJson("../examples/valid/solid-basic.json");
  for (const toothCount of [12, 13]) {
    input.rim.toothCount = toothCount;
    const result = validateDescription(input);
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some(({ code, paths }) => code === "E_SCHEMA_VALUE" && paths.includes("/rim/toothCount")));
  }
});

test("cross-field invalid examples return their documented diagnostics", async () => {
  const cases = [
    ["hub-wall.json", "E_HUB_WALL"],
    ["radial-order.json", "E_RADIAL_ORDER"],
    ["web-outside-rim.json", "E_WEB_AXIAL_RANGE"],
    ["spoke-overlap.json", "E_SPOKE_OVERLAP"],
    ["schema-extra-field.json", "E_SCHEMA_VALUE"]
  ];
  for (const [name, expected] of cases) {
    const result = validateDescription(await readJson(`../examples/invalid/${name}`));
    assert.equal(result.ok, false, name);
    assert.ok(result.diagnostics.some(({ code }) => code === expected), `${name}: ${JSON.stringify(result.diagnostics)}`);
  }
});

test("validation is finite, strict, and does not mutate its input", async () => {
  const input = await readJson("../examples/valid/solid-basic.json");
  const snapshot = structuredClone(input);
  input.hub.boreDiameter = NaN;
  input.rim.extra = 1;
  const result = validateDescription(input);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(({ code, paths }) => code === "E_SCHEMA_VALUE" && paths.includes("/hub/boreDiameter")));
  assert.ok(result.diagnostics.some(({ code, paths }) => code === "E_SCHEMA_VALUE" && paths.includes("/rim/extra")));
  delete input.rim.extra;
  input.hub.boreDiameter = snapshot.hub.boreDiameter;
  assert.deepEqual(input, snapshot);
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

test("stage-2 scope is reported explicitly for later construction variants", async () => {
  const input = await readJson("../examples/valid/asymmetric.json");
  const result = generatePulley(input);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(({ code }) => code === "E_STAGE2_UNSUPPORTED"));
  assert.equal(Object.hasOwn(result, "mesh"), false);
});

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
