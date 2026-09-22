import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { generatePulley, validateDescription } from "../src/core/generate.js";
import { boreExtents, buildBoreContour, buildMarkedCircle, circleSegmentCount } from "../src/core/contours.js";
import { triangulateSimplePolygon } from "../src/core/mesh-builder.js";
import { rimSurface } from "../src/core/rims.js";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

/** The base example as a timing pulley and as a smooth idler of about the same size. */
async function kindBases() {
  const timing = await readJson("../examples/valid/spokes-flanged.json");
  const idler = { ...structuredClone(timing), kind: "idlerPulley", rim: { outerDiameter: 40, width: timing.rim.width, radialThickness: 2 } };
  const gear = {
    ...structuredClone(timing), kind: "gear",
    rim: { module: 1, toothCount: 40, pressureAngle: 20, profileShift: 0.2, backlash: 0.1, helix: "none", width: timing.rim.width, radialThickness: 2 }
  };
  const inclined = (helix, helixAngle) => ({ ...structuredClone(gear), rim: { ...gear.rim, helix, helixAngle } });
  return { timing, idler, gear, helical: inclined("helical", -25), herringbone: inclined("herringbone", 40) };
}

const FLANGE_VARIANTS = {
  none: { lower: null, upper: null },
  lower: { lower: { axialThickness: 0.8, radialExtension: 1 }, upper: null },
  upper: { lower: null, upper: { axialThickness: 1.2, radialExtension: 1.5 } },
  both: { lower: { axialThickness: 0.8, radialExtension: 1 }, upper: { axialThickness: 1.2, radialExtension: 1.5 } }
};
const SPOKES = { type: "spokes", count: 6, width: 3, filletRadius: 1 };
// the rim width is 9 in the base example and the flanges add up to 2, so the web is 2…11 thick;
// an aligned or full web shares its planes with the flanges, the hub or the rim ends;
// the tapered ones reach the faces, stop before a taller side or, at 60°, get shortened
const CYLINDERS = { hubTaper: 0, rimTaper: 0 };
const WEB_VARIANTS = {
  solidFull: { type: "solid", thinning: 0, alignment: "lower", axialOffset: 0, ...CYLINDERS },
  solidThin: { type: "solid", thinning: 7, alignment: "center", axialOffset: 0.5, ...CYLINDERS },
  solidAtLower: { type: "solid", thinning: 5, alignment: "lower", axialOffset: 0, ...CYLINDERS },
  solidShifted: { type: "solid", thinning: 6, alignment: "lower", axialOffset: 0.8, ...CYLINDERS },
  spokesCentered: { ...SPOKES, thinning: 5, alignment: "center", axialOffset: 0, ...CYLINDERS },
  spokesAtUpper: { ...SPOKES, thinning: 5, alignment: "upper", axialOffset: 0, ...CYLINDERS },
  spokesFull: { ...SPOKES, thinning: 0, alignment: "center", axialOffset: 0, ...CYLINDERS },
  taperedAtLower: { type: "solid", thinning: 5, alignment: "lower", axialOffset: 0, hubTaper: 30, rimTaper: 30 },
  taperedThin: { type: "solid", thinning: 7, alignment: "center", axialOffset: 0.5, hubTaper: 45, rimTaper: 20 },
  taperedHubOnly: { type: "solid", thinning: 6, alignment: "upper", axialOffset: -0.8, hubTaper: 35, rimTaper: 0 },
  taperedShortened: { type: "solid", thinning: 7, alignment: "center", axialOffset: 0, hubTaper: 60, rimTaper: 60 },
  taperedSpokes: { ...SPOKES, thinning: 5, alignment: "center", axialOffset: 0, hubTaper: 35, rimTaper: 20 },
  none: { type: "none" }
};
const HUB_VARIANTS = [[0, 0], [2, 0], [0, 3], [2, 3]];
// sizes for a 12 mm hub; each shape reaches close to the 1 mm wall limit somewhere
const BORE_VARIANTS = {
  triangle: { shape: "polygon", diameter: 8, sides: 3 },
  square: { shape: "polygon", diameter: 8.5, sides: 4 },
  hexagon: { shape: "polygon", diameter: 8.7, sides: 6 },
  dodecagon: { shape: "polygon", diameter: 9.3, sides: 12 },
  flat: { shape: "dFlat", diameter: 5, flatDistance: 4.5 },
  deepFlat: { shape: "dFlat", diameter: 9, flatDistance: 4.6 },
  keyed: { shape: "keyed", diameter: 6, keyWidth: 2, keyDepth: 1 },
  wideKey: { shape: "keyed", diameter: 6, keyWidth: 5.5, keyDepth: 0.5 }
};

test("every kind, flange, web and hub-extension combination builds one closed solid", async () => {
  for (const [kindName, base] of Object.entries(await kindBases())) {
  for (const [flangeName, flanges] of Object.entries(FLANGE_VARIANTS)) {
    // a gear has no flanges
    if (base.kind === "gear" && flangeName !== "none") continue;
    for (const [webName, web] of Object.entries(WEB_VARIANTS)) {
      for (const [lowerExtension, upperExtension] of HUB_VARIANTS) {
        const input = { ...structuredClone(base), flanges, web };
        Object.assign(input.hub, { lowerExtension, upperExtension });
        const label = `${kindName}/${flangeName}/${webName}/hub ${lowerExtension},${upperExtension}`;
        const result = generatePulley(input);
        assert.equal(result.ok, true, `${label}: ${JSON.stringify(result.diagnostics)}`);
        assert.deepEqual(result.verification.errors, [], label);
        assert.equal(result.verification.connectedComponents, 1, label);
        assertNoDuplicateVertices(result.mesh, label);
        assertExpectedBounds(input, result, label);
        if (web.type !== "spokes") {
          const expected = expectedSolidWebVolume(input, result.derived);
          // between turned sections the working surface sinks inwards by no more than the chord tolerance
          const helical = base.rim.helix && base.rim.helix !== "none";
          const tolerance = helical ? outlinePerimeter(input) * input.generation.maxChordError * input.rim.width : 1e-9 * expected;
          assert.ok(Math.abs(result.verification.signedVolume - expected) < tolerance, `${label}: volume ${result.verification.signedVolume} vs ${expected}`);
        }
      }
    }
  }
  }
});

test("every bore shape builds one closed solid with the volume of its contour", async () => {
  const base = await readJson("../examples/valid/spokes-flanged.json");
  for (const [boreName, bore] of Object.entries(BORE_VARIANTS)) {
    for (const webName of ["solidFull", "solidThin", "spokesCentered"]) {
      for (const maxChordError of [0.01, 0.25]) {
        const input = { ...structuredClone(base), web: WEB_VARIANTS[webName], bore };
        input.generation.maxChordError = maxChordError;
        const label = `${boreName}/${webName}/ε ${maxChordError}`;
        const result = generatePulley(input);
        assert.equal(result.ok, true, `${label}: ${JSON.stringify(result.diagnostics)}`);
        assert.deepEqual(result.verification.errors, [], label);
        assert.equal(result.verification.connectedComponents, 1, label);
        assertNoDuplicateVertices(result.mesh, label);
        if (webName !== "spokesCentered") {
          const expected = expectedSolidWebVolume(input, result.derived);
          assert.ok(Math.abs(result.verification.signedVolume - expected) < 1e-9 * expected, `${label}: volume`);
        }
      }
    }
  }
});

test("bore contours are loops around the axis with their exact sizes", () => {
  for (const [name, bore] of Object.entries({ round: { shape: "round", diameter: 5 }, ...BORE_VARIANTS })) {
    for (const maxChordError of [0.01, 0.25]) {
      const label = `${name}/ε ${maxChordError}`;
      const { points } = buildBoreContour(bore, maxChordError);
      assert.equal(points[0][0], 0, `${label}: starts on the +Y ray`);
      assert.ok(points[0][1] > 0, label);
      const angles = points.map(([x, y]) => (Math.atan2(x, y) + 2 * Math.PI) % (2 * Math.PI));
      for (let index = 1; index < angles.length; index += 1) assert.ok(angles[index] > angles[index - 1], `${label}: clockwise at ${index}`);

      // extents from the contour itself: the farthest vertex and where the ±X rays cross it
      const radius = bore.diameter / 2;
      const extents = boreExtents(bore);
      const farthest = Math.max(...points.map((point) => Math.hypot(...point)));
      assert.ok(Math.abs(farthest - extents.outerRadius) < 1e-12, `${label}: outer radius ${farthest} vs ${extents.outerRadius}`);
      assert.ok(Math.abs(rayCrossing(points, 1) - extents.positiveX) <= maxChordError, `${label}: +X`);
      assert.ok(Math.abs(rayCrossing(points, -1) - extents.negativeX) <= maxChordError, `${label}: −X`);

      // area within the chord tolerance of the exact shape
      const perimeter = points.reduce((sum, point, index) => sum + Math.hypot(...point.map((value, axis) => value - points[(index + 1) % points.length][axis])), 0);
      assert.ok(Math.abs(polygonArea(points) - exactBoreArea(bore)) <= perimeter * maxChordError, `${label}: area`);
      if (bore.shape === "polygon") assert.ok(Math.abs(polygonArea(points) - exactBoreArea(bore)) < 1e-12 * radius ** 2, `${label}: polygon area is exact`);
    }
  }
});

test("shaped bores match the analytic shape at sample points", async () => {
  const base = await readJson("../examples/valid/spokes-flanged.json");
  base.generation.maxChordError = 0.1;
  for (const [name, bore] of Object.entries(BORE_VARIANTS)) {
    const input = { ...structuredClone(base), bore };
    const result = generatePulley(input);
    assert.equal(result.ok, true, `${name}: ${JSON.stringify(result.diagnostics)}`);
    const triangles = meshTriangles(result.mesh);
    const margin = 1.5 * input.generation.maxChordError + 1e-4;
    const z = result.derived.hubUpperZ - 0.7; // above the web, where only the hub is material
    const hubRadius = result.derived.hubRadius;
    let checked = 0;
    const steps = 30;
    for (let i = 0; i <= steps; i += 1) {
      for (let j = 0; j <= steps; j += 1) {
        const x = -hubRadius + 2 * hubRadius * (i + 0.2718) / (steps + 1);
        const y = -hubRadius + 2 * hubRadius * (j + 0.3141) / (steps + 1);
        if (Math.hypot(x, y) > hubRadius - margin) continue;
        const inside = insideBore(bore, x, y, margin);
        if (inside === null) continue;
        checked += 1;
        assert.equal(insideMesh(triangles, [x, y, z]), !inside, `${name}: point ${x.toFixed(3)}, ${y.toFixed(3)}`);
      }
    }
    assert.ok(checked > 400, `${name}: only ${checked} sample points away from boundaries`);
  }
});

test("spokes, fillets and windows match the analytic shape at sample points", async () => {
  const base = await readJson("../examples/valid/spokes-flanged.json");
  const wide = structuredClone(base);
  // wide spokes on a small hub: the fillet ends lie below the hub's widest chord
  Object.assign(wide.web, { count: 3, width: 7.5, filletRadius: 0.8, thinning: 6, alignment: "lower", axialOffset: 0 });
  wide.bore.diameter = 5;
  wide.hub.outerDiameter = 11;
  const narrow = structuredClone(base);
  // narrow spokes on a large rim with coarse arcs: the rim guard vertex matters
  Object.assign(narrow.rim, { toothCount: 120, radialThickness: 1.5 });
  Object.assign(narrow.web, { count: 12, width: 1, filletRadius: 0.5, thinning: 8, alignment: "upper", axialOffset: 0 });
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
  const halfWidth = input.rim.width / 2;
  const lowerZ = -halfWidth - (input.flanges.lower?.axialThickness ?? 0) - Math.max(input.hub.lowerExtension, 0);
  const upperZ = halfWidth + (input.flanges.upper?.axialThickness ?? 0) + Math.max(input.hub.upperExtension, 0);
  assert.equal(result.mesh.bounds.min[2], lowerZ, `${label}: min z`);
  assert.equal(result.mesh.bounds.max[2], upperZ, `${label}: max z`);
  // a flange edge has a vertex on the +Y ray, so its radius is the exact extent
  if (input.flanges.lower || input.flanges.upper) assert.equal(result.mesh.bounds.max[1], derived.bounds.max[1], `${label}: max y`);
}

/** Where the ray from the axis along direction·X leaves the loop, as a distance. */
function rayCrossing(points, direction) {
  for (let index = 0; index < points.length; index += 1) {
    const [x0, y0] = points[index];
    const [x1, y1] = points[(index + 1) % points.length];
    if ((y0 > 0) === (y1 > 0) && y0 !== 0) continue;
    const x = y0 === y1 ? Math.max(x0 * direction, x1 * direction) * direction : x0 + (x1 - x0) * (0 - y0) / (y1 - y0);
    if (x * direction > 0) return x * direction;
  }
  return NaN;
}

function exactBoreArea(bore) {
  const radius = bore.diameter / 2;
  const circle = Math.PI * radius ** 2;
  if (bore.shape === "polygon") return bore.sides * radius ** 2 * Math.sin(2 * Math.PI / bore.sides) / 2;
  // a segment of height h cut off a circle: r²acos((r − h)/r) − (r − h)√(2rh − h²)
  const segment = (height) => radius ** 2 * Math.acos((radius - height) / radius) - (radius - height) * Math.sqrt(2 * radius * height - height ** 2);
  if (bore.shape === "dFlat") return circle - segment(bore.diameter - bore.flatDistance);
  if (bore.shape === "keyed") {
    const half = bore.keyWidth / 2;
    const edge = Math.sqrt(radius ** 2 - half ** 2);
    return circle - segment(radius - edge) + 2 * half * (radius + bore.keyDepth - edge);
  }
  return circle;
}

/** Point inside the bore from its analytic description, or null within margin of its outline. */
function insideBore(bore, x, y, margin) {
  const radius = bore.diameter / 2;
  const r = Math.hypot(x, y);
  const near = (value, edge) => Math.abs(value - edge) < margin;
  if (bore.shape === "polygon") {
    const distances = Array.from({ length: bore.sides }, (_, k) => {
      const angle = Math.PI / 2 + 2 * Math.PI * k / bore.sides; // side middles, clockwise from +Y
      return x * Math.sin(angle) + y * Math.cos(angle);
    });
    const apothem = radius * Math.cos(Math.PI / bore.sides);
    if (distances.some((distance) => near(distance, apothem))) return null;
    return distances.every((distance) => distance < apothem);
  }
  if (bore.shape === "dFlat") {
    const flat = bore.flatDistance - radius;
    if (near(r, radius) || near(x, flat)) return null;
    return r < radius && x < flat;
  }
  if (bore.shape === "keyed") {
    const half = bore.keyWidth / 2;
    const bottom = radius + bore.keyDepth;
    if (near(r, radius) || (x > 0 && (near(Math.abs(y), half) || near(x, bottom)))) return null;
    return r < radius || (Math.abs(y) < half && x > 0 && x < bottom);
  }
  if (near(r, radius)) return null;
  return r < radius;
}

/** Volume of the stacked prisms, from shoelace areas of the same discretised contours. */
/**
 * Volume of a part with a solid web or without one, slice by slice. A tapered
 * surface is a stack of circles with one vertex count, similar to each other, so
 * the area of a slice is quadratic in z between the cone ends and Simpson's rule
 * over each piece is exact.
 */
function expectedSolidWebVolume(input, derived) {
  const error = input.generation.maxChordError;
  const surface = rimSurface(input.kind, input.rim, { outside: derived.outsideRadius }, error);
  const circleArea = (radius, marks = [], segments = circleSegmentCount(radius, error)) => polygonArea(buildMarkedCircle(radius, segments, marks).points);
  const corners = buildBoreContour(input.bore, error).corners;
  // without a web the rim reaches the hub, and the hub loop carries the rim marks too
  const noWeb = input.web.type === "none";
  const { webLowerZ, webUpperZ, hubRadius, rimInnerRadius, hubWebRadius, rimInnerWebRadius } = derived;
  const hubMarks = noWeb ? [...corners, ...surface.marks] : corners;
  const hubSegments = circleSegmentCount(hubWebRadius, error);
  const rimSegments = circleSegmentCount(noWeb ? hubWebRadius : rimInnerRadius, error);
  // the radius leaves its web value at the taper angle and stops at the base radius
  const radiusAt = (base, web, angle, z) => {
    const distance = Math.max(webLowerZ - z, z - webUpperZ, 0);
    const change = Math.max(Math.abs(web - base) - distance * Math.tan(angle * Math.PI / 180), 0);
    return base + Math.sign(web - base) * change;
  };
  const hubArea = (z) => circleArea(radiusAt(hubRadius, hubWebRadius, input.web.hubTaper ?? 0, z), hubMarks, hubSegments);
  const rimInnerArea = noWeb ? hubArea : (z) => circleArea(radiusAt(rimInnerRadius, rimInnerWebRadius, input.web.rimTaper, z), surface.marks, rimSegments);
  const coneEnds = [hubWebRadius - hubRadius, rimInnerRadius - rimInnerWebRadius].flatMap((addition, index) => {
    const angle = [input.web.hubTaper, input.web.rimTaper][index];
    return addition > 0 ? [webLowerZ - addition / Math.tan(angle * Math.PI / 180), webUpperZ + addition / Math.tan(angle * Math.PI / 180)] : [];
  });
  const integrate = (area, z0, z1) => {
    const levels = [z0, ...[webLowerZ, webUpperZ, ...coneEnds].filter((z) => z > z0 && z < z1).sort((a, b) => a - b), z1];
    let sum = 0;
    for (let index = 1; index < levels.length; index += 1) {
      const [a, b] = [levels[index - 1], levels[index]];
      sum += (b - a) / 6 * (area(a) + 4 * area((a + b) / 2) + area(b));
    }
    return sum;
  };
  const halfWidth = input.rim.width / 2;
  const bore = polygonArea(buildBoreContour(input.bore, error).points);
  let volume = polygonArea(surface.points) * input.rim.width - integrate(rimInnerArea, -halfWidth, halfWidth);
  volume += integrate(hubArea, derived.hubLowerZ, derived.hubUpperZ) - bore * (derived.hubUpperZ - derived.hubLowerZ);
  volume += integrate(rimInnerArea, webLowerZ, webUpperZ) - integrate(hubArea, webLowerZ, webUpperZ);
  for (const [flange, z0, z1] of [[input.flanges.lower, derived.faceLowerZ, -halfWidth], [input.flanges.upper, halfWidth, derived.faceUpperZ]]) {
    if (flange) volume += circleArea(derived.outsideRadius + flange.radialExtension, surface.marks) * flange.axialThickness - integrate(rimInnerArea, z0, z1);
  }
  return volume;
}

function outlinePerimeter(input) {
  const { points } = rimSurface(input.kind, input.rim, null, input.generation.maxChordError);
  return points.reduce((sum, point, index) => sum + Math.hypot(...points[(index + 1) % points.length].map((value, axis) => value - point[axis])), 0);
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
  const radius = derived.rootRadius;
  const halfWidth = input.rim.width / 2;
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
  const halfWidth = input.rim.width / 2;
  const shellLowerZ = -halfWidth - (input.flanges.lower?.axialThickness ?? 0);
  const shellUpperZ = halfWidth + (input.flanges.upper?.axialThickness ?? 0);
  const { boreRadius, hubRadius, rimInnerRadius, rootRadius, hubLowerZ, hubUpperZ, webLowerZ, webUpperZ } = derived;
  const radii = [boreRadius, hubRadius, rimInnerRadius, rootRadius];
  const levels = [hubLowerZ, hubUpperZ, webLowerZ, webUpperZ, shellLowerZ, shellUpperZ, -halfWidth, halfWidth];
  if (radii.some((value) => Math.abs(r - value) < margin) || levels.some((value) => Math.abs(z - value) < margin)) return null;
  if (r > rootRadius) return null; // teeth and the smooth surface are not modelled here
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
