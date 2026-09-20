// Gears — (c) 2026 Ivan Polyacov (ivan@apus-software.com), Elastic License 2.0, see LICENSE
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
import { buildGearContour, gearGeometry, helixAngleOf } from "./involute.js";

/** Index of the first groove centre in buildGt2Contour: it lies on the +Y ray. */
const PROFILE_START = 9;

export const RIM_FIELDS = {
  timingPulley: ["profile", "toothCount", "width", "radialThickness"],
  idlerPulley: ["outerDiameter", "width", "radialThickness"],
  gear: ["module", "toothCount", "pressureAngle", "profileShift", "backlash", "helix", "helixAngle", "width", "radialThickness"]
};
export const HELICES = ["none", "helical", "herringbone"];

/** Fields of a rim; straight gear teeth have no helix angle. */
export function rimFields(kind, rim) {
  const fields = RIM_FIELDS[kind];
  return kind === "gear" && rim?.helix === "none" ? fields.filter((field) => field !== "helixAngle") : fields;
}

/** Chord tolerance for a toothed outline measured without a mesh setting. */
const MEASURE_CHORD_ERROR = 0.01;

export const PART_KINDS = Object.keys(RIM_FIELDS);

export function rimRadii(kind, rim) {
  if (kind === "timingPulley") {
    const pitch = rim.toothCount / Math.PI;
    const outside = pitch - 0.254;
    return { pitch, outside, root: outside - 0.75, base: null };
  }
  if (kind === "gear") {
    const gear = gearGeometry(rim);
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
 *
 * points is the section at the mid-plane z = 0. sections lists the levels from
 * the lower rim end to the upper one with the clockwise turn of that section;
 * the working surface is built between neighbouring sections. Straight teeth
 * and smooth rims have just the two ends without a turn. The marks cover both
 * end sections, which the rim end rings join.
 */
export function rimSurface(kind, rim, radii, maxChordError = MEASURE_CHORD_ERROR) {
  const ends = [{ z: -rim.width / 2, turn: 0 }, { z: rim.width / 2, turn: 0 }];
  const toothMarks = () => Array.from({ length: 2 * rim.toothCount }, (_, index) => index * Math.PI / rim.toothCount);
  if (kind === "timingPulley") {
    return { points: rotateContour(buildGt2Contour(rim.toothCount, radii.outside), PROFILE_START), marks: toothMarks(), sections: ends };
  }
  if (kind === "gear") {
    const points = buildGearContour(rim, maxChordError);
    const sections = helixSections(rim, points, maxChordError);
    const endTurns = [...new Set([sections[0].turn, sections.at(-1).turn])];
    return { points, marks: endTurns.flatMap((turn) => toothMarks().map((mark) => mark + turn)), sections };
  }
  return { points: buildMarkedCircle(radii.outside, circleSegmentCount(radii.outside, maxChordError)).points, marks: [], sections: ends };
}

/**
 * Clockwise turn of the gear section at height z. A tooth follows a helix of lead
 * 2π·R_p / tan β, so a section turns by z·tan β / R_p. The sign of β is the hand:
 * a right-hand tooth (β > 0) rises counter-clockwise seen from +Z, like a right-hand
 * thread. A herringbone with β > 0 is right-hand below the mid-plane and left-hand
 * above it; turned over, it is the herringbone with −β.
 */
export function helixTurn(rim, z) {
  const helix = helixAngleOf(rim);
  if (helix === 0) return 0;
  const rate = Math.tan(helix) / gearGeometry(rim).pitch;
  return rim.helix === "herringbone" ? Math.abs(z) * rate : -z * rate;
}

/**
 * Levels of a helical working surface. A band between two sections turned by δ
 * apart departs from the true helicoid by the sagitta of the tip helix, R·δ²/8,
 * and by the twist of each quad, about δ·a/4 for a contour edge of length a; both
 * stay within maxChordError. A herringbone gets a section at the mid-plane, where
 * its halves meet.
 */
function helixSections(rim, points, maxChordError) {
  const halfWidth = rim.width / 2;
  const spans = rim.helix === "herringbone" ? [[-halfWidth, 0], [0, halfWidth]] : [[-halfWidth, halfWidth]];
  let radius = 0;
  let edge = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    radius = Math.max(radius, Math.hypot(...point));
    edge = Math.max(edge, Math.hypot(next[0] - point[0], next[1] - point[1]));
  });
  const step = Math.min(Math.sqrt(8 * maxChordError / radius), 4 * maxChordError / edge);
  const sections = [{ z: -halfWidth, turn: helixTurn(rim, -halfWidth) }];
  for (const [from, to] of spans) {
    const count = Math.max(1, Math.ceil(Math.abs(helixTurn(rim, to) - helixTurn(rim, from)) / step - 1e-9));
    for (let index = 1; index <= count; index += 1) {
      // the last level is the span end itself, so the mid-plane and the rim ends are exact
      const z = index === count ? to : from + (to - from) * index / count;
      sections.push({ z, turn: helixTurn(rim, z) });
    }
  }
  return sections;
}
