// Gears — (c) 2026 Ivan Polyacov (ivan@apus-software.com), Elastic License 2.0, see LICENSE
// Pulley form: groups of fields, live drawings, diagnostics next to the fields,
// and the 3D preview of the built part.
//
// Flow: every edit produces a new state → validateDescription (core, main thread,
// fractions of a millisecond) → drawings and messages are redrawn. A valid state
// is also sent to the worker, which builds the mesh; its answer is shown only
// while it still matches the current parameters, and only then STL is offered.
// The form itself is rebuilt only when its structure changes (group, web type,
// flange switch, bore shape, loaded file), so typing keeps the caret.

import { buildPlanView, validateDescription } from "../core/generate.js";
import { exportBinaryStl } from "../export/stl.js";
import { GENERATOR, VERSION } from "../about.js";
import { BuildClient } from "../worker/client.js";
import { chordSummary, renderChord, renderCone, renderHelix, renderPlan, renderSection, renderTooth } from "./drawings.js";
import { FIELD_BY_PATH, GROUPS, KINDS, fieldHint, fieldLabel, fieldOptions, fieldSchema, fieldsOf, fieldUnit, groupOfPath, groupsOf, groupTitle, kindOf } from "./fields.js";
import { escapeHtml, formatCount, formatNumber, inputText, symbolHtml } from "./format.js";
import { T } from "./locale.js";
import { diagnosticKind, diagnosticText } from "./messages.js";
import { PRESETS } from "./presets.js";
import { createState, defaultDescription, getValue, keepShaft, loadDescription, parseNumber, restoreState as upgradeState, setBoreShape, setFlange, setHelix, setValue, setWebType } from "./state.js";
import { MeshViewer } from "./viewer.js";

const STORAGE_KEY = "gears.pulley.form.v1";
const SECTION_FIRST = new Set(["flanges", "hub"]);
const MAX_FILE_BYTES = 1 << 20; // a description is well under a kilobyte
const BUILD_TIMEOUT_MS = 20000;
const CONTEXT_VIEW_SCALE = 0.6; // labels of a view with no sizes of its own, relative to the main one
const PRESET_KIND_ORDER = ["gear", "bevelGear", "timingPulley", "idlerPulley"]; // gears open the variants page
const $ = (selector) => document.querySelector(selector);
const el = {
  nav: $("#groups"), title: $("#group-title"), form: $("#form"), sizes: $("#sizes"), status: $("#status"), drawings: $("#drawings"),
  plan: $("#plan"), section: $("#section"), sectionTag: $("#section-tag"), planTag: $("#plan-tag"),
  chordFigure: $("#chord-figure"), chord: $("#chord"), planFigure: $("#plan-figure"), sectionFigure: $("#section-figure"),
  toothFigure: $("#tooth-figure"), tooth: $("#tooth"), toothTag: $("#tooth-tag"), helixFigure: $("#helix-figure"), helix: $("#helix"),
  coneFigure: $("#cone-figure"), cone: $("#cone"),
  stale: $("#stale"), file: $("#file-input"), notice: $("#notice"),
  viewport: $("#viewport"), canvas: $("#viewer"), previewState: $("#preview-state"), overlay: $("#preview-overlay"),
  previewInfo: $("#preview-info"), retry: $("#retry"), stl: $("#download-stl"),
  partTitle: $("#part-title"), profileBadge: $("#profile-badge")
};

let schema, presets;
try {
  // relative to this module rather than the page: the published page sits at the site root
  schema = await fetchJson(new URL("../../schemas/pulley-v6.schema.json", import.meta.url));
  presets = await Promise.all(PRESETS.map(async (preset) => ({ ...preset, description: await fetchJson(new URL(`../../examples/valid/${preset.file}`, import.meta.url)) })));
} catch (error) {
  $("#boot").className = "notice notice-error";
  $("#boot").textContent = T.page.bootFailed(error.message);
  throw error;
}
$("#boot").hidden = true;
$("#version").textContent = VERSION;

let state = restoreState() ?? createState(schema);
// the page opens on the variants; a bookmarked group or field opens the editor directly
const view = { group: "presets", focus: null, keepShaft: false, ...readHash() };
let validation = null; // core answer for the current description
let result = null; // the same with build failures of the current description added
let currentKey = null;
let model = null; // last structurally valid description with its geometry
let build = { key: null, reply: null }; // worker answer for the parameters that were current when it arrived

const client = new BuildClient({
  createWorker: () => new Worker(new URL("../worker/pulley-worker.js", import.meta.url), { type: "module" }),
  onResult: receiveBuild,
  timeoutMs: BUILD_TIMEOUT_MS
});
const viewer = createViewer();

evaluate();
renderAll();
if (view.focus) focusField(view.focus);
scheduleBuild();
renderPreview();

// ------------------------------------------------------------------ state

function evaluate() {
  validation = validateDescription(state.description);
  currentKey = JSON.stringify(state.description);
  result = validation;
  const answer = build.key === currentKey ? build.reply : null;
  if (validation.ok && answer?.type === "built" && !answer.ok) {
    // mesh-level failures belong to these parameters: shown next to their fields like any other
    const failures = answer.diagnostics.filter((item) => item.phase === "build");
    result = { ...validation, ok: false, diagnostics: [...validation.diagnostics, ...failures] };
  }
  if (result.normalized) {
    model = { normalized: result.normalized, derived: result.derived, anchors: result.anchors, plan: buildPlanView(result.normalized, result.derived) };
  }
}

function update(next, { rebuildForm = false } = {}) {
  state = next;
  saveState();
  evaluate();
  if (rebuildForm) renderForm();
  else renderComputed();
  renderNav();
  renderMessages();
  renderDrawings();
  scheduleBuild();
  renderPreview();
}

/** Ask the worker for the current part unless it is invalid or already answered. */
function scheduleBuild() {
  const answered = build.key === currentKey && build.reply !== null;
  client.request(currentKey, validation.ok && !answered ? state.description : null);
}

function receiveBuild(answer) {
  build = answer;
  if (answer.reply.type === "built" && answer.reply.ok) viewer?.setMesh(answer.reply.mesh);
  evaluate();
  renderNav();
  renderMessages();
  renderDrawings();
  renderPreview();
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state }));
  } catch { /* storage unavailable: the form still works for this visit */ }
}

function restoreState() {
  try {
    return upgradeState(schema, JSON.parse(localStorage.getItem(STORAGE_KEY))?.state);
  } catch {
    return null;
  }
}

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const group = GROUPS.some(({ id }) => id === params.get("group")) ? params.get("group") : undefined;
  const field = FIELD_BY_PATH.get(params.get("field") ?? "");
  return field ? { group: field.group, focus: field.path } : group ? { group } : {};
}

function writeHash() {
  // paths are letters and slashes, which a fragment keeps readable without escaping
  history.replaceState(null, "", `#group=${view.group}${view.focus ? `&field=${view.focus}` : ""}`);
}

// -------------------------------------------------------------- rendering

function renderAll() {
  // the variants take the whole page: drawings and the preview belong to the editor
  document.body.dataset.page = view.group === "presets" ? "presets" : "editor";
  // a group the part does not have (flanges of a gear) falls back to its rim
  if (!groupsOf(state.description).some(({ id }) => id === view.group)) view.group = "rim";
  renderHeader();
  renderNav();
  renderForm();
  renderMessages();
  renderDrawings();
}

function renderHeader() {
  const kind = kindOf(state.description);
  el.partTitle.textContent = kind.title;
  el.profileBadge.hidden = !kind.experimental;
  document.title = T.page.title(kind.title);
}

/** Diagnostics without the permanent profile warning, which lives in the header. */
function activeDiagnostics() {
  return result.diagnostics.filter(({ code }) => code !== "W_EXPERIMENTAL_PROFILE");
}

function renderNav() {
  const counts = new Map();
  for (const item of activeDiagnostics()) {
    for (const group of new Set(item.paths.map(groupOfPath))) {
      const entry = counts.get(group) ?? { error: 0, other: 0 };
      entry[item.severity === "error" ? "error" : "other"] += 1;
      counts.set(group, entry);
    }
  }
  el.nav.innerHTML = groupsOf(state.description).map((group) => {
    const { id } = group;
    const title = groupTitle(group, state.description);
    const count = counts.get(id);
    const badge = count?.error ? `<span class="badge badge-error" aria-label="${T.page.errorsBadge(count.error)}">${count.error}</span>`
      : count?.other ? `<span class="badge badge-advice" aria-label="${T.page.adviceBadge(count.other)}">!</span>` : "";
    return `<button type="button" data-group="${id}"${id === view.group ? ' aria-current="page"' : ""}>${escapeHtml(title)}${badge}</button>`;
  }).join("");
}

function renderForm() {
  const group = GROUPS.find(({ id }) => id === view.group);
  el.title.textContent = groupTitle(group, state.description);
  if (view.group === "presets") {
    el.form.innerHTML = presetCards();
    renderComputed();
    return;
  }
  const description = state.description;
  el.form.innerHTML = fieldsOf(view.group, description).map((field) => {
    if (field.kind === "toggle") return toggleMarkup(field, description);
    if (field.kind === "choice") return choiceMarkup(field, description);
    return numberMarkup(field, description);
  }).join("");
  renderComputed();
}

/** The computed sizes follow every change and stay in sight beside the form, under the preview. */
function renderComputed() {
  const markup = view.group === "presets" ? "" : computedMarkup();
  el.sizes.innerHTML = markup;
  el.sizes.hidden = !markup;
}

function fieldId(path) {
  return `f${path.replaceAll("/", "-")}`;
}

// the hint and the messages of a field open from small buttons beside its label,
// so the form stays short; the message button shows only while there is something to say
function tipButtons(id) {
  return `<button type="button" class="tip-toggle" aria-label="${T.page.hintButton}" aria-expanded="false" aria-controls="${id}-hint">?</button><button type="button" class="tip-toggle tip-msg" aria-label="${T.page.messageButton}" aria-expanded="false" aria-controls="${id}-msg" hidden>!</button>`;
}

function tipBoxes(id, hint) {
  return `<p class="tip field-hint" id="${id}-hint" role="tooltip">${hint}</p>
    <div class="tip field-msg" id="${id}-msg" aria-live="polite"></div>`;
}

function numberMarkup(field, description) {
  const id = fieldId(field.path);
  const limits = fieldSchema(schema, field, description);
  const unit = field.unit ? ` ${fieldUnit(field)}` : "";
  const range = `${formatNumber(limits.minimum)}…${formatNumber(limits.maximum)}${unit}`;
  return `<div class="field" data-field="${field.path}">
    <div class="field-head"><label for="${id}"><span class="field-label">${escapeHtml(fieldLabel(field, description))}</span> <span class="field-symbol">${symbolHtml(field.symbol)}</span></label>${tipButtons(id)}</div>
    <div class="input-row">
      <input id="${id}" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" data-path="${field.path}"
        value="${escapeHtml(inputText(getValue(description, field.path)))}" aria-describedby="${id}-hint ${id}-msg">
      ${field.unit ? `<span class="unit">${fieldUnit(field)}</span>` : ""}
    </div>
    ${tipBoxes(id, `${escapeHtml(fieldHint(field, description))} <span class="range">${T.page.range(range, `${formatNumber(limits.default)}${unit}`)}</span>`)}
  </div>`;
}

function toggleMarkup(field, description) {
  const id = fieldId(field.path);
  const checked = Boolean(getValue(description, field.path));
  return `<div class="field field-toggle" data-field="${field.path}">
    <div class="field-head"><label class="toggle" for="${id}"><input id="${id}" type="checkbox" data-path="${field.path}"${checked ? " checked" : ""} aria-describedby="${id}-hint ${id}-msg">
      <span>${escapeHtml(fieldLabel(field, description))}</span></label>${tipButtons(id)}</div>
    ${tipBoxes(id, escapeHtml(fieldHint(field, description)))}
  </div>`;
}

function choiceMarkup(field, description) {
  const value = getValue(description, field.path);
  const id = fieldId(field.path);
  return `<fieldset class="field field-choice" data-field="${field.path}" aria-describedby="${id}-hint ${id}-msg">
    <legend><span class="field-head">${escapeHtml(fieldLabel(field, description))}${tipButtons(id)}</span></legend>
    <div class="segmented">${fieldOptions(field).map((option) => `<label><input type="radio" name="${id}" value="${option.value}" data-path="${field.path}"${option.value === value ? " checked" : ""}><span>${escapeHtml(option.label)}</span></label>`).join("")}</div>
    ${tipBoxes(id, escapeHtml(fieldHint(field, description)))}
  </fieldset>`;
}

/** Sizes the core derived from the entered ones, shown apart from the inputs. */
function computedMarkup() {
  if (!model) return "";
  const { derived, anchors } = model;
  const previous = result.normalized ? "" : ` <span class="tag">${T.sizes.previous}</span>`;
  const S = T.sizes;
  const mm = T.units.mm;
  // without a web the rim reaches the hub, its inner diameter is the hub one
  const rimInner = model.normalized.web.type === "none" ? null : 2 * derived.rimInnerRadius;
  const rows = {
    rim: {
      idlerPulley: [[S.idlerRimInner, rimInner]],
      gear: [[S.pitchDiameter, 2 * derived.pitchRadius], [S.tipDiameter, 2 * derived.outsideRadius], [S.rootDiameter, 2 * derived.rootRadius],
        [S.baseDiameter, 2 * derived.baseRadius], [derived.lead === null ? S.pitch : S.transversePitch, derived.pitch],
        [S.transverseModule, derived.lead === null ? null : derived.transverseModule], [S.lead, derived.lead], [S.rimInner, rimInner]],
      bevelGear: [[S.largePitchDiameter, 2 * derived.pitchRadius], [S.largeTipDiameter, 2 * derived.outsideRadius], [S.smallRootDiameter, 2 * derived.rootRadius],
        [S.pitch, derived.pitch], [S.coneAngle, derived.pitchConeAngle, "deg"], [S.mateConeAngle, derived.mateConeAngle, "deg"],
        [S.coneDistance, derived.coneDistance], [S.faceLength, derived.faceWidth], [S.apexHeight, derived.apexZ - derived.faceLowerZ],
        [S.virtualTeeth, derived.virtualToothCount, ""], [S.rimInner, rimInner]],
      timingPulley: [[S.pulleyOutside, 2 * derived.outsideRadius], [S.pitchDiameter, 2 * derived.pitchRadius], [S.grooveRoot, 2 * derived.grooveRootRadius], [S.rimInner, rimInner]]
    }[model.normalized.kind],
    flanges: [[S.lowerFlange, derived.lowerFlangeOuterRadius && 2 * derived.lowerFlangeOuterRadius], [S.upperFlange, derived.upperFlangeOuterRadius && 2 * derived.upperFlangeOuterRadius], [S.height, derived.bounds.max[2] - derived.bounds.min[2]]],
    web: model.normalized.web.type === "none" ? [] : [[model.normalized.web.type === "spokes" ? S.spokeThickness : S.webThickness, derived.webThickness],
      [S.hubToRim(derived.pitchRadius === null), anchors.radii.rimInner - anchors.radii.hub],
      // the cones as built: shorter than asked when they do not fit
      [S.hubAtWeb, derived.hubTaper.addition > 0 ? 2 * derived.hubWebRadius : null],
      [S.rimInnerAtWeb(derived.pitchRadius === null), derived.rimTaper.addition > 0 ? 2 * derived.rimInnerWebRadius : null],
      [S.webFrom, derived.webLowerZ], [S.upTo, derived.webUpperZ]],
    hub: [[S.hubWall, derived.hubRadius - derived.boreOuterRadius], [S.hubFrom, derived.hubLowerZ], [S.upTo, derived.hubUpperZ]],
    bore: boreRows(model),
    generation: []
  }[view.group].filter(([, value]) => typeof value === "number");
  if (view.group === "generation") {
    return `<div class="computed"><h3>${S.segmentsTitle}${previous}</h3><dl>${chordSummary(model).map(({ name, diameter, segments }) =>
      `<div><dt>${escapeHtml(S.circles[name])} ⌀${formatNumber(diameter)} ${mm}</dt><dd>${segments}</dd></div>`).join("")}</dl></div>`;
  }
  if (!rows.length) return "";
  // sizes are in millimetres unless a row names its unit: degrees, or none for a count
  return `<div class="computed"><h3>${S.title}${previous}</h3><dl>${rows.map(([name, value, unit = "mm"]) =>
    `<div><dt>${escapeHtml(name)}</dt><dd>${formatNumber(value)}${unit === "deg" ? T.units.deg : unit ? ` ${T.units[unit]}` : ""}</dd></div>`).join("")}</dl></div>`;
}

function boreRows({ normalized: { bore }, derived }) {
  return [
    bore.shape === "polygon" && [bore.sides % 2 ? T.sizes.inscribed : T.sizes.inscribedFlats, bore.diameter * Math.cos(Math.PI / bore.sides)],
    bore.shape === "keyed" && [T.sizes.keyway, bore.diameter + bore.keyDepth],
    [T.sizes.hubWall, derived.hubRadius - derived.boreOuterRadius]
  ].filter(Boolean);
}

/** The variants page: start a new part of any kind; the sections above lead back to the current one. */
function presetCards() {
  // a card shows the picture and the title, its description pops up on hover and focus
  let cards = 0;
  const card = (attributes, className, description, title, text) => {
    const id = `preset-tip-${cards++}`;
    return `<button type="button" class="preset ${className}" ${attributes} aria-describedby="${id}">
    <span class="preset-thumb" aria-hidden="true">${thumbnailOf(description)}</span>
    <span class="preset-title">${escapeHtml(title)}</span>
    <span class="tip preset-text" id="${id}" role="tooltip">${escapeHtml(text)}</span></button>`;
  };
  const kinds = PRESET_KIND_ORDER.map((id) => KINDS.find((kind) => kind.id === id));
  const sections = kinds.map((kind) => `<h3 class="preset-kind">${escapeHtml(kind.title)}</h3>
    <p class="lead">${escapeHtml(kind.text)}</p>
    <div class="presets">${card(`data-new="${kind.id}"`, "preset-new", defaultDescription(schema, kind.id), T.page.newPart, T.page.newPartText)}${
      presets.map((preset, index) => preset.description.kind === kind.id
        ? card(`data-preset="${index}"`, "", preset.description, preset.title, preset.text) : "").join("")}</div>`).join("");
  return `<p class="lead">${T.page.presetsLead}</p>
    <label class="toggle keep-shaft"><input type="checkbox" id="keep-shaft"${view.keepShaft ? " checked" : ""}>
      <span>${T.page.keepShaft}</span></label>${sections}`;
}

/** Plan view without sizes, or nothing for a description that cannot be drawn. */
function thumbnailOf(description) {
  const checked = validateDescription(description);
  if (!checked.normalized) return "";
  const ctx = { visible: new Set(), focus: null, errors: new Set(), advice: new Set(), group: null, description: checked.normalized };
  return renderPlan({ ...checked, plan: buildPlanView(checked.normalized, checked.derived) }, ctx);
}

/**
 * A diagnostic with several paths is explained once: at the field being edited
 * when it is one of them, otherwise at its first visible field.
 */
function messageOwner(item, visiblePaths) {
  if (view.focus && item.paths.includes(view.focus) && visiblePaths.includes(view.focus)) return view.focus;
  return visiblePaths.find((candidate) => item.paths.includes(candidate));
}

function renderMessages() {
  const shown = new Set();
  const fields = [...el.form.querySelectorAll("[data-field]")];
  const visiblePaths = fields.map((node) => node.dataset.field);
  for (const node of fields) {
    const path = node.dataset.field;
    const related = activeDiagnostics().filter((item) => item.paths.includes(path));
    const own = related.filter((item) => messageOwner(item, visiblePaths) === path);
    const owners = [...new Set(related.filter((item) => !own.includes(item)).map((item) => messageOwner(item, visiblePaths)))];
    const kind = related.some((item) => item.severity === "error") ? "error" : related.length ? "advice" : "";
    node.classList.toggle("has-error", kind === "error");
    node.classList.toggle("has-advice", kind === "advice");
    const input = node.querySelector("input[type=text]");
    if (input) input.setAttribute("aria-invalid", String(kind === "error"));
    const box = node.querySelector(".field-msg");
    if (box) {
      box.innerHTML = own.map((item) => `<p class="msg msg-${diagnosticKind(item)}">${escapeHtml(diagnosticText(item, state.description))}</p>`).join("") +
        owners.map((owner) => `<p class="msg msg-ref">${escapeHtml(T.page.related(fieldLabel(FIELD_BY_PATH.get(owner), state.description)))}</p>`).join("");
      const button = node.querySelector(".tip-msg");
      button.hidden = !box.innerHTML;
      if (button.hidden) button.setAttribute("aria-expanded", "false");
      button.classList.toggle("tip-error", kind === "error");
    }
    for (const item of own) shown.add(item);
  }
  renderStatus(shown);
}

function renderStatus(shown) {
  const errors = result.diagnostics.filter((item) => item.severity === "error");
  const elsewhere = activeDiagnostics().filter((item) => !shown.has(item));
  const links = elsewhere.map((item) => {
    const group = GROUPS.find(({ id }) => id === groupOfPath(item.paths[0]));
    return `<li class="msg-${diagnosticKind(item)}">${escapeHtml(diagnosticText(item, state.description))}${group && group.id !== view.group
      ? ` <button type="button" class="link" data-goto="${item.paths[0]}">${escapeHtml(groupTitle(group, state.description))} →</button>` : ""}</li>`;
  }).join("");
  const headline = errors.length
    ? `<p class="status-line status-error">${T.page.blocked(errors.length)}</p>`
    : `<p class="status-line status-ok">${T.page.consistent}</p>`;
  el.status.innerHTML = headline + (links ? `<ul class="status-list">${links}</ul>` : "");
}

function drawingContext() {
  const description = state.description;
  const visible = new Set(fieldsOf(view.group, description).map(({ path }) => path));
  const errors = new Set();
  const advice = new Set();
  for (const item of result.diagnostics) {
    for (const path of item.paths) (item.severity === "error" ? errors : advice).add(path);
  }
  return { visible, focus: view.focus, errors, advice, group: view.group, description };
}

function renderDrawings() {
  el.stale.hidden = Boolean(result.normalized);
  if (!model) {
    el.plan.innerHTML = el.section.innerHTML = el.tooth.innerHTML = el.helix.innerHTML = el.cone.innerHTML = "";
    el.toothFigure.hidden = el.helixFigure.hidden = el.coneFigure.hidden = true;
    return;
  }
  const ctx = drawingContext();
  // flange and hub sizes are mostly axial: their section goes first
  if (SECTION_FIRST.has(view.group)) el.planFigure.before(el.sectionFigure);
  else el.sectionFigure.before(el.planFigure);
  el.plan.innerHTML = renderPlan(model, ctx);
  el.section.innerHTML = renderSection(model, ctx);
  cropToContent(el.plan.querySelector("svg"));
  cropToContent(el.section.querySelector("svg"));
  // a view whose sizes all appear on the other one is context: it gets less room
  const [plan, section] = [el.planFigure, el.sectionFigure].map((figure) => new Set([...figure.querySelectorAll(".dim")].map((dim) => dim.dataset.path)));
  const covered = (mine, other) => [...mine].every((path) => other.has(path));
  setLabelSpan(el.planFigure, covered(plan, section) ? CONTEXT_VIEW_SCALE : 1);
  setLabelSpan(el.sectionFigure, covered(section, plan) ? CONTEXT_VIEW_SCALE : 1);
  const words = T.drawings;
  el.planTag.textContent = view.group === "bore" ? words.hubCloseUp : model.plan.spokes?.schematic ? words.schematicSpokes : words.toScale;
  el.sectionTag.textContent = model.normalized.web.type === "spokes" ? words.spokeSection : words.toScale;
  // gear teeth get a larger view of their own sizes, and the side view of their helices or pitch cones
  const { kind } = model.normalized;
  const teeth = view.group === "rim" && (kind === "gear" || kind === "bevelGear");
  const side = teeth && kind === "gear" ? [el.helixFigure, el.helix] : teeth ? [el.coneFigure, el.cone] : null;
  el.toothFigure.hidden = !teeth;
  el.helixFigure.hidden = side?.[0] !== el.helixFigure;
  el.coneFigure.hidden = side?.[0] !== el.coneFigure;
  el.tooth.innerHTML = teeth ? renderTooth(model, ctx) : "";
  el.helix.innerHTML = teeth && kind === "gear" ? renderHelix(model, ctx) : "";
  el.cone.innerHTML = teeth && kind === "bevelGear" ? renderCone(model, ctx) : "";
  if (teeth) {
    el.toothTag.textContent = kind === "bevelGear" ? words.backCone : model.normalized.rim.helix === "none" ? words.toScale : words.transverseSection;
    for (const [figure, drawing] of [[el.toothFigure, el.tooth], side]) {
      cropToContent(drawing.querySelector("svg"));
      setLabelSpan(figure, 1);
    }
  }
  el.chordFigure.hidden = view.group !== "generation";
  if (view.group === "generation") el.chord.innerHTML = renderChord(model, ctx);
  revealFocus();
}

/** The renderer leaves room for the labels of every group; keep only what is drawn. */
function cropToContent(svg) {
  const label = Number(svg.getAttribute("font-size"));
  // measured without the focus style, so the enlarged label does not rescale the view on each focus change
  const focused = [...svg.querySelectorAll(".is-focus")];
  for (const node of focused) node.classList.remove("is-focus");
  // getBBox ignores clipping: a detail is measured by its edge circle alone
  const clipped = [...svg.querySelectorAll(".detail")];
  for (const node of clipped) node.style.display = "none";
  const box = svg.getBBox();
  for (const node of clipped) node.style.display = "";
  for (const node of focused) node.classList.add("is-focus");
  if (!box.width || !box.height) return; // not laid out: a hidden page keeps the full view
  const pad = label; // strokes and the focused label's growth are outside the box
  svg.setAttribute("viewBox", [box.x - pad, box.y - pad, box.width + 2 * pad, box.height + 2 * pad].map((value) => value.toFixed(3)).join(" "));
}

/** Drawing size in label heights: the stylesheet shares space in these proportions. */
function setLabelSpan(figure, scale) {
  const svg = figure.querySelector("svg");
  const label = Number(svg.getAttribute("font-size")) / scale;
  const { width, height } = svg.viewBox.baseVal;
  figure.style.setProperty("--w", (width / label).toFixed(2));
  figure.style.setProperty("--h", (height / label).toFixed(2));
}

/** Scrolls the drawings panel, never the page, to the focused size if it is cut off. */
function revealFocus() {
  const panel = el.drawings;
  const dimension = panel.querySelector(".dim.is-focus");
  if (!dimension || panel.scrollHeight <= panel.clientHeight) return;
  const box = dimension.getBoundingClientRect();
  const frame = panel.getBoundingClientRect();
  const margin = 12;
  if (box.top < frame.top + margin) panel.scrollTop -= frame.top + margin - box.top;
  else if (box.bottom > frame.bottom - margin) panel.scrollTop += box.bottom - (frame.bottom - margin);
}

function createViewer() {
  try {
    return new MeshViewer(el.canvas);
  } catch {
    el.canvas.hidden = true;
    return null;
  }
}

/**
 * State of the preview relative to the current parameters:
 * fresh — built from them; building — asked for; invalid — they cannot be built;
 * failed — the core refused the mesh; crashed — the worker broke or timed out.
 */
function previewState() {
  const answer = build.key === currentKey ? build.reply : null;
  if (!validation.ok) return "invalid";
  if (!answer) return "building";
  if (answer.type === "crashed") return "crashed";
  return answer.ok ? "fresh" : "failed";
}

function renderPreview() {
  const status = previewState();
  const shown = Boolean(viewer?.source);
  const answer = build.reply;
  const words = T.preview;
  const previous = shown ? words.previousShown : "";
  const cause = answer?.message === "timeout" ? words.timeout(BUILD_TIMEOUT_MS / 1000) : answer?.message;
  const overlay = {
    fresh: "",
    building: words.building(shown),
    invalid: words.invalid(shown),
    failed: words.failed(previous),
    crashed: words.crashed(cause, previous)
  }[status];
  el.viewport.dataset.state = status;
  el.previewState.textContent = words.tags[status];
  el.canvas.setAttribute("aria-label", words.canvas(words.tags[status]));
  el.overlay.textContent = viewer ? overlay : words.noWebgl(status === "fresh", overlay);
  el.overlay.hidden = viewer ? !overlay : false;
  el.retry.hidden = status !== "crashed";
  viewer?.setStale(status !== "fresh" && status !== "building");

  if (status === "fresh") {
    const { bounds } = answer.mesh;
    const size = [0, 1, 2].map((axis) => formatNumber(bounds.max[axis] - bounds.min[axis])).join(" × ");
    const triangles = answer.verification.triangleCount;
    el.previewInfo.textContent = words.info(size, triangles, formatCount(triangles), Math.round(answer.elapsed));
  } else {
    el.previewInfo.textContent = "";
  }
  const blocker = stlBlocker(status);
  el.stl.setAttribute("aria-disabled", String(Boolean(blocker)));
  el.stl.title = blocker || words.stlReady;
}

/** Why STL cannot be downloaded right now; empty when it can. */
function stlBlocker(status = previewState()) {
  return status === "fresh" ? "" : T.preview.stlBlocked[status];
}

// ----------------------------------------------------------------- events

el.nav.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-group]");
  if (button) openGroup(button.dataset.group);
});

function openGroup(group, focus = null) {
  view.group = group;
  view.focus = focus;
  writeHash();
  renderAll();
}

function focusField(path) {
  const field = FIELD_BY_PATH.get(path);
  if (!field) return;
  if (field.group !== view.group) openGroup(field.group, path);
  view.focus = path;
  writeHash();
  const input = el.form.querySelector(`[data-path="${CSS.escape(path)}"]`);
  if (input) {
    input.focus();
    if (input.select) input.select();
  }
  renderDrawings();
}

el.form.addEventListener("input", (event) => {
  const input = event.target;
  if (input.type !== "text" || !input.dataset.path) return;
  const number = parseNumber(input.value);
  update(setValue(state, input.dataset.path, Number.isNaN(number) ? input.value : number));
});

el.form.addEventListener("change", (event) => {
  const input = event.target;
  const path = input.dataset.path;
  if (input.id === "keep-shaft") {
    view.keepShaft = input.checked;
  } else if (input.type === "checkbox" && path?.startsWith("/flanges/")) {
    update(setFlange(state, path.split("/")[2], input.checked), { rebuildForm: true });
    focusField(path);
  } else if (input.type === "radio" && path === "/web/type") {
    update(setWebType(state, input.value), { rebuildForm: true });
    focusField(path);
  } else if (input.type === "radio" && path === "/rim/helix") {
    update(setHelix(state, input.value), { rebuildForm: true });
    focusField(path);
  } else if (input.type === "radio" && path === "/bore/shape") {
    update(setBoreShape(state, input.value), { rebuildForm: true });
    focusField(path);
  } else if (input.type === "radio" && path) {
    update(setValue(state, path, input.value), { rebuildForm: true });
    focusField(path);
  }
});

el.form.addEventListener("focusin", (event) => {
  const path = event.target.dataset?.path;
  if (!path || path === view.focus) return;
  view.focus = path;
  writeHash();
  renderDrawings();
});

// arrow keys step numeric fields: 1 for integers, 0.1 otherwise, Shift ×10
el.form.addEventListener("keydown", (event) => {
  const input = event.target;
  if (input.type !== "text" || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
  const field = FIELD_BY_PATH.get(input.dataset.path);
  const current = parseNumber(input.value);
  if (Number.isNaN(current)) return;
  event.preventDefault();
  const step = (fieldSchema(schema, field, state.description).integer ? 1 : 0.1) * (event.shiftKey ? 10 : 1);
  const next = Number((current + (event.key === "ArrowUp" ? step : -step)).toFixed(6));
  input.value = inputText(next);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});

el.form.addEventListener("click", (event) => {
  const created = event.target.closest("[data-new]");
  const preset = event.target.closest("[data-preset]");
  if (!created && !preset) return;
  const chosen = created ? null : presets[Number(preset.dataset.preset)];
  const description = created ? defaultDescription(schema, created.dataset.new) : chosen.description;
  const loaded = loadDescription(state, description);
  update(view.keepShaft ? keepShaft(loaded, state) : loaded);
  openGroup("rim");
  showNotice(created ? T.notices.newPart(kindOf(description).title, view.keepShaft) : T.notices.presetLoaded(chosen.title, view.keepShaft));
});

// a tip shows while its button is hovered or focused, a click keeps it open until a click elsewhere
function closeTips(except = null) {
  for (const button of document.querySelectorAll('.tip-toggle[aria-expanded="true"]')) {
    if (button !== except) button.setAttribute("aria-expanded", "false");
  }
}
document.addEventListener("click", (event) => {
  const button = event.target.closest(".tip-toggle");
  closeTips(button);
  if (button) button.setAttribute("aria-expanded", String(button.getAttribute("aria-expanded") !== "true"));
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeTips();
});

el.status.addEventListener("click", (event) => {
  const link = event.target.closest("[data-goto]");
  if (link) focusField(link.dataset.goto);
});

// drawings: a dimension focuses its field, a part opens its group
for (const container of [el.plan, el.section, el.chord, el.tooth, el.helix, el.cone]) {
  container.addEventListener("click", (event) => pickFromDrawing(event.target));
  container.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pickFromDrawing(event.target);
    }
  });
}

// a hand-edited or bookmarked address opens its group and field
addEventListener("hashchange", () => {
  const next = { group: view.group, focus: null, ...readHash() };
  openGroup(next.group, next.focus);
  if (next.focus) focusField(next.focus);
});

function pickFromDrawing(target) {
  const dimension = target.closest?.("[data-path]");
  if (dimension && FIELD_BY_PATH.has(dimension.dataset.path)) {
    focusField(dimension.dataset.path);
    return;
  }
  const part = target.closest?.("[data-group]");
  if (part && part.dataset.group !== view.group) openGroup(part.dataset.group);
}

// ------------------------------------------------------------- file I/O

$("#save").addEventListener("click", () => {
  if (!result.normalized) {
    showNotice(T.notices.fixFormatFirst, "error");
    return;
  }
  const blob = new Blob([`${JSON.stringify({ generator: GENERATOR, ...result.normalized }, null, 2)}\n`], { type: "application/json" });
  download(blob, `${partFileName(result.normalized)}.json`);
  showNotice(T.notices.saved(result.ok));
});

// only the mesh built from exactly the current parameters is exported
el.stl.addEventListener("click", () => {
  const blocker = stlBlocker();
  if (blocker) {
    showNotice(T.notices.stlNotDownloaded(blocker), "error");
    return;
  }
  const exported = exportBinaryStl(build.reply.mesh, { placement: "onBed" });
  download(new Blob([exported.data], { type: "model/stl" }), `${partFileName(validation.normalized)}.stl`);
  showNotice(T.notices.stlDownloaded);
});

$("#view-reset").addEventListener("click", () => viewer?.resetView());

el.retry.addEventListener("click", () => {
  build = { key: null, reply: null };
  scheduleBuild();
  renderPreview();
});

function partFileName({ kind, rim }) {
  const number = (value) => String(value).replace(".", "_");
  if (kind === "idlerPulley") return `idler-${number(rim.outerDiameter)}mm`;
  const hand = rim.helixAngle > 0 ? "-right" : rim.helixAngle < 0 ? "-left" : "";
  const teeth = { none: "", helical: hand, herringbone: `-herringbone${hand}` }[rim.helix];
  if (kind === "bevelGear") return `bevel-m${number(rim.module)}-${rim.toothCount}x${rim.mateToothCount}t${rim.shaftAngle === 90 ? "" : `-${number(rim.shaftAngle)}deg`}`;
  return kind === "gear" ? `gear-m${number(rim.module)}-${rim.toothCount}t${teeth}` : `pulley-${rim.toothCount}t`;
}

function download(blob, name) {
  const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  link.click();
  // revoke later: some browsers read the blob after click() returns
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

$("#open").addEventListener("click", () => el.file.click());
el.file.addEventListener("change", async () => {
  const file = el.file.files[0];
  el.file.value = "";
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    showNotice(T.notices.fileTooBig(file.name, Math.round(file.size / 1024)), "error");
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    showNotice(T.notices.notJson(file.name), "error");
    return;
  }
  const checked = validateDescription(parsed);
  if (!checked.normalized) {
    const first = checked.diagnostics.find((item) => item.severity === "error");
    showNotice(T.notices.unfit(file.name, first.paths[0], diagnosticText(first)), "error");
    return;
  }
  update(loadDescription(state, checked.normalized));
  openGroup("rim");
  showNotice(T.notices.opened(file.name));
});

// the other language opens on the same section and field
$("#lang").addEventListener("click", (event) => {
  event.currentTarget.href = `${event.currentTarget.getAttribute("href").split("#")[0]}${location.hash}`;
});

$("#reset").addEventListener("click", () => {
  if (!confirm(T.notices.confirmReset)) return;
  update(createState(schema, state.description.kind));
  openGroup("rim");
});

function showNotice(text, kind = "info") {
  el.notice.textContent = text;
  el.notice.className = `notice notice-${kind}`;
  el.notice.hidden = false;
  clearTimeout(showNotice.timer);
  showNotice.timer = setTimeout(() => { el.notice.hidden = true; }, 6000);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}
