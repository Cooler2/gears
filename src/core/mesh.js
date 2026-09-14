import { buildGt2Contour, buildMarkedCircle, circleSegmentCount, rotateContour } from "./contours.js";
import { createMeshBuilder, isSimplePolygon, MeshBuildError } from "./mesh-builder.js";
import { layoutSpokes } from "./spokes.js";

const MAX_LOOP_SEGMENTS = 4096;
const MAX_TRIANGLES = 200000;
/** Index of the first groove centre in buildGt2Contour: it lies on the +Y ray. */
const PROFILE_START = 9;

/**
 * Build the closed boundary of the pulley.
 *
 * Every surface is either a vertical wall between two copies of one XY contour
 * or a flat face at one Z level (see mesh-builder.js). From the axis outwards
 * the contours are: bore R_b, hub R_h, rim inner circle R_i, tooth profile and
 * the flange edges R_o + E_f. Axially the rim spans [−W/2, +W/2], flanges add
 * their thickness outside it, the hub spans [hubLowerZ, hubUpperZ] and the web
 * [webLowerZ, webUpperZ]. Between the web levels the hub cylinder and the rim
 * inner surface are covered by the web; with spokes they stay exposed inside
 * the windows, whose walls are built from the same loop vertices.
 */
export function buildPulleyMesh(description, derived) {
  const { rim, flanges, web } = description;
  const { boreRadius, hubRadius, rimInnerRadius, outsideRadius, webLowerZ, webUpperZ, hubLowerZ, hubUpperZ } = derived;
  const maxChordError = description.generation.maxChordError;
  const rimLowerZ = -rim.toothedWidth / 2;
  const rimUpperZ = rim.toothedWidth / 2;
  // outer limits of the belt part: flange far faces or rim ends
  const shellLowerZ = flanges.lower ? rimLowerZ - flanges.lower.axialThickness : rimLowerZ;
  const shellUpperZ = flanges.upper ? rimUpperZ + flanges.upper.axialThickness : rimUpperZ;

  // Rim-side circles get a vertex at every groove centre and every tip between
  // grooves, so caps against the concave profile always triangulate.
  const halfPitchAngles = Array.from({ length: 2 * rim.toothCount }, (_, index) => index * Math.PI / rim.toothCount);
  const layout = web.type === "spokes" ? layoutSpokes({
    count: web.count,
    width: web.width,
    filletRadius: web.filletRadius,
    hubRadius,
    rimRadius: rimInnerRadius,
    maxChordError
  }) : null;
  // spoke k uses hub marks 3k..3k+2 and rim marks 4k..4k+3 (after the half-pitch marks)
  const hubMarks = layout ? layout.spokes.flatMap(({ axisAngle }) => [
    axisAngle - layout.hubTangentAngle,
    axisAngle,
    axisAngle + layout.hubTangentAngle
  ]) : [];
  const rimSpokeMarks = layout ? layout.spokes.flatMap(({ axisAngle }) => [
    axisAngle - layout.rimTangentAngle,
    axisAngle - layout.rimGuardAngle,
    axisAngle + layout.rimGuardAngle,
    axisAngle + layout.rimTangentAngle
  ]) : [];

  const circle = (radius, marks) => buildMarkedCircle(radius, circleSegmentCount(radius, maxChordError), marks);
  const flangeEdge = (flange) => flange ? circle(outsideRadius + flange.radialExtension, halfPitchAngles) : null;
  const contours = {
    bore: circle(boreRadius, []),
    hub: circle(hubRadius, hubMarks),
    rimInner: circle(rimInnerRadius, [...halfPitchAngles, ...rimSpokeMarks]),
    profile: { points: rotateContour(buildGt2Contour(rim.toothCount, outsideRadius), PROFILE_START) },
    lowerFlange: flangeEdge(flanges.lower),
    upperFlange: flangeEdge(flanges.upper)
  };
  const circles = [contours.bore, contours.hub, contours.rimInner, contours.lowerFlange, contours.upperFlange];
  if (circles.some((contour) => contour && contour.points.length > MAX_LOOP_SEGMENTS)) return complexityFailure();

  const mesh = createMeshBuilder();
  const loops = new Map();
  /** The loop of a contour at height z, created on first use and then shared. */
  const loop = (contour, z) => {
    if (!loops.has(contour)) loops.set(contour, new Map());
    const levels = loops.get(contour);
    if (!levels.has(z)) levels.set(z, mesh.addPoints(contour.points, z));
    return levels.get(z);
  };

  addHub();
  addRim();
  addFlange("lower");
  addFlange("upper");
  if (layout) addSpokes();
  else addSolidWeb();

  if (mesh.triangleCount > MAX_TRIANGLES) return complexityFailure();
  const { vertices, indices } = mesh.finish();
  return {
    ok: true,
    mesh: {
      primitive: "triangles",
      units: "mm",
      vertices,
      indices,
      bounds: calculateBounds(vertices)
    },
    contours: {
      toothVertexCount: contours.profile.points.length,
      circleSegments: {
        bore: contours.bore.points.length,
        hub: contours.hub.points.length,
        rimInner: contours.rimInner.points.length
      }
    }
  };

  /** Bore, hub end rings and the hub cylinder outside the web levels. */
  function addHub() {
    const { bore, hub } = contours;
    mesh.wall({ lower: loop(bore, hubLowerZ), upper: loop(bore, hubUpperZ), normal: "inward" });
    mesh.annulus({ inner: loop(bore, hubLowerZ), outer: loop(hub, hubLowerZ), normal: "-Z" });
    mesh.annulus({ inner: loop(bore, hubUpperZ), outer: loop(hub, hubUpperZ), normal: "+Z" });
    if (hubLowerZ < webLowerZ) mesh.wall({ lower: loop(hub, hubLowerZ), upper: loop(hub, webLowerZ), normal: "outward" });
    if (webUpperZ < hubUpperZ) mesh.wall({ lower: loop(hub, webUpperZ), upper: loop(hub, hubUpperZ), normal: "outward" });
  }

  /** Tooth surface, flangeless rim ends and the rim inner surface outside the web levels. */
  function addRim() {
    const { rimInner, profile } = contours;
    mesh.wall({ lower: loop(profile, rimLowerZ), upper: loop(profile, rimUpperZ), normal: "outward" });
    if (!flanges.lower) mesh.annulus({ inner: loop(rimInner, rimLowerZ), outer: loop(profile, rimLowerZ), normal: "-Z" });
    if (!flanges.upper) mesh.annulus({ inner: loop(rimInner, rimUpperZ), outer: loop(profile, rimUpperZ), normal: "+Z" });
    // the inner surface continues through the flanges, which are rings from R_i
    if (shellLowerZ < webLowerZ) mesh.wall({ lower: loop(rimInner, shellLowerZ), upper: loop(rimInner, webLowerZ), normal: "inward" });
    if (webUpperZ < shellUpperZ) mesh.wall({ lower: loop(rimInner, webUpperZ), upper: loop(rimInner, shellUpperZ), normal: "inward" });
  }

  /**
   * One flange: a ring from R_i to its edge, extruded away from the rim end.
   * On the rim side only the ledge outside the teeth is exposed; the area under
   * the teeth is interior material and gets no surface.
   */
  function addFlange(side) {
    if (!flanges[side]) return;
    const upper = side === "upper";
    const edge = contours[`${side}Flange`];
    const rimZ = upper ? rimUpperZ : rimLowerZ;
    const farZ = upper ? shellUpperZ : shellLowerZ;
    mesh.annulus({ inner: loop(contours.profile, rimZ), outer: loop(edge, rimZ), normal: upper ? "-Z" : "+Z" });
    mesh.annulus({ inner: loop(contours.rimInner, farZ), outer: loop(edge, farZ), normal: upper ? "+Z" : "-Z" });
    mesh.wall({ lower: loop(edge, Math.min(rimZ, farZ)), upper: loop(edge, Math.max(rimZ, farZ)), normal: "outward" });
  }

  /** A solid web is two flat rings between the hub and the rim inner circle. */
  function addSolidWeb() {
    mesh.annulus({ inner: loop(contours.hub, webLowerZ), outer: loop(contours.rimInner, webLowerZ), normal: "-Z" });
    mesh.annulus({ inner: loop(contours.hub, webUpperZ), outer: loop(contours.rimInner, webUpperZ), normal: "+Z" });
  }

  /**
   * Spokes: a flat face for every spoke at both web levels and a vertical wall
   * around every window between neighbouring spokes.
   *
   * Hub and rim loops are split at the fillet tangent points T1 and T4 into
   * spoke footprints and window arcs. A footprint arc bounds the spoke faces,
   * a window arc belongs to the window wall; each side chain of a spoke bounds
   * both its faces and the wall of the adjacent window.
   */
  function addSpokes() {
    const count = layout.spokes.length;
    const hubIndex = (spoke, side) => contours.hub.markIndices[3 * spoke + (side === "leading" ? 2 : 0)];
    const rimIndex = (spoke, side) => contours.rimInner.markIndices[halfPitchAngles.length + 4 * spoke + (side === "leading" ? 3 : 0)];
    const chains = new Map();
    /** Side chain between T1 and T4, from the hub to the rim, at height z. */
    const chain = (spoke, side, z) => {
      const key = `${spoke}:${side}:${z}`;
      if (!chains.has(key)) chains.set(key, mesh.addPoints(layout.spokes[spoke][side], z));
      return chains.get(key);
    };

    /** Counter-clockwise from +Z: hub footprint, leading side, rim footprint back, trailing side down. */
    const spokeFace = (spoke, z) => joinPath([
      loopArc(loop(contours.hub, z), hubIndex(spoke, "trailing"), hubIndex(spoke, "leading"), +1),
      chain(spoke, "leading", z),
      loopArc(loop(contours.rimInner, z), rimIndex(spoke, "leading"), rimIndex(spoke, "trailing"), -1),
      reversePath(chain(spoke, "trailing", z))
    ]);
    /** Clockwise around window k between spoke k and the next one. */
    const windowLoop = (spoke, z) => {
      const following = (spoke + 1) % count;
      return joinPath([
        loopArc(loop(contours.rimInner, z), rimIndex(spoke, "leading"), rimIndex(following, "trailing"), +1),
        reversePath(chain(following, "trailing", z)),
        loopArc(loop(contours.hub, z), hubIndex(following, "trailing"), hubIndex(spoke, "leading"), -1),
        chain(spoke, "leading", z)
      ]);
    };

    for (let spoke = 0; spoke < count; spoke += 1) {
      const lowerFace = spokeFace(spoke, webLowerZ);
      const lowerWindow = windowLoop(spoke, webLowerZ);
      // both levels share the same XY contour, so checking one level is enough
      if (!isSimplePolygon(lowerFace.points) || !isSimplePolygon(lowerWindow.points)) {
        throw new MeshBuildError("E_SELF_INTERSECTION", { rule: "spokeContour", spoke });
      }
      mesh.polygon({ loop: lowerFace, normal: "-Z" });
      mesh.polygon({ loop: spokeFace(spoke, webUpperZ), normal: "+Z" });
      mesh.wall({ lower: lowerWindow, upper: windowLoop(spoke, webUpperZ), normal: "inward" });
    }
  }
}

/** Vertices of a loop from index `from` to `to` inclusive, stepping by direction (+1 or −1). */
function loopArc(loop, from, to, direction) {
  const count = loop.ids.length;
  const ids = [];
  const points = [];
  for (let index = from; ; index = (index + direction + count) % count) {
    ids.push(loop.ids[index]);
    points.push(loop.points[index]);
    if (index === to) break;
  }
  return { ids, points };
}

function reversePath(path) {
  return { ids: [...path.ids].reverse(), points: [...path.points].reverse() };
}

function joinPath(paths) {
  return {
    ids: paths.flatMap((path) => path.ids),
    points: paths.flatMap((path) => path.points)
  };
}

export function calculateBounds(vertices) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < vertices.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], vertices[index + axis]);
      max[axis] = Math.max(max[axis], vertices[index + axis]);
    }
  }
  return { min, max };
}

function complexityFailure() {
  return { ok: false, code: "E_MESH_COMPLEXITY" };
}
