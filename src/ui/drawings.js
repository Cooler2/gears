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

/**
 * Cross-section perpendicular to the axis at the web, looking down (+Z towards the viewer).
 * For the bore group it is a detail: only a circle around the hub, at a larger scale.
 */
export function renderPlan(model, ctx) {
  const { plan, normalized, derived } = model;
  const r = plan.radii;
  const flangeRadius = Math.max(plan.flangeRadii.lower ?? 0, plan.flangeRadii.upper ?? 0);
  const whole = Math.max(r.outside, flangeRadius);
  const hubSize = Math.max(r.hub, derived.boreOuterRadius);
  const detail = ctx.group === "bore" ? Math.min(whole, Math.max(1.35 * hubSize, hubSize + 1.5)) : null;
  const outer = detail ?? whole;
  const extent = detail ? outer * 1.5 : outer * 1.45 + 1;
  const u = extent / 16;
  const out = [];

  for (const side of ["lower", "upper"]) {
    const radius = plan.flangeRadii[side];
    if (radius) out.push(part(ctx, "flanges", circlePath(radius), { path: `/flanges/${side}`, extra: "part-beyond" }));
  }
  const rimInner = Math.max(r.rimInner, 0);
  const surface = plan.profile ? polygonPath(plan.profile) : circlePath(r.outside);
  out.push(part(ctx, "rim", surface + (rimInner > 0 ? circlePath(rimInner) : "")));
  if (plan.spokes) {
    const outlines = plan.spokes.outlines.map(polygonPath).join("");
    if (outlines) out.push(part(ctx, "web", outlines, { path: "/web/type", extra: plan.spokes.schematic ? "part-schematic" : "" }));
  } else if (rimInner > r.hub) {
    out.push(part(ctx, "web", circlePath(rimInner) + circlePath(r.hub), { path: "/web/type" }));
  }
  if (r.hub > r.bore) out.push(part(ctx, "hub", circlePath(r.hub) + polygonPath(plan.bore)));
  if (detail) {
    // parts are cut by the detail circle; getBBox ignores clipping, so the app measures the circle instead
    out.splice(0, out.length, `<g class="detail" clip-path="url(#plan-detail)">${out.join("")}</g>`, `<path class="detail-edge" d="${circlePath(detail)}"/>`);
  }
  out.push(`<path class="centre-line" d="M${P([-outer - u, 0])}L${P([outer + u, 0])}M${P([0, -outer - u])}L${P([0, outer + u])}"/>`);
  if (!detail && r.pitch) out.push(`<path class="pitch-line" d="${circlePath(r.pitch)}"/>`);

  const { rim, web, hub } = normalized;
  const labelRadius = outer + 0.9 * u;
  const toothed = Boolean(plan.profile);

  if (toothed) {
    // N: a dot on every groove, the label above the pulley
    const dots = Array.from({ length: rim.toothCount }, (_, k) => polar(outer + 0.5 * u, 2 * Math.PI * k / rim.toothCount));
    out.push(wrap(ctx, "/rim/toothCount", rim.toothCount,
      dots.map((point) => `<path class="dim-dot" d="${circlePath(0.13 * u, point)}"/>`).join("") +
      labelMarkup("/rim/toothCount", rim.toothCount, [0, outer + 1.4 * u], "middle")));
  } else {
    // D across the upper right diagonal, the label led outside
    const direction = polar(1, Math.PI / 4);
    out.push(dimension(ctx, "/rim/outerDiameter", {
      u, a: mul(direction, -r.outside), b: mul(direction, r.outside), value: rim.outerDiameter,
      leader: [mul(direction, r.outside), mul(direction, labelRadius)],
      label: add(mul(direction, labelRadius), [0.3 * u, 0]), anchor: "start"
    }));
  }

  // T_r to the lower right, along a groove of a toothed rim
  const rimAngle = toothed ? 2 * Math.PI * Math.round(rim.toothCount * 3 / 8) / rim.toothCount : 3 * Math.PI / 4;
  const rimDirection = polar(1, rimAngle);
  out.push(dimension(ctx, "/rim/radialThickness", {
    u, a: mul(rimDirection, rimInner), b: mul(rimDirection, r.root), value: rim.radialThickness,
    leader: [mul(rimDirection, r.root + 1.2 * u), mul(rimDirection, labelRadius)],
    label: add(mul(rimDirection, labelRadius), [0.3 * u, 0]), anchor: "start"
  }));

  // hub diameter on the upper left diagonal, the label led outside
  const hubDirection = polar(1, 7 * Math.PI / 4);
  out.push(dimension(ctx, "/hub/outerDiameter", {
    u, a: mul(hubDirection, -r.hub), b: mul(hubDirection, r.hub), value: hub.outerDiameter,
    leader: [mul(hubDirection, r.hub), mul(hubDirection, labelRadius)],
    label: add(mul(hubDirection, labelRadius), [-0.3 * u, 0]), anchor: "end"
  }));

  if (plan.spokes && web.type === "spokes") out.push(...spokeDimensions(ctx, plan, web, u, outer));
  if (detail) out.push(...boreDimensions(ctx, model, u, outer));
  const defs = detail ? `<clipPath id="plan-detail"><path d="${circlePath(detail)}"/></clipPath>` : "";
  return svgRoot([-extent, -extent, 2 * extent, 2 * extent], u, out.join(""), "Поперечный разрез по полотну", defs);
}

/** Bore sizes on the hub detail; the flat and the keyway face +X, so d is measured vertically. */
function boreDimensions(ctx, model, u, outer) {
  const { bore } = model.normalized;
  const radius = bore.diameter / 2;
  const labelRadius = outer + 0.9 * u;
  const out = [];

  // d: a polygon and a keyway hide part of the circle, so it is drawn dashed
  const top = [0, radius];
  const diameterLabel = polar(labelRadius, -Math.PI / 5);
  out.push(dimension(ctx, "/bore/diameter", {
    u, a: [0, -radius], b: top, value: bore.diameter,
    extra: ["polygon", "keyed"].includes(bore.shape) ? `<path class="bore-circle" d="${circlePath(radius)}"/>` : "",
    leader: [top, diameterLabel], label: add(diameterLabel, [-0.3 * u, 0]), anchor: "end"
  }));

  if (bore.shape === "polygon") {
    // n: a dot on every vertex, the label below the detail
    const corners = Array.from({ length: bore.sides }, (_, k) => polar(model.derived.boreOuterRadius, Math.PI / 2 + Math.PI * (2 * k + 1) / bore.sides));
    out.push(wrap(ctx, "/bore/sides", bore.sides,
      corners.map((point) => `<path class="dim-dot" d="${circlePath(0.13 * u, point)}"/>`).join("") +
      labelMarkup("/bore/sides", bore.sides, [0, -(outer + 1.4 * u)], "middle")));
  }

  if (bore.shape === "dFlat") {
    // s along the X axis, from the far side of the circle to the flat
    const sizeLabel = polar(labelRadius, 6 * Math.PI / 5);
    out.push(dimension(ctx, "/bore/flatDistance", {
      u, a: [-radius, 0], b: [bore.flatDistance - radius, 0], value: bore.flatDistance,
      leader: [[-radius, 0], sizeLabel], label: add(sizeLabel, [-0.3 * u, 0]), anchor: "end"
    }));
  }

  if (bore.shape === "keyed") {
    const half = bore.keyWidth / 2;
    const bottom = radius + bore.keyDepth;
    // b just past the bottom of the keyway, t along the keyway axis from the circle
    const widthX = bottom + 0.9 * u;
    const widthLabel = polar(labelRadius, 3 * Math.PI / 10);
    out.push(dimension(ctx, "/bore/keyWidth", {
      u, a: [widthX, -half], b: [widthX, half], value: bore.keyWidth,
      ext: [[[bottom + 0.2 * u, half], [widthX + 0.4 * u, half]], [[bottom + 0.2 * u, -half], [widthX + 0.4 * u, -half]]],
      leader: [[widthX, half], widthLabel], label: add(widthLabel, [0.3 * u, 0]), anchor: "start"
    }));
    const depthLabel = polar(labelRadius, 7 * Math.PI / 10);
    out.push(dimension(ctx, "/bore/keyDepth", {
      u, a: [radius, 0], b: [bottom, 0], value: bore.keyDepth,
      leader: [[(radius + bottom) / 2, 0], depthLabel], label: add(depthLabel, [0.3 * u, 0]), anchor: "start"
    }));
  }
  return out;
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
    if (r.root < r.outside) rects.teeth.push(box(r.root, z.rimLower, r.outside, z.rimUpper));
    rects.rim.push(box(rimInner, z.rimLower, r.root, z.rimUpper));
    if (z.lowerFlange !== null) rects.flanges.lower.push(box(rimInner, z.lowerFlange, flangeRadius.lower, z.rimLower));
    if (z.upperFlange !== null) rects.flanges.upper.push(box(rimInner, z.rimUpper, flangeRadius.upper, z.upperFlange));
    if (rimInner > r.hub) rects.web.push(box(r.hub, z.webLower, rimInner, z.webUpper));
    // the flat, the keyway and a polygon side face +X, so the bore edge differs between the halves
    const boreEdge = Math.max(side > 0 ? derived.boreExtentX.positive : derived.boreExtentX.negative, 0);
    if (r.hub > boreEdge) rects.hub.push(box(boreEdge, z.lowerHub, r.hub, z.upperHub));
  }

  const out = [];
  if (rects.teeth.length) out.push(part(ctx, "rim", rects.teeth.join(""), { extra: "part-teeth" }));
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

  const { rim, flanges, web, hub, bore } = normalized;

  // right column: lower flange, rim width, upper flange as a chain
  const column = outer + 1.5 * u;
  const chain = [
    ["/flanges/lower/axialThickness", z.lowerFlange, z.rimLower, flanges.lower?.axialThickness, flangeRadius.lower, r.outside],
    ["/rim/width", z.rimLower, z.rimUpper, rim.width, r.outside, r.outside],
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

  // rim, hub and bore sizes across the part, above it, values centred over their lines;
  // they belong to different groups and never show together. The section shows
  // the bore sizes that lie in its plane: d of a round bore and s of a flat.
  const across = [["/hub/outerDiameter", -r.hub, r.hub, hub.outerDiameter]];
  if (!(r.root < r.outside)) across.push(["/rim/outerDiameter", -r.outside, r.outside, rim.outerDiameter]);
  if (bore.shape === "round") across.push(["/bore/diameter", -r.bore, r.bore, bore.diameter]);
  if (bore.shape === "dFlat") across.push(["/bore/flatDistance", -r.bore, bore.flatDistance - r.bore, bore.flatDistance]);
  const acrossLevel = top + 1.4 * u;
  for (const [path, x0, x1, value] of across) {
    out.push(dimension(ctx, path, {
      u, a: [x0, acrossLevel], b: [x1, acrossLevel], value,
      ext: [[[x0, (path.startsWith("/rim") ? z.rimUpper : z.upperHub) + 0.3 * u], [x0, acrossLevel + 0.4 * u]], [[x1, (path.startsWith("/rim") ? z.rimUpper : z.upperHub) + 0.3 * u], [x1, acrossLevel + 0.4 * u]]],
      label: [(x0 + x1) / 2, acrossLevel + 0.65 * u], anchor: "middle"
    }));
  }

  // hub extensions: left column, measured from the rim faces
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
    model.normalized.bore.shape === "polygon" ? null : ["отверстие", r.bore],
    ["втулка", r.hub],
    model.normalized.kind === "idlerPulley" ? ["обод", r.outside] : null,
    flange > 0 ? ["фланец", flange] : null
  ].filter(Boolean).filter(([, radius]) => radius > 0)
    .map(([name, radius]) => ({ name, diameter: 2 * radius, segments: circleSegmentCount(radius, epsilon) }));
}
