// Rims of the part kinds: the only part of the geometry that depends on `kind`.
//
// Everything inside the rim (web, hub, bore) and the flanges outside it are shared.
// A rim kind gives four radii and the working surface: the outer loop of the rim
// between its end faces.
//   outside — the largest radius of the working surface; flanges start there;
//   root    — the smallest one; the rim body of radialThickness lies inside it;
//   pitch   — the pitch radius of a toothed rim, null when there is none;
//   base    — the base circle of an involute gear, null for the pulleys.

import { buildGt2Contour, buildMarkedCircle, circleSegmentCount, rotateContour } from "./contours.js";
import { buildSpurGearContour, spurGearGeometry } from "./involute.js";

/** Index of the first groove centre in buildGt2Contour: it lies on the +Y ray. */
const PROFILE_START = 9;

export const RIM_FIELDS = {
  timingPulley: ["profile", "toothCount", "width", "radialThickness"],
  idlerPulley: ["outerDiameter", "width", "radialThickness"],
  spurGear: ["module", "toothCount", "pressureAngle", "profileShift", "backlash", "width", "radialThickness"]
};

/** Chord tolerance for a toothed outline measured without a mesh setting. */
const MEASURE_CHORD_ERROR = 0.01;

export const PART_KINDS = Object.keys(RIM_FIELDS);

export function rimRadii(kind, rim) {
  if (kind === "timingPulley") {
    const pitch = rim.toothCount / Math.PI;
    const outside = pitch - 0.254;
    return { pitch, outside, root: outside - 0.75, base: null };
  }
  if (kind === "spurGear") {
    const gear = spurGearGeometry(rim);
    return { pitch: gear.pitch, outside: gear.tip, root: gear.root, base: gear.base };
  }
  const outside = rim.outerDiameter / 2;
  return { pitch: null, outside, root: outside, base: null };
}

/** Field that sets the rim size together with radialThickness, for diagnostics. */
export function rimSizePath(kind) {
  return kind === "idlerPulley" ? "/rim/outerDiameter" : "/rim/toothCount";
}

/**
 * Working surface as a clockwise loop from +Y, and the angles at which the
 * circles facing it (rim inner surface, flange edges) need vertices: at every
 * groove centre and tip of a toothed rim (every tooth and space centre of a
 * gear), so that flat rings against its concave profile always triangulate.
 * A smooth rim needs none.
 */
export function rimSurface(kind, rim, radii, maxChordError = MEASURE_CHORD_ERROR) {
  if (kind === "timingPulley") {
    return {
      points: rotateContour(buildGt2Contour(rim.toothCount, radii.outside), PROFILE_START),
      marks: Array.from({ length: 2 * rim.toothCount }, (_, index) => index * Math.PI / rim.toothCount)
    };
  }
  if (kind === "spurGear") {
    return {
      points: buildSpurGearContour(rim, maxChordError),
      marks: Array.from({ length: 2 * rim.toothCount }, (_, index) => index * Math.PI / rim.toothCount)
    };
  }
  return { points: buildMarkedCircle(radii.outside, circleSegmentCount(radii.outside, maxChordError)).points, marks: [] };
}
