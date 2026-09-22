// Gears — (c) 2026 Ivan Polyacov (ivan@apus-software.com), Elastic License 2.0, see LICENSE
import { boreExtents } from "./contours.js";
import { gearGeometry } from "./involute.js";
import { HELICES, PART_KINDS, rimFields, rimRadii, rimSizePath, rimSurface } from "./rims.js";
import { planTapers } from "./taper.js";

const SCHEMA_VERSION = 6;
const ROOT_FIELDS = ["schemaVersion", "kind", "units", "rim", "flanges", "web", "hub", "bore", "generation"];
const OPTIONAL_ROOT_FIELDS = ["generator"]; // the program that wrote the file; not geometry, dropped on normalization
const FLANGES_FIELDS = ["lower", "upper"];
const FLANGE_FIELDS = ["axialThickness", "radialExtension"];
const SOLID_WEB_FIELDS = ["type", "thinning", "alignment", "axialOffset", "hubTaper", "rimTaper"];
const WEB_ALIGNMENTS = ["lower", "center", "upper"];
const SPOKE_WEB_FIELDS = [...SOLID_WEB_FIELDS, "count", "width", "filletRadius"];
const NO_WEB_FIELDS = ["type"]; // the rim sits on the hub: a pinion, a small pulley on a shaft
const HUB_FIELDS = ["outerDiameter", "lowerExtension", "upperExtension"];
const BORE_FIELDS = {
  round: ["shape", "diameter"],
  polygon: ["shape", "diameter", "sides"],
  dFlat: ["shape", "diameter", "flatDistance"],
  keyed: ["shape", "diameter", "keyWidth", "keyDepth"]
};
const GENERATION_FIELDS = ["maxChordError"];
const THIN_FEATURE = 1.2; // print recommendation, mm
const MIN_WEB_THICKNESS = 1; // mm, the web limit of the earlier versions

export function validateDescription(original) {
  const diagnostics = [];
  if (!isRecord(original)) {
    return failedSchema(diagnostics, "", "object");
  }
  const input = upgradeDescription(original);
  if (input.schemaVersion !== SCHEMA_VERSION) {
    diagnostics.push(diagnostic("E_SCHEMA_VERSION", "error", "description", ["/schemaVersion"]));
  }

  validateStatic(input, diagnostics);
  if (diagnostics.some((item) => item.severity === "error")) {
    return { ok: false, schemaVersion: SCHEMA_VERSION, normalized: null, derived: null, anchors: null, diagnostics };
  }

  // A structurally valid description is normalized even when relation rules fail:
  // ok stays false and no mesh is built, but a form can still draw the conflict.
  const normalized = normalize(input);
  const derived = derive(normalized);
  validateRelations(normalized, derived, diagnostics);
  addWarnings(normalized, derived, diagnostics);
  return {
    ok: !diagnostics.some((item) => item.severity === "error"),
    schemaVersion: SCHEMA_VERSION,
    normalized,
    derived,
    anchors: buildAnchors(normalized, derived),
    diagnostics
  };
}

/**
 * Earlier versions are read as the current one; key order is kept, anything that
 * does not look like them is returned unchanged, and the argument is never modified.
 * Version 1 kept a round bore as hub.boreDiameter (version 2: bore.shape "round").
 * Versions 1 and 2 were timing pulleys only and called the rim width toothedWidth.
 * Version 3 added the idler pulley and the spur gear without changing older kinds.
 * Version 4 places the web and the hub against the faces of the part (flanges
 * included): the web by its thinning and alignment instead of its thickness and
 * mid-plane, the hub extensions from those faces instead of the rim ends.
 * Version 5 renames the spur gear to gear, whose teeth may be helical: an earlier
 * gear gets straight teeth.
 * Version 6 lets the hub and the rim widen towards the web; an earlier web keeps
 * them cylindrical.
 */
export function upgradeDescription(input) {
  let current = input;
  if (isRecord(current) && current.schemaVersion === 1 && isRecord(current.hub) && Object.hasOwn(current.hub, "boreDiameter")) {
    const { boreDiameter, ...hub } = current.hub;
    current = replaceKeys(current, { schemaVersion: { schemaVersion: 2 }, hub: { hub, bore: { shape: "round", diameter: boreDiameter } } });
  }
  if (isRecord(current) && current.schemaVersion === 2 && isRecord(current.rim) && Object.hasOwn(current.rim, "toothedWidth")) {
    const rim = replaceKeys(current.rim, { toothedWidth: { width: current.rim.toothedWidth } });
    current = replaceKeys(current, { schemaVersion: { schemaVersion: 3 }, rim: { rim } });
  }
  if (isRecord(current) && current.schemaVersion === 3) current = upgradeVersion3(current);
  if (isRecord(current) && current.schemaVersion === 4) {
    const gear = current.kind === "spurGear" && isRecord(current.rim) && Object.hasOwn(current.rim, "backlash");
    current = replaceKeys(current, {
      schemaVersion: { schemaVersion: 5 },
      ...(gear ? { kind: { kind: "gear" }, rim: { rim: replaceKeys(current.rim, { backlash: { backlash: current.rim.backlash, helix: "none" } }) } } : {})
    });
  }
  if (isRecord(current) && current.schemaVersion === 5) {
    const placed = isRecord(current.web) && Object.hasOwn(current.web, "axialOffset");
    current = replaceKeys(current, {
      schemaVersion: { schemaVersion: 6 },
      ...(placed ? { web: { web: replaceKeys(current.web, { axialOffset: { axialOffset: current.web.axialOffset, hubTaper: 0, rimTaper: 0 } }) } } : {})
    });
  }
  return current;
}

/** Version 3 to 4 with the same geometry; a description whose sizes cannot be read is left as it is. */
function upgradeVersion3(input) {
  const { rim, flanges, web, hub } = input;
  const flangeThickness = (side) => isRecord(flanges) && isRecord(flanges[side]) ? flanges[side].axialThickness : 0;
  const sizes = [rim?.width, flangeThickness("lower"), flangeThickness("upper"), web?.axialThickness, web?.axialOffset, hub?.lowerExtension, hub?.upperExtension];
  if (!isRecord(rim) || !isRecord(web) || !isRecord(hub) || !sizes.every(Number.isFinite)) return input;
  const faceLowerZ = -rim.width / 2 - flangeThickness("lower");
  const faceUpperZ = rim.width / 2 + flangeThickness("upper");
  const webLowerZ = web.axialOffset - web.axialThickness / 2;
  const webUpperZ = web.axialOffset + web.axialThickness / 2;
  // a web against a face keeps that face; any other is centred with its shift
  const alignment = sameLevel(webLowerZ, faceLowerZ) ? "lower" : sameLevel(webUpperZ, faceUpperZ) ? "upper" : "center";
  const placement = {
    thinning: tidy(faceUpperZ - faceLowerZ - web.axialThickness),
    alignment,
    axialOffset: alignment === "center" ? tidy(web.axialOffset - (faceLowerZ + faceUpperZ) / 2) : 0
  };
  return replaceKeys(input, {
    schemaVersion: { schemaVersion: 4 },
    web: { web: replaceKeys(web, { axialThickness: placement, axialOffset: {} }) },
    hub: {
      hub: replaceKeys(hub, {
        lowerExtension: { lowerExtension: tidy(hub.lowerExtension - flangeThickness("lower")) },
        upperExtension: { upperExtension: tidy(hub.upperExtension - flangeThickness("upper")) }
      })
    }
  });
}

const sameLevel = (a, b) => Math.abs(a - b) < 1e-9;
// differences of decimal sizes: 2 − 0.8 gives 1.2, not 1.2000000000000002
const tidy = (value) => Math.round(value * 1e9) / 1e9;

/** Copy of an object where each key of `replacements` is replaced, in place, by the keys of its value. */
function replaceKeys(object, replacements) {
  const result = {};
  for (const [key, value] of Object.entries(object)) Object.assign(result, Object.hasOwn(replacements, key) ? replacements[key] : { [key]: value });
  return result;
}

function buildAnchors(input, derived) {
  const halfWidth = input.rim.width / 2;
  return {
    axis: { origin: [0, 0, 0], direction: [0, 0, 1] },
    radii: {
      bore: derived.boreRadius,
      hub: derived.hubRadius,
      rimInner: derived.rimInnerRadius,
      hubWeb: derived.hubWebRadius,
      rimInnerWeb: derived.rimInnerWebRadius,
      root: derived.rootRadius,
      outside: derived.outsideRadius,
      pitch: derived.pitchRadius
    },
    zLevels: {
      lowerHub: derived.hubLowerZ,
      // far face of the flange, null without it
      lowerFlange: input.flanges.lower ? -halfWidth - input.flanges.lower.axialThickness : null,
      rimLower: -halfWidth,
      webLower: derived.webLowerZ,
      webUpper: derived.webUpperZ,
      rimUpper: halfWidth,
      upperFlange: input.flanges.upper ? halfWidth + input.flanges.upper.axialThickness : null,
      upperHub: derived.hubUpperZ
    }
  };
}

function validateStatic(input, diagnostics) {
  exactObject(input, ROOT_FIELDS, "", diagnostics, OPTIONAL_ROOT_FIELDS);
  if (isRecord(input) && Object.hasOwn(input, "generator") && typeof input.generator !== "string") {
    schemaError(diagnostics, "/generator", "type", { type: "string" });
  }
  enumeration(input.kind, PART_KINDS, "/kind", diagnostics);
  constant(input.units, "mm", "/units", diagnostics);

  // the fields of a rim depend on the kind: with an unknown kind there is nothing to check them against
  if (!PART_KINDS.includes(input.kind)) {
    if (!isRecord(input.rim)) schemaError(diagnostics, "/rim", "object");
  } else if (exactObject(input.rim, rimFields(input.kind, input.rim), "/rim", diagnostics)) {
    if (input.kind === "idlerPulley") {
      numberRange(input.rim.outerDiameter, 5, 150, "/rim/outerDiameter", diagnostics);
    } else if (input.kind === "gear") {
      numberRange(input.rim.module, 0.3, 10, "/rim/module", diagnostics);
      integerRange(input.rim.toothCount, 6, 200, "/rim/toothCount", diagnostics);
      numberRange(input.rim.pressureAngle, 14.5, 30, "/rim/pressureAngle", diagnostics);
      numberRange(input.rim.profileShift, -1, 1, "/rim/profileShift", diagnostics);
      numberRange(input.rim.backlash, 0, 1, "/rim/backlash", diagnostics);
      enumeration(input.rim.helix, HELICES, "/rim/helix", diagnostics);
      if (input.rim.helix !== "none") numberRange(input.rim.helixAngle, -45, 45, "/rim/helixAngle", diagnostics);
    } else {
      constant(input.rim.profile, "gt2-2mm-experimental-v1", "/rim/profile", diagnostics);
      integerRange(input.rim.toothCount, 14, 120, "/rim/toothCount", diagnostics);
    }
    numberRange(input.rim.width, 2, 50, "/rim/width", diagnostics);
    numberRange(input.rim.radialThickness, 1, 25, "/rim/radialThickness", diagnostics);
  }
  if (exactObject(input.flanges, FLANGES_FIELDS, "/flanges", diagnostics)) {
    for (const side of FLANGES_FIELDS) {
      // a flange past the tooth tips would stop the mating gear
      if (input.kind === "gear" && input.flanges[side] !== null) constant(input.flanges[side], null, `/flanges/${side}`, diagnostics);
      else validateFlange(input.flanges[side], `/flanges/${side}`, diagnostics);
    }
  }
  if (isRecord(input.web)) {
    const fields = { spokes: SPOKE_WEB_FIELDS, none: NO_WEB_FIELDS }[input.web.type] ?? SOLID_WEB_FIELDS;
    if (exactObject(input.web, fields, "/web", diagnostics)) {
      enumeration(input.web.type, ["solid", "spokes", "none"], "/web/type", diagnostics);
      if (input.web.type !== "none") {
        numberRange(input.web.thinning, 0, 59, "/web/thinning", diagnostics);
        enumeration(input.web.alignment, WEB_ALIGNMENTS, "/web/alignment", diagnostics);
        numberRange(input.web.axialOffset, -60, 60, "/web/axialOffset", diagnostics);
        numberRange(input.web.hubTaper, 0, 60, "/web/hubTaper", diagnostics);
        numberRange(input.web.rimTaper, 0, 60, "/web/rimTaper", diagnostics);
      }
      if (input.web.type === "spokes") {
        integerRange(input.web.count, 3, 12, "/web/count", diagnostics);
        numberRange(input.web.width, 1, 20, "/web/width", diagnostics);
        numberRange(input.web.filletRadius, 0.5, 10, "/web/filletRadius", diagnostics);
      }
    }
  } else schemaError(diagnostics, "/web", "object");

  if (exactObject(input.hub, HUB_FIELDS, "/hub", diagnostics)) {
    numberRange(input.hub.outerDiameter, 2, 100, "/hub/outerDiameter", diagnostics);
    // a negative extension ends the hub inside the flange zone, the thickest flange at most
    numberRange(input.hub.lowerExtension, -5, 50, "/hub/lowerExtension", diagnostics);
    numberRange(input.hub.upperExtension, -5, 50, "/hub/upperExtension", diagnostics);
  }
  if (isRecord(input.bore)) {
    const fields = BORE_FIELDS[input.bore.shape] ?? BORE_FIELDS.round;
    if (exactObject(input.bore, fields, "/bore", diagnostics)) {
      enumeration(input.bore.shape, Object.keys(BORE_FIELDS), "/bore/shape", diagnostics);
      numberRange(input.bore.diameter, 0.5, 50, "/bore/diameter", diagnostics);
      if (input.bore.shape === "polygon") integerRange(input.bore.sides, 3, 12, "/bore/sides", diagnostics);
      if (input.bore.shape === "dFlat") numberRange(input.bore.flatDistance, 0.3, 50, "/bore/flatDistance", diagnostics);
      if (input.bore.shape === "keyed") {
        numberRange(input.bore.keyWidth, 0.3, 20, "/bore/keyWidth", diagnostics);
        numberRange(input.bore.keyDepth, 0.2, 10, "/bore/keyDepth", diagnostics);
      }
    }
  } else schemaError(diagnostics, "/bore", "object");
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

// details carry the compared quantities in mm so a form can explain the conflict
function validateRelations(input, derived, diagnostics) {
  const noWeb = input.web.type === "none";
  // without a web the rim material reaches the hub, so the hub has to stay inside the tooth roots
  const span = (noWeb ? derived.rootRadius : derived.rimInnerRadius) - derived.hubRadius;
  if (!noWeb && derived.rimInnerRadius <= 0) {
    diagnostics.push(diagnostic("E_RIM_NO_INTERIOR", "error", "description", [rimSizePath(input.kind), "/rim/radialThickness"],
      { rimInnerRadius: derived.rimInnerRadius }));
  }
  if (input.kind === "gear") {
    const gear = gearGeometry(input.rim);
    if (gear.thin) {
      diagnostics.push(diagnostic("E_GEAR_TOOTH_THIN", "error", "description", ["/rim/backlash", "/rim/module", "/rim/profileShift"],
        { thickness: gear.thickness }));
    } else if (gear.closed) {
      diagnostics.push(diagnostic("E_GEAR_ROOT_CLOSED", "error", "description", ["/rim/profileShift", "/rim/toothCount", "/rim/pressureAngle"]));
    }
  }
  const { bore } = input;
  // the flat must leave the axis inside the bore, or the bore is not a loop around it
  if (bore.shape === "dFlat" && !(bore.flatDistance > bore.diameter / 2 && bore.flatDistance < bore.diameter)) {
    diagnostics.push(diagnostic("E_BORE_FLAT", "error", "description", ["/bore/flatDistance", "/bore/diameter"],
      { minimum: bore.diameter / 2, maximum: bore.diameter }));
  }
  if (bore.shape === "keyed" && bore.keyWidth >= bore.diameter) {
    diagnostics.push(diagnostic("E_BORE_KEY", "error", "description", ["/bore/keyWidth", "/bore/diameter"],
      { maximum: bore.diameter }));
  }
  if (derived.hubRadius - derived.boreOuterRadius < 1) {
    diagnostics.push(diagnostic("E_HUB_WALL", "error", "description", [...borePaths(bore), "/hub/outerDiameter"],
      { wall: derived.hubRadius - derived.boreOuterRadius, minimum: 1 }));
  }
  if (span < minimumWebSpan(input.web.type)) {
    const paths = noWeb ? ["/hub/outerDiameter", rimSizePath(input.kind)] : ["/hub/outerDiameter", "/rim/radialThickness", rimSizePath(input.kind)];
    diagnostics.push(diagnostic("E_RADIAL_ORDER", "error", "description", paths,
      { span, minimum: minimumWebSpan(input.web.type), maxHubDiameter: 2 * (derived.hubRadius + span - minimumWebSpan(input.web.type)) }));
  }
  const { faceLowerZ, faceUpperZ, webLowerZ, webUpperZ, hubLowerZ, hubUpperZ } = derived;
  if (derived.webThickness < MIN_WEB_THICKNESS) {
    diagnostics.push(diagnostic("E_WEB_THINNING", "error", "description", ["/web/thinning", "/rim/width"],
      { thickness: derived.webThickness, minimum: MIN_WEB_THICKNESS, maximum: faceUpperZ - faceLowerZ - MIN_WEB_THICKNESS }));
  } else if (webLowerZ < faceLowerZ - 1e-9 || webUpperZ > faceUpperZ + 1e-9) {
    // each check speaks only when the ones before it pass: the levels of a too thin web
    // mean little, and a hub cannot be long enough for a web outside the part
    diagnostics.push(diagnostic("E_WEB_AXIAL_RANGE", "error", "description", ["/web/axialOffset", "/web/thinning", "/web/alignment"],
      { webLowerZ, webUpperZ, faceLowerZ, faceUpperZ }));
  } else {
    // the hub carries the web, so it spans the web levels
    if (hubLowerZ > webLowerZ + 1e-9) {
      diagnostics.push(diagnostic("E_HUB_SHORT", "error", "description", ["/hub/lowerExtension", "/web/axialOffset", "/web/alignment"],
        { hubZ: hubLowerZ, webZ: webLowerZ, minimum: faceLowerZ - webLowerZ }));
    }
    if (hubUpperZ < webUpperZ - 1e-9) {
      diagnostics.push(diagnostic("E_HUB_SHORT", "error", "description", ["/hub/upperExtension", "/web/axialOffset", "/web/alignment"],
        { hubZ: hubUpperZ, webZ: webUpperZ, minimum: webUpperZ - faceUpperZ }));
    }
  }
  if (input.web.type === "spokes") {
    const { count, width, filletRadius } = input.web;
    // with no room between hub and rim E_RADIAL_ORDER already speaks for the span;
    // the fillets are then limited by the spoke width alone
    const spanKnown = span >= minimumWebSpan("spokes");
    // spokes join the hub and the rim at the web, where the cones have widened them
    const webSpan = derived.rimInnerWebRadius - derived.hubWebRadius;
    if (filletRadius > width / 2 || (spanKnown && 2 * filletRadius > webSpan)) {
      diagnostics.push(diagnostic("E_SPOKE_FILLET", "error", "description", ["/web/width", "/web/filletRadius"],
        spanKnown ? { maxByWidth: width / 2, maxBySpan: webSpan / 2 } : { maxByWidth: width / 2 }));
    }
    const available = 2 * derived.hubWebRadius * Math.sin(Math.PI / count);
    if (width + 2 * filletRadius >= available) {
      diagnostics.push(diagnostic("E_SPOKE_OVERLAP", "error", "description", ["/web/count", "/web/width", "/web/filletRadius", "/hub/outerDiameter"],
        { required: width + 2 * filletRadius, available }));
    }
  }
}

/** Bore fields that set its farthest point from the axis. */
function borePaths(bore) {
  if (bore.shape === "keyed") return ["/bore/diameter", "/bore/keyWidth", "/bore/keyDepth"];
  return ["/bore/diameter"];
}

// a solid web is plain material, so it only has to keep the hub and rim polygons apart
// (0.5 is twice the largest maxChordError), as does a hub under the tooth roots without a web;
// spokes need room for two fillets
function minimumWebSpan(webType) {
  return webType === "spokes" ? 1 : 0.5;
}

function addWarnings(input, derived, diagnostics) {
  const hubWall = derived.hubRadius - derived.boreOuterRadius;
  if (input.web.type !== "none" && input.rim.radialThickness < THIN_FEATURE) diagnostics.push(thin("/rim/radialThickness", input.rim.radialThickness));
  if (derived.webThickness < THIN_FEATURE) diagnostics.push(thin("/web/thinning", derived.webThickness));
  if (input.web.type === "spokes" && input.web.width < THIN_FEATURE) diagnostics.push(thin("/web/width", input.web.width));
  if (hubWall < THIN_FEATURE) diagnostics.push(thin("/hub/outerDiameter", hubWall));
  if (input.kind === "timingPulley") diagnostics.push(diagnostic("W_EXPERIMENTAL_PROFILE", "warning", "build", ["/rim/profile"]));
  if (input.kind === "gear") {
    const gear = gearGeometry(input.rim);
    // the limit is rounded as usual: a 20° rack gives the textbook 17 teeth for 17.1, a trace of undercut is harmless
    const minimum = Math.round(gear.undercutLimit);
    if (input.rim.toothCount < minimum) {
      diagnostics.push(diagnostic("W_GEAR_UNDERCUT", "warning", "build", ["/rim/toothCount", "/rim/profileShift"],
        { minimum, shift: 1 - input.rim.toothCount * Math.sin(gear.transversePressureAngle) ** 2 / (2 * Math.cos(gear.helix)) }));
    }
    if (gear.pointed) {
      diagnostics.push(diagnostic("W_GEAR_POINTED", "warning", "build", ["/rim/profileShift", "/rim/backlash"],
        { tipDiameter: 2 * gear.tip, fullTipDiameter: 2 * gear.fullTip }));
    }
  }
}

function derive(input) {
  const radii = rimRadii(input.kind, input.rim);
  const gear = input.kind === "gear" ? gearGeometry(input.rim) : null;
  const toothed = input.kind !== "idlerPulley";
  const outsideRadius = radii.outside;
  const noWeb = input.web.type === "none";
  const hubRadius = input.hub.outerDiameter / 2;
  // without a web the rim body goes down to the hub, and radialThickness is not used
  const rimInnerRadius = noWeb ? hubRadius : radii.root - input.rim.radialThickness;
  const boreRadius = input.bore.diameter / 2;
  const bore = boreExtents(input.bore);
  const halfWidth = input.rim.width / 2;
  // faces of the part: flange far faces, or rim ends without flanges
  const faceLowerZ = input.flanges.lower ? -halfWidth - input.flanges.lower.axialThickness : -halfWidth;
  const faceUpperZ = input.flanges.upper ? halfWidth + input.flanges.upper.axialThickness : halfWidth;
  // no web means the rim and the hub are one body over the whole height, as a web without thinning
  const { thinning, alignment, axialOffset } = noWeb ? { thinning: 0, alignment: "lower", axialOffset: 0 } : input.web;
  const webThickness = faceUpperZ - faceLowerZ - thinning;
  // each web plane is counted from its own face, so a web without thinning or shift
  // lies exactly on the faces; the mesh shares vertices only between equal levels
  const [lowerCut, upperCut] = { lower: [0, thinning], upper: [thinning, 0], center: [thinning / 2, thinning / 2] }[alignment];
  const levels = [faceLowerZ, -halfWidth, halfWidth, faceUpperZ];
  const webLowerZ = snapLevel(faceLowerZ + lowerCut + axialOffset, levels);
  const webUpperZ = snapLevel(faceUpperZ - upperCut + axialOffset, levels);
  const hubLowerZ = snapLevel(faceLowerZ - input.hub.lowerExtension, [...levels, webLowerZ, webUpperZ]);
  const hubUpperZ = snapLevel(faceUpperZ + input.hub.upperExtension, [...levels, webLowerZ, webUpperZ]);
  // the cones leave room for the spoke fillets; without a web there are none
  const tapers = planTapers({
    hubRadius, rimInnerRadius, faceLowerZ, faceUpperZ, webLowerZ, webUpperZ,
    hubTaper: noWeb ? 0 : input.web.hubTaper,
    rimTaper: noWeb ? 0 : input.web.rimTaper,
    minimumSpan: input.web.type === "spokes" ? Math.max(minimumWebSpan("spokes"), 2 * input.web.filletRadius) : minimumWebSpan(input.web.type)
  });
  // a smooth surface is exactly outsideRadius; the tooth profile is measured as built
  const surfaceBound = toothed ? Math.max(...rimSurface(input.kind, input.rim, radii).points.map(([x, y]) => Math.hypot(x, y))) : outsideRadius;
  const radialBound = Math.max(surfaceBound,
    input.flanges.lower ? outsideRadius + input.flanges.lower.radialExtension : 0,
    input.flanges.upper ? outsideRadius + input.flanges.upper.radialExtension : 0);
  return {
    // belt pitch of a timing pulley, circular pitch of a gear along the pitch circle: π·m/cos β
    pitch: input.kind === "timingPulley" ? 2 : gear ? Math.PI * gear.transverseModule : null,
    transverseModule: gear ? gear.transverseModule : null,
    // axial advance of a helical tooth over one turn, null for straight teeth
    lead: gear && gear.helix > 0 ? 2 * Math.PI * gear.pitch / Math.tan(gear.helix) : null,
    pitchRadius: radii.pitch,
    outsideRadius,
    rootRadius: radii.root,
    grooveRootRadius: input.kind === "timingPulley" ? radii.root : null,
    baseRadius: radii.base,
    rimInnerRadius,
    boreRadius,
    boreOuterRadius: bore.outerRadius,
    boreExtentX: { positive: bore.positiveX, negative: bore.negativeX },
    hubRadius,
    // radii at the web and the cones that lead to them, see taper.js
    hubWebRadius: hubRadius + tapers.hub.addition,
    rimInnerWebRadius: rimInnerRadius - tapers.rim.addition,
    hubTaper: tapers.hub,
    rimTaper: tapers.rim,
    faceLowerZ,
    faceUpperZ,
    webThickness,
    webLowerZ,
    webUpperZ,
    hubLowerZ,
    hubUpperZ,
    lowerFlangeOuterRadius: input.flanges.lower ? outsideRadius + input.flanges.lower.radialExtension : null,
    upperFlangeOuterRadius: input.flanges.upper ? outsideRadius + input.flanges.upper.radialExtension : null,
    bounds: {
      min: [-radialBound, -radialBound, Math.min(hubLowerZ, faceLowerZ)],
      max: [radialBound, radialBound, Math.max(hubUpperZ, faceUpperZ)]
    }
  };
}

/** A level within rounding of a rim end or a face is that level: 5.7 − 1.2 is not quite 4.5. */
function snapLevel(z, levels) {
  return levels.find((level) => Math.abs(z - level) < 1e-9) ?? z;
}

function normalize(input) {
  const flange = (value) => value === null ? null : {
    axialThickness: value.axialThickness,
    radialExtension: value.radialExtension
  };
  const web = input.web.type === "none" ? { type: "none" } : {
    type: input.web.type,
    thinning: input.web.thinning,
    alignment: input.web.alignment,
    axialOffset: input.web.axialOffset,
    hubTaper: input.web.hubTaper,
    rimTaper: input.web.rimTaper
  };
  if (input.web.type === "spokes") Object.assign(web, {
    count: input.web.count,
    width: input.web.width,
    filletRadius: input.web.filletRadius
  });
  const bore = { shape: input.bore.shape, diameter: input.bore.diameter };
  for (const field of BORE_FIELDS[input.bore.shape].slice(2)) bore[field] = input.bore[field];
  // every rim field is a checked scalar, the GT2 profile name included
  const rim = Object.fromEntries(rimFields(input.kind, input.rim).map((field) => [field, input.rim[field]]));
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: input.kind,
    units: "mm",
    rim,
    flanges: { lower: flange(input.flanges.lower), upper: flange(input.flanges.upper) },
    web,
    hub: {
      outerDiameter: input.hub.outerDiameter,
      lowerExtension: input.hub.lowerExtension,
      upperExtension: input.hub.upperExtension
    },
    bore,
    generation: { maxChordError: input.generation.maxChordError }
  };
}

function exactObject(value, fields, path, diagnostics, optional = []) {
  if (!isRecord(value)) {
    schemaError(diagnostics, path, "object");
    return false;
  }
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) schemaError(diagnostics, `${path}/${field}`, "required");
  }
  for (const field of Object.keys(value)) {
    if (!fields.includes(field) && !optional.includes(field)) schemaError(diagnostics, `${path}/${field}`, "additionalProperty");
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
  return { ok: false, schemaVersion: SCHEMA_VERSION, normalized: null, derived: null, anchors: null, diagnostics };
}

function thin(path, value) {
  return diagnostic("W_THIN_FEATURE", "warning", "print", [path], { value, recommended: THIN_FEATURE });
}

export function diagnostic(code, severity, phase, paths, details) {
  return { code, severity, phase, paths, ...(details ? { details } : {}) };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
