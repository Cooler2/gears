import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { buildPlanView, generatePulley, validateDescription, verifyMesh } from "../src/core/generate.js";
import { buildCircleContour, buildGt2Contour, circleSegmentCount } from "../src/core/contours.js";
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
  minimum.rim.width = 2;
  minimum.web.axialThickness = 2;
  minimum.bore.diameter = 0.5;
  minimum.hub.outerDiameter = 2.5;
  minimum.generation.maxChordError = 0.25;
  const maximum = structuredClone(base);
  maximum.rim.toothCount = 120;
  maximum.rim.width = 50;
  maximum.rim.radialThickness = 25;
  maximum.web.axialThickness = 1;
  maximum.web.axialOffset = 24.5;
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
    "spoke-overlap.json": "E_SPOKE_OVERLAP",
    "spoke-fillet.json": "E_SPOKE_FILLET",
    "idler-no-interior.json": "E_RIM_NO_INTERIOR",
    "gear-thin-tooth.json": "E_GEAR_TOOTH_THIN",
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

test("version 1 and 2 descriptions are read as version 3", async () => {
  const current = await readJson("../examples/valid/spokes-flanged.json");
  // version 2: the rim width was toothedWidth; version 1 also kept the bore in the hub
  const rim = Object.fromEntries(Object.entries(current.rim).map(([key, value]) => [key === "width" ? "toothedWidth" : key, value]));
  const version2 = { ...structuredClone(current), schemaVersion: 2, rim };
  const { bore, ...rest } = version2;
  const version1 = { ...rest, schemaVersion: 1, hub: { boreDiameter: bore.diameter, ...current.hub } };
  const mesh = generatePulley(current).mesh;
  for (const legacy of [version1, version2]) {
    const snapshot = structuredClone(legacy);
    const result = generatePulley(legacy);
    assert.deepEqual(legacy, snapshot, "the input is not modified");
    assert.deepEqual(result.normalized, current);
    assert.deepEqual(Object.keys(result.normalized), Object.keys(current), "bore follows hub");
    assert.deepEqual(Object.keys(result.normalized.rim), Object.keys(current.rim), "width keeps its place");
    assert.deepEqual(result.mesh, mesh);
  }
  // the current version with an old field is still strict
  const mixed = { ...structuredClone(current), hub: { ...current.hub, boreDiameter: 5 } };
  assert.ok(validateDescription(mixed).diagnostics.some(({ paths }) => paths.includes("/hub/boreDiameter")));
  assert.ok(validateDescription({ ...current, rim }).diagnostics.some(({ paths }) => paths.includes("/rim/toothedWidth")));
  assert.ok(validateDescription({ ...current, schemaVersion: 4 }).diagnostics.some(({ code }) => code === "E_SCHEMA_VERSION"));
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
  assert.deepEqual(kindCodes({ ...input, kind: "gear" }), ["/kind"]);
  assert.deepEqual(kindCodes({ ...input, rim: { ...input.rim, toothCount: 20 } }), ["/rim/toothCount"]);
  assert.deepEqual(kindCodes({ ...input, rim: { ...input.rim, outerDiameter: 4 } }), ["/rim/outerDiameter"]);
  const noInterior = validateDescription(await readJson("../examples/invalid/idler-no-interior.json")).diagnostics;
  assert.deepEqual(noInterior.find(({ code }) => code === "E_RIM_NO_INTERIOR").paths, ["/rim/outerDiameter", "/rim/radialThickness"]);
  assert.ok(noInterior.find(({ code }) => code === "E_RADIAL_ORDER").paths.includes("/rim/outerDiameter"));
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
    const flank = rimSurface("spurGear", rim, null, maxChordError).points
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
  input.bore.diameter = NaN;
  input.web.axialThickness = Infinity;
  input.rim.extra = 1;
  const result = validateDescription(input);
  assert.equal(result.ok, false);
  for (const path of ["/bore/diameter", "/web/axialThickness", "/rim/extra"]) {
    assert.ok(result.diagnostics.some(({ code, paths }) => code === "E_SCHEMA_VALUE" && paths.includes(path)), path);
  }
  delete input.rim.extra;
  input.bore.diameter = snapshot.bore.diameter;
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
    const result = generatePulley(input);
    const toothed = input.kind === "timingPulley";
    const gear = input.kind === "spurGear";
    assert.equal(result.ok, true, `${name}: ${JSON.stringify(result.diagnostics)}`);
    assert.deepEqual(result.verification.errors, [], name);
    assert.deepEqual(result.diagnostics.map(({ code }) => code), [...(extraWarnings[name] ?? []), ...(toothed ? ["W_EXPERIMENTAL_PROFILE"] : [])], name);

    // sizes straight from the contract formulas, not from derive()
    const { rim, flanges, hub } = input;
    const outsideRadius = toothed ? rim.toothCount / Math.PI - 0.254 : gear ? rim.module * (rim.toothCount / 2 + 1 + rim.profileShift) : rim.outerDiameter / 2;
    // a smooth circle need not have a vertex on the X axis: it may fall short by the chord tolerance
    const tolerance = toothed ? 1e-9 : input.generation.maxChordError;
    const flangeRadii = [flanges.lower, flanges.upper].filter(Boolean).map((flange) => outsideRadius + flange.radialExtension);
    const radius = Math.max(outsideRadius, ...flangeRadii);
    const bottom = -rim.width / 2 - Math.max(hub.lowerExtension, flanges.lower?.axialThickness ?? 0);
    const top = rim.width / 2 + Math.max(hub.upperExtension, flanges.upper?.axialThickness ?? 0);
    const { min, max } = result.mesh.bounds;
    // a gear has a tooth tip on +Y, not necessarily on the X axis
    if (gear) assert.ok(Math.abs(max[1] - radius) < 1e-9 && max[0] <= radius && -min[0] <= radius, `${name}: radius ${max[1]} vs ${radius}`);
    else assert.ok(Math.abs(max[0] - radius) < tolerance && Math.abs(min[0] + radius) < tolerance, `${name}: radius ${max[0]} vs ${radius}`);
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
