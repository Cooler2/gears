import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { generatePulley, validateDescription } from "../src/core/generate.js";
import { buildGt2Contour, buildMarkedCircle, circleSegmentCount } from "../src/core/contours.js";
import { triangulateSimplePolygon } from "../src/core/mesh-builder.js";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

const FLANGE_VARIANTS = {
  none: { lower: null, upper: null },
  lower: { lower: { axialThickness: 0.8, radialExtension: 1 }, upper: null },
  upper: { lower: null, upper: { axialThickness: 1.2, radialExtension: 1.5 } },
  both: { lower: { axialThickness: 0.8, radialExtension: 1 }, upper: { axialThickness: 1.2, radialExtension: 1.5 } }
};
const SPOKES = { type: "spokes", count: 6, width: 3, filletRadius: 1 };
// toothedWidth is 9 in the base example, so ±2.5 with thickness 4 touches a rim end
const WEB_VARIANTS = {
  solidFull: { type: "solid", axialThickness: 9, axialOffset: 0 },
  solidThin: { type: "solid", axialThickness: 2, axialOffset: 0.5 },
  solidAtLower: { type: "solid", axialThickness: 4, axialOffset: -2.5 },
  spokesCentered: { ...SPOKES, axialThickness: 4, axialOffset: 0 },
  spokesAtUpper: { ...SPOKES, axialThickness: 4, axialOffset: 2.5 },
  spokesFull: { ...SPOKES, axialThickness: 9, axialOffset: 0 }
};
const HUB_VARIANTS = [[0, 0], [2, 0], [0, 3], [2, 3]];

test("every flange, web and hub-extension combination builds one closed solid", async () => {
  const base = await readJson("../examples/valid/spokes-flanged.json");
  for (const [flangeName, flanges] of Object.entries(FLANGE_VARIANTS)) {
    for (const [webName, web] of Object.entries(WEB_VARIANTS)) {
      for (const [lowerExtension, upperExtension] of HUB_VARIANTS) {
        const input = { ...structuredClone(base), flanges, web };
        Object.assign(input.hub, { lowerExtension, upperExtension });
        const label = `${flangeName}/${webName}/hub ${lowerExtension},${upperExtension}`;
        const result = generatePulley(input);
        assert.equal(result.ok, true, `${label}: ${JSON.stringify(result.diagnostics)}`);
        assert.deepEqual(result.verification.errors, [], label);
        assert.equal(result.verification.connectedComponents, 1, label);
        assertNoDuplicateVertices(result.mesh, label);
        assertExpectedBounds(input, result, label);
        if (web.type === "solid") {
          const expected = expectedSolidWebVolume(input, result.derived);
          assert.ok(Math.abs(result.verification.signedVolume - expected) < 1e-9 * expected, `${label}: volume`);
        }
      }
    }
  }
});

test("spokes, fillets and windows match the analytic shape at sample points", async () => {
  const base = await readJson("../examples/valid/spokes-flanged.json");
  const wide = structuredClone(base);
  // wide spokes on a small hub: the fillet ends lie below the hub's widest chord
  Object.assign(wide.web, { count: 3, width: 7.5, filletRadius: 0.8, axialThickness: 5, axialOffset: -2 });
  Object.assign(wide.hub, { boreDiameter: 5, outerDiameter: 11 });
  const narrow = structuredClone(base);
  // narrow spokes on a large rim with coarse arcs: the rim guard vertex matters
  Object.assign(narrow.rim, { toothCount: 120, radialThickness: 1.5 });
  Object.assign(narrow.web, { count: 12, width: 1, filletRadius: 0.5, axialThickness: 3, axialOffset: 3 });
  narrow.generation.maxChordError = 0.25;
  const large = structuredClone(base);
  // large fillets leave corner fills much wider than the sampling margin
  Object.assign(large.rim, { toothCount: 80 });
  Object.assign(large.web, { count: 3, width: 6, filletRadius: 3 });
  large.hub.outerDiameter = 24;
  const cases = [["example", base], ["wide", wide], ["narrow", narrow], ["large fillets", large]];
  for (const [label, input] of cases) {
    const result = generatePulley(input);
    assert.equal(result.ok, true, `${label}: ${JSON.stringify(result.diagnostics)}`);
    const margin = 1.5 * input.generation.maxChordError + 1e-4;
    const triangles = meshTriangles(result.mesh);
    let checked = 0;
    for (const point of samplePoints(result.derived, input)) {
      const expected = expectedMaterial(input, result.derived, point, margin);
      if (expected === null) continue;
      checked += 1;
      assert.equal(insideMesh(triangles, point), expected, `${label}: point ${point.map((value) => value.toFixed(3))}`);
    }
    assert.ok(checked > 300, `${label}: only ${checked} sample points away from boundaries`);
  }
});

test("spoke layouts across the supported ranges build closed solids", async () => {
  const base = await readJson("../examples/valid/spokes-flanged.json");
  let built = 0;
  for (const toothCount of [20, 37, 60, 120]) {
    for (const count of [3, 5, 8, 12]) {
      for (const maxChordError of [0.01, 0.07, 0.25]) {
        for (const [width, filletRadius] of [[1, 0.5], [2.5, 1], [4, 2]]) {
          const input = structuredClone(base);
          Object.assign(input.rim, { toothCount });
          Object.assign(input.web, { count, width, filletRadius });
          input.generation.maxChordError = maxChordError;
          const validation = validateDescription(input);
          if (!validation.ok) continue;
          const result = generatePulley(input);
          const label = `N=${toothCount} spokes=${count} B=${width} Rf=${filletRadius} e=${maxChordError}`;
          assert.equal(result.ok, true, `${label}: ${JSON.stringify(result.diagnostics)}`);
          assert.equal(result.verification.connectedComponents, 1, label);
          built += 1;
        }
      }
    }
  }
  assert.ok(built > 60, `only ${built} combinations were valid`);
});

test("fillets that exactly fill the radial span leave no straight spoke side", async () => {
  const input = await readJson("../examples/valid/spokes-flanged.json");
  input.hub.outerDiameter = 24;
  const { derived } = validateDescription(input);
  // the largest allowed fillet: 2R_f = R_i − R_h, and the smallest spoke for it
  input.web.filletRadius = (derived.rimInnerRadius - derived.hubRadius) / 2;
  input.web.width = 2 * input.web.filletRadius;
  const result = generatePulley(input);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.verification.errors, []);
  assertNoDuplicateVertices(result.mesh, "no straight side");
});

test("spoke fillet and overlap limits are rejected with addressed diagnostics", async () => {
  const base = await readJson("../examples/valid/spokes-flanged.json");
  const cases = [
    // fillet wider than half the spoke
    [{ web: { width: 3, filletRadius: 1.6 } }, "E_SPOKE_FILLET", "/web/filletRadius"],
    // two fillets do not fit between the hub (R_h = 13) and the rim (R_i ≈ 16.1)
    [{ web: { width: 4, filletRadius: 2 }, hub: { outerDiameter: 26 } }, "E_SPOKE_FILLET", "/web/filletRadius"],
    [{ web: { count: 12, width: 2, filletRadius: 1 } }, "E_SPOKE_OVERLAP", "/web/count"],
    [{ web: { count: 3, width: 9, filletRadius: 1.5 } }, "E_SPOKE_OVERLAP", "/web/width"]
  ];
  for (const [patch, code, path] of cases) {
    const input = structuredClone(base);
    Object.assign(input.web, patch.web);
    Object.assign(input.hub, patch.hub);
    const result = generatePulley(input);
    assert.equal(result.ok, false, JSON.stringify(patch));
    assert.equal(result.mesh, undefined);
    assert.ok(result.diagnostics.some((item) => item.code === code && item.paths.includes(path)), `${JSON.stringify(patch)}: ${JSON.stringify(result.diagnostics)}`);
  }
});

test("ear clipping covers a concave polygon with positive triangles", () => {
  const points = [[0, 0], [4, 0], [4, 3], [2, 1], [0, 3]];
  const triangles = triangulateSimplePolygon(points);
  assert.equal(triangles.length, points.length - 2);
  let area = 0;
  for (const [a, b, c] of triangles) {
    const doubled = cross2(points[a], points[b], points[c]);
    assert.ok(doubled > 0);
    area += doubled / 2;
  }
  assert.equal(area, 8);
});

function assertNoDuplicateVertices(mesh, label) {
  const keys = new Set();
  for (let index = 0; index < mesh.vertices.length; index += 3) keys.add(mesh.vertices.slice(index, index + 3).join(","));
  assert.equal(keys.size, mesh.vertices.length / 3, `${label}: coincident vertices`);
}

function assertExpectedBounds(input, result, label) {
  const { derived } = result;
  const halfWidth = input.rim.toothedWidth / 2;
  const lowerZ = Math.min(derived.hubLowerZ, -halfWidth - (input.flanges.lower?.axialThickness ?? 0));
  const upperZ = Math.max(derived.hubUpperZ, halfWidth + (input.flanges.upper?.axialThickness ?? 0));
  assert.equal(result.mesh.bounds.min[2], lowerZ, `${label}: min z`);
  assert.equal(result.mesh.bounds.max[2], upperZ, `${label}: max z`);
  // a flange edge has a vertex on the +Y ray, so its radius is the exact extent
  if (input.flanges.lower || input.flanges.upper) assert.equal(result.mesh.bounds.max[1], derived.bounds.max[1], `${label}: max y`);
}

/** Volume of the stacked prisms, from shoelace areas of the same discretised contours. */
function expectedSolidWebVolume(input, derived) {
  const error = input.generation.maxChordError;
  const N = input.rim.toothCount;
  const halfPitch = Array.from({ length: 2 * N }, (_, index) => index * Math.PI / N);
  const circleArea = (radius, marks = []) => polygonArea(buildMarkedCircle(radius, circleSegmentCount(radius, error), marks).points);
  const rimInner = circleArea(derived.rimInnerRadius, halfPitch);
  const hub = circleArea(derived.hubRadius);
  let volume = (polygonArea(buildGt2Contour(N, derived.outsideRadius)) - rimInner) * input.rim.toothedWidth;
  volume += (hub - circleArea(derived.boreRadius)) * (derived.hubUpperZ - derived.hubLowerZ);
  volume += (rimInner - hub) * (derived.webUpperZ - derived.webLowerZ);
  for (const flange of [input.flanges.lower, input.flanges.upper]) {
    if (flange) volume += (circleArea(derived.outsideRadius + flange.radialExtension, halfPitch) - rimInner) * flange.axialThickness;
  }
  return volume;
}

function polygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x0, y0] = points[index];
    const [x1, y1] = points[(index + 1) % points.length];
    area += x1 * y0 - x0 * y1; // contours run clockwise
  }
  return area / 2;
}

function* samplePoints(derived, input) {
  const radius = derived.grooveRootRadius;
  const halfWidth = input.rim.toothedWidth / 2;
  const levels = [
    (derived.webLowerZ + derived.webUpperZ) / 2,
    derived.webLowerZ + 0.3,
    derived.webUpperZ + 0.4,
    derived.webLowerZ - 0.4,
    derived.hubUpperZ - 0.3,
    halfWidth + 0.3
  ];
  const steps = 28;
  for (const z of levels) {
    for (let i = 0; i <= steps; i += 1) {
      for (let j = 0; j <= steps; j += 1) {
        // irrational offsets keep samples off the symmetry lines
        const x = -radius + 2 * radius * (i + 0.2718) / (steps + 1);
        const y = -radius + 2 * radius * (j + 0.3141) / (steps + 1);
        if (Math.hypot(x, y) < radius) yield [x, y, z];
      }
    }
  }
  if (input.web.type !== "spokes") return;

  // dense patches around the four fillet centres of two spokes: the corner
  // fills are too small for the coarse grid
  const { count, width, filletRadius } = input.web;
  const centerV = width / 2 + filletRadius;
  const centersU = [
    Math.sqrt((derived.hubRadius + filletRadius) ** 2 - centerV ** 2),
    Math.sqrt((derived.rimInnerRadius - filletRadius) ** 2 - centerV ** 2)
  ];
  // bounding boxes (u0, u1, v0, v1) of the corner fills: from the sharp corner
  // of the straight side to the tangent points T1 and T4
  const hubScale = derived.hubRadius / (derived.hubRadius + filletRadius);
  const rimScale = derived.rimInnerRadius / (derived.rimInnerRadius - filletRadius);
  const corners = [
    [Math.sqrt(derived.hubRadius ** 2 - (width / 2) ** 2), centersU[0], width / 2, centerV * hubScale],
    [centersU[1], Math.sqrt(derived.rimInnerRadius ** 2 - (width / 2) ** 2), width / 2, centerV * rimScale]
  ];
  const z = (derived.webLowerZ + derived.webUpperZ) / 2;
  const toXY = (angle, u, v) => [u * Math.sin(angle) + v * Math.cos(angle), u * Math.cos(angle) - v * Math.sin(angle), z];
  for (const spoke of [0, 1]) {
    const angle = 2 * Math.PI * spoke / count;
    for (const side of [-1, 1]) {
      for (const centerU of centersU) {
        for (let i = -6; i <= 6; i += 1) {
          for (let j = -6; j <= 6; j += 1) {
            yield toXY(angle, centerU + filletRadius * (i + 0.137) / 4, side * (centerV + filletRadius * (j + 0.291) / 4));
          }
        }
      }
      for (const [u0, u1, v0, v1] of corners) {
        for (let i = 0; i < 12; i += 1) {
          for (let j = 0; j < 12; j += 1) {
            yield toXY(angle, u0 + (u1 - u0) * (i + 0.5) / 12, side * (v0 + (v1 - v0) * (j + 0.5) / 12));
          }
        }
      }
    }
  }
}

/** Material at a point from the analytic description, or null within margin of a boundary. */
function expectedMaterial(input, derived, [x, y, z], margin) {
  const r = Math.hypot(x, y);
  const halfWidth = input.rim.toothedWidth / 2;
  const shellLowerZ = -halfWidth - (input.flanges.lower?.axialThickness ?? 0);
  const shellUpperZ = halfWidth + (input.flanges.upper?.axialThickness ?? 0);
  const { boreRadius, hubRadius, rimInnerRadius, grooveRootRadius, hubLowerZ, hubUpperZ, webLowerZ, webUpperZ } = derived;
  const radii = [boreRadius, hubRadius, rimInnerRadius, grooveRootRadius];
  const levels = [hubLowerZ, hubUpperZ, webLowerZ, webUpperZ, shellLowerZ, shellUpperZ, -halfWidth, halfWidth];
  if (radii.some((value) => Math.abs(r - value) < margin) || levels.some((value) => Math.abs(z - value) < margin)) return null;
  if (r > grooveRootRadius) return null; // teeth are not modelled here
  if (r < boreRadius) return false;
  if (r < hubRadius) return z > hubLowerZ && z < hubUpperZ;
  if (r > rimInnerRadius) return z > shellLowerZ && z < shellUpperZ;
  if (z < webLowerZ || z > webUpperZ) return false;
  if (input.web.type === "solid") return true;

  const { count, width, filletRadius } = input.web;
  const centerV = width / 2 + filletRadius;
  const hubCenterU = Math.sqrt((hubRadius + filletRadius) ** 2 - centerV ** 2);
  const rimCenterU = Math.sqrt((rimInnerRadius - filletRadius) ** 2 - centerV ** 2);
  let material = false;
  for (let spoke = 0; spoke < count; spoke += 1) {
    const angle = 2 * Math.PI * spoke / count;
    const u = x * Math.sin(angle) + y * Math.cos(angle);
    const w = Math.abs(x * Math.cos(angle) - y * Math.sin(angle));
    if (u <= 0) continue;
    const toHubCenter = Math.hypot(u - hubCenterU, w - centerV);
    const toRimCenter = Math.hypot(u - rimCenterU, w - centerV);
    if (Math.abs(w - width / 2) < margin || Math.abs(toHubCenter - filletRadius) < margin || Math.abs(toRimCenter - filletRadius) < margin) return null;
    if (w < width / 2) material = true;
    // corner fill between the straight side, the circle and the fillet arc
    else if (u < hubCenterU && w * hubCenterU < centerV * u && toHubCenter > filletRadius) material = true;
    else if (u > rimCenterU && w * rimCenterU < centerV * u && toRimCenter > filletRadius) material = true;
  }
  return material;
}

function meshTriangles(mesh) {
  const data = new Float64Array(mesh.indices.length * 3);
  const maxima = new Float64Array(mesh.indices.length);
  mesh.indices.forEach((id, index) => {
    for (let axis = 0; axis < 3; axis += 1) data[index * 3 + axis] = mesh.vertices[id * 3 + axis];
  });
  for (let offset = 0; offset < data.length; offset += 9) {
    for (let axis = 0; axis < 3; axis += 1) {
      maxima[offset / 3 + axis] = Math.max(data[offset + axis], data[offset + 3 + axis], data[offset + 6 + axis]);
    }
  }
  return { data, maxima };
}

/** Ray parity test along a fixed direction that is not parallel to any model plane. */
function insideMesh({ data: triangles, maxima }, point) {
  // every direction component is positive, so triangles entirely behind the point on any axis are missed
  const direction = normalize([0.5773, 0.3141, 0.7536]);
  let crossings = 0;
  for (let offset = 0; offset < triangles.length; offset += 9) {
    const bound = offset / 3;
    if (maxima[bound] < point[0] || maxima[bound + 1] < point[1] || maxima[bound + 2] < point[2]) continue;
    const a = triangles.subarray(offset, offset + 3);
    const edge1 = [triangles[offset + 3] - a[0], triangles[offset + 4] - a[1], triangles[offset + 5] - a[2]];
    const edge2 = [triangles[offset + 6] - a[0], triangles[offset + 7] - a[1], triangles[offset + 8] - a[2]];
    const p = cross(direction, edge2);
    const determinant = dot(edge1, p);
    if (Math.abs(determinant) < 1e-15) continue;
    const s = [point[0] - a[0], point[1] - a[1], point[2] - a[2]];
    const u = dot(s, p) / determinant;
    if (u < 0 || u > 1) continue;
    const q = cross(s, edge1);
    const v = dot(direction, q) / determinant;
    if (v < 0 || u + v > 1) continue;
    if (dot(edge2, q) / determinant > 0) crossings += 1;
  }
  return crossings % 2 === 1;
}

function normalize(vector) {
  const length = Math.hypot(...vector);
  return vector.map((value) => value / length);
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross2(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
