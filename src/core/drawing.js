// Gears — (c) 2026 Ivan Polyacov (ivan@apus-software.com), Elastic License 2.0, see LICENSE
import { buildBoreContour } from "./contours.js";
import { rimSurface } from "./rims.js";
import { layoutSpokes } from "./spokes.js";

// fillets and the bore are drawn smoother than the mesh needs, independent of maxChordError
const DRAWING_CHORD_ERROR = 0.005;

/**
 * Exact XY geometry for explanatory drawings, without building a mesh.
 *
 * Works for every structurally valid description, including one that breaks a
 * relation rule, so a form can show the conflict. Coordinates follow the mesh:
 * millimetres, +Y up, angles clockwise from +Y.
 *
 * profile is the toothed working surface, null for a smooth rim: that one is the
 * circle radii.outside. The plan looks down on the part, so a bevel gear shows the
 * outline of its small end as profile, and its large end below it as
 * profileBeyond (null for other kinds); its pitch circle lies in neither. bore is the bore outline with the same orientation as the mesh loop: the flat,
 * the keyway and one polygon side face +X.
 *
 * spokes is null for a solid web. Each spoke outline is a closed polygon from the
 * hub tangent point along the leading side to the rim and back along the trailing
 * side; its hub and rim ends are straight chords inside the hub disc and under the
 * spoke root, so filling the outline together with the hub and rim gives the exact
 * material. When the fillets cannot exist (a broken rule) the spokes fall back to
 * plain strips and schematic is true; if even strips do not fit they are omitted.
 */
export function buildPlanView(normalized, derived) {
  const { kind, rim, web, flanges } = normalized;
  // a rack is drawn from rack.js directly: it has no axis to cut across
  if (kind === "rack") return null;
  const surface = kind === "idlerPulley" ? null : rimSurface(kind, rim, { outside: derived.outsideRadius }).points;
  const bevel = kind === "bevelGear";
  return {
    profile: bevel ? surface.map(([x, y]) => [x * derived.endScale, y * derived.endScale]) : surface,
    profileBeyond: bevel ? surface : null,
    bore: buildBoreContour(normalized.bore, DRAWING_CHORD_ERROR).points,
    radii: {
      bore: derived.boreRadius,
      hub: derived.hubRadius,
      rimInner: derived.rimInnerRadius,
      // at the web, where the cones have widened the hub and the rim
      hubWeb: derived.hubWebRadius,
      rimInnerWeb: derived.rimInnerWebRadius,
      root: derived.rootRadius,
      outside: derived.outsideRadius,
      pitch: bevel ? null : derived.pitchRadius
    },
    flangeRadii: {
      lower: flanges.lower ? derived.lowerFlangeOuterRadius : null,
      upper: flanges.upper ? derived.upperFlangeOuterRadius : null
    },
    spokes: web.type === "spokes" ? spokeOutlines(web, derived) : null
  };
}

function spokeOutlines(web, derived) {
  const hubRadius = derived.hubWebRadius;
  const rimRadius = derived.rimInnerWebRadius;
  const layout = layoutSpokes({ ...web, hubRadius, rimRadius, maxChordError: Math.min(DRAWING_CHORD_ERROR, web.filletRadius / 4) });
  const fits = web.filletRadius <= web.width / 2 && 2 * web.filletRadius <= rimRadius - hubRadius;
  if (fits && [layout.hubTangentAngle, layout.rimTangentAngle].every(Number.isFinite)) {
    return {
      schematic: false,
      fillets: layout.spokes.map(({ axisAngle }) => filletMarks(axisAngle, layout.fillets, web.filletRadius)),
      outlines: layout.spokes.map(({ axisAngle, leading, trailing }) => [
        onCircle(hubRadius, axisAngle + layout.hubTangentAngle),
        ...leading,
        onCircle(rimRadius, axisAngle + layout.rimTangentAngle),
        onCircle(rimRadius, axisAngle - layout.rimTangentAngle),
        ...trailing.slice().reverse(),
        onCircle(hubRadius, axisAngle - layout.hubTangentAngle)
      ])
    };
  }
  const half = web.width / 2;
  if (!(half < hubRadius && hubRadius < rimRadius)) return { schematic: true, fillets: [], outlines: [] };
  const hubU = Math.sqrt(hubRadius ** 2 - half ** 2);
  const rimU = Math.sqrt(rimRadius ** 2 - half ** 2);
  return {
    schematic: true,
    fillets: [],
    outlines: Array.from({ length: web.count }, (_, index) => {
      const axisAngle = 2 * Math.PI * index / web.count;
      return [[hubU, half], [rimU, half], [rimU, -half], [hubU, -half]].map(([u, v]) => local(axisAngle, u, v));
    })
  };
}

// Centre and arc midpoint of the four fillets of one spoke, for radius callouts.
// The hub fillet arc runs from its tangent point on the hub to the spoke side
// (direction −v from the centre), the rim fillet from the spoke side to the rim.
function filletMarks(axisAngle, { hubCenter, rimCenter }, radius) {
  const hubFrom = Math.atan2(-hubCenter[1], -hubCenter[0]);
  const rimTo = Math.atan2(rimCenter[1], rimCenter[0]);
  const marks = [];
  for (const [kind, [u, v], middle] of [["hub", hubCenter, (hubFrom - Math.PI / 2) / 2], ["rim", rimCenter, (rimTo - Math.PI / 2) / 2]]) {
    for (const side of [1, -1]) {
      marks.push({
        kind,
        side: side > 0 ? "leading" : "trailing",
        center: local(axisAngle, u, side * v),
        mid: local(axisAngle, u + radius * Math.cos(middle), side * (v + radius * Math.sin(middle)))
      });
    }
  }
  return marks;
}

function onCircle(radius, angle) {
  return [radius * Math.sin(angle), radius * Math.cos(angle)];
}

function local(axisAngle, u, v) {
  return [u * Math.sin(axisAngle) + v * Math.cos(axisAngle), u * Math.cos(axisAngle) - v * Math.sin(axisAngle)];
}
