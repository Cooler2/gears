// Gears — (c) 2026 Ivan Polyacov (ivan@apus-software.com), Elastic License 2.0, see LICENSE
/**
 * Conical hub and rim at the web.
 *
 * The hub radius R_h and the rim inner radius R_i are the sizes at the faces of
 * the part. Towards the web the hub widens and the rim thickens: the surface
 * leaves the axis direction at its taper angle and reaches its web radius
 * R_h + a_h or R_i − a_r at the web plane. Past the cone the surface is the
 * cylinder again, so between the web levels both keep their web radii.
 *
 * The additions come from the angle and the lower exposed height H between the
 * web and a face of the part: a = H·tg γ, so on that side the cone ends exactly
 * at the face and on a taller side it ends before it. A web on a face leaves
 * that side out; a web through the whole height gives no cones. When the two
 * cones leave less than minimumSpan between them at the web, both additions
 * shrink in proportion: the angles stay, the cones become chamfers.
 */
export function planTapers({ hubRadius, rimInnerRadius, faceLowerZ, faceUpperZ, webLowerZ, webUpperZ, hubTaper, rimTaper, minimumSpan }) {
  const heights = [webLowerZ - faceLowerZ, faceUpperZ - webUpperZ].filter((height) => height > 1e-9);
  const exposed = heights.length ? Math.min(...heights) : 0;
  const hubSlope = Math.tan(hubTaper * Math.PI / 180);
  const rimSlope = Math.tan(rimTaper * Math.PI / 180);
  let hubAddition = exposed * hubSlope;
  let rimAddition = exposed * rimSlope;
  const room = Math.max(rimInnerRadius - hubRadius - minimumSpan, 0);
  if (hubAddition + rimAddition > room) {
    const scale = room / (hubAddition + rimAddition);
    hubAddition *= scale;
    rimAddition *= scale;
  }
  return {
    hub: { addition: hubAddition, slope: hubSlope, height: hubSlope > 0 ? hubAddition / hubSlope : 0 },
    rim: { addition: rimAddition, slope: rimSlope, height: rimSlope > 0 ? rimAddition / rimSlope : 0 }
  };
}

/**
 * Radius of a tapered surface at height z: the base radius plus (hub, sign +1)
 * or minus (rim, sign −1) what is left of the addition at that distance from the
 * web. A remainder within rounding of zero gives the base radius exactly, so the
 * loops at the faces are the untapered ones.
 */
export function taperedRadius(base, sign, taper, webLowerZ, webUpperZ, z) {
  const distance = z < webLowerZ ? webLowerZ - z : z > webUpperZ ? z - webUpperZ : 0;
  const remainder = taper.addition - distance * taper.slope;
  return remainder > 1e-9 ? base + sign * remainder : base;
}

/** Levels strictly between from and to where a cone meets the cylinder, ascending. */
export function taperBreaks(taper, webLowerZ, webUpperZ, from, to) {
  if (!(taper.addition > 1e-9)) return [];
  return [webLowerZ - taper.height, webLowerZ, webUpperZ, webUpperZ + taper.height]
    .filter((z, index, all) => z > from + 1e-9 && z < to - 1e-9 && all.indexOf(z) === index);
}
