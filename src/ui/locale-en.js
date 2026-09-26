// Gears — (c) 2026 Ivan Polyacov (ivan@apus-software.com), Elastic License 2.0, see LICENSE
// English texts of the page. The keys are the same as in locale-ru.js, a test checks it.
import { formatNumber as n } from "./format.js";
import { isBevel, isGear, isIdler, isInclined, isSpokes } from "./part.js";

/** The rim of the kind in words: a toothed part of a pulley, a gear rim or a smooth rim. */
function rimWord(description) {
  if (isIdler(description)) return "rim";
  return isGear(description) ? "gear rim" : "toothed part";
}

/** The faces of the part in words: flange far faces, or rim ends where there is no flange. */
function faceWords(description, side) {
  const end = `the ${side} end of the ${rimWord(description)}`;
  return isGear(description) ? end : `the ${side} flange, or ${end} without it`;
}

const plural = (count, one, many) => count === 1 ? one : many;

export default {
  units: { mm: "mm", deg: "°" },

  kinds: {
    timingPulley: { title: "GT2 pulley", text: "A toothed pulley for a GT2 belt with a 2 mm pitch." },
    idlerPulley: { title: "Smooth pulley", text: "A roller without teeth: a belt tensioner or an idler." },
    gear: { title: "Gear", text: "Involute teeth: straight, helical or herringbone. The gears of a pair must have the same module, pressure angle and helix angle." },
    bevelGear: { title: "Bevel gear", text: "Straight teeth on a cone, for shafts at an angle, usually 90°. The gears of a pair must have the same module, pressure angle and shaft angle; each one is set with the tooth count of the other." }
  },

  groups: {
    presets: "Presets",
    rim: (description) => isIdler(description) ? "Belt and rim" : isGear(description) ? "Teeth" : "Belt and teeth",
    flanges: "Flanges",
    web: "Web and spokes",
    hub: "Hub",
    bore: "Shaft bore",
    generation: "Model accuracy"
  },

  fields: {
    "/rim/module": {
      label: "Module",
      hint: (description) => isBevel(description)
        ? "Tooth size at the large end, which is the lower face: the pitch diameter there is mN, the pitch πm. Towards the apex of the cone the teeth get smaller. The gears of a pair must have the same module."
        : isInclined(description)
        ? "Tooth size across the tooth (normal module): the tooth height and thickness are those of a spur gear of this module, while the pitch diameter is 1/cos β times larger, mN/cos β. The gears of a pair must have the same module."
        : "Tooth size: the pitch along the pitch circle is πm, the pitch diameter is mN. The gears of a pair must have the same module."
    },
    "/rim/toothCount": {
      label: "Number of teeth",
      hint: (description) => isBevel(description)
        ? "The gear ratio of a pair is the ratio of their tooth counts. The mating gear is made with this count and the count of the mating gear swapped."
        : isGear(description)
        ? "The gear ratio of a pair is the ratio of their tooth counts."
        : "Grooves for the teeth of a GT2 belt with a 2 mm pitch. The pitch diameter is 2N/π."
    },
    "/rim/mateToothCount": {
      label: "Teeth of the mating gear",
      hint: "Together with the shaft angle it sets the pitch cone: tan δ = sin Σ / (N₂/N + cos Σ). Two equal gears at 90° have 45° cones. The drawing shows the pitch cones of the pair."
    },
    "/rim/shaftAngle": {
      label: "Shaft angle",
      hint: "Between the axes of the two gears, usually 90°; both gears of a pair have the same. The pitch cone angles of the pair add up to it."
    },
    "/rim/pressureAngle": {
      label: "Pressure angle",
      hint: (description) => "Slope of the tooth flanks at the pitch circle. The standard is 20°; both gears of a pair must have the same." +
        (isInclined(description) ? " For a helical tooth the angle is set across the tooth; in the transverse section on the drawing it is larger." : "")
    },
    "/rim/profileShift": {
      label: "Profile shift coefficient",
      hint: "Moves the tooth outwards by xm: it gets thicker at the root and more pointed at the tip. A positive shift removes undercut on a gear with few teeth."
    },
    "/rim/backlash": {
      label: "Tooth thinning",
      hint: "How much thinner the tooth is than nominal along the pitch circle, equally on both flanks. The backlash of a pair is the sum of the thinnings of both gears; 0.1–0.2 mm is usual for printing."
    },
    "/rim/helix": {
      label: "Teeth",
      options: { none: "Straight", helical: "Helical", herringbone: "Herringbone" },
      hint: "Helical teeth mesh more smoothly and quietly than straight ones but push the shaft along its axis. " +
        "Herringbone is two helical halves facing each other, so the axial forces cancel. The sign of the angle sets the hand."
    },
    "/rim/helixAngle": {
      label: "Helix angle",
      hint: "Between the tooth and the axis on the pitch cylinder. Plus is right-hand: the teeth rise counter-clockwise like a right-hand thread; minus is left-hand. For herringbone the sign refers to the lower half. " +
        "A pair has the same magnitude and opposite signs: +20 meshes with −20. A herringbone gear with the opposite sign is the same part turned over. Usually 15–30°, up to 45° for herringbone; a larger angle runs smoother and pushes harder along the axis."
    },
    "/rim/outerDiameter": {
      label: "Rim diameter",
      hint: "The smooth cylindrical surface the belt runs on."
    },
    "/rim/width": {
      label: (description) => isIdler(description) ? "Rim width" : isGear(description) ? "Face width" : "Toothed width",
      hint: (description) => isBevel(description)
        ? "Height of the teeth along the axis, from the large end at the bottom towards the apex of the cone, where the teeth shrink. The gears of a pair need teeth of the same length along the cone, which is shown under the fields; usually at most a third of the cone distance. Hub extensions are not included."
        : isGear(description)
        ? "Tooth length along the axis. Hub extensions are not included."
        : "Usually 0.5–1 mm wider than the belt. Flanges and hub extensions are not included."
    },
    "/rim/radialThickness": {
      // a radial size: "width" and "thickness" are both read as the size along the axis
      label: (description) => isIdler(description) ? "Rim wall" : isGear(description) ? "Rim under the teeth" : "Rim under the grooves",
      hint: (description) => isIdler(description)
        ? "The ring of material under the rim surface, radially inwards to the web or the spokes."
        : isBevel(description)
        ? "The ring of material under the teeth of the small end, the upper one: radially from its root circle inwards to the web or the spokes. Towards the large end the ring gets thicker."
        : `The ring of material under the ${isGear(description) ? "teeth" : "grooves"}: radially from the ${isGear(description) ? "root circle" : "groove bottoms"} inwards to the web or the spokes.`
    },
    "/flanges/lower": {
      label: "Lower flange",
      hint: (description) => `A lip below the ${isIdler(description) ? "rim" : "toothed part"} that keeps the belt from slipping off downwards.`
    },
    "/flanges/lower/axialThickness": {
      label: "Lower flange thickness",
      hint: (description) => `Along the axis, down from the lower end of the ${rimWord(description)}.`
    },
    "/flanges/lower/radialExtension": {
      label: "Lower flange height",
      hint: (description) => `How far the flange rises above ${isIdler(description) ? "the rim surface" : "the tooth tips"}.`
    },
    "/flanges/upper": {
      label: "Upper flange",
      hint: (description) => isIdler(description)
        ? "A lip above the rim. It is printed as an overhang above the rim."
        : "A lip above the toothed part. It is printed as an overhang above the teeth."
    },
    "/flanges/upper/axialThickness": {
      label: "Upper flange thickness",
      hint: (description) => `Along the axis, up from the upper end of the ${rimWord(description)}.`
    },
    "/flanges/upper/radialExtension": {
      label: "Upper flange height",
      hint: (description) => `How far the flange rises above ${isIdler(description) ? "the rim surface" : "the tooth tips"}.`
    },
    "/web/type": {
      label: (description) => `Between the ${isGear(description) ? "gear rim" : "rim"} and the hub`,
      options: { solid: "Solid", spokes: "Spokes", none: "No web" },
      hint: (description) => `A solid disc, straight spokes with fillets or nothing: without a web the ${isIdler(description) ? "rim sits" : "teeth sit"} right on the hub, like a small gear on a shaft.`
    },
    "/web/thinning": {
      label: (description) => isSpokes(description) ? "Spoke thinning" : "Web thinning",
      hint: (description) => isGear(description)
        ? "How much thinner the web is than the gear rim. Zero is a solid body over the whole width."
        : "How much thinner the web is than the part with its flanges. Zero is a web over the whole height, flush with the flanges."
    },
    "/web/alignment": {
      label: (description) => isSpokes(description) ? "Spokes aligned to" : "Web aligned to",
      options: { lower: "Bottom", center: "Centre", upper: "Top" },
      hint: "Bottom gives a flat base for printing: the web lies in one plane with the lower flange or end and the hub."
    },
    "/web/axialOffset": {
      label: (description) => isSpokes(description) ? "Spoke offset" : "Web offset",
      hint: "From the chosen position, plus is up. Usually zero; the web cannot go beyond the bottom and the top of the part."
    },
    "/web/count": {
      label: "Number of spokes",
      hint: "The spokes are evenly spaced. Two spokes are not supported."
    },
    "/web/width": {
      label: "Spoke width",
      hint: "Across the spoke, on the straight part between the fillets."
    },
    "/web/filletRadius": {
      label: "Fillet radius",
      hint: (description) => `A smooth blend of the spoke into the hub and the ${isGear(description) ? "gear rim" : "rim"}. At most half the spoke width.`
    },
    "/hub/outerDiameter": {
      label: "Hub diameter",
      hint: "Outer diameter of the cylindrical hub around the bore."
    },
    "/hub/lowerExtension": {
      label: "Hub extension down",
      hint: (description) => `Below ${faceWords(description, "lower")}. Zero is flush, minus makes the hub shorter.`
    },
    "/hub/upperExtension": {
      label: "Hub extension up",
      hint: (description) => `Above ${faceWords(description, "upper")}. Zero is flush, minus makes the hub shorter.`
    },
    "/bore/shape": {
      label: "Bore shape",
      options: { round: "Round", polygon: "Polygon", dFlat: "D-shaped", keyed: "Keyway" },
      hint: "A through hole for the shaft. On the drawing the flat, the keyway and one side of the polygon face right."
    },
    "/bore/diameter": {
      label: (description) => description.bore?.shape === "polygon" ? "Circumscribed diameter" : "Bore diameter",
      hint: (description) => description.bore?.shape === "polygon"
        ? "The circle through all the corners. With an even number of sides it is the size across opposite corners."
        : "Add the clearance yourself: a printed hole usually comes out smaller."
    },
    "/bore/sides": {
      label: "Number of sides",
      hint: "A regular polygon: 4 is a square, 6 a hexagon."
    },
    "/bore/flatDistance": {
      label: "Size across the flat",
      hint: "From the flat to the opposite side of the bore. More than half the diameter and less than the diameter."
    },
    "/bore/keyWidth": {
      label: "Keyway width",
      hint: "Key width plus clearance. Less than the bore diameter."
    },
    "/bore/keyDepth": {
      label: "Keyway depth",
      hint: "From the bore circle to the bottom of the keyway, along its centre line. Key tables call it the hub keyway depth t₂."
    },
    "/generation/maxChordError": {
      label: "Chord tolerance",
      hint: "How far the mesh segments may deviate from the exact circle. Smaller is smoother and makes a heavier file. It is a mesh setting, not a size of the part."
    }
  },

  presets: {
    "trial-20t.json": { title: "20 teeth, solid", text: "For a 6 mm belt: two flanges, 5 mm bore." },
    "trial-60t.json": { title: "60 teeth, spokes", text: "For a 6 mm belt: six spokes flush with the lower flange, two flanges, 5 mm bore." },
    "motor-d-flat.json": { title: "30 teeth, D-shaft", text: "For a 5 mm stepper motor shaft with a flat: 5.2 mm bore, 4.7 mm across the flat, the hub extends 4 mm up." },
    "solid-basic.json": { title: "Plain solid", text: "24 teeth, no flanges, no hub extensions." },
    "asymmetric.json": { title: "Asymmetric", text: "A thin web at the lower end, an upper flange only, the hub extends above it." },
    "spokes-flanged.json": { title: "Spokes, uneven flanges", text: "60 teeth, six spokes in the middle, flanges of different thickness, the hub extends both ways: the bottom is not flat." },
    "idler-shaft.json": { title: "On a 5 mm shaft", text: "16 mm diameter for a 6 mm belt, two flanges, 5.2 mm bore." },
    "idler-bearing.json": { title: "On a 625 bearing", text: "28 mm diameter, 16 mm bore for the outer ring of a 625 bearing (5×16×5), two flanges." },
    "idler-spokes.json": { title: "Large, spokes", text: "40 mm diameter for a 9 mm belt, five spokes flush with the lower flange, the hub extends up." },
    "gear-keyed-20t.json": { title: "20 teeth, keyway", text: "Module 2, 44 mm diameter, 10 mm wide, 8 mm bore with a 3 mm keyway." },
    "gear-pinion-12t.json": { title: "12 teeth, no web", text: "Module 1 with a 0.3 shift: teeth right on the hub, 5 mm D-shaft." },
    "gear-motor-12t.json": { title: "12 teeth, motor pinion", text: "Module 1.5 with a 0.3 shift against undercut, 5 mm D-shaft, the hub extends 5 mm up." },
    "gear-spokes-60t.json": { title: "60 teeth, spokes", text: "Module 1.5, 93 mm diameter, six spokes at the lower end, the hub extends up." },
    "gear-helical-30t.json": { title: "30 teeth, helical right", text: "Module 1.5, helix +20°, 8 mm bore. The mating gear has left-hand teeth, −20°." },
    "gear-helical-15t.json": { title: "15 teeth, helical left", text: "Pairs with the right-hand 30 teeth: module 1.5, helix −20°, 5 mm D-shaft." },
    "gear-herringbone-32t.json": { title: "Herringbone, 32 teeth", text: "Module 1.5, helix +30°, 12 mm wide, 8 mm bore. The mating gear has a −30° helix." },
    "gear-herringbone-12t.json": { title: "Herringbone, 12 teeth, no web", text: "Pairs with the 32 teeth: module 1.5, helix −30°, teeth right on the hub, 5 mm D-shaft." },
    "bevel-20t.json": { title: "20 teeth for 30, 90°", text: "Module 2, 43 mm across the large end, teeth right on the hub, 5 mm D-shaft. Pairs with the 30 teeth at a right angle." },
    "bevel-30t.json": { title: "30 teeth for 20, 90°", text: "Module 2, 62 mm across the large end, solid body, 8 mm bore. Pairs with the 20 teeth: same tooth length along the cone." },
    "bevel-miter-16t.json": { title: "Miter gear, 16 teeth", text: "Two equal gears at a right angle turn the motion by 90° at 1:1: module 1.5, 45° cones, 5 mm bore." }
  },

  // the core returns only codes, paths and numeric details; every sentence a person reads is composed here
  diagnostics: {
    E_SCHEMA_VERSION: () => "The file has another format version: this version of the generator reads schemaVersion 1 to 5.",
    E_SCHEMA_VALUE: ({ rule, minimum, maximum, expected }) => {
      if (rule === "numberRange") return `A number from ${n(minimum)} to ${n(maximum)} is needed.`;
      if (rule === "integerRange") return `A whole number from ${minimum} to ${maximum} is needed.`;
      if (rule === "additionalProperty") return "An extra field that the format does not have.";
      if (rule === "required") return "A required field is missing.";
      if (rule === "const" && expected === "null") return "A gear has no flanges: they would stop the mating gear.";
      return "The value does not fit the format.";
    },
    E_RIM_NO_INTERIOR: ({ rimInnerRadius }, smooth) => (smooth ? "The rim wall is too thick for this diameter" : "The rim under the teeth is too thick for this number of teeth") +
      `: no room is left inside (inner radius ${n(rimInnerRadius)} mm).`,
    E_HUB_WALL: ({ wall, minimum }) =>
      `The hub wall around the bore is ${n(wall)} mm at its thinnest, at least ${n(minimum)} mm is needed. Make the hub larger or the bore smaller.`,
    E_BORE_FLAT: ({ minimum, maximum }) =>
      `The size across the flat must be more than half the diameter (${n(minimum)} mm) and less than the diameter (${n(maximum)} mm): otherwise the flat cuts the axis or misses the bore.`,
    E_BORE_KEY: ({ maximum }) =>
      `The keyway must be narrower than the bore: less than ${n(maximum)} mm wide.`,
    E_RADIAL_ORDER: ({ span, minimum, maxHubDiameter }, smooth, paths) => {
      // without a web the rim thickness is not involved: the hub has to stay under the tooth roots
      if (!paths.includes("/rim/radialThickness")) {
        return `The hub almost reaches the ${smooth ? "rim surface" : "tooth roots"}: ${n(span)} mm between them, at least ${n(minimum)} mm is needed. ` +
          (maxHubDiameter > 0 ? `Make the hub diameter at most ${n(maxHubDiameter)} mm.` : `Take ${smooth ? "a larger rim diameter" : "more teeth"}.`);
      }
      const rim = smooth ? ["rim", "a larger rim diameter", "a thinner rim wall"] : ["gear rim", "more teeth", "a thinner rim under the teeth"];
      return `${n(span)} mm between the hub and the ${rim[0]}, at least ${n(minimum)} mm is needed. ` +
        (maxHubDiameter > 0
          ? `Make the hub diameter at most ${n(maxHubDiameter)} mm, or take ${rim[1]} or ${rim[2]}.`
          : `Take ${rim[1]} or ${rim[2]}.`);
    },
    E_WEB_AXIAL_RANGE: ({ webLowerZ, webUpperZ, faceLowerZ, faceUpperZ }) =>
      `The web goes beyond the part: it spans ${n(webLowerZ)}…${n(webUpperZ)} mm in height, the part ${n(faceLowerZ)}…${n(faceUpperZ)} mm. Reduce the offset.`,
    E_WEB_THINNING: ({ thickness, minimum, maximum }) =>
      `The web comes out ${n(thickness)} mm thick, at least ${n(minimum)} mm is needed: thin it by at most ${n(maximum)} mm.`,
    // the lower end of the hub is above the web, or the upper one below it
    E_HUB_SHORT: ({ hubZ, webZ, minimum }) => hubZ > webZ
      ? `The hub ends above the web: its bottom is at ${n(hubZ)} mm, the bottom of the web at ${n(webZ)} mm. The hub extension down must be at least ${n(minimum)} mm.`
      : `The hub ends below the web: its top is at ${n(hubZ)} mm, the top of the web at ${n(webZ)} mm. The hub extension up must be at least ${n(minimum)} mm.`,
    E_SPOKE_FILLET: ({ maxByWidth, maxBySpan }, smooth) => maxBySpan === undefined
      ? `The fillet radius is at most half the spoke width, ${n(maxByWidth)} mm.`
      : `The fillet radius is at most ${n(Math.min(maxByWidth, maxBySpan))} mm: it is limited by half the spoke width (${n(maxByWidth)} mm) ` +
        `and half the gap between the hub and the ${smooth ? "rim" : "gear rim"} (${n(maxBySpan)} mm).`,
    E_SPOKE_OVERLAP: ({ required, available }) =>
      `The spokes with their fillets do not fit at the hub: each needs ${n(required)} mm along the hub circle, there are ${n(available)} mm. ` +
      "Reduce the number of spokes, their width or fillets, or make the hub larger.",
    E_GEAR_TOOTH_THIN: ({ thickness }) =>
      `The tooth has no material left: along the pitch circle it would be ${n(thickness)} mm thick. ` +
      "Reduce the tooth thinning, or take a larger module or profile shift.",
    E_GEAR_ROOT_CLOSED: () =>
      "Neighbouring teeth merge at the root, no space is left between them. Reduce the profile shift or the pressure angle, or take more teeth.",
    W_GEAR_UNDERCUT: ({ minimum, shift }) =>
      `Fewer than ${minimum} teeth: a real gear would have an undercut root; here it is built without the undercut and may hit the tips of the mating gear. ` +
      `Take at least ${minimum} teeth or a profile shift of ${n(Math.ceil(shift * 100) / 100)} or more.`,
    W_GEAR_POINTED: ({ tipDiameter, fullTipDiameter }) =>
      `The teeth are pointed: the tips are cut to ${n(tipDiameter)} mm diameter instead of ${n(fullTipDiameter)} mm. Reduce the profile shift or the tooth thinning.`,
    E_BEVEL_CONE: ({ coneAngle, maximum }) =>
      `The pitch cone is almost flat: its angle comes out ${n(coneAngle)}°, at most ${n(maximum)}° is supported. ` +
      "Take fewer teeth on this gear, more on the mating one, or a smaller shaft angle.",
    E_BEVEL_WIDTH: ({ maximum }) =>
      `The teeth reach too close to the apex of the cone, where they become too small to print: the face width may be at most ${n(maximum)} mm.`,
    W_BEVEL_WIDTH: ({ usual, coneDistance }) =>
      `The teeth are longer than a third of the cone distance (${n(coneDistance)} mm), which is ${n(usual)} mm of face width: the small end is weak and carries little load. It will be built, but shorter teeth are usual.`,
    W_THIN_FEATURE: ({ value, recommended }) =>
      `Thinner than ${n(recommended)} mm (${n(value)} mm now): the model will be built, but check that your printer can print such a wall.`,
    W_EXPERIMENTAL_PROFILE: () =>
      "The tooth profile is experimental: the pitch and the outside diameter match the catalogue, the groove shape is confirmed by test prints only.",
    E_MESH_COMPLEXITY: () => "The mesh is too detailed. Increase the chord tolerance.",
    E_SELF_INTERSECTION: () => "The outline of the spokes or windows intersects itself. Change the spoke parameters or the chord tolerance.",
    E_DEGENERATE_TRIANGLE: () => "The build produced a degenerate triangle.",
    E_NON_MANIFOLD: () => "The built surface is not closed.",
    E_BUILD_INTERNAL: () => "Internal build error."
  },

  // computed sizes beside the form
  sizes: {
    title: "Computed sizes",
    previous: "for the previous parameters",
    segmentsTitle: "Segments per circle",
    circles: { bore: "bore", hub: "hub", rim: "rim", flange: "flange" },
    idlerRimInner: "Rim inner diameter",
    rimInner: "Rim inner diameter",
    pitchDiameter: "Pitch diameter",
    tipDiameter: "Tip diameter",
    rootDiameter: "Root diameter",
    baseDiameter: "Base diameter",
    largePitchDiameter: "Pitch diameter of the large end",
    largeTipDiameter: "Tip diameter of the large end",
    smallRootDiameter: "Root diameter of the small end",
    coneAngle: "Pitch cone angle",
    mateConeAngle: "Pitch cone angle of the mating gear",
    coneDistance: "Cone distance of the large end",
    faceLength: "Tooth length along the cone",
    apexHeight: "Cone apex above the lower face",
    virtualTeeth: "Teeth of the virtual gear, N/cos δ",
    pitch: "Circular pitch",
    transversePitch: "Transverse circular pitch",
    transverseModule: "Transverse module",
    lead: "Lead of the tooth helix",
    pulleyOutside: "Outside diameter",
    grooveRoot: "Groove bottom diameter",
    lowerFlange: "Lower flange diameter",
    upperFlange: "Upper flange diameter",
    height: "Overall height",
    spokeThickness: "Spoke thickness",
    webThickness: "Web thickness",
    hubToRim: (smooth) => `Gap between the hub and the ${smooth ? "rim" : "gear rim"}`,
    webFrom: "Web in height, from",
    hubFrom: "Hub in height, from",
    upTo: "to",
    hubWall: "Hub wall at its thinnest",
    inscribed: "Inscribed diameter",
    inscribedFlats: "Inscribed diameter, across the flats",
    keyway: "From the bore wall to the keyway bottom, d + t"
  },

  drawings: {
    plan: "Cross section through the web",
    section: "Axial section",
    tooth: "Teeth close up",
    helix: "Teeth from the side",
    cone: "Pitch cones of the pair",
    apex: "apex",
    mate: "mating gear",
    coneAngle: "pitch cone",
    backCone: "virtual gear on the back cone, to scale",
    chord: "Chord tolerance diagram",
    pitch: (inclined) => inclined ? "transverse pitch πm/cos β" : "pitch πm",
    transverse: "transverse",
    chordLine: "mesh chord",
    exactCircle: "exact circle",
    toScale: "to scale",
    hubCloseUp: "hub close up, to scale",
    schematicSpokes: "spokes schematic: the fillets do not fit",
    spokeSection: "to scale, spokes cut along a spoke",
    transverseSection: "transverse section, to scale"
  },

  page: {
    title: (kind) => `${kind} generator`,
    bootFailed: (message) => `Could not load the schema or the examples (${message}). The page has to be served from the project root: npm run ui.`,
    errorsBadge: (count) => `${count} ${plural(count, "error", "errors")}`,
    adviceBadge: (count) => `${count} ${plural(count, "recommendation", "recommendations")}`,
    hintButton: "Explanation",
    messageButton: "Message",
    range: (range, fallback) => `Allowed ${range}, default ${fallback}.`,
    related: (label) => `See the message at the “${label}” field.`,
    blocked: (count) => `The part cannot be built yet: ${count === 1 ? "one error" : `${count} errors`}.`,
    consistent: "The sizes agree, the part can be built.",
    presetsLead: "Start from a preset: it replaces the current parameters, which you can then change in any section. To go on with the current ones, open any section.",
    keepShaft: "Keep the current hub and bore — for a part on the same shaft",
    newPart: "New",
    newPartText: "All sizes by default."
  },

  preview: {
    tags: { fresh: "current parameters", building: "building…", invalid: "outdated", failed: "not built", crashed: "failure" },
    previousShown: " The model for the previous parameters is shown.",
    timeout: (seconds) => `no answer in ${seconds} s`,
    building: (shown) => shown ? "Building the model for the new parameters…" : "Building the model…",
    invalid: (shown) => shown ? "The model for the previous parameters: the current ones have errors, shown at the fields." : "No model: fix the errors in the sizes.",
    failed: (previous) => `The core could not build the mesh, the reason is in the messages at the fields.${previous}`,
    crashed: (cause, previous) => `The background computation failed (${cause}).${previous} If a retry does not help, save the JSON: it reproduces the failure.`,
    canvas: (tag) => `3D model of the part, ${tag}`,
    noWebgl: (fresh, overlay) => `3D view is unavailable: the browser gave no WebGL. ${fresh ? "The model is built, the STL can be downloaded." : overlay}`,
    info: (size, count, triangles, ms) => `${size} mm · ${triangles} ${plural(count, "triangle", "triangles")} · built in ${ms} ms`,
    stlReady: "The mesh for the current parameters, standing on the bed on its bottom face",
    stlBlocked: {
      building: "The model for the current parameters is still being built.",
      invalid: "The sizes have errors. The previous model is not downloaded, so it is not mistaken for the current one.",
      failed: "The model for the current parameters was not built, the reason is in the messages at the fields.",
      crashed: "The background computation failed. Press “Retry”."
    }
  },

  notices: {
    newPart: (kind, keptShaft) => `New part “${kind}”: default sizes${keptShaft ? ", the hub and the bore kept" : ""}.`,
    presetLoaded: (title, keptShaft) => `Variant “${title}” loaded${keptShaft ? ", the hub and the bore kept" : ""}.`,
    fixFormatFirst: "Fix the fields with format errors first: only a description that can be read back is saved.",
    saved: (ok) => ok ? "Description saved." : "Description saved, but its sizes have errors.",
    stlNotDownloaded: (reason) => `STL not downloaded. ${reason}`,
    stlDownloaded: "STL downloaded. The part stands on the bed on its bottom face, coordinates in millimetres.",
    fileTooBig: (name, kilobytes) => `“${name}” is too large for a part description (${kilobytes} KB).`,
    notJson: (name) => `“${name}” is not JSON.`,
    unfit: (name, path, text) => `“${name}” does not fit: ${path || "root"} — ${text}`,
    opened: (name) => `Opened “${name}”.`,
    confirmReset: "Reset all parameters to their defaults?"
  }
};
