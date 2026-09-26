// Gears — (c) 2026 Ivan Polyacov (ivan@apus-software.com), Elastic License 2.0, see LICENSE
// Straight bevel gear: teeth on a cone, every line of a tooth runs to the cone apex.
//
// The pitch cone of a gear with N teeth meshing with N₂ teeth on shafts at an angle
// Σ has the half angle δ, tan δ = sin Σ / (N₂/N + cos Σ); the pitch cones of a pair
// touch along a line through their common apex. Module, pitch diameter mN and
// tooth sizes are those of the large end.
//
// The teeth follow Tredgold's approximation: the back cone, which touches the large
// end square to the pitch cone, is unrolled into a plane, and there the teeth are
// those of a spur gear of module m with N/cos δ teeth, the virtual gear. Each point
// of its outline is wrapped back onto the back cone and joined to the apex by a
// straight line; these lines are the tooth surfaces (tapered depth: tip, root and
// flanks all converge at the apex). Every section across the axis is then the same
// outline scaled towards the axis, so the working surface is a single band between
// the outlines of the two ends.
//
// The part is bounded by planes across the axis: the lower face through the tip
// circle of the large end, where the tip cone meets the back cone, and the upper
// face W above it. The lower face lies inside the back cone, so the part stays
// within the true gear; the large end only loses the sliver of the dedendum
// between the back cone and that face, which the mating gear does not touch.

import { gearGeometry, gearToothOutline } from "./involute.js";

const DEGREE = Math.PI / 180;
/** Largest pitch cone angle, degrees: a steeper cone is nearly a crown gear, whose teeth lie flat. */
export const MAX_CONE_ANGLE = 80;
/** Smallest share of the large end left at the small end, for drawings of a face width out of the rules. */
const MIN_END_SCALE = 0.05;

/** Pitch cone angle δ in radians, from the tooth counts of the pair and the shaft angle. */
export function pitchConeAngle({ toothCount, mateToothCount, shaftAngle }) {
  const shaft = shaftAngle * DEGREE;
  return Math.atan2(Math.sin(shaft), mateToothCount / toothCount + Math.cos(shaft));
}

/**
 * Cone and tooth sizes of a bevel gear rim.
 *
 * Heights are measured along the axis from the lower face towards the apex:
 * apexHeight is the apex, the small end is at rim.width. toPlane(ρ) is the radius
 * in the lower face of the tooth line through the point of the virtual gear at the
 * distance ρ from its centre; angles around the axis are those of the virtual gear
 * times angleScale. scaleAt(h) is the size of the section at the height h relative
 * to the lower face.
 *
 * A cone steeper than MAX_CONE_ANGLE, an apex below the lower face or a face width
 * past it break relation rules; the sizes are then clamped so that drawings still
 * get an outline, and such a rim never reaches the mesh.
 */
export function bevelGeometry(rim) {
  const trueCone = pitchConeAngle(rim);
  const cone = Math.min(trueCone, MAX_CONE_ANGLE * DEGREE);
  const sin = Math.sin(cone);
  const cos = Math.cos(cone);
  const pitch = rim.module * rim.toothCount / 2;
  const virtualRim = {
    module: rim.module,
    toothCount: rim.toothCount / cos,
    pressureAngle: rim.pressureAngle,
    profileShift: rim.profileShift,
    backlash: rim.backlash
  };
  const virtual = gearGeometry(virtualRim);
  // heights above the pitch circle of the large end: the apex and the tip circle on the back cone
  const pitchApex = pitch / Math.tan(cone);
  const tipLevel = (virtual.tip - virtual.pitch) * sin;
  const apexHeight = pitchApex - tipLevel;
  const safeHeight = Math.max(apexHeight, 0.1 * pitchApex);
  const toPlane = (radius) => radius * cos * safeHeight / Math.max(pitchApex - (radius - virtual.pitch) * sin, 1e-9);
  const scaleAt = (height) => Math.max(1 - height / safeHeight, MIN_END_SCALE);
  return {
    coneAngle: trueCone,
    mateConeAngle: rim.shaftAngle * DEGREE - trueCone,
    pitch,
    coneDistance: pitch / Math.sin(trueCone),
    apexHeight,
    virtualRim,
    virtual,
    angleScale: 1 / cos,
    toPlane,
    scaleAt,
    tip: toPlane(virtual.tip),
    root: toPlane(virtual.root)
  };
}

/**
 * Closed clockwise outline of the teeth in the lower face, starting at the tip of
 * the tooth on +Y. An arc of the virtual gear turned by θ becomes an arc of the
 * radius toPlane(ρ) turned by θ·angleScale, so its sagitta grows by
 * toPlane(ρ)·angleScale²/ρ; the virtual outline is made that much finer.
 */
export function buildBevelContour(rim, maxChordError) {
  const bevel = bevelGeometry(rim);
  const { virtual, toPlane, angleScale } = bevel;
  const growth = Math.max(1, ...[virtual.tip, virtual.root].map((radius) => toPlane(radius) * angleScale ** 2 / radius));
  const tooth = gearToothOutline(virtual, Math.PI / bevel.virtualRim.toothCount, maxChordError / growth);
  const points = [];
  for (let index = 0; index < rim.toothCount; index += 1) {
    const turn = 2 * Math.PI * index / rim.toothCount;
    for (const [radius, angle] of tooth) {
      const planar = toPlane(radius);
      const turned = angle * angleScale + turn;
      points.push([planar * Math.sin(turned), planar * Math.cos(turned)]);
    }
  }
  return points;
}
