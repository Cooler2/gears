// Gears — (c) 2026 Ivan Polyacov (ivan@apus-software.com), Elastic License 2.0, see LICENSE
// Form state: the contract description plus values remembered for hidden parts.
//
// The description itself follows the contract: switching the web to solid drops
// the spoke fields, removing a flange stores null and a bore keeps only the fields
// of its shape. So that such a switch does not lose what the user typed, the last
// spoke fields, flanges, bore sizes and the helix angle are kept in `remembered` and
// restored when the part comes back. Pure functions, no DOM.

import { upgradeDescription } from "../core/parameters.js";

const WEB_PLACEMENT = ["thinning", "alignment", "axialOffset", "hubTaper", "rimTaper"];
const BORE_EXTRAS = { round: [], polygon: ["sides"], dFlat: ["flatDistance"], keyed: ["keyWidth", "keyDepth"] };

export function defaultDescription(schema, kind = "timingPulley") {
  const value = (definition, property) => schema.$defs[definition].properties[property].default;
  if (kind === "rack") {
    // the teeth of a gear, as long as its tooth count, on a bar of the pitch height
    const teeth = Object.fromEntries(["module", "pressureAngle", "backlash", "helix"].map((field) => [field, value("gearRim", field)]));
    return {
      schemaVersion: schema.properties.schemaVersion.const,
      kind,
      units: "mm",
      rim: {
        module: teeth.module,
        toothCount: value("rackRim", "toothCount"),
        pressureAngle: teeth.pressureAngle,
        backlash: teeth.backlash,
        helix: teeth.helix,
        width: value("rimPlacement", "width"),
        pitchHeight: value("rackRim", "pitchHeight")
      }
    };
  }
  const rims = {
    timingPulley: () => ({ profile: schema.$defs.timingRim.properties.profile.const, toothCount: value("timingRim", "toothCount") }),
    idlerPulley: () => ({ outerDiameter: value("idlerRim", "outerDiameter") }),
    gear: () => Object.fromEntries(["module", "toothCount", "pressureAngle", "profileShift", "backlash", "helix"].map((field) => [field, value("gearRim", field)])),
    // the tooth fields a bevel gear shares with a gear are references to the gear ones
    bevelGear: () => Object.fromEntries(["module", "toothCount", "mateToothCount", "shaftAngle", "pressureAngle", "profileShift", "backlash"]
      .map((field) => [field, value(Object.hasOwn(schema.$defs.bevelRim.properties[field], "$ref") ? "gearRim" : "bevelRim", field)]))
  };
  const rim = rims[kind]();
  return {
    schemaVersion: schema.properties.schemaVersion.const,
    kind,
    units: "mm",
    rim: { ...rim, width: value("rimPlacement", "width"), radialThickness: value("rimPlacement", "radialThickness") },
    flanges: { lower: null, upper: null },
    web: { type: "solid", ...Object.fromEntries(WEB_PLACEMENT.map((field) => [field, value("webPlacement", field)])) },
    hub: {
      outerDiameter: value("hub", "outerDiameter"),
      lowerExtension: value("hub", "lowerExtension"),
      upperExtension: value("hub", "upperExtension")
    },
    bore: { shape: "round", diameter: value("borePlacement", "diameter") },
    generation: { maxChordError: value("generation", "maxChordError") }
  };
}

export function createState(schema, kind) {
  const value = (definition, property) => schema.$defs[definition].properties[property].default;
  const flange = () => ({ axialThickness: value("flange", "axialThickness"), radialExtension: value("flange", "radialExtension") });
  return {
    description: defaultDescription(schema, kind),
    remembered: {
      spokes: { count: value("spokeWeb", "count"), width: value("spokeWeb", "width"), filletRadius: value("spokeWeb", "filletRadius") },
      placement: Object.fromEntries(WEB_PLACEMENT.map((field) => [field, value("webPlacement", field)])),
      flanges: { lower: flange(), upper: flange() },
      bore: Object.fromEntries(Object.values(BORE_EXTRAS).flat().map((field) => [field, value("borePlacement", field)])),
      helixAngle: value("gearRim", "helixAngle")
    }
  };
}

export function getValue(description, path) {
  return path.split("/").slice(1).reduce((node, key) => node?.[key], description);
}

export function setValue(state, path, value) {
  const next = structuredClone(state);
  const keys = path.split("/").slice(1);
  const parent = keys.slice(0, -1).reduce((node, key) => node[key], next.description);
  parent[keys.at(-1)] = value;
  return next;
}

export function setWebType(state, type) {
  const { web } = state.description;
  if (web.type === type) return state;
  const next = structuredClone(state);
  // a web without placement (none) takes the remembered one back
  const placement = web.type === "none" ? state.remembered.placement : Object.fromEntries(WEB_PLACEMENT.map((field) => [field, web[field]]));
  if (web.type !== "none") next.remembered.placement = placement;
  if (web.type === "spokes") next.remembered.spokes = { count: web.count, width: web.width, filletRadius: web.filletRadius };
  next.description.web = { none: { type }, solid: { type, ...placement }, spokes: { type, ...placement, ...next.remembered.spokes } }[type];
  return next;
}

export function setFlange(state, side, enabled) {
  const current = state.description.flanges[side];
  if (Boolean(current) === enabled) return state;
  const next = structuredClone(state);
  if (enabled) {
    next.description.flanges[side] = structuredClone(state.remembered.flanges[side]);
  } else {
    next.remembered.flanges[side] = structuredClone(current);
    next.description.flanges[side] = null;
  }
  return next;
}

export function setBoreShape(state, shape) {
  const { bore } = state.description;
  if (bore.shape === shape) return state;
  const next = structuredClone(state);
  for (const field of BORE_EXTRAS[bore.shape]) next.remembered.bore[field] = bore[field];
  next.description.bore = { shape, diameter: bore.diameter };
  for (const field of BORE_EXTRAS[shape]) next.description.bore[field] = next.remembered.bore[field];
  return next;
}

/** Straight teeth drop the helix angle, inclined ones take it back; the angle goes after the helix, as in the contract. */
export function setHelix(state, helix) {
  const { rim } = state.description;
  if (rim.helix === helix) return state;
  const next = structuredClone(state);
  if (rim.helix !== "none") next.remembered.helixAngle = rim.helixAngle;
  const { helixAngle, ...rest } = rim;
  next.description.rim = {};
  for (const [key, value] of Object.entries(rest)) {
    next.description.rim[key] = key === "helix" ? helix : value;
    if (key === "helix" && helix !== "none") next.description.rim.helixAngle = next.remembered.helixAngle;
  }
  return next;
}

/** Replace the description (preset or file); parts it lacks keep their remembered values. */
export function loadDescription(state, description) {
  const next = { description: structuredClone(description), remembered: structuredClone(state.remembered) };
  const { web, flanges, bore, rim } = description;
  if (Number.isFinite(rim.helixAngle)) next.remembered.helixAngle = rim.helixAngle;
  // a rack has nothing but its teeth
  if (!bore) return next;
  for (const field of BORE_EXTRAS[bore.shape] ?? []) next.remembered.bore[field] = bore[field];
  if (web.type === "spokes") next.remembered.spokes = { count: web.count, width: web.width, filletRadius: web.filletRadius };
  if (web.type !== "none") next.remembered.placement = Object.fromEntries(WEB_PLACEMENT.map((field) => [field, web[field]]));
  for (const side of ["lower", "upper"]) {
    if (flanges[side]) next.remembered.flanges[side] = structuredClone(flanges[side]);
  }
  return next;
}

/** Whether a new part can take the hub and the bore of the previous one: a rack has neither. */
export function canKeepShaft(state, previous) {
  return Boolean(state.description.hub && previous.description.hub);
}

/** The hub and the bore of `previous` put into `state`: a new part for the same shaft. */
export function keepShaft(state, previous) {
  if (!canKeepShaft(state, previous)) return state;
  const next = structuredClone(state);
  next.description.hub = structuredClone(previous.description.hub);
  next.description.bore = structuredClone(previous.description.bore);
  next.remembered.bore = structuredClone(previous.remembered.bore);
  return next;
}

/**
 * Form state saved by an earlier version: an older description is upgraded and
 * sizes it could not remember come from the defaults. Null when it is not a state.
 */
export function restoreState(schema, saved) {
  if (!saved?.description || !saved.remembered) return null;
  const defaults = createState(schema).remembered;
  return {
    description: upgradeDescription(saved.description),
    remembered: {
      ...defaults,
      ...saved.remembered,
      // a placement remembered before version 6 has no cones: they stay cylindrical, as its web was
      placement: saved.remembered.placement ? { hubTaper: 0, rimTaper: 0, ...saved.remembered.placement } : defaults.placement,
      bore: { ...defaults.bore, ...saved.remembered.bore }
    }
  };
}

/** Number typed by a person: a decimal comma is read as a point, a typographic minus as a minus; NaN otherwise. */
export function parseNumber(text) {
  const normalized = String(text).trim().replace(",", ".").replace("−", "-");
  return normalized === "" ? NaN : Number(normalized);
}
