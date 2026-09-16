// Rims of the part kinds: the only part of the geometry that depends on `kind`.
//
// Everything inside the rim (web, hub, bore) and the flanges outside it are shared.
// A rim kind gives three radii and the working surface: the outer loop of the rim
// between its end faces.
//   outside — the largest radius of the working surface; flanges start there;
//   root    — the smallest one; the rim body of radialThickness lies inside it;
//   pitch   — the belt pitch radius of a toothed rim, null when there is none.

import { buildGt2Contour, buildMarkedCircle, circleSegmentCount, rotateContour } from "./contours.js";

/** Index of the first groove centre in buildGt2Contour: it lies on the +Y ray. */
const PROFILE_START = 9;

export const RIM_FIELDS = {
  timingPulley: ["profile", "toothCount", "width", "radialThickness"],
  idlerPulley: ["outerDiameter", "width", "radialThickness"]
};

export const PART_KINDS = Object.keys(RIM_FIELDS);

export function rimRadii(kind, rim) {
  if (kind === "timingPulley") {
    const pitch = rim.toothCount / Math.PI;
    const outside = pitch - 0.254;
    return { pitch, outside, root: outside - 0.75 };
  }
  const outside = rim.outerDiameter / 2;
  return { pitch: null, outside, root: outside };
}

/** Field that sets the rim size together with radialThickness, for diagnostics. */
export function rimSizePath(kind) {
  return kind === "timingPulley" ? "/rim/toothCount" : "/rim/outerDiameter";
}

/**
 * Working surface as a clockwise loop from +Y, and the angles at which the
 * circles facing it (rim inner surface, flange edges) need vertices: at every
 * groove centre and tip of a toothed rim, so that flat rings against its
 * concave profile always triangulate. A smooth rim needs none.
 */
export function rimSurface(kind, rim, radii, maxChordError) {
  if (kind === "timingPulley") {
    return {
      points: rotateContour(buildGt2Contour(rim.toothCount, radii.outside), PROFILE_START),
      marks: Array.from({ length: 2 * rim.toothCount }, (_, index) => index * Math.PI / rim.toothCount)
    };
  }
  return { points: buildMarkedCircle(radii.outside, circleSegmentCount(radii.outside, maxChordError)).points, marks: [] };
}
