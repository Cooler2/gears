// Gears — (c) 2026 Ivan Polyacov (ivan@apus-software.com), Elastic License 2.0, see LICENSE
// Part kinds, form groups and fields of the pulley contract v6.
//
// Everything about a field that the contract already defines (limits, defaults,
// integer or not) is read from the JSON Schema through `schema`; this file adds
// only presentation: group, drawing symbol, unit and applicability. Labels, hints
// and words of choices are in the locale files, keyed by the path.
// `schema: [def, property]` points at $defs[def].properties[property].

import { T, resolve } from "./locale.js";
import { hasWeb, isBevel, isGear, isIdler, isInclined, isParallel, isSpokes } from "./part.js";

// titles and texts come from the page language when asked for
const kind = (id, extra = {}) => ({ id, ...extra, get title() { return T.kinds[id].title; }, get text() { return T.kinds[id].text; } });

export const KINDS = [kind("timingPulley", { experimental: true }), kind("idlerPulley"), kind("gear"), kind("bevelGear")];

export function kindOf(description) {
  return KINDS.find(({ id }) => id === description?.kind) ?? KINDS[0];
}

export const GROUPS = [
  { id: "presets" },
  { id: "rim" },
  // flanges past the tooth tips would stop the mating gear
  { id: "flanges", applies: (description) => !isGear(description) },
  { id: "web" },
  { id: "hub" },
  { id: "bore" },
  { id: "generation" }
];

/** Groups of the kind, the variants page included. */
export function groupsOf(description) {
  return GROUPS.filter((group) => !group.applies || group.applies(description));
}

export function groupTitle(group, description) {
  return resolve(T.groups[group.id], description);
}

const hasBore = (...shapes) => (description) => shapes.includes(description.bore?.shape);
const hasFlange = (side) => (description) => Boolean(description.flanges?.[side]);

export const FIELDS = [
  {
    path: "/rim/module", group: "rim", schema: (description) => [isBevel(description) ? "bevelRim" : "gearRim", "module"], applies: isGear,
    symbol: "m", unit: "mm"
  },
  {
    path: "/rim/toothCount", group: "rim", schema: (description) => [isBevel(description) ? "bevelRim" : isGear(description) ? "gearRim" : "timingRim", "toothCount"],
    applies: (description) => !isIdler(description),
    symbol: "N"
  },
  {
    path: "/rim/mateToothCount", group: "rim", schema: ["bevelRim", "mateToothCount"], applies: isBevel,
    symbol: "N_2"
  },
  {
    path: "/rim/shaftAngle", group: "rim", schema: ["bevelRim", "shaftAngle"], applies: isBevel,
    symbol: "Σ", unit: "deg"
  },
  {
    path: "/rim/pressureAngle", group: "rim", schema: ["gearRim", "pressureAngle"], applies: isGear,
    symbol: "α", unit: "deg"
  },
  {
    path: "/rim/profileShift", group: "rim", schema: ["gearRim", "profileShift"], applies: isGear,
    symbol: "x"
  },
  {
    path: "/rim/backlash", group: "rim", schema: ["gearRim", "backlash"], applies: isGear,
    symbol: "j", unit: "mm"
  },
  {
    path: "/rim/helix", group: "rim", kind: "choice", applies: isParallel,
    options: ["none", "helical", "herringbone"]
  },
  {
    path: "/rim/helixAngle", group: "rim", schema: ["gearRim", "helixAngle"], applies: isInclined,
    symbol: "β", unit: "deg"
  },
  {
    path: "/rim/outerDiameter", group: "rim", schema: ["idlerRim", "outerDiameter"], applies: isIdler,
    symbol: "D", unit: "mm"
  },
  {
    path: "/rim/width", group: "rim", schema: ["rimPlacement", "width"],
    symbol: "W", unit: "mm"
  },
  {
    path: "/rim/radialThickness", group: "rim", schema: ["rimPlacement", "radialThickness"], applies: hasWeb,
    symbol: "T_r", unit: "mm"
  },
  {
    path: "/flanges/lower", group: "flanges", kind: "toggle"
  },
  {
    path: "/flanges/lower/axialThickness", group: "flanges", schema: ["flange", "axialThickness"], applies: hasFlange("lower"),
    symbol: "T_f−", unit: "mm"
  },
  {
    path: "/flanges/lower/radialExtension", group: "flanges", schema: ["flange", "radialExtension"], applies: hasFlange("lower"),
    symbol: "E_f−", unit: "mm"
  },
  {
    path: "/flanges/upper", group: "flanges", kind: "toggle"
  },
  {
    path: "/flanges/upper/axialThickness", group: "flanges", schema: ["flange", "axialThickness"], applies: hasFlange("upper"),
    symbol: "T_f+", unit: "mm"
  },
  {
    path: "/flanges/upper/radialExtension", group: "flanges", schema: ["flange", "radialExtension"], applies: hasFlange("upper"),
    symbol: "E_f+", unit: "mm"
  },
  {
    path: "/web/type", group: "web", kind: "choice",
    options: ["solid", "spokes", "none"]
  },
  {
    path: "/web/thinning", group: "web", schema: ["webPlacement", "thinning"], applies: hasWeb,
    symbol: "t_w", unit: "mm"
  },
  {
    path: "/web/alignment", group: "web", kind: "choice", applies: hasWeb,
    options: ["lower", "center", "upper"]
  },
  {
    path: "/web/axialOffset", group: "web", schema: ["webPlacement", "axialOffset"], applies: hasWeb,
    symbol: "Δz", unit: "mm"
  },
  {
    path: "/web/hubTaper", group: "web", schema: ["webPlacement", "hubTaper"], applies: hasWeb,
    symbol: "γ_h", unit: "deg"
  },
  {
    path: "/web/rimTaper", group: "web", schema: ["webPlacement", "rimTaper"], applies: hasWeb,
    symbol: "γ_r", unit: "deg"
  },
  {
    path: "/web/count", group: "web", schema: ["spokeWeb", "count"], applies: isSpokes,
    symbol: "N_s"
  },
  {
    path: "/web/width", group: "web", schema: ["spokeWeb", "width"], applies: isSpokes,
    symbol: "B_s", unit: "mm"
  },
  {
    path: "/web/filletRadius", group: "web", schema: ["spokeWeb", "filletRadius"], applies: isSpokes,
    symbol: "R_f", unit: "mm"
  },
  {
    path: "/hub/outerDiameter", group: "hub", schema: ["hub", "outerDiameter"],
    symbol: "D_h", unit: "mm"
  },
  {
    path: "/hub/lowerExtension", group: "hub", schema: ["hub", "lowerExtension"],
    symbol: "L_h−", unit: "mm"
  },
  {
    path: "/hub/upperExtension", group: "hub", schema: ["hub", "upperExtension"],
    symbol: "L_h+", unit: "mm"
  },
  {
    path: "/bore/shape", group: "bore", kind: "choice",
    options: ["round", "polygon", "dFlat", "keyed"]
  },
  {
    path: "/bore/diameter", group: "bore", schema: ["borePlacement", "diameter"],
    symbol: "d", unit: "mm"
  },
  {
    path: "/bore/sides", group: "bore", schema: ["borePlacement", "sides"], applies: hasBore("polygon"),
    symbol: "n"
  },
  {
    path: "/bore/flatDistance", group: "bore", schema: ["borePlacement", "flatDistance"], applies: hasBore("dFlat"),
    symbol: "s", unit: "mm"
  },
  {
    path: "/bore/keyWidth", group: "bore", schema: ["borePlacement", "keyWidth"], applies: hasBore("keyed"),
    symbol: "b", unit: "mm"
  },
  {
    path: "/bore/keyDepth", group: "bore", schema: ["borePlacement", "keyDepth"], applies: hasBore("keyed"),
    symbol: "t", unit: "mm"
  },
  {
    path: "/generation/maxChordError", group: "generation", schema: ["generation", "maxChordError"],
    symbol: "ε", unit: "mm"
  }
];

export const FIELD_BY_PATH = new Map(FIELDS.map((field) => [field.path, field]));

export function fieldLabel(field, description) {
  return resolve(T.fields[field.path].label, description);
}

export function fieldHint(field, description) {
  return resolve(T.fields[field.path].hint, description);
}

/** Choices of a choice field with their words. */
export function fieldOptions(field) {
  return field.options.map((value) => ({ value, label: T.fields[field.path].options[value] }));
}

/** Unit of a numeric field in the page language; empty for a pure number. */
export function fieldUnit(field) {
  return field.unit ? T.units[field.unit] : "";
}

export function isApplicable(field, description) {
  return field.applies ? field.applies(description) : true;
}

export function fieldsOf(group, description) {
  return FIELDS.filter((field) => field.group === group && isApplicable(field, description));
}

/** Limits and defaults of a numeric field, straight from the JSON Schema; they may depend on the kind. */
export function fieldSchema(schema, field, description) {
  const [definition, property] = typeof field.schema === "function" ? field.schema(description) : field.schema;
  const node = schema.$defs[definition].properties[property];
  return { minimum: node.minimum, maximum: node.maximum, integer: node.type === "integer", default: node.default };
}

/** Group of a diagnostic path: the field itself or the closest field above it. */
export function groupOfPath(path) {
  for (let candidate = path; candidate; candidate = candidate.slice(0, candidate.lastIndexOf("/"))) {
    const field = FIELD_BY_PATH.get(candidate);
    if (field) return field.group;
  }
  return path.startsWith("/rim") ? "rim" : null;
}
