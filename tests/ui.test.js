import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { buildPlanView, validateDescription } from "../src/core/generate.js";
import { chordSummary, renderChord, renderPlan, renderSection } from "../src/ui/drawings.js";
import { FIELDS, GROUPS, fieldSchema, fieldsOf, groupOfPath } from "../src/ui/fields.js";
import { formatNumber, inputText, splitSymbol } from "../src/ui/format.js";
import { diagnosticKind, diagnosticText } from "../src/ui/messages.js";
import { PRESETS } from "../src/ui/presets.js";
import { createState, getValue, loadDescription, parseNumber, setFlange, setValue, setWebType } from "../src/ui/state.js";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const schema = await readJson("../schemas/pulley-v1.schema.json");
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
    const limits = fieldSchema(schema, field);
    for (const key of ["minimum", "maximum", "default"]) assert.ok(Number.isFinite(limits[key]), `${field.path} ${key}`);
    assert.ok(limits.minimum <= limits.default && limits.default <= limits.maximum, field.path);
  }
  // every number the contract lets a person choose has a field (this example has all parts)
  const leaves = [];
  const walk = (value, path) => {
    if (typeof value === "number") leaves.push(path);
    else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) walk(child, `${path}/${key}`);
  };
  walk(await readJson("../examples/valid/spokes-flanged.json"), "");
  for (const leaf of leaves.filter((path) => path !== "/schemaVersion")) assert.ok(paths.has(leaf), `no field for ${leaf}`);
});

test("each visible numeric field has a dimension on the drawings of its group", async () => {
  for (const name of await exampleNames("valid")) {
    const model = modelOf(await readJson(`../examples/valid/${name}`));
    assert.equal(model.ok, true, name);
    for (const { id: group } of GROUPS.filter(({ id }) => id !== "presets")) {
      const ctx = contextFor(model, group);
      const drawings = [renderPlan(model, ctx), renderSection(model, ctx), group === "generation" ? renderChord(model, ctx) : ""].map(dimensionPaths);
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
});

test("defaults validate and the form state keeps hidden values", () => {
  const state = createState(schema);
  assert.equal(validateDescription(state.description).ok, true);

  const spokes = setValue(setWebType(state, "spokes"), "/web/width", 4);
  assert.equal(state.description.web.type, "solid", "updates never mutate the previous state");
  const solid = setWebType(spokes, "solid");
  assert.deepEqual(Object.keys(solid.description.web).sort(), ["axialOffset", "axialThickness", "type"]);
  assert.equal(validateDescription(solid.description).ok, true, "a solid web carries no spoke fields");
  assert.equal(setWebType(solid, "spokes").description.web.width, 4);

  const flanged = setValue(setFlange(state, "upper", true), "/flanges/upper/axialThickness", 2.5);
  const bare = setFlange(flanged, "upper", false);
  assert.equal(bare.description.flanges.upper, null);
  assert.equal(setFlange(bare, "upper", true).description.flanges.upper.axialThickness, 2.5);
  assert.equal(getValue(flanged.description, "/flanges/upper/axialThickness"), 2.5);
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
});

test("diagnostic paths map to groups", () => {
  assert.equal(groupOfPath("/flanges/lower/axialThickness"), "flanges");
  assert.equal(groupOfPath("/flanges/lower"), "flanges");
  assert.equal(groupOfPath("/web/type"), "web");
  assert.equal(groupOfPath("/rim/profile"), "rim");
  assert.equal(groupOfPath("/hub/outerDiameter"), "hub");
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
