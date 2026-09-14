import { buildGt2Contour } from "./contours.js";

const ROOT_FIELDS = ["schemaVersion", "kind", "units", "rim", "flanges", "web", "hub", "generation"];
const RIM_FIELDS = ["profile", "toothCount", "toothedWidth", "radialThickness"];
const FLANGES_FIELDS = ["lower", "upper"];
const FLANGE_FIELDS = ["axialThickness", "radialExtension"];
const SOLID_WEB_FIELDS = ["type", "axialThickness", "axialOffset"];
const SPOKE_WEB_FIELDS = [...SOLID_WEB_FIELDS, "count", "width", "filletRadius"];
const HUB_FIELDS = ["boreDiameter", "outerDiameter", "lowerExtension", "upperExtension"];
const GENERATION_FIELDS = ["maxChordError"];

export function validateDescription(input) {
  const diagnostics = [];
  if (!isRecord(input)) {
    return failedSchema(diagnostics, "", "object");
  }
  if (input.schemaVersion !== 1) {
    diagnostics.push(diagnostic("E_SCHEMA_VERSION", "error", "description", ["/schemaVersion"]));
  }

  validateStatic(input, diagnostics);
  if (diagnostics.some((item) => item.severity === "error")) {
    return { ok: false, schemaVersion: 1, normalized: null, derived: null, diagnostics };
  }

  const normalized = normalize(input);
  const derived = derive(normalized);
  validateRelations(normalized, derived, diagnostics);
  addWarnings(normalized, derived, diagnostics);
  const ok = !diagnostics.some((item) => item.severity === "error");
  return {
    ok,
    schemaVersion: 1,
    normalized: ok ? normalized : null,
    derived: ok ? derived : null,
    diagnostics
  };
}

function validateStatic(input, diagnostics) {
  exactObject(input, ROOT_FIELDS, "", diagnostics);
  constant(input.kind, "timingPulley", "/kind", diagnostics);
  constant(input.units, "mm", "/units", diagnostics);

  if (exactObject(input.rim, RIM_FIELDS, "/rim", diagnostics)) {
    constant(input.rim.profile, "gt2-2mm-experimental-v1", "/rim/profile", diagnostics);
    integerRange(input.rim.toothCount, 14, 120, "/rim/toothCount", diagnostics);
    numberRange(input.rim.toothedWidth, 2, 50, "/rim/toothedWidth", diagnostics);
    numberRange(input.rim.radialThickness, 1, 25, "/rim/radialThickness", diagnostics);
  }
  if (exactObject(input.flanges, FLANGES_FIELDS, "/flanges", diagnostics)) {
    validateFlange(input.flanges.lower, "/flanges/lower", diagnostics);
    validateFlange(input.flanges.upper, "/flanges/upper", diagnostics);
  }
  if (isRecord(input.web)) {
    const fields = input.web.type === "spokes" ? SPOKE_WEB_FIELDS : SOLID_WEB_FIELDS;
    if (exactObject(input.web, fields, "/web", diagnostics)) {
      enumeration(input.web.type, ["solid", "spokes"], "/web/type", diagnostics);
      numberRange(input.web.axialThickness, 1, 50, "/web/axialThickness", diagnostics);
      numberRange(input.web.axialOffset, -24.5, 24.5, "/web/axialOffset", diagnostics);
      if (input.web.type === "spokes") {
        integerRange(input.web.count, 3, 12, "/web/count", diagnostics);
        numberRange(input.web.width, 1, 20, "/web/width", diagnostics);
        numberRange(input.web.filletRadius, 0.5, 10, "/web/filletRadius", diagnostics);
      }
    }
  } else schemaError(diagnostics, "/web", "object");

  if (exactObject(input.hub, HUB_FIELDS, "/hub", diagnostics)) {
    numberRange(input.hub.boreDiameter, 0.5, 50, "/hub/boreDiameter", diagnostics);
    numberRange(input.hub.outerDiameter, 2, 100, "/hub/outerDiameter", diagnostics);
    numberRange(input.hub.lowerExtension, 0, 50, "/hub/lowerExtension", diagnostics);
    numberRange(input.hub.upperExtension, 0, 50, "/hub/upperExtension", diagnostics);
  }
  if (exactObject(input.generation, GENERATION_FIELDS, "/generation", diagnostics)) {
    numberRange(input.generation.maxChordError, 0.01, 0.25, "/generation/maxChordError", diagnostics);
  }
}

function validateFlange(value, path, diagnostics) {
  if (value === null) return;
  if (!exactObject(value, FLANGE_FIELDS, path, diagnostics)) return;
  numberRange(value.axialThickness, 0.4, 5, `${path}/axialThickness`, diagnostics);
  numberRange(value.radialExtension, 0.5, 10, `${path}/radialExtension`, diagnostics);
}

function validateRelations(input, derived, diagnostics) {
  if (derived.rimInnerRadius <= 0) {
    diagnostics.push(diagnostic("E_RIM_NO_INTERIOR", "error", "description", ["/rim/toothCount", "/rim/radialThickness"]));
  }
  if (derived.hubRadius - derived.boreRadius < 1) {
    diagnostics.push(diagnostic("E_HUB_WALL", "error", "description", ["/hub/boreDiameter", "/hub/outerDiameter"]));
  }
  if (derived.rimInnerRadius - derived.hubRadius < 1) {
    diagnostics.push(diagnostic("E_RADIAL_ORDER", "error", "description", ["/hub/outerDiameter", "/rim/radialThickness", "/rim/toothCount"]));
  }
  if (derived.webLowerZ < -input.rim.toothedWidth / 2 || derived.webUpperZ > input.rim.toothedWidth / 2) {
    diagnostics.push(diagnostic("E_WEB_AXIAL_RANGE", "error", "description", ["/web/axialThickness", "/web/axialOffset", "/rim/toothedWidth"]));
  }
  if (input.web.type === "spokes") {
    if (input.web.filletRadius > input.web.width / 2 || 2 * input.web.filletRadius > derived.rimInnerRadius - derived.hubRadius) {
      diagnostics.push(diagnostic("E_SPOKE_FILLET", "error", "description", ["/web/width", "/web/filletRadius"]));
    }
    if (input.web.width + 2 * input.web.filletRadius >= 2 * derived.hubRadius * Math.sin(Math.PI / input.web.count)) {
      diagnostics.push(diagnostic("E_SPOKE_OVERLAP", "error", "description", ["/web/count", "/web/width", "/web/filletRadius", "/hub/outerDiameter"]));
    }
  }
}

function addWarnings(input, derived, diagnostics) {
  if (input.rim.radialThickness < 1.2) diagnostics.push(thin("/rim/radialThickness"));
  if (input.web.axialThickness < 1.2) diagnostics.push(thin("/web/axialThickness"));
  if (input.web.type === "spokes" && input.web.width < 1.2) diagnostics.push(thin("/web/width"));
  if (derived.hubRadius - derived.boreRadius < 1.2) diagnostics.push(thin("/hub/outerDiameter"));
  diagnostics.push(diagnostic("W_EXPERIMENTAL_PROFILE", "warning", "build", ["/rim/profile"]));
}

function derive(input) {
  const pitchRadius = input.rim.toothCount / Math.PI;
  const outsideRadius = pitchRadius - 0.254;
  const grooveRootRadius = outsideRadius - 0.75;
  const rimInnerRadius = grooveRootRadius - input.rim.radialThickness;
  const boreRadius = input.hub.boreDiameter / 2;
  const hubRadius = input.hub.outerDiameter / 2;
  const halfWidth = input.rim.toothedWidth / 2;
  const webLowerZ = input.web.axialOffset - input.web.axialThickness / 2;
  const webUpperZ = input.web.axialOffset + input.web.axialThickness / 2;
  const hubLowerZ = -halfWidth - input.hub.lowerExtension;
  const hubUpperZ = halfWidth + input.hub.upperExtension;
  const profile = buildGt2Contour(input.rim.toothCount, outsideRadius);
  const radialBound = Math.max(...profile.map(([x, y]) => Math.hypot(x, y)),
    input.flanges.lower ? outsideRadius + input.flanges.lower.radialExtension : 0,
    input.flanges.upper ? outsideRadius + input.flanges.upper.radialExtension : 0);
  const lowerFlangeZ = input.flanges.lower ? -halfWidth - input.flanges.lower.axialThickness : -halfWidth;
  const upperFlangeZ = input.flanges.upper ? halfWidth + input.flanges.upper.axialThickness : halfWidth;
  return {
    pitch: 2,
    pitchRadius,
    outsideRadius,
    grooveRootRadius,
    rimInnerRadius,
    boreRadius,
    hubRadius,
    webLowerZ,
    webUpperZ,
    hubLowerZ,
    hubUpperZ,
    lowerFlangeOuterRadius: input.flanges.lower ? outsideRadius + input.flanges.lower.radialExtension : null,
    upperFlangeOuterRadius: input.flanges.upper ? outsideRadius + input.flanges.upper.radialExtension : null,
    bounds: {
      min: [-radialBound, -radialBound, Math.min(hubLowerZ, lowerFlangeZ)],
      max: [radialBound, radialBound, Math.max(hubUpperZ, upperFlangeZ)]
    }
  };
}

function normalize(input) {
  const flange = (value) => value === null ? null : {
    axialThickness: value.axialThickness,
    radialExtension: value.radialExtension
  };
  const web = {
    type: input.web.type,
    axialThickness: input.web.axialThickness,
    axialOffset: input.web.axialOffset
  };
  if (input.web.type === "spokes") Object.assign(web, {
    count: input.web.count,
    width: input.web.width,
    filletRadius: input.web.filletRadius
  });
  return {
    schemaVersion: 1,
    kind: "timingPulley",
    units: "mm",
    rim: {
      profile: "gt2-2mm-experimental-v1",
      toothCount: input.rim.toothCount,
      toothedWidth: input.rim.toothedWidth,
      radialThickness: input.rim.radialThickness
    },
    flanges: { lower: flange(input.flanges.lower), upper: flange(input.flanges.upper) },
    web,
    hub: {
      boreDiameter: input.hub.boreDiameter,
      outerDiameter: input.hub.outerDiameter,
      lowerExtension: input.hub.lowerExtension,
      upperExtension: input.hub.upperExtension
    },
    generation: { maxChordError: input.generation.maxChordError }
  };
}

function exactObject(value, fields, path, diagnostics) {
  if (!isRecord(value)) {
    schemaError(diagnostics, path, "object");
    return false;
  }
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) schemaError(diagnostics, `${path}/${field}`, "required");
  }
  for (const field of Object.keys(value)) {
    if (!fields.includes(field)) schemaError(diagnostics, `${path}/${field}`, "additionalProperty");
  }
  return fields.every((field) => Object.hasOwn(value, field));
}

function numberRange(value, minimum, maximum, path, diagnostics) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    schemaError(diagnostics, path, "numberRange", { minimum, maximum });
  }
}

function integerRange(value, minimum, maximum, path, diagnostics) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    schemaError(diagnostics, path, "integerRange", { minimum, maximum });
  }
}

function constant(value, expected, path, diagnostics) {
  if (value !== expected) schemaError(diagnostics, path, "const", { expected: String(expected) });
}

function enumeration(value, expected, path, diagnostics) {
  if (!expected.includes(value)) schemaError(diagnostics, path, "enum");
}

function schemaError(diagnostics, path, rule, details) {
  diagnostics.push(diagnostic("E_SCHEMA_VALUE", "error", "description", [path], { rule, ...details }));
}

function failedSchema(diagnostics, path, rule) {
  schemaError(diagnostics, path, rule);
  return { ok: false, schemaVersion: 1, normalized: null, derived: null, diagnostics };
}

function thin(path) {
  return diagnostic("W_THIN_FEATURE", "warning", "print", [path]);
}

export function diagnostic(code, severity, phase, paths, details) {
  return { code, severity, phase, paths, ...(details ? { details } : {}) };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
