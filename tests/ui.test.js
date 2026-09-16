import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { buildPlanView, validateDescription } from "../src/core/generate.js";
import { chordSummary, renderChord, renderPlan, renderSection, renderTooth } from "../src/ui/drawings.js";
import { FIELD_BY_PATH, FIELDS, GROUPS, KINDS, fieldHint, fieldLabel, fieldSchema, fieldsOf, groupOfPath, groupsOf, groupTitle } from "../src/ui/fields.js";
import { formatNumber, inputText, plural, splitSymbol } from "../src/ui/format.js";
import { diagnosticKind, diagnosticText } from "../src/ui/messages.js";
import { PRESETS } from "../src/ui/presets.js";
import { createState, getValue, keepShaft, loadDescription, parseNumber, restoreState, setBoreShape, setFlange, setValue, setWebType } from "../src/ui/state.js";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const schema = await readJson("../schemas/pulley-v4.schema.json");
const exampleNames = async (kind) => (await readdir(new URL(`../examples/${kind}/`, import.meta.url))).filter((name) => name.endsWith(".json")).sort();
const numeric = (field) => !field.kind;

function modelOf(description) {
  const result = validateDescription(description);
  return { ...result, plan: buildPlanView(result.normalized, result.derived) };
}

function contextFor(model, group, focus = null) {
  const errors = new Set();
  const advice = new Set();
  for (const item of model.diagnostics) for (const path of item.paths) (item.severity === "error" ? errors : advice).add(path);
  const visible = new Set(fieldsOf(group, model.normalized).map(({ path }) => path));
  return { visible, focus, errors, advice, group, description: model.normalized };
}

/** Paths of the dimensions drawn in an SVG string, with repeats. */
function dimensionPaths(svg) {
  return [...svg.matchAll(/<g class="dim[^"]*" data-path="([^"]+)"/g)].map((match) => match[1]);
}

test("every field is described completely and its limits come from the schema", async () => {
  const groups = new Set(GROUPS.map(({ id }) => id));
  const paths = new Set();
  for (const field of FIELDS) {
    assert.ok(groups.has(field.group), field.path);
    assert.ok(!paths.has(field.path), `duplicate ${field.path}`);
    paths.add(field.path);
    assert.ok(field.label && field.hint, field.path);
    if (!numeric(field)) continue;
    assert.ok(field.symbol, `${field.path} has no drawing symbol`);
    // limits may depend on the kind: check them for every kind that has the field
    for (const { id: kind } of KINDS) {
      const description = createState(schema, kind).description;
      if (field.applies && !field.applies(description)) continue;
      const limits = fieldSchema(schema, field, description);
      for (const key of ["minimum", "maximum", "default"]) assert.ok(Number.isFinite(limits[key]), `${field.path} ${kind} ${key}`);
      assert.ok(limits.minimum <= limits.default && limits.default <= limits.maximum, `${field.path} ${kind}`);
    }
  }
  // every number the contract lets a person choose has a field (together the examples have all parts)
  const leaves = [];
  const walk = (value, path) => {
    if (typeof value === "number") leaves.push(path);
    else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) walk(child, `${path}/${key}`);
  };
  for (const name of await exampleNames("valid")) walk(await readJson(`../examples/valid/${name}`), "");
  for (const path of ["/bore/sides", "/bore/flatDistance", "/bore/keyWidth", "/bore/keyDepth"]) assert.ok(leaves.includes(path), `no example has ${path}`);
  for (const leaf of leaves.filter((path) => path !== "/schemaVersion")) assert.ok(paths.has(leaf), `no field for ${leaf}`);
});

test("each visible numeric field has a dimension on the drawings of its group", async () => {
  for (const name of await exampleNames("valid")) {
    const model = modelOf(await readJson(`../examples/valid/${name}`));
    assert.equal(model.ok, true, name);
    for (const { id: group } of groupsOf(model.normalized).filter(({ id }) => id !== "presets")) {
      const ctx = contextFor(model, group);
      const teeth = group === "rim" && model.normalized.kind === "spurGear";
      const drawings = [renderPlan(model, ctx), renderSection(model, ctx), group === "generation" ? renderChord(model, ctx) : "", teeth ? renderTooth(model, ctx) : ""].map(dimensionPaths);
      const drawn = drawings.flat();
      const expected = [...ctx.visible].filter((path) => numeric(FIELDS.find((field) => field.path === path)));
      // a size may appear on both views (the diameters do), but once per view
      for (const path of expected) {
        assert.ok(drawn.includes(path), `${name} ${group} ${path} is not drawn`);
        for (const paths of drawings) assert.ok(paths.filter((item) => item === path).length <= 1, `${name} ${group} ${path} twice`);
      }
      // only the current group is dimensioned, so hidden fields never show up
      assert.deepEqual([...new Set(drawn)].sort(), expected.sort(), `${name} ${group}`);
    }
  }
});

test("spoke fields disappear with a solid web; flanges draw only when present", async () => {
  const model = modelOf(await readJson("../examples/valid/solid-basic.json"));
  const ctx = { ...contextFor(model, "web"), visible: new Set(FIELDS.map(({ path }) => path)) };
  const drawn = [renderPlan(model, ctx), renderSection(model, ctx)].flatMap(dimensionPaths);
  assert.ok(!drawn.includes("/web/count") && !drawn.includes("/web/filletRadius"));
  assert.ok(!drawn.some((path) => path.startsWith("/flanges/")), "solid-basic has no flanges");
  const asymmetric = modelOf(await readJson("../examples/valid/asymmetric.json"));
  const section = renderSection(asymmetric, contextFor(asymmetric, "flanges"));
  assert.ok(section.includes('data-path="/flanges/upper"') && !section.includes('data-path="/flanges/lower"'));
});

test("the focused dimension is marked and the drawings are self-contained", async () => {
  const model = modelOf(await readJson("../examples/valid/trial-60t.json"));
  const plan = renderPlan(model, contextFor(model, "web", "/web/filletRadius"));
  assert.match(plan, /<g class="dim is-focus" data-path="\/web\/filletRadius"/);
  assert.match(plan, /role="button" aria-label="Радиус скруглений: 1,5 мм"/);
  const section = renderSection(model, contextFor(model, "web"));
  // one hatch pattern with a page-unique id, referenced by the section only
  assert.equal([...section.matchAll(/<pattern id="section-hatch"/g)].length, 1);
  assert.ok(!plan.includes("<pattern"));
  assert.ok(!/NaN|undefined/.test(plan + section), "no broken numbers in the SVG");
});

test("the bore group shows the hub as a detail with the sizes of its shape", async () => {
  const expected = { "hex-bore.json": ["/bore/diameter", "/bore/sides"], "motor-d-flat.json": ["/bore/diameter", "/bore/flatDistance"], "keyed-spokes.json": ["/bore/diameter", "/bore/keyDepth", "/bore/keyWidth"] };
  for (const [name, paths] of Object.entries(expected)) {
    const model = modelOf(await readJson(`../examples/valid/${name}`));
    const plan = renderPlan(model, contextFor(model, "bore"));
    assert.deepEqual(dimensionPaths(plan).sort(), paths, name);
    assert.match(plan, /<clipPath id="plan-detail">/, name);
    assert.ok(!/NaN|undefined/.test(plan), name);
    assert.ok(!renderPlan(model, contextFor(model, "hub")).includes("clipPath"), `${name}: only the bore group is a detail`);
  }
  // the flat is measured on the section too, where the hub halves differ
  const flat = modelOf(await readJson("../examples/valid/motor-d-flat.json"));
  assert.deepEqual(dimensionPaths(renderSection(flat, contextFor(flat, "bore"))), ["/bore/flatDistance"]);
  // out-of-rule sizes still draw
  for (const name of ["bore-flat.json", "bore-key.json"]) {
    const model = modelOf(await readJson(`../examples/invalid/${name}`));
    assert.ok(!/NaN|undefined/.test(renderPlan(model, contextFor(model, "bore")) + renderSection(model, contextFor(model, "bore"))), name);
  }
});

test("a schematic spoke plan still draws, without fillet radii", async () => {
  const model = modelOf(await readJson("../examples/invalid/spoke-fillet.json"));
  assert.equal(model.ok, false);
  assert.equal(model.plan.spokes.schematic, true);
  const plan = renderPlan(model, contextFor(model, "web"));
  assert.ok(dimensionPaths(plan).includes("/web/width"));
  assert.ok(!dimensionPaths(plan).includes("/web/filletRadius"));
  assert.match(plan, /part-schematic/);
});

test("chord summary counts segments for the characteristic circles", async () => {
  const model = modelOf(await readJson("../examples/valid/trial-60t.json"));
  const rows = chordSummary(model);
  assert.deepEqual(rows.map(({ name }) => name), ["отверстие", "втулка", "фланец"]);
  assert.ok(rows.every(({ segments }) => Number.isInteger(segments) && segments >= 12));
  assert.ok(rows[0].segments < rows[2].segments, "a larger circle needs more segments");
  const hex = modelOf(await readJson("../examples/valid/hex-bore.json"));
  assert.ok(!chordSummary(hex).some(({ name }) => name === "отверстие"), "a polygonal bore has no arcs");
});

test("defaults validate and the form state keeps hidden values", () => {
  const state = createState(schema);
  assert.equal(validateDescription(state.description).ok, true);

  const spokes = setValue(setWebType(state, "spokes"), "/web/width", 4);
  assert.equal(state.description.web.type, "solid", "updates never mutate the previous state");
  const solid = setWebType(spokes, "solid");
  assert.deepEqual(Object.keys(solid.description.web).sort(), ["alignment", "axialOffset", "thinning", "type"]);
  assert.equal(validateDescription(solid.description).ok, true, "a solid web carries no spoke fields");
  assert.equal(setWebType(solid, "spokes").description.web.width, 4);

  const flanged = setValue(setFlange(state, "upper", true), "/flanges/upper/axialThickness", 2.5);
  const bare = setFlange(flanged, "upper", false);
  assert.equal(bare.description.flanges.upper, null);
  assert.equal(setFlange(bare, "upper", true).description.flanges.upper.axialThickness, 2.5);
  assert.equal(getValue(flanged.description, "/flanges/upper/axialThickness"), 2.5);
});

test("switching the bore shape keeps the diameter and the sizes of other shapes", async () => {
  const state = createState(schema);
  const keyed = setValue(setValue(setBoreShape(state, "keyed"), "/bore/keyWidth", 3), "/bore/diameter", 10);
  assert.deepEqual(keyed.description.bore, { shape: "keyed", diameter: 10, keyWidth: 3, keyDepth: 1 });
  const hex = setBoreShape(keyed, "polygon");
  assert.deepEqual(hex.description.bore, { shape: "polygon", diameter: 10, sides: 6 });
  assert.equal(validateDescription({ ...hex.description, hub: { ...hex.description.hub, outerDiameter: 16 } }).ok, true);
  assert.equal(setBoreShape(hex, "keyed").description.bore.keyWidth, 3);
  assert.deepEqual(setBoreShape(hex, "round").description.bore, { shape: "round", diameter: 10 });

  const loaded = loadDescription(state, await readJson("../examples/valid/motor-d-flat.json"));
  assert.equal(setBoreShape(setBoreShape(loaded, "round"), "dFlat").description.bore.flatDistance, 4.7);
});

test("a form state saved with a version 1 description is upgraded", () => {
  const { description } = createState(schema);
  const { bore, ...rest } = description;
  const { width, ...rim } = description.rim;
  // the default web has no thinning and no flanges around it: version 3 called it as thick as the rim
  const web = { type: "solid", axialThickness: width, axialOffset: 0 };
  const legacy = { ...rest, schemaVersion: 1, rim: { ...rim, toothedWidth: width }, web, hub: { boreDiameter: 6, ...description.hub } };
  const saved = { description: legacy, remembered: { spokes: { count: 4, width: 2, filletRadius: 1 }, flanges: createState(schema).remembered.flanges } };
  const restored = restoreState(schema, saved);
  assert.deepEqual(restored.description, { ...description, bore: { shape: "round", diameter: 6 } });
  assert.equal(restored.remembered.spokes.count, 4);
  assert.equal(restored.remembered.bore.sides, 6);
  assert.equal(restoreState(schema, { description }), null);
});

test("loading a description remembers its spokes and flanges", async () => {
  const preset = await readJson("../examples/valid/trial-60t.json");
  const loaded = loadDescription(createState(schema), preset);
  assert.deepEqual(loaded.description, preset);
  const solid = setWebType(loaded, "solid");
  const back = setWebType(solid, "spokes");
  assert.deepEqual(back.description.web, preset.web);
  assert.equal(setFlange(setFlange(loaded, "lower", false), "lower", true).description.flanges.lower.axialThickness, preset.flanges.lower.axialThickness);
});

test("each kind has valid defaults, variants, its own rim fields and words", async () => {
  for (const { id, title } of KINDS) {
    const { description } = createState(schema, id);
    assert.equal(description.kind, id);
    assert.equal(validateDescription(description).ok, true, id);
    const kinds = await Promise.all(PRESETS.map(async ({ file }) => (await readJson(`../examples/valid/${file}`)).kind));
    assert.ok(kinds.includes(id), `${title} has no variants`);
  }
  const timing = createState(schema).description;
  const idler = createState(schema, "idlerPulley").description;
  const paths = (description) => fieldsOf("rim", description).map(({ path }) => path);
  assert.deepEqual(paths(timing), ["/rim/toothCount", "/rim/width", "/rim/radialThickness"]);
  assert.deepEqual(paths(idler), ["/rim/outerDiameter", "/rim/width", "/rim/radialThickness"]);
  const gear = createState(schema, "spurGear").description;
  assert.deepEqual(paths(gear), ["/rim/module", "/rim/toothCount", "/rim/pressureAngle", "/rim/profileShift", "/rim/backlash", "/rim/width", "/rim/radialThickness"]);
  assert.equal(fieldSchema(schema, FIELD_BY_PATH.get("/rim/toothCount"), gear).minimum, 6, "a gear takes fewer teeth than a pulley");
  assert.equal(fieldSchema(schema, FIELD_BY_PATH.get("/rim/toothCount"), timing).minimum, 14);
  assert.ok(!groupsOf(gear).some(({ id }) => id === "flanges"), "a gear has no flanges");
  assert.ok(groupsOf(idler).some(({ id }) => id === "flanges"));
  const flanged = validateDescription(await readJson("../examples/invalid/gear-flange.json")).diagnostics[0];
  assert.match(diagnosticText(flanged, gear), /У шестерни нет фланцев/);
  const rim = GROUPS.find(({ id }) => id === "rim");
  assert.equal(groupTitle(rim, timing), "Ремень и зубья");
  assert.equal(groupTitle(rim, idler), "Ремень и обод");
  assert.equal(fieldLabel(FIELD_BY_PATH.get("/rim/radialThickness"), idler), "Толщина обода");
  // a smooth pulley is never explained with teeth
  for (const field of FIELDS.filter((item) => fieldsOf(item.group, idler).includes(item))) {
    assert.ok(!/зуб|венц|канав/i.test(fieldLabel(field, idler) + fieldHint(field, idler)), field.path);
  }
  const noInterior = validateDescription(await readJson("../examples/invalid/idler-no-interior.json")).diagnostics;
  assert.match(diagnosticText(noInterior.find(({ code }) => code === "E_RIM_NO_INTERIOR")), /^Обод слишком толстый/);
  assert.match(diagnosticText(noInterior.find(({ code }) => code === "E_RADIAL_ORDER")), /больше диаметр обода/);
  const fillet = { code: "E_SPOKE_FILLET", paths: ["/web/filletRadius"], details: { maxByWidth: 1, maxBySpan: 2 } };
  assert.match(diagnosticText(fillet, idler), /втулкой и ободом/);
  assert.match(diagnosticText(fillet, timing), /втулкой и венцом/);
});

test("a new part of another kind can keep the hub and the bore", async () => {
  const motor = loadDescription(createState(schema), await readJson("../examples/valid/motor-d-flat.json"));
  const idler = createState(schema, "idlerPulley").description;
  const kept = keepShaft(loadDescription(motor, idler), motor);
  assert.equal(kept.description.kind, "idlerPulley");
  assert.deepEqual(kept.description.rim, idler.rim);
  assert.deepEqual(kept.description.hub, motor.description.hub);
  assert.deepEqual(kept.description.bore, motor.description.bore);
  assert.equal(setBoreShape(setBoreShape(kept, "round"), "dFlat").description.bore.flatDistance, 4.7, "remembered bore sizes come along");
});

test("presets point at valid examples", async () => {
  const valid = new Set(await exampleNames("valid"));
  for (const preset of PRESETS) {
    assert.ok(valid.has(preset.file), preset.file);
    assert.ok(preset.title && preset.text, preset.file);
    assert.equal(validateDescription(await readJson(`../examples/valid/${preset.file}`)).ok, true, preset.file);
  }
});

test("numbers read and written the Russian way", () => {
  assert.equal(parseNumber("1,5"), 1.5);
  assert.equal(parseNumber(" −2 "), -2);
  assert.equal(parseNumber("-0.25"), -0.25);
  assert.ok(Number.isNaN(parseNumber("")));
  assert.ok(Number.isNaN(parseNumber("6x")));
  assert.equal(formatNumber(1.5), "1,5");
  assert.equal(formatNumber(-2), "−2");
  assert.equal(formatNumber(-0.004), "0");
  assert.equal(formatNumber(25.4648), "25,46");
  assert.equal(formatNumber(NaN), "—");
  assert.equal(inputText(0.05), "0,05");
  assert.equal(inputText("6x"), "6x");
  assert.deepEqual(splitSymbol("T_f−"), { base: "T", sub: "f−" });
  assert.deepEqual(splitSymbol("ε"), { base: "ε", sub: "" });
  const forms = (count) => plural(count, "треугольник", "треугольника", "треугольников");
  assert.deepEqual([1, 2, 5, 11, 12, 21, 9324, 7596, 111, 1001].map(forms),
    ["треугольник", "треугольника", "треугольников", "треугольников", "треугольников", "треугольник", "треугольника", "треугольников", "треугольников", "треугольник"]);
});

test("diagnostic paths map to groups", () => {
  assert.equal(groupOfPath("/flanges/lower/axialThickness"), "flanges");
  assert.equal(groupOfPath("/flanges/lower"), "flanges");
  assert.equal(groupOfPath("/web/type"), "web");
  assert.equal(groupOfPath("/rim/profile"), "rim");
  assert.equal(groupOfPath("/hub/outerDiameter"), "hub");
  assert.equal(groupOfPath("/bore/keyDepth"), "bore");
});

test("every diagnostic of the examples reads as a sentence", async () => {
  for (const kind of ["valid", "invalid"]) {
    for (const name of await exampleNames(kind)) {
      for (const item of validateDescription(await readJson(`../examples/${kind}/${name}`)).diagnostics) {
        const text = diagnosticText(item);
        assert.notEqual(text, item.code, `${name}: ${item.code} has no text`);
        assert.ok(!/NaN|undefined|— мм/.test(text), `${name}: ${text}`); // "—" is formatNumber's non-number
        assert.ok(["error", "advice", "warning"].includes(diagnosticKind(item)));
      }
    }
  }
});

test("fillet advice does not repeat a missing hub-to-rim span", async () => {
  const input = await readJson("../examples/valid/trial-60t.json");
  input.hub.outerDiameter = 36;
  const result = validateDescription(input);
  const codes = result.diagnostics.map(({ code }) => code);
  assert.ok(codes.includes("E_RADIAL_ORDER"));
  assert.ok(!codes.includes("E_SPOKE_FILLET"), "R_f 1.5 fits the 3 mm spoke; the span is E_RADIAL_ORDER's business");
  input.web.filletRadius = 2;
  const fillet = validateDescription(input).diagnostics.find(({ code }) => code === "E_SPOKE_FILLET");
  assert.deepEqual(fillet.details, { maxByWidth: 1.5 });
  assert.equal(diagnosticText(fillet), "Радиус скругления — не больше половины ширины спицы, 1,5 мм.");
});
