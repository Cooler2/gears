import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { buildPlanView, generatePulley, validateDescription, verifyMesh } from "../src/core/generate.js";
import { buildBoreContour, buildCircleContour, buildGt2Contour, buildMarkedCircle, circleSegmentCount } from "../src/core/contours.js";
import { rimSurface } from "../src/core/rims.js";
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
  Object.assign(input.web, { thinning: 4, alignment: "center" });
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
  minimum.rim.width = 2;
  minimum.web.thinning = 0;
  minimum.bore.diameter = 0.5;
  minimum.hub.outerDiameter = 2.5;
  minimum.generation.maxChordError = 0.25;
  const maximum = structuredClone(base);
  maximum.rim.toothCount = 120;
  maximum.rim.width = 50;
  maximum.rim.radialThickness = 25;
  Object.assign(maximum.web, { thinning: 49, alignment: "upper" });
  maximum.bore.diameter = 0.5;
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
  base.bore.diameter = 0.5;
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
    "bore-flat.json": "E_BORE_FLAT",
    "bore-key.json": "E_BORE_KEY",
    "radial-order.json": "E_RADIAL_ORDER",
    "web-outside-rim.json": "E_WEB_AXIAL_RANGE",
    "web-too-thin.json": "E_WEB_THINNING",
    "hub-short.json": "E_HUB_SHORT",
    "spoke-overlap.json": "E_SPOKE_OVERLAP",
    "spoke-fillet.json": "E_SPOKE_FILLET",
    "idler-no-interior.json": "E_RIM_NO_INTERIOR",
    "gear-thin-tooth.json": "E_GEAR_TOOTH_THIN",
    "bevel-too-wide.json": "E_BEVEL_WIDTH",
    "rack-body.json": "E_RACK_BODY",
    "gear-flange.json": "E_SCHEMA_VALUE",
    "schema-extra-field.json": "E_SCHEMA_VALUE"
  };
  assert.deepEqual(await exampleNames("invalid"), Object.keys(cases).sort(), "every invalid example needs an expected code");
  for (const [name, expected] of Object.entries(cases)) {
    const result = validateDescription(await readJson(`../examples/invalid/${name}`));
    assert.equal(result.ok, false, name);
    // relation conflicts keep the normalized description for drawing, schema errors do not
    assert.equal(result.anchors === null, expected === "E_SCHEMA_VALUE", name);
    assert.equal(generatePulley(await readJson(`../examples/invalid/${name}`)).mesh, undefined, name);
    const found = result.diagnostics.find(({ code }) => code === expected);
    assert.ok(found, `${name}: ${JSON.stringify(result.diagnostics)}`);
    if (expected !== "E_SCHEMA_VALUE") assert.ok(Object.values(found.details).every(Number.isFinite), `${name}: details`);
  }
});

test("relation diagnostics report the compared quantities", async () => {
  const input = await readJson("../examples/invalid/radial-order.json");
  const radialOrder = validateDescription(input).diagnostics.find(({ code }) => code === "E_RADIAL_ORDER");
  const rimInner = 24 / Math.PI - 0.254 - 0.75 - 2;
  assert.ok(Math.abs(radialOrder.details.span - (rimInner - 4.4)) < 1e-12);
  assert.equal(radialOrder.details.minimum, 0.5);
  assert.ok(Math.abs(radialOrder.details.maxHubDiameter - 2 * (rimInner - 0.5)) < 1e-12);
  const overlap = validateDescription(await readJson("../examples/invalid/spoke-overlap.json")).diagnostics.find(({ code }) => code === "E_SPOKE_OVERLAP");
  assert.ok(overlap.details.required >= overlap.details.available);
});

test("bore rules keep the axis inside and measure the hub wall at the farthest point", async () => {
  const input = await readJson("../examples/valid/hex-bore.json");
  input.hub.outerDiameter = 10; // R_h = 5
  const check = (bore) => validateDescription({ ...input, bore }).diagnostics.filter(({ severity }) => severity === "error");

  for (const flatDistance of [2.5, 5]) assert.deepEqual(check({ shape: "dFlat", diameter: 5, flatDistance }).map(({ code }) => code), ["E_BORE_FLAT"], `s = ${flatDistance}`);
  assert.deepEqual(check({ shape: "dFlat", diameter: 5, flatDistance: 2.51 }), []);
  assert.deepEqual(check({ shape: "keyed", diameter: 5, keyWidth: 5, keyDepth: 0.5 }).map(({ code }) => code), ["E_BORE_KEY"]);

  // a polygon diameter is across corners: 7 leaves a wall of 1.5, 10 leaves none
  assert.deepEqual(check({ shape: "polygon", diameter: 7, sides: 4 }), []);
  const triangle = check({ shape: "polygon", diameter: 10, sides: 3 })[0];
  assert.equal(triangle.code, "E_HUB_WALL");
  assert.deepEqual(triangle.paths, ["/bore/diameter", "/hub/outerDiameter"]);
  assert.ok(Math.abs(triangle.details.wall) < 1e-12);
  // the keyway corner (3.9, ±1) is 4.03 from the axis
  const keyed = check({ shape: "keyed", diameter: 5, keyWidth: 2, keyDepth: 1.4 })[0];
  assert.deepEqual(keyed.paths, ["/bore/diameter", "/bore/keyWidth", "/bore/keyDepth", "/hub/outerDiameter"]);
  assert.ok(Math.abs(keyed.details.wall - (5 - Math.hypot(3.9, 1))) < 1e-12);

  const { derived } = validateDescription({ ...input, bore: { shape: "polygon", diameter: 5, sides: 5 } });
  assert.equal(derived.boreOuterRadius, 2.5);
  assert.deepEqual(derived.boreExtentX, { positive: 2.5 * Math.cos(Math.PI / 5), negative: 2.5 }, "an odd polygon has a vertex at −X");
});

test("version 1 to 5 descriptions are read as version 6", async () => {
  const current = await readJson("../examples/valid/spokes-flanged.json");
  // version 3: the web by thickness and mid-plane, hub extensions from the rim ends (flanges 0.8 and 1.2)
  const { thinning, alignment, axialOffset, ...spokes } = current.web;
  const version3 = {
    ...structuredClone(current), schemaVersion: 3,
    web: { type: spokes.type, axialThickness: 4, axialOffset: 0, count: spokes.count, width: spokes.width, filletRadius: spokes.filletRadius },
    hub: { outerDiameter: current.hub.outerDiameter, lowerExtension: 2, upperExtension: 3 }
  };
  // version 2: the rim width was toothedWidth; version 1 also kept the bore in the hub
  const rim = Object.fromEntries(Object.entries(current.rim).map(([key, value]) => [key === "width" ? "toothedWidth" : key, value]));
  const version2 = { ...structuredClone(version3), schemaVersion: 2, rim };
  const { bore, ...rest } = version2;
  const version1 = { ...rest, schemaVersion: 1, hub: { boreDiameter: bore.diameter, ...version3.hub } };
  // version 5: no cones, the example has cylinders
  const { hubTaper, rimTaper, ...version5Web } = current.web;
  const version5 = { ...structuredClone(current), schemaVersion: 5, web: version5Web };
  const mesh = generatePulley(current).mesh;
  for (const legacy of [version1, version2, version3, version5]) {
    const snapshot = structuredClone(legacy);
    const result = generatePulley(legacy);
    assert.deepEqual(legacy, snapshot, "the input is not modified");
    assert.deepEqual(result.normalized, current);
    assert.deepEqual(Object.keys(result.normalized), Object.keys(current), "bore follows hub");
    assert.deepEqual(Object.keys(result.normalized.rim), Object.keys(current.rim), "width keeps its place");
    assert.deepEqual(Object.keys(result.normalized.web), Object.keys(current.web), "the placement keeps its place");
    assert.deepEqual(result.mesh, mesh);
  }
  // the current version with an old field is still strict
  const mixed = { ...structuredClone(current), hub: { ...current.hub, boreDiameter: 5 } };
  assert.ok(validateDescription(mixed).diagnostics.some(({ paths }) => paths.includes("/hub/boreDiameter")));
  assert.ok(validateDescription({ ...current, rim }).diagnostics.some(({ paths }) => paths.includes("/rim/toothedWidth")));
  assert.ok(validateDescription({ ...current, schemaVersion: 7 }).diagnostics.some(({ code }) => code === "E_SCHEMA_VERSION"));
  assert.ok(validateDescription({ ...current, web: version5Web }).diagnostics.some(({ paths }) => paths.includes("/web/hubTaper")), "version 6 requires the cones");
  assert.ok(validateDescription({ ...version3, schemaVersion: 4 }).diagnostics.some(({ paths }) => paths.includes("/web/axialThickness")));

  // a version 3 web against a face of the part is aligned to it, any other is centred; the levels stay
  const cases = [
    // no lower flange: the web against the rim end; the hub extension loses the upper flange
    [{ lower: 0, upper: 1, thickness: 3, offset: -3, hub: [0, 2] }, { thinning: 7, alignment: "lower", axialOffset: 0 }, [0, 1]],
    // upper side without a flange, a web against the rim end
    [{ lower: 0, upper: 0, thickness: 4, offset: 2.5, hub: [0, 2] }, { thinning: 5, alignment: "upper", axialOffset: 0 }, [0, 2]],
    // a web against the rim end under a flange is centred with a shift
    [{ lower: 1, upper: 0, thickness: 3, offset: -3, hub: [0, 0] }, { thinning: 7, alignment: "center", axialOffset: -2.5 }, [-1, 0]]
  ];
  for (const [old, web, hub] of cases) {
    const flange = (thickness) => thickness ? { axialThickness: thickness, radialExtension: 1 } : null;
    const legacy = {
      ...structuredClone(version3), flanges: { lower: flange(old.lower), upper: flange(old.upper) },
      web: { ...version3.web, axialThickness: old.thickness, axialOffset: old.offset },
      hub: { ...version3.hub, lowerExtension: old.hub[0], upperExtension: old.hub[1] }
    };
    const { normalized, derived } = validateDescription(legacy);
    const label = JSON.stringify(old);
    assert.deepEqual({ thinning: normalized.web.thinning, alignment: normalized.web.alignment, axialOffset: normalized.web.axialOffset }, web, label);
    assert.deepEqual([normalized.hub.lowerExtension, normalized.hub.upperExtension], hub, label);
    assert.ok(Math.abs(derived.webLowerZ - (old.offset - old.thickness / 2)) < 1e-12 && Math.abs(derived.webUpperZ - (old.offset + old.thickness / 2)) < 1e-12, label);
    assert.equal(derived.hubLowerZ, -4.5 - old.hub[0], label);
    assert.equal(derived.hubUpperZ, 4.5 + old.hub[1], label);
  }
});

test("an idler pulley has a smooth rim of its diameter and shares the rest", async () => {
  const input = await readJson("../examples/valid/idler-shaft.json");
  const result = generatePulley(input);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, [], "no profile warning without teeth");
  const { derived, anchors } = result;
  assert.equal(derived.outsideRadius, 8);
  assert.equal(derived.rootRadius, 8);
  assert.equal(derived.rimInnerRadius, 6);
  assert.equal(derived.pitchRadius, null);
  assert.equal(derived.grooveRootRadius, null);
  assert.equal(anchors.radii.root, 8);
  const plan = buildPlanView(result.normalized, derived);
  assert.equal(plan.profile, null);
  // every vertex lies on one of the circles the description names
  const radii = [derived.boreRadius, derived.hubRadius, derived.rimInnerRadius, 8, 9.5];
  for (let index = 0; index < result.mesh.vertices.length; index += 3) {
    const r = Math.hypot(result.mesh.vertices[index], result.mesh.vertices[index + 1]);
    assert.ok(radii.some((radius) => Math.abs(r - radius) < 1e-9), `vertex at r = ${r}`);
  }

  const kindCodes = (description) => validateDescription(description).diagnostics.filter(({ severity }) => severity === "error").map(({ paths }) => paths[0]);
  assert.deepEqual(kindCodes({ ...input, kind: "wormGear" }), ["/kind"]);
  assert.deepEqual(kindCodes({ ...input, rim: { ...input.rim, toothCount: 20 } }), ["/rim/toothCount"]);
  assert.deepEqual(kindCodes({ ...input, rim: { ...input.rim, outerDiameter: 4 } }), ["/rim/outerDiameter"]);
  const noInterior = validateDescription(await readJson("../examples/invalid/idler-no-interior.json")).diagnostics;
  assert.deepEqual(noInterior.find(({ code }) => code === "E_RIM_NO_INTERIOR").paths, ["/rim/outerDiameter", "/rim/radialThickness"]);
  assert.ok(noInterior.find(({ code }) => code === "E_RADIAL_ORDER").paths.includes("/rim/outerDiameter"));
});

test("a version 4 spur gear is read as a gear with straight teeth", async () => {
  const current = await readJson("../examples/valid/gear-keyed-20t.json");
  const { helix, ...rim } = current.rim;
  const legacy = { ...structuredClone(current), schemaVersion: 4, kind: "spurGear", rim };
  const snapshot = structuredClone(legacy);
  const result = generatePulley(legacy);
  assert.deepEqual(legacy, snapshot, "the input is not modified");
  assert.deepEqual(result.normalized, current);
  assert.deepEqual(Object.keys(result.normalized.rim), Object.keys(current.rim), "helix follows backlash");
  assert.deepEqual(result.mesh, generatePulley(current).mesh);

  // version 5 has no spur gear; straight teeth take no angle, inclined ones need it
  const errors = (changes) => validateDescription({ ...current, ...changes }).diagnostics
    .filter(({ severity }) => severity === "error").map(({ paths }) => paths[0]);
  assert.deepEqual(errors({ kind: "spurGear" }), ["/kind"]);
  assert.deepEqual(errors({ rim: { ...current.rim, helixAngle: 20 } }), ["/rim/helixAngle"]);
  assert.deepEqual(errors({ rim: { ...current.rim, helix: "helical" } }), ["/rim/helixAngle"]);
  assert.deepEqual(errors({ rim: { ...current.rim, helix: "spiral", helixAngle: 20 } }), ["/rim/helix"]);
  assert.deepEqual(errors({ rim: { ...current.rim, helix: "right", helixAngle: 20 } }), ["/rim/helix"], "the hand is the sign of the angle");
  assert.deepEqual(errors({ rim: { ...current.rim, helix: "helical", helixAngle: -50 } }), ["/rim/helixAngle"]);
});

test("helical teeth have the normal module and turn with height", async () => {
  const input = await readJson("../examples/valid/gear-helical-30t.json");
  const result = generatePulley(input);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const { derived } = result;
  const { module: m, toothCount: n, pressureAngle, backlash, helixAngle, width } = input.rim;
  const beta = helixAngle * Math.PI / 180;
  const transverseAngle = Math.atan(Math.tan(pressureAngle * Math.PI / 180) / Math.cos(beta));
  const pitchRadius = m * n / (2 * Math.cos(beta));
  const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} vs ${expected}`);
  close(derived.pitchRadius, pitchRadius, "pitch radius");
  // addendum and dedendum keep their sizes in mm; the base circle follows the transverse pressure angle
  close(derived.outsideRadius, pitchRadius + m, "tip radius");
  close(derived.rootRadius, pitchRadius - 1.25 * m, "root radius");
  close(derived.baseRadius, pitchRadius * Math.cos(transverseAngle), "base radius");
  close(derived.pitch, Math.PI * m / Math.cos(beta), "transverse pitch");
  close(derived.lead, 2 * Math.PI * pitchRadius / Math.tan(beta), "lead");

  // across the tooth the tooth is π·m/2 − j thick at the pitch cylinder: s_n = s_t·cos β, measured on the outline
  // measured on a fine outline, so that the chords cut the flanks by less than the check allows
  const fine = rimSurface("gear", input.rim, null, 0.001).points;
  const flankAngle = (side) => {
    for (let index = 0; index < fine.length; index += 1) {
      const [a, b] = [fine[index], fine[(index + 1) % fine.length]].map(([x, y]) => [Math.hypot(x, y), Math.atan2(x, y)]);
      if (Math.sign(a[1]) !== side || Math.abs(a[1]) > Math.PI / n || Math.abs(b[1]) > Math.PI / n) continue;
      if ((a[0] - pitchRadius) * (b[0] - pitchRadius) <= 0 && a[0] !== b[0]) return a[1] + (b[1] - a[1]) * (pitchRadius - a[0]) / (b[0] - a[0]);
    }
    return NaN;
  };
  const normalThickness = (flankAngle(1) - flankAngle(-1)) * pitchRadius * Math.cos(beta);
  assert.ok(Math.abs(normalThickness - (m * Math.PI / 2 - backlash)) < 0.002, `normal thickness ${normalThickness}`);

  // every vertex of the working surface, turned back by the helix, lies on the mid-plane outline:
  // a right-hand tooth rises counter-clockwise, by z·tan β / R_p
  const turn = ([x, y], angle) => [x * Math.cos(angle) + y * Math.sin(angle), y * Math.cos(angle) - x * Math.sin(angle)]; // clockwise
  const outline = rimSurface("gear", input.rim, null, input.generation.maxChordError).points;
  const { vertices } = result.mesh;
  const levels = new Set();
  for (let index = 0; index < vertices.length; index += 3) {
    const [x, y, z] = vertices.slice(index, index + 3);
    if (Math.hypot(x, y) < derived.rootRadius - 1e-9) continue;
    const back = turn([x, y], z * Math.tan(beta) / pitchRadius);
    const distance = Math.min(...outline.map((point) => Math.hypot(point[0] - back[0], point[1] - back[1])));
    assert.ok(distance < 1e-9, `vertex ${x}, ${y}, ${z} is ${distance} off the turned outline`);
    levels.add(z);
  }
  assert.ok(levels.has(-width / 2) && levels.has(width / 2) && levels.size >= 3, `section levels ${[...levels]}`);
});

test("helical hands turn opposite ways, a herringbone meets itself at the mid-plane", async () => {
  // the tip of the tooth on +Y at the upper rim end: turned clockwise for a left hand (β < 0), counter-clockwise for a right one
  const left = await readJson("../examples/valid/gear-helical-15t.json");
  assert.ok(left.rim.helixAngle < 0);
  for (const helixAngle of [left.rim.helixAngle, -left.rim.helixAngle]) {
    const input = { ...left, rim: { ...left.rim, helixAngle } };
    const { mesh, derived } = generatePulley(input);
    const { toothCount: n, width } = input.rim;
    const expected = -width / 2 * Math.tan(helixAngle * Math.PI / 180) / derived.pitchRadius;
    const tooth = 2 * Math.PI / n;
    const wrapped = expected - tooth * Math.round(expected / tooth);
    let found = false;
    for (let index = 0; index < mesh.vertices.length; index += 3) {
      const [x, y, z] = mesh.vertices.slice(index, index + 3);
      if (z === width / 2 && Math.abs(Math.hypot(x, y) - derived.outsideRadius) < 1e-9) {
        // the tip land is an arc around the tooth centre; its middle vertex sits on the centre
        found ||= Math.abs(Math.atan2(x, y) - wrapped) < 1e-9;
      }
    }
    assert.ok(found, `β ${helixAngle}: a tip at ${wrapped}`);
  }

  const input = await readJson("../examples/valid/gear-herringbone-32t.json");
  const result = generatePulley(input);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const { vertices } = result.mesh;
  const surfaceAt = (z) => {
    const points = [];
    for (let index = 0; index < vertices.length; index += 3) {
      const [x, y] = vertices.slice(index, index + 2);
      if (vertices[index + 2] === z && Math.hypot(x, y) > result.derived.rootRadius - 1e-9) points.push([x, y]);
    }
    return points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  };
  const { width } = input.rim;
  // both ends are the same section, so the part is symmetric about the mid-plane, where the halves share the plain outline
  assert.deepEqual(surfaceAt(-width / 2), surfaceAt(width / 2));
  assert.deepEqual(surfaceAt(0), rimSurface("gear", input.rim, null, input.generation.maxChordError).points.sort((a, b) => a[0] - b[0] || a[1] - b[1]));
  // the opposite sign is the same part turned over: its ends are the mirror sections, turned the other way
  const opposite = generatePulley({ ...input, rim: { ...input.rim, helixAngle: -input.rim.helixAngle } });
  const top = (mesh) => {
    const points = [];
    for (let index = 0; index < mesh.vertices.length; index += 3) {
      const [x, y, z] = mesh.vertices.slice(index, index + 3);
      if (z === width / 2 && Math.hypot(x, y) > result.derived.rootRadius - 1e-9) points.push([x, y]);
    }
    return points;
  };
  const tipAngle = (points) => Math.atan2(...points.reduce((best, point) => Math.abs(Math.atan2(...point)) < Math.abs(Math.atan2(...best)) && Math.hypot(...point) > result.derived.outsideRadius - 1e-9 ? point : best,
    points.find((point) => Math.hypot(...point) > result.derived.outsideRadius - 1e-9)));
  assert.ok(Math.abs(tipAngle(top(result.mesh)) + tipAngle(top(opposite.mesh))) < 1e-9, "the ends turn opposite ways");
});

test("helical teeth take the undercut limit of their transverse section", async () => {
  const input = await readJson("../examples/valid/gear-helical-15t.json");
  const codes = (rim) => validateDescription({ ...input, rim: { ...input.rim, ...rim } }).diagnostics.map(({ code }) => code);
  // 2·cos β / sin² α_t: 14.4 teeth at 20°, 11.5 at 30°, against 17.1 for straight teeth
  assert.deepEqual(codes({ toothCount: 14 }), []);
  assert.deepEqual(codes({ toothCount: 13 }), ["W_GEAR_UNDERCUT"]);
  assert.deepEqual(codes({ toothCount: 12, helixAngle: 30 }), []);
  const { helixAngle, ...straight } = input.rim;
  assert.deepEqual(validateDescription({ ...input, rim: { ...straight, helix: "none", toothCount: 14 } }).diagnostics.map(({ code }) => code), ["W_GEAR_UNDERCUT"]);
});

test("a spur gear has involute teeth of the standard rack sizes", async () => {
  const input = await readJson("../examples/valid/gear-30t.json");
  const result = generatePulley(input);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, []);
  const { derived, anchors } = result;
  const { module: m, toothCount: n, backlash } = input.rim;
  const alpha = input.rim.pressureAngle * Math.PI / 180;
  const pitchRadius = m * n / 2;
  const baseRadius = pitchRadius * Math.cos(alpha);
  assert.equal(derived.pitchRadius, 15);
  assert.equal(derived.outsideRadius, 16);
  assert.equal(derived.rootRadius, 13.75);
  assert.ok(Math.abs(derived.baseRadius - baseRadius) < 1e-12);
  assert.equal(derived.rimInnerRadius, 11.75);
  assert.equal(derived.pitch, Math.PI);
  assert.equal(anchors.radii.pitch, 15);
  assert.equal(result.mesh.bounds.max[1], 16, "the tooth on +Y reaches the tip circle");

  // the outline, independently: a flank vertex above the base circle lies on the involute
  // whose tooth is m·π/2 − backlash thick along the pitch circle
  const involute = (angle) => Math.tan(angle) - angle;
  const halfAngle = (r) => (m * Math.PI / 2 - backlash) / (2 * pitchRadius) + involute(alpha) - involute(Math.acos(baseRadius / r));
  const outline = buildPlanView(result.normalized, derived).profile;
  const pitchAngle = 2 * Math.PI / n;
  let previous = -Infinity;
  let flankVertices = 0;
  for (const [x, y] of outline) {
    const r = Math.hypot(x, y);
    const angle = (Math.atan2(x, y) + 2 * Math.PI + 1e-12) % (2 * Math.PI);
    assert.ok(angle >= previous - 1e-12, "the outline turns clockwise without going back");
    previous = angle;
    assert.ok(r > 13.75 - 1e-9 && r < 16 + 1e-9, `r = ${r}`);
    if (r < 13.75 + 1e-9 || r > 16 - 1e-9) continue;
    // angle from the nearest tooth centre
    const fromTooth = Math.abs(angle - pitchAngle * Math.round(angle / pitchAngle));
    const expected = r >= baseRadius ? halfAngle(r) : halfAngle(baseRadius);
    assert.ok(Math.abs(fromTooth - expected) < 1e-9, `flank at r = ${r}: ${fromTooth} vs ${expected}`);
    flankVertices += 1;
  }
  assert.ok(flankVertices >= 4 * n, "every flank has vertices between root and tip");

  // between neighbouring flank vertices the exact involute stays within the chord tolerance
  for (const [rim, maxChordError] of [[input.rim, 0.25], [input.rim, 0.01], [{ ...input.rim, module: 5, toothCount: 12, profileShift: 0.5 }, 0.01]]) {
    const gear = { m: rim.module, alpha: rim.pressureAngle * Math.PI / 180 };
    const rp = rim.module * rim.toothCount / 2;
    const rb = rp * Math.cos(gear.alpha);
    const half = (r) => (rim.module * (Math.PI / 2 + 2 * rim.profileShift * Math.tan(gear.alpha)) - rim.backlash) / (2 * rp) + involute(gear.alpha) - involute(Math.acos(rb / r));
    const tip = rp + rim.module * (1 + rim.profileShift);
    const start = Math.max(rb, rp - rim.module * (1.25 - rim.profileShift));
    const flank = rimSurface("gear", rim, null, maxChordError).points
      .map(([x, y]) => [Math.hypot(x, y), Math.atan2(x, y)])
      .filter(([r, angle]) => angle > 0 && angle < Math.PI / rim.toothCount && r >= start - 1e-9 && r <= tip + 1e-9 && Math.abs(angle - half(Math.max(r, rb))) < 1e-9);
    let worst = 0;
    for (let index = 1; index < flank.length; index += 1) {
      const [a, b] = [flank[index - 1], flank[index]].map(([r, angle]) => [r * Math.sin(angle), r * Math.cos(angle)]);
      const [ra, rb2] = [flank[index - 1][0], flank[index][0]];
      for (let k = 1; k < 8; k += 1) {
        const r = rb2 + (ra - rb2) * k / 8;
        const exact = [r * Math.sin(half(r)), r * Math.cos(half(r))];
        const cross = Math.abs((b[0] - a[0]) * (exact[1] - a[1]) - (b[1] - a[1]) * (exact[0] - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]);
        worst = Math.max(worst, cross);
      }
    }
    assert.ok(flank.length >= 3, `m ${rim.module} ε ${maxChordError}: ${flank.length} flank vertices`);
    assert.ok(worst <= maxChordError, `m ${rim.module} ε ${maxChordError}: involute off the chord by ${worst}`);
  }

  // a smaller hub leaves room for the web of a 16-tooth gear
  const codes = (rim) => validateDescription({ ...input, hub: { ...input.hub, outerDiameter: 8 }, rim: { ...input.rim, ...rim } }).diagnostics.map(({ code }) => code);
  // 17 teeth are the fewest a 20° rack does not undercut; a shift lowers the limit
  assert.deepEqual(codes({ toothCount: 16 }), ["W_GEAR_UNDERCUT"]);
  assert.deepEqual(codes({ toothCount: 17 }), []);
  assert.deepEqual(codes({ toothCount: 16, profileShift: 0.1 }), []);
  assert.ok(codes({ toothCount: 10, profileShift: 1 }).includes("W_GEAR_POINTED"));
  const thin = validateDescription(await readJson("../examples/invalid/gear-thin-tooth.json")).diagnostics;
  assert.deepEqual(thin.find(({ code }) => code === "E_GEAR_TOOTH_THIN").paths, ["/rim/backlash", "/rim/module", "/rim/profileShift"]);
  const flanged = validateDescription(await readJson("../examples/invalid/gear-flange.json")).diagnostics;
  assert.deepEqual(flanged.map(({ paths }) => paths[0]), ["/flanges/lower"]);
});

test("bevel gear teeth run to the apex of the pitch cone and have the sizes of the large end", async () => {
  const input = await readJson("../examples/valid/bevel-20t.json");
  const result = generatePulley(input);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const { rim } = input;
  const { derived } = result;
  const cone = Math.atan(rim.toothCount / rim.mateToothCount); // at a right angle tan δ = N/N₂
  const pitch = rim.module * rim.toothCount / 2;
  assert.ok(Math.abs(derived.pitchConeAngle - cone * 180 / Math.PI) < 1e-9);
  assert.ok(Math.abs(derived.pitchConeAngle + derived.mateConeAngle - 90) < 1e-9, "the cones of a pair add up to the shaft angle");
  assert.ok(Math.abs(derived.coneDistance - pitch / Math.sin(cone)) < 1e-9);
  assert.equal(derived.pitch, Math.PI * rim.module);
  assert.equal(derived.virtualToothCount, rim.toothCount / Math.cos(cone));
  // the lower face passes through the tip circle of the large end, the apex is above it
  const addendum = rim.module * (1 + rim.profileShift);
  assert.ok(Math.abs(derived.outsideRadius - (pitch + addendum * Math.cos(cone))) < 1e-9);
  assert.ok(Math.abs(derived.apexZ - derived.faceLowerZ - (pitch / Math.tan(cone) - addendum * Math.sin(cone))) < 1e-9);
  // every point of the lower outline lies on a straight line through the apex with its copy in the upper face
  const surface = rimSurface(input.kind, rim, { outside: derived.outsideRadius }, input.generation.maxChordError);
  assert.deepEqual(surface.sections.map(({ z }) => z), [-rim.width / 2, rim.width / 2]);
  const { scale } = surface.sections[1];
  assert.equal(scale, derived.endScale);
  assert.ok(Math.abs((1 - scale) * (derived.apexZ + rim.width / 2) - rim.width) < 1e-9, "the tooth lines meet at the apex");
  assert.ok(Math.abs(derived.rootRadius - Math.min(...surface.points.map((point) => Math.hypot(...point))) * scale) < 1e-9);
  assert.equal(derived.rimInnerRadius, derived.hubRadius, "without a web the rim reaches the hub");
  // the upper face of the mesh is the lower outline scaled by s
  const { vertices } = result.mesh;
  let upper = 0;
  for (let index = 0; index < vertices.length; index += 3) {
    if (vertices[index + 2] === rim.width / 2) upper = Math.max(upper, Math.hypot(vertices[index], vertices[index + 1]));
  }
  assert.ok(Math.abs(upper - derived.outsideRadius * scale) < 1e-9);
  assert.equal(result.verification.connectedComponents, 1);
});

test("bevel rules limit the cone angle and the face width, and undercut follows the virtual gear", async () => {
  const base = await readJson("../examples/valid/bevel-miter-16t.json");
  const codes = (change) => {
    const input = structuredClone(base);
    Object.assign(input.rim, change);
    return validateDescription(input).diagnostics.map(({ code }) => code);
  };
  assert.deepEqual(codes({}), []);
  // tan δ = sin Σ/(N₂/N + cos Σ): 16 teeth for 6 give 69.4° at 90°, 83.1° at 105°, past 90° at 140°
  assert.ok(!codes({ mateToothCount: 6, width: 2 }).includes("E_BEVEL_CONE"));
  assert.ok(codes({ mateToothCount: 6, shaftAngle: 105, width: 2 }).includes("E_BEVEL_CONE"));
  assert.ok(codes({ mateToothCount: 6, shaftAngle: 140, width: 2 }).includes("E_BEVEL_CONE"));
  // the small end shrinks with the width: a thinner hub keeps under its roots
  const wide = validateDescription({ ...base, hub: { ...base.hub, outerDiameter: 8 }, rim: { ...base.rim, width: 4.5 } });
  assert.deepEqual(wide.diagnostics.map(({ code }) => code), ["W_BEVEL_WIDTH"]);
  // a third of the cone distance along the cone is a third of R_e cos δ along the axis
  assert.ok(Math.abs(wide.diagnostics[0].details.usual - wide.derived.coneDistance * Math.cos(Math.PI / 4) / 3) < 1e-9);
  assert.ok(codes({ width: 6 }).includes("E_BEVEL_WIDTH"));
  // the miter gear has 16/cos 45° = 22.6 virtual teeth: no undercut; a 16 tooth pinion for 60 has 16.5
  assert.ok(!codes({}).includes("W_GEAR_UNDERCUT"));
  const pinion = validateDescription({ ...base, rim: { ...base.rim, mateToothCount: 60, width: 3 } });
  const undercut = pinion.diagnostics.find(({ code }) => code === "W_GEAR_UNDERCUT");
  assert.ok(undercut, JSON.stringify(pinion.diagnostics));
  assert.equal(undercut.details.minimum, Math.round(2 / Math.sin(20 * Math.PI / 180) ** 2 * Math.cos(Math.atan(16 / 60))));
});

test("a bevel pair meshes through a pitch without interference and collides out of phase", async () => {
  const [small, large] = await Promise.all(["bevel-20t.json", "bevel-30t.json"].map((name) => readJson(`../examples/valid/${name}`)));
  // no thinning: the teeth of the pair touch
  small.rim.backlash = large.rim.backlash = 0;
  const [first, second] = [small, large].map((input) => generatePulley(input));
  const turned = (result, angle, place) => triangles(result).map((triangle) => triangle.map(([x, y, z]) => place([
    x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle), z - result.derived.apexZ])));
  // common apex at the origin; the second axis along −X: a tooth of the first gear at +X faces a space of the second
  const interfering = (firstTurn, secondTurn) => {
    const one = turned(first, firstTurn, (point) => point);
    const two = turned(second, secondTurn, ([x, y, z]) => [-z, y, x]);
    return surfaceSamples(two).filter((point) => insideMesh(point, one)).length + surfaceSamples(one).filter((point) => insideMesh(point, two)).length;
  };
  const degree = Math.PI / 180;
  for (const turn of [0, 5, 11, 18]) assert.equal(interfering(turn * degree, -turn * degree * 20 / 30), 0, `turned by ${turn}°`);
  assert.ok(interfering(0, 0.5 * degree) > 0, "the teeth touch: half a degree more collides");
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

test("without a web the rim thickness is free and the hub stays 0.5 mm under the tooth roots", async () => {
  const pinion = await readJson("../examples/valid/gear-pinion-12t.json");
  const { derived } = validateDescription(pinion);
  assert.equal(derived.rimInnerRadius, derived.hubRadius, "the rim reaches the hub");
  assert.deepEqual([derived.webLowerZ, derived.webUpperZ], [derived.faceLowerZ, derived.faceUpperZ]);
  const diagnostics = (input) => validateDescription(input).diagnostics;
  // a rim thickness that leaves no room for a web does not matter
  pinion.rim.radialThickness = 25;
  assert.deepEqual(diagnostics(pinion).filter(({ severity }) => severity === "error"), []);
  pinion.hub.outerDiameter = 2 * (derived.rootRadius - 0.5);
  assert.ok(!diagnostics(pinion).some(({ code }) => code === "E_RADIAL_ORDER"));
  pinion.hub.outerDiameter = 2 * (derived.rootRadius - 0.45);
  const radialOrder = diagnostics(pinion).find(({ code }) => code === "E_RADIAL_ORDER");
  assert.deepEqual(radialOrder.paths, ["/hub/outerDiameter", "/rim/toothCount"]);
  assert.ok(Math.abs(radialOrder.details.maxHubDiameter - 2 * (derived.rootRadius - 0.5)) < 1e-12);
  // placement fields belong to a web
  const placed = { ...structuredClone(pinion), web: { type: "none", thinning: 0 } };
  assert.ok(diagnostics(placed).some(({ paths }) => paths.includes("/web/thinning")));
});

test("validation is finite, strict, and does not mutate its input", async () => {
  const input = await readJson("../examples/valid/solid-basic.json");
  const snapshot = structuredClone(input);
  input.bore.diameter = NaN;
  input.web.thinning = Infinity;
  input.rim.extra = 1;
  const result = validateDescription(input);
  assert.equal(result.ok, false);
  for (const path of ["/bore/diameter", "/web/thinning", "/rim/extra"]) {
    assert.ok(result.diagnostics.some(({ code, paths }) => code === "E_SCHEMA_VALUE" && paths.includes(path)), path);
  }
  delete input.rim.extra;
  input.bore.diameter = snapshot.bore.diameter;
  input.web.thinning = snapshot.web.thinning;
  assert.deepEqual(input, snapshot);
});

test("anchors come with the normalized description, without building a mesh", async () => {
  const input = await readJson("../examples/valid/spokes-flanged.json");
  const { anchors, derived } = validateDescription(input);
  const levels = {
    lowerHub: -6.5, lowerFlange: -5.3, rimLower: -4.5, webLower: -2,
    webUpper: 2, rimUpper: 4.5, upperFlange: 5.7, upperHub: 7.5
  };
  assert.deepEqual(Object.keys(anchors.zLevels), Object.keys(levels));
  for (const [name, level] of Object.entries(levels)) assert.ok(Math.abs(anchors.zLevels[name] - level) < 1e-12, name);
  assert.equal(anchors.radii.bore, 2.6);
  assert.equal(anchors.radii.pitch, derived.pitchRadius);
  assert.deepEqual(generatePulley(input).anchors, anchors);
});

test("plan view gives exact spoke outlines and falls back to strips on conflicts", async () => {
  const input = await readJson("../examples/valid/trial-60t.json");
  const { normalized, derived } = validateDescription(input);
  const plan = buildPlanView(normalized, derived);
  assert.equal(plan.profile.length, 19 * 60);
  assert.equal(plan.spokes.schematic, false);
  assert.equal(plan.spokes.outlines.length, 6);
  for (const outline of plan.spokes.outlines) {
    const radii = outline.map((point) => Math.hypot(...point));
    assert.ok(Math.abs(radii[0] - derived.hubRadius) < 1e-12 && Math.abs(radii.at(-1) - derived.hubRadius) < 1e-12);
    assert.ok(radii.every((r) => r > derived.hubRadius - 1e-9 && r < derived.rimInnerRadius + 1e-9));
  }

  input.web.filletRadius = 2; // wider than half the spoke: E_SPOKE_FILLET
  const conflict = validateDescription(input);
  assert.equal(conflict.ok, false);
  const strips = buildPlanView(conflict.normalized, conflict.derived).spokes;
  assert.equal(strips.schematic, true);
  assert.equal(strips.outlines.length, 6);

  const solid = validateDescription(await readJson("../examples/valid/trial-20t.json"));
  assert.equal(buildPlanView(solid.normalized, solid.derived).spokes, null);
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
    // racks have a test of their own below
    if (input.kind === "rack") continue;
    const result = generatePulley(input);
    const toothed = input.kind === "timingPulley";
    const gear = input.kind === "gear";
    const bevel = input.kind === "bevelGear";
    const helical = gear && input.rim.helix !== "none";
    assert.equal(result.ok, true, `${name}: ${JSON.stringify(result.diagnostics)}`);
    assert.deepEqual(result.verification.errors, [], name);
    assert.deepEqual(result.diagnostics.map(({ code }) => code), [...(extraWarnings[name] ?? []), ...(toothed ? ["W_EXPERIMENTAL_PROFILE"] : [])], name);

    // sizes straight from the contract formulas, not from derive()
    const { rim, flanges, hub } = input;
    // a helical gear has the normal module: its pitch circle is larger by 1/cos β, the tooth height is the same
    const pitchRadius = gear ? rim.module * rim.toothCount / 2 / (helical ? Math.cos(rim.helixAngle * Math.PI / 180) : 1) : null;
    // a bevel gear stands on the tip circle of its large end: the addendum is laid along the back cone, at δ to the lower face
    const cone = bevel ? Math.atan2(Math.sin(rim.shaftAngle * Math.PI / 180), rim.mateToothCount / rim.toothCount + Math.cos(rim.shaftAngle * Math.PI / 180)) : 0;
    const outsideRadius = toothed ? rim.toothCount / Math.PI - 0.254
      : gear ? pitchRadius + rim.module * (1 + rim.profileShift)
      : bevel ? rim.module * rim.toothCount / 2 + rim.module * (1 + rim.profileShift) * Math.cos(cone)
      : rim.outerDiameter / 2;
    // a smooth circle need not have a vertex on the X axis: it may fall short by the chord tolerance
    const tolerance = toothed ? 1e-9 : input.generation.maxChordError;
    const flangeRadii = [flanges.lower, flanges.upper].filter(Boolean).map((flange) => outsideRadius + flange.radialExtension);
    const radius = Math.max(outsideRadius, ...flangeRadii);
    // hub extensions count from the faces of the part, a negative one stays inside
    const bottom = -rim.width / 2 - (flanges.lower?.axialThickness ?? 0) - Math.max(hub.lowerExtension, 0);
    const top = rim.width / 2 + (flanges.upper?.axialThickness ?? 0) + Math.max(hub.upperExtension, 0);
    const { min, max } = result.mesh.bounds;
    // a gear has a tooth tip on +Y at the mid-plane, not necessarily on the X axis; helical tips turn away from it
    if (helical) assert.ok(Math.abs(farthestRadius(result.mesh) - radius) < 1e-9, `${name}: radius ${farthestRadius(result.mesh)} vs ${radius}`);
    else if (gear || bevel) assert.ok(Math.abs(max[1] - radius) < 1e-9 && max[0] <= radius && -min[0] <= radius, `${name}: radius ${max[1]} vs ${radius}`);
    else assert.ok(Math.abs(max[0] - radius) < tolerance && Math.abs(min[0] + radius) < tolerance, `${name}: radius ${max[0]} vs ${radius}`);
    assert.ok(Math.abs(min[2] - bottom) < 1e-12 && Math.abs(max[2] - top) < 1e-12, `${name}: height`);
  }
});

test("examples lie flat on their lower face, and a solid one covers it completely", async () => {
  // one example keeps the hub out on both sides to show that it can
  const raised = new Set(["spokes-flanged.json"]);
  for (const name of await exampleNames("valid")) {
    if (raised.has(name)) continue;
    const input = await readJson(`../examples/valid/${name}`);
    // a rack lies on its side, a flat rectangle: nothing to cover
    if (input.kind === "rack") continue;
    const result = generatePulley(input);
    const { derived, mesh } = result;
    const bottom = derived.faceLowerZ;
    assert.equal(mesh.bounds.min[2], bottom, name);
    assert.equal(derived.webLowerZ, bottom, `${name}: web`);
    assert.equal(derived.hubLowerZ, bottom, `${name}: hub`);
    // the faces at the bottom level, projected: bore to the rim or the flange edge for a solid web
    let area = 0;
    for (let face = 0; face < mesh.indices.length; face += 3) {
      const points = [...mesh.indices.slice(face, face + 3)].map((id) => mesh.vertices.slice(id * 3, id * 3 + 3));
      if (!points.every((point) => point[2] === bottom)) continue;
      const [a, b, c] = points;
      area -= ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2; // facing −Z
    }
    if (input.web.type === "spokes") {
      assert.ok(area > 0, `${name}: spokes and hub at the bottom`);
      continue;
    }
    const error = input.generation.maxChordError;
    const surface = rimSurface(input.kind, input.rim, { outside: derived.outsideRadius }, error);
    const outline = input.flanges.lower
      ? contourArea(buildMarkedCircle(derived.lowerFlangeOuterRadius, circleSegmentCount(derived.lowerFlangeOuterRadius, error), surface.marks).points)
      : contourArea(surface.points);
    const expected = outline - contourArea(buildBoreContour(input.bore, error).points);
    assert.ok(Math.abs(area - expected) < 1e-9 * expected, `${name}: bottom area ${area} vs ${expected}`);
  }
});

test("a rack is a closed bar of N pitches with the volume of its section", async () => {
  const rack = (rim) => ({ schemaVersion: 6, kind: "rack", units: "mm", rim: { module: 1, toothCount: 10, pressureAngle: 20, backlash: 0.1, helix: "none", width: 6, pitchHeight: 6, ...rim } });
  const inputs = [
    ...await Promise.all((await exampleNames("valid")).filter((name) => name.startsWith("rack-")).map((name) => readJson(`../examples/valid/${name}`))),
    rack({ helix: "helical", helixAngle: -15 }),
    rack({ helix: "herringbone", helixAngle: -30, toothCount: 7 }),
    // the teeth lean farther than the whole rack is long
    rack({ helix: "helical", helixAngle: 45, width: 50, toothCount: 3 })
  ];
  for (const input of inputs) {
    const { rim } = input;
    const name = JSON.stringify(rim);
    const result = generatePulley(input);
    assert.equal(result.ok, true, `${name}: ${JSON.stringify(result.diagnostics)}`);
    assert.deepEqual(result.diagnostics, [], name);
    assert.deepEqual(result.verification.errors, [], name);
    assert.equal(result.verification.connectedComponents, 1, name);
    // straight from the contract: the transverse pitch, heights m and 1.25m from the pitch line
    const beta = rim.helix === "none" ? 0 : rim.helixAngle * Math.PI / 180;
    const pitch = Math.PI * rim.module / Math.cos(beta);
    const length = rim.toothCount * pitch;
    const { min, max } = result.mesh.bounds;
    const close = (a, b) => Math.abs(a - b) < 1e-9;
    assert.ok(close(min[0], -length / 2) && close(max[0], length / 2), `${name}: length`);
    assert.ok(close(min[1], 0) && close(max[1], rim.pitchHeight + rim.module), `${name}: height`);
    assert.ok(close(min[2], -rim.width / 2) && close(max[2], rim.width / 2), `${name}: width`);
    // the section does not depend on z, only moves along X: the volume is the width times its area
    const angle = Math.atan(Math.tan(rim.pressureAngle * Math.PI / 180) / Math.cos(beta));
    const thickness = pitch / 2 - rim.backlash / Math.cos(beta);
    const root = thickness / 2 + 1.25 * rim.module * Math.tan(angle);
    const tip = thickness / 2 - rim.module * Math.tan(angle);
    const area = length * (rim.pitchHeight - 1.25 * rim.module) + rim.toothCount * (root + tip) * 2.25 * rim.module;
    assert.ok(Math.abs(result.verification.signedVolume - rim.width * area) < 1e-6 * rim.width * area, `${name}: volume ${result.verification.signedVolume} vs ${rim.width * area}`);
  }
});

test("a right-hand rack has its teeth moving to −X upwards, a herringbone turns at the mid-plane", () => {
  const rim = { module: 2, toothCount: 12, pressureAngle: 20, backlash: 0, width: 10, pitchHeight: 8 };
  const pitch = (angle) => Math.PI * rim.module / Math.cos(angle * Math.PI / 180);
  // the tip corners at height z, within the rack, as phases in [0, pitch)
  const phases = (mesh, z, step) => {
    const top = mesh.bounds.max[1];
    const found = [];
    for (let index = 0; index < mesh.vertices.length; index += 3) {
      const [x, y, vz] = mesh.vertices.slice(index, index + 3);
      if (Math.abs(y - top) < 1e-9 && Math.abs(vz - z) < 1e-9 && Math.abs(x) < mesh.bounds.max[0] - 1e-6) found.push(Math.round((((x % step) + step) % step) * 1e6) / 1e6);
    }
    return [...new Set(found)].sort((p, q) => p - q);
  };
  const moved = (list, by, step) => list.map((value) => Math.round((((value + by) % step + step) % step) * 1e6) / 1e6).sort((p, q) => p - q);
  for (const [helix, angle] of [["helical", 20], ["helical", -20], ["herringbone", 30]]) {
    const { mesh } = generatePulley({ schemaVersion: 6, kind: "rack", units: "mm", rim: { ...rim, helix, helixAngle: angle } });
    const step = pitch(angle);
    const lean = rim.width / 2 * Math.tan(angle * Math.PI / 180);
    const bottom = phases(mesh, -rim.width / 2, step);
    assert.equal(bottom.length, 2, `${helix} ${angle}: two tip corners per pitch`);
    // helical: −z·tan β, the top face is the bottom one moved by −W·tan β; herringbone: |z|·tan β, the same at both faces
    const expected = helix === "helical" ? moved(bottom, -2 * lean, step) : bottom;
    const upper = phases(mesh, rim.width / 2, step);
    assert.ok(upper.length === 2 && upper.every((value, index) => Math.abs(value - expected[index]) < 1e-5), `${helix} ${angle}: ${upper} vs ${expected}`);
  }
});

test("rack diagnostics: pointed teeth, a thin body, a tooth thinned away, parts of a turning one", () => {
  const input = (rim) => ({ schemaVersion: 6, kind: "rack", units: "mm", rim: { module: 1, toothCount: 10, pressureAngle: 20, backlash: 0.1, helix: "none", width: 6, pitchHeight: 6, ...rim } });
  const codes = (rim) => validateDescription(input(rim)).diagnostics.map(({ code }) => code);
  assert.deepEqual(codes({ module: 0.3, backlash: 0.4 }), ["W_RACK_POINTED"]);
  assert.deepEqual(codes({ pitchHeight: 2.4 }), ["W_THIN_FEATURE"]);
  assert.deepEqual(codes({ module: 0.3, backlash: 1 }), ["E_GEAR_TOOTH_THIN"]);
  const body = validateDescription(input({ pitchHeight: 2 }));
  assert.equal(body.ok, false);
  assert.deepEqual(body.diagnostics[0].details, { thickness: 0.75, minimum: 1, minimumPitchHeight: 2.25 });
  assert.equal(validateDescription({ ...input({}), hub: { outerDiameter: 10, lowerExtension: 0, upperExtension: 0 } }).ok, false);
  assert.equal(validateDescription({ ...input({}), rim: { ...input({}).rim, profileShift: 0 } }).ok, false);
});

function farthestRadius({ vertices }) {
  let radius = 0;
  for (let index = 0; index < vertices.length; index += 3) radius = Math.max(radius, Math.hypot(vertices[index], vertices[index + 1]));
  return radius;
}

function contourArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x0, y0] = points[index];
    const [x1, y1] = points[(index + 1) % points.length];
    area += x1 * y0 - x0 * y1; // contours run clockwise
  }
  return area / 2;
}

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

test("the hub and the rim widen towards the web at their angles, shortened when they do not fit", async () => {
  const base = await readJson("../examples/valid/gear-herringbone-32t.json");
  const tapered = (web) => validateDescription({ ...base, web: { ...base.web, ...web } });
  // a 12 mm rim, the web 6 mm thick against the lower face: the cones span the upper 6 mm
  const { derived } = tapered({ hubTaper: 30, rimTaper: 45 });
  const addition = 6 * Math.tan(Math.PI / 6);
  assert.ok(Math.abs(derived.hubWebRadius - (8 + addition)) < 1e-12);
  assert.ok(Math.abs(derived.rimInnerWebRadius - (derived.rimInnerRadius - 6)) < 1e-12);
  assert.ok(Math.abs(derived.hubTaper.height - 6) < 1e-12 && Math.abs(derived.rimTaper.height - 6) < 1e-12, "both cones end at the upper face");

  // a centred web: the lower of the two heights sets the additions, the taller side ends in a cylinder
  const centred = tapered({ alignment: "center", axialOffset: 1, hubTaper: 30, rimTaper: 30 }).derived;
  assert.ok(Math.abs(centred.hubWebRadius - 8 - 2 * Math.tan(Math.PI / 6)) < 1e-12, "3 − 1 mm below the web");

  // steep cones do not fit: both shrink in proportion and keep 0.5 mm between them
  const steep = tapered({ hubTaper: 60, rimTaper: 60 }).derived;
  assert.ok(Math.abs(steep.rimInnerWebRadius - steep.hubWebRadius - 0.5) < 1e-12);
  assert.ok(Math.abs((steep.hubWebRadius - 8) - (steep.rimInnerRadius - steep.rimInnerWebRadius)) < 1e-12, "equal angles, equal shares");
  assert.ok(steep.hubTaper.height < 6, "the cone became a chamfer");

  // a web through the whole height and a part without a web have no cones
  assert.equal(tapered({ thinning: 0, hubTaper: 30, rimTaper: 30 }).derived.hubWebRadius, 8);
  const noWeb = validateDescription({ ...base, web: { type: "none" } }).derived;
  assert.equal(noWeb.hubWebRadius, noWeb.hubRadius);

  // the mesh: the widest hub vertex at the web level and the narrowest rim vertex there
  const result = generatePulley({ ...base, web: { ...base.web, hubTaper: 30, rimTaper: 45 } });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const radiiAt = (z) => {
    const radii = [];
    for (let index = 0; index < result.mesh.vertices.length; index += 3) {
      const [x, y, level] = result.mesh.vertices.slice(index, index + 3);
      if (Math.abs(level - z) < 1e-9) radii.push(Math.hypot(x, y));
    }
    return radii;
  };
  const web = radiiAt(result.derived.webUpperZ);
  const face = radiiAt(result.derived.faceUpperZ);
  const near = (radii, radius) => radii.some((value) => Math.abs(value - radius) < 1e-9);
  assert.ok(near(web, derived.hubWebRadius) && near(web, derived.rimInnerWebRadius), "the web meets both cones at their web radii");
  assert.ok(near(face, 8) && near(face, derived.rimInnerRadius) && !near(face, derived.hubWebRadius), "the faces keep the given sizes");
});

test("a hub cone makes room for spokes that a narrow hub cannot carry", async () => {
  const input = await readJson("../examples/invalid/spoke-overlap.json");
  assert.ok(validateDescription(input).diagnostics.some(({ code }) => code === "E_SPOKE_OVERLAP"));
  const widened = generatePulley({ ...input, web: { ...input.web, hubTaper: 50 } });
  assert.equal(widened.ok, true, JSON.stringify(widened.diagnostics));
  assert.equal(widened.verification.connectedComponents, 1);
});

function triangles({ mesh: { vertices, indices } }) {
  const point = (index) => [vertices[3 * index], vertices[3 * index + 1], vertices[3 * index + 2]];
  return Array.from({ length: indices.length / 3 }, (_, face) => [point(indices[3 * face]), point(indices[3 * face + 1]), point(indices[3 * face + 2])]);
}

/** Points inside every triangle, away from its edges. */
function surfaceSamples(list) {
  const weights = [[1 / 3, 1 / 3], [0.1, 0.1], [0.8, 0.1], [0.1, 0.8], [0.45, 0.45], [0.05, 0.5], [0.5, 0.05]];
  return list.flatMap(([a, b, c]) => weights.map(([u, w]) => a.map((value, axis) => value + (b[axis] - value) * u + (c[axis] - value) * w)));
}

/** Parity of the crossings of a ray in a skew direction with a closed mesh. */
function insideMesh(point, list) {
  const direction = [0.5773, 0.5774, 0.5775];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  let crossings = 0;
  for (const [a, b, c] of list) {
    const edge1 = sub(b, a);
    const edge2 = sub(c, a);
    const h = cross(direction, edge2);
    const det = dot(edge1, h);
    if (Math.abs(det) < 1e-12) continue;
    const s = sub(point, a);
    const u = dot(s, h) / det;
    if (u < 0 || u > 1) continue;
    const q = cross(s, edge1);
    const v = dot(direction, q) / det;
    if (v < 0 || u + v > 1) continue;
    if (dot(edge2, q) / det > 0) crossings += 1;
  }
  return crossings % 2 === 1;
}
