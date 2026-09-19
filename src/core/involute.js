// Gears — (c) 2026 Ivan Polyacov, Elastic License 2.0, see LICENSE
// Involute gear tooth outline in the transverse plane (perpendicular to the axis).
//
// Standard basic rack: addendum 1·m, dedendum 1.25·m, measured from the pitch
// circle and moved outwards by the profile shift x·m. The tooth thickness along
// the pitch circle is m·(π/2 + 2x·tan α) less the backlash, so two gears with
// backlash j1 and j2 at the standard centre distance have j1 + j2 of play.
//
// A helical tooth is cut by the same rack turned by the helix angle β, so module,
// pressure angle and backlash are normal ones, measured across the tooth. The
// transverse section is then an involute gear of module m/cos β and pressure angle
// atan(tan α / cos β); addendum, dedendum and the shift keep their sizes in mm, and
// the backlash along the pitch circle grows to j/cos β.
//
// A flank is an involute of the base circle from max(base, root) up to the tip.
// Below the base circle the flank continues as a radial line down to the root
// circle; real undercut (the trochoid cut by the mating rack) is not modelled,
// which is what W_GEAR_UNDERCUT warns about. There is no root fillet.
//
// Angles are clockwise from +Y, as for every other contour.

import { circleSegmentCount } from "./contours.js";

const DEGREE = Math.PI / 180;
/** Narrowest tip land kept when the flanks would meet below the tip circle, in modules. */
const MIN_LAND = 0.04;
const MAX_FLANK_SEGMENTS = 64;

const involute = (angle) => Math.tan(angle) - angle;

/** Signed helix angle in radians: positive for right-hand teeth, 0 for straight ones. */
export function helixAngleOf(rim) {
  return rim.helix && rim.helix !== "none" ? rim.helixAngle * DEGREE : 0;
}

/**
 * Radii and transverse tooth thickness of a gear rim.
 *
 * halfAngle(r) is half the angular thickness of a tooth at radius r ≥ base;
 * below the base circle the flank is radial, so it keeps halfAngle(base).
 * tip is the tip circle, lowered to where the tooth keeps a land of MIN_LAND·m
 * when the flanks meet earlier (pointed is then true). thin means the tooth has no
 * material even at the flank start; closed means neighbouring teeth touch at the root.
 */
export function gearGeometry(rim) {
  const { module, toothCount, pressureAngle, profileShift, backlash } = rim;
  const helix = Math.abs(helixAngleOf(rim)); // the section does not depend on the hand
  const transverseModule = module / Math.cos(helix);
  const angle = Math.atan(Math.tan(pressureAngle * DEGREE) / Math.cos(helix));
  const pitch = transverseModule * toothCount / 2;
  const base = pitch * Math.cos(angle);
  const root = pitch - module * (1.25 - profileShift);
  const fullTip = pitch + module * (1 + profileShift);
  const thickness = transverseModule * Math.PI / 2 + 2 * profileShift * module * Math.tan(angle) - backlash / Math.cos(helix);
  const halfAngle = (radius) => thickness / (2 * pitch) + involute(angle) - involute(Math.acos(Math.min(1, base / Math.max(radius, base))));
  const minHalfAngle = (radius) => MIN_LAND * module / (2 * radius);
  const flankStart = Math.max(root, base);

  const thin = halfAngle(flankStart) <= minHalfAngle(flankStart);
  let tip = fullTip;
  let pointed = false;
  if (!thin && halfAngle(fullTip) < minHalfAngle(fullTip)) {
    pointed = true;
    let low = flankStart;
    let high = fullTip;
    for (let step = 0; step < 60; step += 1) {
      const middle = (low + high) / 2;
      if (halfAngle(middle) < minHalfAngle(middle)) high = middle;
      else low = middle;
    }
    tip = low;
  }
  const rootHalfGap = Math.PI / toothCount - halfAngle(flankStart);
  return {
    helix,
    transverseModule,
    transversePressureAngle: angle,
    pitch,
    base,
    root,
    tip,
    fullTip,
    flankStart,
    thickness,
    halfAngle,
    pointed,
    thin,
    closed: rootHalfGap <= minHalfAngle(root),
    // fewest teeth that a standard rack does not undercut at this shift
    undercutLimit: 2 * (1 - profileShift) * Math.cos(helix) / Math.sin(angle) ** 2
  };
}

/**
 * Closed clockwise outline of all teeth, starting at the tip of the tooth on +Y.
 * Out-of-rule sizes (thin or closed teeth) still give points for drawings; such a
 * rim never reaches the mesh.
 */
export function buildGearContour(rim, maxChordError) {
  const gear = gearGeometry(rim);
  const { toothCount } = rim;
  const space = Math.PI / toothCount; // tooth centre to space centre
  const flankTop = Math.max(gear.tip, gear.flankStart);
  const rootAngle = Math.min(gear.halfAngle(gear.flankStart), space);
  const tipAngle = Math.max(0, Math.min(gear.halfAngle(flankTop), rootAngle));

  // half a tooth, from the tooth centre to just before the space centre, as [radius, angle]
  const half = [];
  arc(gear.tip, 0, tipAngle, false, half);
  for (const radius of flankRadii(gear, flankTop, maxChordError)) half.push([radius, Math.min(gear.halfAngle(radius), rootAngle)]);
  if (gear.base > gear.root) half.push([gear.root, rootAngle]);
  arc(gear.root, rootAngle, space, true, half);

  const tooth = [...half, [gear.root, space], ...half.slice(1).reverse().map(([radius, angle]) => [radius, 2 * space - angle])];
  const points = [];
  for (let index = 0; index < toothCount; index += 1) {
    const turn = 2 * space * index;
    for (const [radius, angle] of tooth) points.push([radius * Math.sin(angle + turn), radius * Math.cos(angle + turn)]);
  }
  return points;

  /** Points of an arc from `from` towards `to`, without the end; skipStart drops the first one too. */
  function arc(radius, from, to, skipStart, target) {
    const step = 2 * Math.PI / circleSegmentCount(radius, maxChordError);
    const count = Math.max(1, Math.ceil((to - from) / step - 1e-9));
    for (let index = skipStart ? 1 : 0; index < count; index += 1) target.push([radius, from + (to - from) * index / count]);
  }
}

/**
 * Flank radii from the top down to the flank start, both included. The involute
 * turns by one radian of roll per radian, with the radius of curvature base·roll,
 * so even steps in roll keep the chord error at the tip within the tolerance.
 */
function flankRadii({ base, flankStart }, top, maxChordError) {
  const roll = (radius) => Math.sqrt(Math.max(0, (radius / base) ** 2 - 1));
  const from = roll(flankStart);
  const to = roll(top);
  const step = Math.sqrt(8 * maxChordError / (base * Math.max(to, 1e-9)));
  const count = Math.min(MAX_FLANK_SEGMENTS, Math.max(2, Math.ceil((to - from) / step)));
  return Array.from({ length: count + 1 }, (_, index) => {
    const t = to - (to - from) * index / count;
    return index === 0 ? top : index === count ? flankStart : base * Math.sqrt(1 + t * t);
  });
}
