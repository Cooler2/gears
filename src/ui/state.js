// Form state: the contract description plus values remembered for hidden parts.
//
// The description itself follows the contract: switching the web to solid drops
// the spoke fields and removing a flange stores null. So that such a switch does
// not lose what the user typed, the last spoke fields and flanges are kept in
// `remembered` and restored when the part comes back. Pure functions, no DOM.

export function defaultDescription(schema) {
  const value = (definition, property) => schema.$defs[definition].properties[property].default;
  return {
    schemaVersion: 1,
    kind: "timingPulley",
    units: "mm",
    rim: {
      profile: schema.$defs.rim.properties.profile.const,
      toothCount: value("rim", "toothCount"),
      toothedWidth: value("rim", "toothedWidth"),
      radialThickness: value("rim", "radialThickness")
    },
    flanges: { lower: null, upper: null },
    web: { type: "solid", axialThickness: value("webPlacement", "axialThickness"), axialOffset: value("webPlacement", "axialOffset") },
    hub: {
      boreDiameter: value("hub", "boreDiameter"),
      outerDiameter: value("hub", "outerDiameter"),
      lowerExtension: value("hub", "lowerExtension"),
      upperExtension: value("hub", "upperExtension")
    },
    generation: { maxChordError: value("generation", "maxChordError") }
  };
}

export function createState(schema) {
  const value = (definition, property) => schema.$defs[definition].properties[property].default;
  const flange = () => ({ axialThickness: value("flange", "axialThickness"), radialExtension: value("flange", "radialExtension") });
  return {
    description: defaultDescription(schema),
    remembered: {
      spokes: { count: value("spokeWeb", "count"), width: value("spokeWeb", "width"), filletRadius: value("spokeWeb", "filletRadius") },
      flanges: { lower: flange(), upper: flange() }
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
  const placement = { axialThickness: web.axialThickness, axialOffset: web.axialOffset };
  if (type === "solid") {
    next.remembered.spokes = { count: web.count, width: web.width, filletRadius: web.filletRadius };
    next.description.web = { type, ...placement };
  } else {
    next.description.web = { type, ...placement, ...state.remembered.spokes };
  }
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

/** Replace the description (preset or file); parts it lacks keep their remembered values. */
export function loadDescription(state, description) {
  const next = { description: structuredClone(description), remembered: structuredClone(state.remembered) };
  const { web, flanges } = description;
  if (web.type === "spokes") next.remembered.spokes = { count: web.count, width: web.width, filletRadius: web.filletRadius };
  for (const side of ["lower", "upper"]) {
    if (flanges[side]) next.remembered.flanges[side] = structuredClone(flanges[side]);
  }
  return next;
}

/** Number typed by a person: accepts a decimal comma and a typographic minus; NaN otherwise. */
export function parseNumber(text) {
  const normalized = String(text).trim().replace(",", ".").replace("−", "-");
  return normalized === "" ? NaN : Number(normalized);
}
