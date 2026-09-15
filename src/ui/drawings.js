// SVG drawings that explain the form fields.
//
// Geometry comes from the core (buildPlanView, derived sizes, anchors); this module
// only places it on paper and adds dimension lines. Model coordinates are
// millimetres with +Y (plan) or +Z (section) up; P() flips them into SVG space.
//
// Every dimension is a <g class="dim" data-path="/json/pointer">: the app shows the
// dimensions of the current group, highlights the focused one and focuses the field
// when a dimension is clicked. Parts carry data-group, so clicking a part opens its
// group; regions that explain a switch (flange, web type) also carry data-path.

import { circleSegmentCount } from "../core/contours.js";
import { FIELD_BY_PATH, fieldLabel } from "./fields.js";
import { escapeHtml, formatNumber, splitSymbol } from "./format.js";

const f = (value) => String(Math.round(value * 1000) / 1000);
const P = ([x, y]) => `${f(x)},${f(-y)}`;
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const length = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => mul(a, 1 / (length(a) || 1));
const perp = ([x, y]) => [-y, x];
const polar = (radius, angle) => [radius * Math.sin(angle), radius * Math.cos(angle)]; // clockwise from +Y

function polygonPath(points) {
  return `M${points.map(P).join("L")}Z`;
}

function circlePath(radius, [cx, cy] = [0, 0]) {
  const r = f(radius);
  return `M${f(cx + radius)},${f(-cy)}A${r},${r} 0 1 0 ${f(cx - radius)},${f(-cy)}A${r},${r} 0 1 0 ${f(cx + radius)},${f(-cy)}Z`;
}

function rectPath(x0, y0, x1, y1) {
  return polygonPath([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
}

function svgRoot(box, u, content, title, defs = "") {
  const [x, y, width, height] = box;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(x)} ${f(y)} ${f(width)} ${f(height)}" font-size="${f(u)}" role="img" aria-label="${escapeHtml(title)}">` +
    `${defs ? `<defs>${defs}</defs>` : ""}${content}</svg>`;
}

/** Section hatching; the id is unique on the page, which holds several drawings. */
function hatchPattern(id, u) {
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${f(u * 0.45)}" height="${f(u * 0.45)}" patternTransform="rotate(45)">` +
    `<line x1="0" y1="0" x2="0" y2="${f(u * 0.45)}" class="hatch-line"/></pattern>`;
}

/** Label "T_r = 2" as SVG text with an italic symbol and a real subscript. */
function labelMarkup(path, value, [x, y], anchor = "start") {
  const { base, sub: index } = splitSymbol(FIELD_BY_PATH.get(path).symbol);
  const shown = typeof value === "number" ? formatNumber(value) : String(value);
  const subscript = index ? `<tspan class="sub" dy="0.3em" font-size="0.72em">${escapeHtml(index)}</tspan><tspan dy="-0.3em">` : "<tspan>";
  return `<text class="dim-label" x="${f(x)}" y="${f(-y)}" text-anchor="${anchor}" dominant-baseline="middle">` +
    `<tspan class="sym">${escapeHtml(base)}</tspan>${subscript} = ${escapeHtml(shown)}</tspan></text>`;
}

function arrowhead(tip, direction, size) {
  const base = sub(tip, mul(direction, size));
  const wing = mul(perp(direction), size * 0.3);
  return `<path class="dim-arrow" d="${polygonPath([tip, add(base, wing), sub(base, wing)])}"/>`;
}

function dimClass(ctx, path) {
  return ["dim", ctx.focus === path && "is-focus", ctx.errors.has(path) && "is-error", ctx.advice.has(path) && "is-advice"].filter(Boolean).join(" ");
}

function wrap(ctx, path, value, inner) {
  if (!ctx.visible.has(path)) return "";
  const field = FIELD_BY_PATH.get(path);
  const name = `${fieldLabel(field, ctx.description)}: ${typeof value === "number" ? formatNumber(value) : value}${field.unit ? ` ${field.unit}` : ""}`;
  return `<g class="${dimClass(ctx, path)}" data-path="${path}" tabindex="0" role="button" aria-label="${escapeHtml(name)}">${inner}</g>`;
}

/**
 * Dimension line between a and b with arrowheads touching both ends. Short
 * dimensions get arrows from outside. ext are extension lines, leader joins the
 * dimension to a label placed away from it.
 */
function dimension(ctx, path, { a, b, value, label, anchor = "start", ext = [], leader = null, extra = "", u }) {
  const arrow = u * 0.55;
  const span = length(sub(b, a));
  const parts = [extra, ...ext.map(([p, q]) => `<path class="dim-ext" d="M${P(p)}L${P(q)}"/>`)];
  if (span > 1e-9) {
    const d = unit(sub(b, a));
    const inside = span > 2.6 * arrow;
    const from = inside ? a : sub(a, mul(d, 1.6 * arrow));
    const to = inside ? b : add(b, mul(d, 1.6 * arrow));
    parts.push(`<path class="dim-line" d="M${P(from)}L${P(to)}"/>`);
    parts.push(inside ? arrowhead(a, mul(d, -1), arrow) + arrowhead(b, d, arrow) : arrowhead(a, d, arrow) + arrowhead(b, mul(d, -1), arrow));
    parts.push(`<path class="dim-hit" d="M${P(from)}L${P(to)}"/>`);
  }
  if (leader) parts.push(`<path class="dim-ext" d="M${P(leader[0])}L${P(leader[1])}"/>`);
  parts.push(labelMarkup(path, value, label, anchor));
  return wrap(ctx, path, value, parts.join(""));
}

function partClass(ctx, group, path) {
  return ["part", `part-${group}`, ctx.group === group && "is-active", path && ctx.focus === path && "is-focus"].filter(Boolean).join(" ");
}

function part(ctx, group, d, { path = null, extra = "" } = {}) {
  return `<path class="${partClass(ctx, group, path)} ${extra}" data-group="${group}"${path ? ` data-path="${path}"` : ""} d="${d}" fill-rule="evenodd"/>`;
}

// ---------------------------------------------------------------- plan view

/** Cross-section perpendicular to the axis at the web, looking down (+Z towards the viewer). */
export function renderPlan(model, ctx) {
  const { plan, normalized } = model;
  const r = plan.radii;
  const flangeRadius = Math.max(plan.flangeRadii.lower ?? 0, plan.flangeRadii.upper ?? 0);
  const outer = Math.max(r.outside, flangeRadius);
  const extent = outer * 1.45 + 1;
  const u = extent / 16;
  const out = [];

  for (const side of ["lower", "upper"]) {
    const radius = plan.flangeRadii[side];
    if (radius) out.push(part(ctx, "flanges", circlePath(radius), { path: `/flanges/${side}`, extra: "part-beyond" }));
  }
  const rimInner = Math.max(r.rimInner, 0);
  out.push(part(ctx, "rim", polygonPath(plan.profile) + (rimInner > 0 ? circlePath(rimInner) : "")));
  if (plan.spokes) {
    const outlines = plan.spokes.outlines.map(polygonPath).join("");
    if (outlines) out.push(part(ctx, "web", outlines, { path: "/web/type", extra: plan.spokes.schematic ? "part-schematic" : "" }));
  } else if (rimInner > r.hub) {
    out.push(part(ctx, "web", circlePath(rimInner) + circlePath(r.hub), { path: "/web/type" }));
  }
  if (r.hub > r.bore) out.push(part(ctx, "hub", circlePath(r.hub) + circlePath(r.bore)));
  out.push(`<path class="centre-line" d="M${P([-outer - u, 0])}L${P([outer + u, 0])}M${P([0, -outer - u])}L${P([0, outer + u])}"/>`);
  out.push(`<path class="pitch-line" d="${circlePath(r.pitch)}"/>`);

  const { rim, web, hub } = normalized;
  const labelRadius = outer + 0.9 * u;

  // N: a dot on every groove, the label above the pulley
  const dots = Array.from({ length: rim.toothCount }, (_, k) => polar(outer + 0.5 * u, 2 * Math.PI * k / rim.toothCount));
  out.push(wrap(ctx, "/rim/toothCount", rim.toothCount,
    dots.map((point) => `<path class="dim-dot" d="${circlePath(0.13 * u, point)}"/>`).join("") +
    labelMarkup("/rim/toothCount", rim.toothCount, [0, outer + 1.4 * u], "middle")));

  // T_r along the groove closest to the lower right
  const grooveIndex = Math.round(rim.toothCount * 3 / 8);
  const rimDirection = polar(1, 2 * Math.PI * grooveIndex / rim.toothCount);
  out.push(dimension(ctx, "/rim/radialThickness", {
    u, a: mul(rimDirection, rimInner), b: mul(rimDirection, r.grooveRoot), value: rim.radialThickness,
    leader: [mul(rimDirection, r.grooveRoot + 1.2 * u), mul(rimDirection, labelRadius)],
    label: add(mul(rimDirection, labelRadius), [0.3 * u, 0]), anchor: "start"
  }));

  // bore and hub diameters on the left diagonals, labels led outside
  for (const [path, radius, angle, value] of [
    ["/hub/boreDiameter", r.bore, 5 * Math.PI / 4, hub.boreDiameter],
    ["/hub/outerDiameter", r.hub, 7 * Math.PI / 4, hub.outerDiameter]
  ]) {
    const direction = polar(1, angle);
    out.push(dimension(ctx, path, {
      u, a: mul(direction, -radius), b: mul(direction, radius), value,
      leader: [mul(direction, radius), mul(direction, labelRadius)],
      label: add(mul(direction, labelRadius), [-0.3 * u, 0]), anchor: "end"
    }));
  }

  if (plan.spokes && web.type === "spokes") out.push(...spokeDimensions(ctx, plan, web, u, outer));
  return svgRoot([-extent, -extent, 2 * extent, 2 * extent], u, out.join(""), "Поперечный разрез по полотну");
}

function spokeDimensions(ctx, plan, web, u, outer) {
  const r = plan.radii;
  const out = [];
  const middle = (r.hub + Math.max(r.rimInner, r.hub)) / 2;

  // N_s: numbered spokes near the rim
  const numberRadius = r.hub + 0.72 * (Math.max(r.rimInner, r.hub) - r.hub);
  const numbers = Array.from({ length: web.count }, (_, k) => {
    const point = polar(numberRadius, 2 * Math.PI * k / web.count);
    return `<path class="dim-badge" d="${circlePath(0.55 * u, point)}"/>` +
      `<text class="dim-number" x="${f(point[0])}" y="${f(-point[1])}" text-anchor="middle" dominant-baseline="central" font-size="${f(0.75 * u)}">${k + 1}</text>`;
  }).join("");
  // the label goes below the pulley, where no other web dimension is drawn
  out.push(wrap(ctx, "/web/count", web.count, numbers + labelMarkup("/web/count", web.count, [0, -(outer + 1.4 * u)], "middle")));

  // B_s across the top spoke at mid-span, the label outside at the upper left
  const widthLabel = polar(outer + 0.9 * u, -Math.PI / 7);
  out.push(dimension(ctx, "/web/width", {
    u, a: [-web.width / 2, middle], b: [web.width / 2, middle], value: web.width,
    label: add(widthLabel, [-0.3 * u, 0]), anchor: "end",
    leader: [[-web.width / 2 - (web.width > 1.43 * u ? 0 : 0.9 * u), middle], widthLabel]
  }));

  // R_f: radius lines of the two leading fillets of the top spoke
  const marks = plan.spokes.fillets[0] ?? [];
  const rimMark = marks.find((mark) => mark.kind === "rim" && mark.side === "leading");
  const hubMark = marks.find((mark) => mark.kind === "hub" && mark.side === "leading");
  if (rimMark && hubMark) {
    const radiusLine = ({ center, mid }) =>
      `<path class="dim-line" d="M${P(center)}L${P(mid)}"/>${arrowhead(mid, unit(sub(mid, center)), 0.5 * u)}` +
      `<path class="dim-dot" d="${circlePath(0.1 * u, center)}"/><path class="dim-hit" d="M${P(center)}L${P(mid)}"/>`;
    // the label sits outside the pulley at the upper right, led from the rim fillet
    const labelAt = polar(outer + 0.9 * u, Math.PI / 7);
    const leader = `<path class="dim-ext" d="M${P(rimMark.mid)}L${P(labelAt)}"/>`;
    out.push(wrap(ctx, "/web/filletRadius", web.filletRadius,
      radiusLine(rimMark) + radiusLine(hubMark) + leader + labelMarkup("/web/filletRadius", web.filletRadius, add(labelAt, [0.3 * u, 0]), "start")));
  }
  return out;
}

// ------------------------------------------------------------- section view

/** Axial section through the axis (XZ plane), both halves; spokes are cut along a spoke. */
export function renderSection(model, ctx) {
  const { normalized, derived, anchors } = model;
  const r = anchors.radii;
  const z = anchors.zLevels;
  const flangeRadius = { lower: derived.lowerFlangeOuterRadius, upper: derived.upperFlangeOuterRadius };
  const outer = Math.max(r.outside, flangeRadius.lower ?? 0, flangeRadius.upper ?? 0);
  const bottom = Math.min(z.lowerHub, z.lowerFlange ?? z.rimLower);
  const top = Math.max(z.upperHub, z.upperFlange ?? z.rimUpper);
  const u = Math.max(2 * outer, 1.4 * (top - bottom)) / 19;
  const rimInner = Math.max(r.rimInner, 0);
  const spokes = normalized.web.type === "spokes";

  const rects = { rim: [], teeth: [], flanges: { lower: [], upper: [] }, web: [], hub: [] };
  for (const side of [1, -1]) {
    const box = (x0, z0, x1, z1) => rectPath(side * x0, z0, side * x1, z1);
    rects.teeth.push(box(r.grooveRoot, z.rimLower, r.outside, z.rimUpper));
    rects.rim.push(box(rimInner, z.rimLower, r.grooveRoot, z.rimUpper));
    if (z.lowerFlange !== null) rects.flanges.lower.push(box(rimInner, z.lowerFlange, flangeRadius.lower, z.rimLower));
    if (z.upperFlange !== null) rects.flanges.upper.push(box(rimInner, z.rimUpper, flangeRadius.upper, z.upperFlange));
    if (rimInner > r.hub) rects.web.push(box(r.hub, z.webLower, rimInner, z.webUpper));
    if (r.hub > r.bore) rects.hub.push(box(r.bore, z.lowerHub, r.hub, z.upperHub));
  }

  const out = [];
  out.push(part(ctx, "rim", rects.teeth.join(""), { extra: "part-teeth" }));
  out.push(part(ctx, "rim", rects.rim.join("")));
  for (const side of ["lower", "upper"]) {
    if (rects.flanges[side].length) out.push(part(ctx, "flanges", rects.flanges[side].join(""), { path: `/flanges/${side}` }));
  }
  if (rects.web.length) out.push(part(ctx, "web", rects.web.join(""), { path: "/web/type", extra: spokes ? "part-schematic" : "" }));
  out.push(part(ctx, "hub", rects.hub.join("")));
  const cut = [...rects.rim, ...rects.flanges.lower, ...rects.flanges.upper, ...rects.hub, ...(spokes ? [] : rects.web)];
  out.push(`<path class="hatch" fill="url(#section-hatch)" d="${cut.join("")}"/>`);

  out.push(`<path class="centre-line" d="M${P([0, bottom - u])}L${P([0, top + u])}"/>`);
  out.push(`<path class="centre-line" d="M${P([-outer - 0.6 * u, 0])}L${P([outer + 0.6 * u, 0])}"/>`);

  const { rim, flanges, web, hub } = normalized;

  // right column: lower flange, toothed width, upper flange as a chain
  const column = outer + 1.5 * u;
  const chain = [
    ["/flanges/lower/axialThickness", z.lowerFlange, z.rimLower, flanges.lower?.axialThickness, flangeRadius.lower, r.outside],
    ["/rim/toothedWidth", z.rimLower, z.rimUpper, rim.toothedWidth, r.outside, r.outside],
    ["/flanges/upper/axialThickness", z.rimUpper, z.upperFlange, flanges.upper?.axialThickness, r.outside, flangeRadius.upper]
  ];
  for (const [path, z0, z1, value, x0, x1] of chain) {
    if (z0 === null || z1 === null) continue;
    out.push(dimension(ctx, path, {
      u, a: [column, z0], b: [column, z1], value,
      ext: [[[x0 + 0.3 * u, z0], [column + 0.4 * u, z0]], [[x1 + 0.3 * u, z1], [column + 0.4 * u, z1]]],
      label: [column + 0.7 * u, (z0 + z1) / 2], anchor: "start"
    }));
  }

  // flange projection beyond the tooth tips, above / below the flange
  for (const [side, face, direction] of [["upper", z.upperFlange, 1], ["lower", z.lowerFlange, -1]]) {
    if (face === null) continue;
    const level = face + direction * 1.3 * u;
    out.push(dimension(ctx, `/flanges/${side}/radialExtension`, {
      u, a: [r.outside, level], b: [flangeRadius[side], level], value: flanges[side].radialExtension,
      ext: [[[r.outside, face], [r.outside, level + direction * 0.4 * u]], [[flangeRadius[side], face + direction * 0.3 * u], [flangeRadius[side], level + direction * 0.4 * u]]],
      label: [(r.outside + flangeRadius[side]) / 2, level + direction * 0.95 * u], anchor: "middle"
    }));
  }

  // bore and hub diameters above the part, values centred over their lines
  for (const [path, radius, row, value] of [["/hub/boreDiameter", r.bore, 1.4, hub.boreDiameter], ["/hub/outerDiameter", r.hub, 2.9, hub.outerDiameter]]) {
    const level = top + row * u;
    out.push(dimension(ctx, path, {
      u, a: [-radius, level], b: [radius, level], value,
      ext: [[[-radius, z.upperHub + 0.3 * u], [-radius, level + 0.4 * u]], [[radius, z.upperHub + 0.3 * u], [radius, level + 0.4 * u]]],
      label: [0, level + 0.65 * u], anchor: "middle"
    }));
  }

  // hub extensions: left column, measured from the toothed rim faces
  const left = -outer - 1.5 * u;
  for (const [path, z0, z1, value] of [["/hub/lowerExtension", z.lowerHub, z.rimLower, hub.lowerExtension], ["/hub/upperExtension", z.rimUpper, z.upperHub, hub.upperExtension]]) {
    out.push(dimension(ctx, path, {
      u, a: [left, z0], b: [left, z1], value,
      ext: [[[-r.hub - 0.3 * u, z0], [left - 0.4 * u, z0]], [[-r.hub - 0.3 * u, z1], [left - 0.4 * u, z1]]],
      label: [left - 0.7 * u, value > 0 ? (z0 + z1) / 2 : z0 + Math.sign(z0 || 1) * 0.8 * u], anchor: "end"
    }));
  }

  // web thickness and offset inside the span between hub and rim, left half;
  // labels are led out past the rim, into the column the hub dimensions use
  const span = Math.max(rimInner - r.hub, 0);
  const thicknessX = -(r.hub + 0.68 * span);
  const offsetX = -(r.hub + 0.3 * span);
  const labelX = -(outer + 0.8 * u);
  const thicknessY = z.webUpper + u;
  const offsetY = Math.min(bottom - 0.6 * u, thicknessY - 1.8 * u);
  out.push(dimension(ctx, "/web/axialThickness", {
    u, a: [thicknessX, z.webLower], b: [thicknessX, z.webUpper], value: web.axialThickness,
    label: [labelX - 0.2 * u, thicknessY], anchor: "end",
    leader: [[thicknessX, z.webUpper], [labelX, thicknessY]]
  }));
  // the web mid-plane, dashed, so the offset from z = 0 has something to point at
  const webMiddle = (z.webLower + z.webUpper) / 2;
  out.push(dimension(ctx, "/web/axialOffset", {
    u, a: [offsetX, 0], b: [offsetX, webMiddle], value: web.axialOffset,
    extra: `<path class="mid-plane" d="M${P([-rimInner, webMiddle])}L${P([-r.hub, webMiddle])}"/>`,
    leader: [[offsetX, webMiddle / 2], [labelX, offsetY]],
    label: [labelX - 0.2 * u, offsetY], anchor: "end"
  }));

  const width = 2 * outer + 6.5 * u + 7 * u;
  const box = [-outer - 7 * u, -(top + 4.2 * u), width, top - bottom + 7.6 * u];
  return svgRoot(box, u, out.join(""), "Осевой разрез", hatchPattern("section-hatch", u));
}

// --------------------------------------------------------------- chord view

/** Schematic of the chord tolerance: an arc, one chord and its sagitta, exaggerated. */
export function renderChord(model, ctx) {
  const epsilon = model.normalized.generation.maxChordError;
  const radius = 10;
  const half = 0.9; // half chord angle, radians; the sagitta is drawn far larger than real
  const u = 0.7;
  const a = polar(radius, -half);
  const b = polar(radius, half);
  const sagittaTop = [0, radius];
  const chordMiddle = [0, radius * Math.cos(half)];
  const arc = `M${P(a)}A${f(radius)},${f(radius)} 0 0 1 ${P(b)}`;
  const arcNote = polar(radius + 0.4, 0.62);
  const out = [
    `<path class="chord-arc" d="${arc}"/>`,
    `<path class="chord-line" d="M${P(a)}L${P(b)}"/>`,
    `<path class="dim-dot" d="${circlePath(0.18, a)}${circlePath(0.18, b)}"/>`,
    dimension(ctx, "/generation/maxChordError", {
      u, a: chordMiddle, b: sagittaTop, value: epsilon,
      label: [0.6 * u, (chordMiddle[1] + sagittaTop[1]) / 2], anchor: "start"
    }),
    `<text class="note" x="${f(0)}" y="${f(-(chordMiddle[1] - 1.1))}" text-anchor="middle">хорда сетки</text>`,
    `<text class="note" x="${f(arcNote[0])}" y="${f(-arcNote[1])}" text-anchor="start">точная окружность</text>`
  ];
  return svgRoot([-12, -(radius + 1.4), 24, 7], u, out.join(""), "Схема допуска хорды");
}

/** Segment counts the mesh will use for characteristic circles at the current tolerance. */
export function chordSummary(model) {
  const epsilon = model.normalized.generation.maxChordError;
  const r = model.anchors.radii;
  const flange = Math.max(model.derived.lowerFlangeOuterRadius ?? 0, model.derived.upperFlangeOuterRadius ?? 0);
  return [
    ["отверстие", r.bore],
    ["втулка", r.hub],
    flange > 0 ? ["фланец", flange] : null
  ].filter(Boolean).filter(([, radius]) => radius > 0)
    .map(([name, radius]) => ({ name, diameter: 2 * radius, segments: circleSegmentCount(radius, epsilon) }));
}
