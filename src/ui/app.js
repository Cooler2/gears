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
import { BuildClient } from "../worker/client.js";
import { chordSummary, renderChord, renderPlan, renderSection, renderTooth } from "./drawings.js";
import { FIELD_BY_PATH, GROUPS, KINDS, fieldHint, fieldLabel, fieldSchema, fieldsOf, groupOfPath, groupsOf, groupTitle, kindOf } from "./fields.js";
import { escapeHtml, formatNumber, inputText, plural, symbolHtml } from "./format.js";
import { diagnosticKind, diagnosticText } from "./messages.js";
import { PRESETS } from "./presets.js";
import { createState, defaultDescription, getValue, keepShaft, loadDescription, parseNumber, restoreState as upgradeState, setBoreShape, setFlange, setValue, setWebType } from "./state.js";
import { MeshViewer } from "./viewer.js";

const STORAGE_KEY = "gears.pulley.form.v1";
const SECTION_FIRST = new Set(["flanges", "hub"]);
const MAX_FILE_BYTES = 1 << 20; // a description is well under a kilobyte
const BUILD_TIMEOUT_MS = 20000;
const CONTEXT_VIEW_SCALE = 0.6; // labels of a view with no sizes of its own, relative to the main one
const PREVIEW_TAGS = { fresh: "по текущим параметрам", building: "строится…", invalid: "устарела", failed: "не построена", crashed: "сбой" };
const $ = (selector) => document.querySelector(selector);
const el = {
  nav: $("#groups"), title: $("#group-title"), form: $("#form"), status: $("#status"), drawings: $("#drawings"),
  plan: $("#plan"), section: $("#section"), sectionTag: $("#section-tag"), planTag: $("#plan-tag"),
  chordFigure: $("#chord-figure"), chord: $("#chord"), planFigure: $("#plan-figure"), sectionFigure: $("#section-figure"),
  toothFigure: $("#tooth-figure"), tooth: $("#tooth"),
  stale: $("#stale"), file: $("#file-input"), notice: $("#notice"),
  viewport: $("#viewport"), canvas: $("#viewer"), previewState: $("#preview-state"), overlay: $("#preview-overlay"),
  previewInfo: $("#preview-info"), retry: $("#retry"), stl: $("#download-stl"),
  partTitle: $("#part-title"), profileBadge: $("#profile-badge")
};

let schema, presets;
try {
  schema = await fetchJson("../../schemas/pulley-v4.schema.json");
  presets = await Promise.all(PRESETS.map(async (preset) => ({ ...preset, description: await fetchJson(`../../examples/valid/${preset.file}`) })));
} catch (error) {
  $("#boot").className = "notice notice-error";
  $("#boot").textContent = `Не удалось загрузить схему или примеры (${error.message}). Страница должна раздаваться из корня проекта: npm run ui.`;
  throw error;
}
$("#boot").hidden = true;

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
  document.title = `${kind.title} — генератор`;
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
    const badge = count?.error ? `<span class="badge badge-error" aria-label="ошибок: ${count.error}">${count.error}</span>`
      : count?.other ? `<span class="badge badge-advice" aria-label="рекомендаций: ${count.other}">!</span>` : "";
    return `<button type="button" data-group="${id}"${id === view.group ? ' aria-current="page"' : ""}>${escapeHtml(title)}${badge}</button>`;
  }).join("");
}

function renderForm() {
  const group = GROUPS.find(({ id }) => id === view.group);
  el.title.textContent = groupTitle(group, state.description);
  if (view.group === "presets") {
    el.form.innerHTML = presetCards();
    return;
  }
  const description = state.description;
  el.form.innerHTML = fieldsOf(view.group, description).map((field) => {
    if (field.kind === "toggle") return toggleMarkup(field, description);
    if (field.kind === "choice") return choiceMarkup(field, description);
    return numberMarkup(field, description);
  }).join("") + '<div id="computed"></div>';
  renderComputed();
}

/** The computed sizes follow every change; the fields above them are not rebuilt while typing. */
function renderComputed() {
  const slot = el.form.querySelector("#computed");
  if (slot) slot.innerHTML = computedMarkup();
}

function fieldId(path) {
  return `f${path.replaceAll("/", "-")}`;
}

function numberMarkup(field, description) {
  const id = fieldId(field.path);
  const limits = fieldSchema(schema, field, description);
  const unit = field.unit ? ` ${field.unit}` : "";
  const range = `${formatNumber(limits.minimum)}…${formatNumber(limits.maximum)}${unit}`;
  return `<div class="field" data-field="${field.path}">
    <label for="${id}"><span class="field-label">${escapeHtml(fieldLabel(field, description))}</span> <span class="field-symbol">${symbolHtml(field.symbol)}</span></label>
    <div class="input-row">
      <input id="${id}" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" data-path="${field.path}"
        value="${escapeHtml(inputText(getValue(description, field.path)))}" aria-describedby="${id}-hint ${id}-msg">
      ${field.unit ? `<span class="unit">${field.unit}</span>` : ""}
    </div>
    <p class="field-hint" id="${id}-hint">${escapeHtml(fieldHint(field, description))} <span class="range">Допустимо ${range}, по умолчанию ${formatNumber(limits.default)}${unit}.</span></p>
    <div class="field-msg" id="${id}-msg" aria-live="polite"></div>
  </div>`;
}

function toggleMarkup(field, description) {
  const id = fieldId(field.path);
  const checked = Boolean(getValue(description, field.path));
  return `<div class="field field-toggle" data-field="${field.path}">
    <label class="toggle" for="${id}"><input id="${id}" type="checkbox" data-path="${field.path}"${checked ? " checked" : ""} aria-describedby="${id}-hint">
      <span>${escapeHtml(fieldLabel(field, description))}</span></label>
    <p class="field-hint" id="${id}-hint">${escapeHtml(fieldHint(field, description))}</p>
    <div class="field-msg" aria-live="polite"></div>
  </div>`;
}

function choiceMarkup(field, description) {
  const value = getValue(description, field.path);
  const name = fieldId(field.path);
  return `<fieldset class="field field-choice" data-field="${field.path}">
    <legend>${escapeHtml(fieldLabel(field, description))}</legend>
    <div class="segmented">${field.options.map((option) => `<label><input type="radio" name="${name}" value="${option.value}" data-path="${field.path}"${option.value === value ? " checked" : ""}><span>${escapeHtml(option.label)}</span></label>`).join("")}</div>
    <p class="field-hint">${escapeHtml(fieldHint(field, description))}</p>
    <div class="field-msg" aria-live="polite"></div>
  </fieldset>`;
}

/** Sizes the core derived from the entered ones, shown apart from the inputs. */
function computedMarkup() {
  if (!model) return "";
  const { derived, anchors } = model;
  const previous = result.normalized ? "" : ' <span class="tag">для прежних параметров</span>';
  const rows = {
    rim: {
      idlerPulley: [["Внутренний диаметр обода", 2 * derived.rimInnerRadius]],
      spurGear: [["Делительный диаметр", 2 * derived.pitchRadius], ["Диаметр вершин", 2 * derived.outsideRadius], ["Диаметр впадин", 2 * derived.rootRadius],
        ["Основной диаметр", 2 * derived.baseRadius], ["Шаг по делительной окружности", derived.pitch], ["Внутренний диаметр венца", 2 * derived.rimInnerRadius]],
      timingPulley: [["Наружный диаметр по вершинам", 2 * derived.outsideRadius], ["Делительный диаметр", 2 * derived.pitchRadius], ["Диаметр по дну канавок", 2 * derived.grooveRootRadius], ["Внутренний диаметр венца", 2 * derived.rimInnerRadius]]
    }[model.normalized.kind],
    flanges: [["Диаметр нижнего фланца", derived.lowerFlangeOuterRadius && 2 * derived.lowerFlangeOuterRadius], ["Диаметр верхнего фланца", derived.upperFlangeOuterRadius && 2 * derived.upperFlangeOuterRadius], ["Полная высота детали", derived.bounds.max[2] - derived.bounds.min[2]]],
    web: [[model.normalized.web.type === "spokes" ? "Толщина спиц" : "Толщина полотна", derived.webThickness],
      [`Промежуток между втулкой и ${derived.pitchRadius === null ? "ободом" : "венцом"}`, anchors.radii.rimInner - anchors.radii.hub],
      ["Полотно по высоте, от", derived.webLowerZ], ["до", derived.webUpperZ]],
    hub: [["Стенка втулки в самом тонком месте", derived.hubRadius - derived.boreOuterRadius], ["Втулка по высоте, от", derived.hubLowerZ], ["до", derived.hubUpperZ]],
    bore: boreRows(model),
    generation: []
  }[view.group].filter(([, value]) => typeof value === "number");
  if (view.group === "generation") {
    return `<div class="computed"><h3>Отрезков на окружность${previous}</h3><dl>${chordSummary(model).map(({ name, diameter, segments }) =>
      `<div><dt>${escapeHtml(name)} ⌀${formatNumber(diameter)} мм</dt><dd>${segments}</dd></div>`).join("")}</dl></div>`;
  }
  if (!rows.length) return "";
  return `<div class="computed"><h3>Вычисленные размеры${previous}</h3><dl>${rows.map(([name, value]) =>
    `<div><dt>${escapeHtml(name)}</dt><dd>${formatNumber(value)} мм</dd></div>`).join("")}</dl></div>`;
}

function boreRows({ normalized: { bore }, derived }) {
  return [
    bore.shape === "polygon" && [bore.sides % 2 ? "Диаметр вписанной окружности" : "Диаметр вписанной окружности, между гранями", bore.diameter * Math.cos(Math.PI / bore.sides)],
    bore.shape === "keyed" && ["От стенки отверстия до дна паза, d + t", bore.diameter + bore.keyDepth],
    ["Стенка втулки в самом тонком месте", derived.hubRadius - derived.boreOuterRadius]
  ].filter(Boolean);
}

/** The variants page: start a new part of any kind; the sections above lead back to the current one. */
function presetCards() {
  const card = (attributes, className, description, title, text) => `<button type="button" class="preset ${className}" ${attributes}>
    <span class="preset-thumb" aria-hidden="true">${thumbnailOf(description)}</span>
    <span class="preset-title">${escapeHtml(title)}</span>
    <span class="preset-text">${escapeHtml(text)}</span></button>`;
  const sections = KINDS.map((kind) => `<h3 class="preset-kind">${escapeHtml(kind.title)}</h3>
    <p class="lead">${escapeHtml(kind.text)}</p>
    <div class="presets">${card(`data-new="${kind.id}"`, "preset-new", defaultDescription(schema, kind.id), "Новый", "Все размеры по умолчанию.")}${
      presets.map((preset, index) => preset.description.kind === kind.id
        ? card(`data-preset="${index}"`, "", preset.description, preset.title, preset.text) : "").join("")}</div>`).join("");
  return `<p class="lead">Начните с готового варианта: он заменит текущие параметры, дальше их можно менять в любом разделе. Чтобы продолжить с текущими, откройте любой раздел.</p>
    <label class="toggle keep-shaft"><input type="checkbox" id="keep-shaft"${view.keepShaft ? " checked" : ""}>
      <span>Оставить текущие втулку и отверстие — для детали на тот же вал</span></label>${sections}`;
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
        owners.map((owner) => `<p class="msg msg-ref">Связано с сообщением у поля «${escapeHtml(fieldLabel(FIELD_BY_PATH.get(owner), state.description))}».</p>`).join("");
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
    ? `<p class="status-line status-error">Деталь пока нельзя построить: ${errors.length === 1 ? "одна ошибка" : `ошибок — ${errors.length}`}.</p>`
    : `<p class="status-line status-ok">Размеры согласованы, деталь можно строить.</p>`;
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
    el.plan.innerHTML = el.section.innerHTML = el.tooth.innerHTML = "";
    el.toothFigure.hidden = true;
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
  el.planTag.textContent = view.group === "bore" ? "втулка крупно, в масштабе"
    : model.plan.spokes?.schematic ? "спицы схематично: скругления не помещаются" : "в масштабе";
  el.sectionTag.textContent = model.normalized.web.type === "spokes" ? "в масштабе, спицы — разрез по спице" : "в масштабе";
  // gear teeth get a larger view of their own sizes
  const teeth = view.group === "rim" && model.normalized.kind === "spurGear";
  el.toothFigure.hidden = !teeth;
  el.tooth.innerHTML = teeth ? renderTooth(model, ctx) : "";
  if (teeth) {
    cropToContent(el.tooth.querySelector("svg"));
    setLabelSpan(el.toothFigure, 1);
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
  const previous = shown ? " Показана модель для прежних параметров." : "";
  const cause = answer?.message === "timeout" ? `нет ответа за ${BUILD_TIMEOUT_MS / 1000} с` : answer?.message;
  const overlay = {
    fresh: "",
    building: shown ? "Строится модель для новых параметров…" : "Строится модель…",
    invalid: shown ? "Модель для прежних параметров: в текущих есть ошибки, они показаны у полей." : "Модели нет: исправьте ошибки в размерах.",
    failed: `Ядро не смогло построить сетку, причина — в сообщениях у полей.${previous}`,
    crashed: `Сбой фонового вычисления (${cause}).${previous} Если повтор не помогает, сохраните JSON: по нему сбой можно воспроизвести.`
  }[status];
  el.viewport.dataset.state = status;
  el.previewState.textContent = PREVIEW_TAGS[status];
  el.canvas.setAttribute("aria-label", `3D-модель шкива, ${PREVIEW_TAGS[status]}`);
  el.overlay.textContent = viewer ? overlay : `3D-просмотр недоступен: браузер не дал WebGL. ${status === "fresh" ? "Модель построена, STL можно скачать." : overlay}`;
  el.overlay.hidden = viewer ? !overlay : false;
  el.retry.hidden = status !== "crashed";
  viewer?.setStale(status !== "fresh" && status !== "building");

  if (status === "fresh") {
    const { bounds } = answer.mesh;
    const size = [0, 1, 2].map((axis) => formatNumber(bounds.max[axis] - bounds.min[axis])).join(" × ");
    const triangles = answer.verification.triangleCount;
    el.previewInfo.textContent = `${size} мм · ${triangles.toLocaleString("ru-RU")} ${plural(triangles, "треугольник", "треугольника", "треугольников")} · построено за ${Math.round(answer.elapsed)} мс`;
  } else {
    el.previewInfo.textContent = "";
  }
  const blocker = stlBlocker(status);
  el.stl.setAttribute("aria-disabled", String(Boolean(blocker)));
  el.stl.title = blocker || "Сетка по текущим параметрам, деталь стоит на столе нижней гранью";
}

/** Why STL cannot be downloaded right now; empty when it can. */
function stlBlocker(status = previewState()) {
  return {
    fresh: "",
    building: "Модель для текущих параметров ещё строится.",
    invalid: "В размерах есть ошибки. Прежняя модель не скачивается, чтобы не спутать её с текущей.",
    failed: "Модель по текущим параметрам не построилась, причина — в сообщениях у полей.",
    crashed: "Фоновое вычисление завершилось сбоем. Нажмите «Повторить построение»."
  }[status];
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
  const shaft = view.keepShaft ? ", втулка и отверстие прежние" : "";
  showNotice(created ? `Новая деталь «${kindOf(description).title}»: размеры по умолчанию${shaft}.` : `Загружен вариант «${chosen.title}»${shaft}.`);
});

el.status.addEventListener("click", (event) => {
  const link = event.target.closest("[data-goto]");
  if (link) focusField(link.dataset.goto);
});

// drawings: a dimension focuses its field, a part opens its group
for (const container of [el.plan, el.section, el.chord, el.tooth]) {
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
    showNotice("Сначала исправьте поля с ошибкой формата: сохраняется только описание, которое можно прочитать обратно.", "error");
    return;
  }
  const blob = new Blob([`${JSON.stringify(result.normalized, null, 2)}\n`], { type: "application/json" });
  download(blob, `${partFileName(result.normalized)}.json`);
  showNotice(result.ok ? "Описание сохранено." : "Описание сохранено, но в нём есть ошибки размеров.");
});

// only the mesh built from exactly the current parameters is exported
el.stl.addEventListener("click", () => {
  const blocker = stlBlocker();
  if (blocker) {
    showNotice(`STL не скачан. ${blocker}`, "error");
    return;
  }
  const exported = exportBinaryStl(build.reply.mesh, { placement: "onBed" });
  download(new Blob([exported.data], { type: "model/stl" }), `${partFileName(validation.normalized)}.stl`);
  showNotice("STL скачан. Деталь стоит на столе нижней гранью, координаты в миллиметрах.");
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
  return kind === "spurGear" ? `gear-m${number(rim.module)}-${rim.toothCount}t` : `pulley-${rim.toothCount}t`;
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
    showNotice(`«${file.name}» слишком большой для описания шкива (${Math.round(file.size / 1024)} КБ).`, "error");
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    showNotice(`«${file.name}» — не JSON.`, "error");
    return;
  }
  const checked = validateDescription(parsed);
  if (!checked.normalized) {
    const first = checked.diagnostics.find((item) => item.severity === "error");
    showNotice(`«${file.name}» не подходит: ${first.paths[0] || "корень"} — ${diagnosticText(first)}`, "error");
    return;
  }
  update(loadDescription(state, checked.normalized));
  openGroup("rim");
  showNotice(`Открыт «${file.name}».`);
});

$("#reset").addEventListener("click", () => {
  if (!confirm("Вернуть все параметры к значениям по умолчанию?")) return;
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
