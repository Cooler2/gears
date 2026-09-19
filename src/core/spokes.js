// Gears — (c) 2026 Ivan Polyacov, Elastic License 2.0, see LICENSE
import { circleSegmentCount } from "./contours.js";

/**
 * Plan straight spokes with tangent fillets in the XY plane.
 *
 * Spoke k lies on the ray at clockwise angle 2πk/count from +Y. In the local
 * spoke frame u runs along that ray away from the axis and v is perpendicular
 * to it, positive towards increasing clockwise angle. The side with v > 0 is
 * called leading, the mirrored side with v < 0 trailing.
 *
 * Every side is a chain from the hub to the rim:
 *
 *   T1 on the hub circle → hub fillet arc → T2, start of the straight side
 *   → T3, end of the straight side → rim fillet arc → T4 on the rim circle.
 *
 * Both fillet circles have radius R_f and their centres lie at v = B/2 + R_f:
 * the hub fillet touches the hub circle from outside, the rim fillet touches
 * the rim circle from inside. T1 and T4 lie on the rays through these centres.
 *
 * T1 and T4 must be vertices of the shared hub and rim loops, so the caller
 * marks them there (see the returned angles) and a chain contains only the
 * points strictly between T1 and T4.
 */
export function layoutSpokes({ count, width, filletRadius, hubRadius, rimRadius, maxChordError }) {
  const centerV = width / 2 + filletRadius;
  const hubCenterU = Math.sqrt((hubRadius + filletRadius) ** 2 - centerV ** 2);
  const rimCenterU = Math.sqrt((rimRadius - filletRadius) ** 2 - centerV ** 2);
  const maxStep = 2 * Math.PI / circleSegmentCount(filletRadius, maxChordError);

  // arc directions are measured in the local frame as atan2(v, u) around the centre
  const hubFillet = arcPoints([hubCenterU, centerV], filletRadius, Math.atan2(-centerV, -hubCenterU), -Math.PI / 2, maxStep);
  const rimFillet = arcPoints([rimCenterU, centerV], filletRadius, -Math.PI / 2, Math.atan2(centerV, rimCenterU), maxStep);
  // with 2R_f = R_i − R_h the straight part vanishes and T2 coincides with T3
  const hasStraightPart = rimCenterU - hubCenterU > 1e-9 * rimRadius;
  const localChain = [
    ...hubFillet.points.slice(1),
    ...rimFillet.points.slice(hasStraightPart ? 0 : 1, -1)
  ];

  const hubTangentAngle = Math.atan2(centerV, hubCenterU);
  const rimTangentAngle = Math.atan2(centerV, rimCenterU);
  // Near T4 the rim circle and the rim fillet bend the same way. The rim chord
  // leaving T4 across the spoke deviates from the common tangent by half its
  // central angle, the fillet chord by half the fillet step. An extra rim vertex
  // at rimGuardAngle keeps the rim chord shallower, so the discretised fillet
  // never crosses the discretised rim circle.
  const rimGuardAngle = rimTangentAngle - Math.min(rimFillet.step, rimTangentAngle) / 2;

  const spokes = Array.from({ length: count }, (_, index) => {
    const axisAngle = 2 * Math.PI * index / count;
    return {
      axisAngle,
      leading: localChain.map(([u, v]) => toGlobal(axisAngle, u, v)),
      trailing: localChain.map(([u, v]) => toGlobal(axisAngle, u, -v))
    };
  });
  // fillet centres in the local frame of every spoke, leading side (mirror v for trailing)
  const fillets = { hubCenter: [hubCenterU, centerV], rimCenter: [rimCenterU, centerV] };
  return { hubTangentAngle, rimTangentAngle, rimGuardAngle, fillets, spokes };
}

/** Points of a circular arc from direction `from` to `to` (radians), both ends included. */
function arcPoints([centerU, centerV], radius, from, to, maxStep) {
  const steps = Math.max(1, Math.ceil(Math.abs(to - from) / maxStep - 1e-9));
  const points = Array.from({ length: steps + 1 }, (_, index) => {
    const angle = from + (to - from) * index / steps;
    return [centerU + radius * Math.cos(angle), centerV + radius * Math.sin(angle)];
  });
  return { points, step: Math.abs(to - from) / steps };
}

/** Convert local spoke coordinates to XY; the axis is at clockwise angle axisAngle from +Y. */
function toGlobal(axisAngle, u, v) {
  const sine = Math.sin(axisAngle);
  const cosine = Math.cos(axisAngle);
  return [u * sine + v * cosine, u * cosine - v * sine];
}
