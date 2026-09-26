// Gears — (c) 2026 Ivan Polyacov (ivan@apus-software.com), Elastic License 2.0, see LICENSE
import { buildBoreContour, buildMarkedCircle, circleSegmentCount, turnContour } from "./contours.js";
import { createMeshBuilder, isSimplePolygon, MeshBuildError } from "./mesh-builder.js";
import { rimSurface } from "./rims.js";
import { layoutSpokes } from "./spokes.js";
import { taperBreaks, taperedRadius } from "./taper.js";

const MAX_LOOP_SEGMENTS = 4096;
const MAX_TRIANGLES = 200000;

/**
 * Build the closed boundary of the part.
 *
 * Every surface is either a vertical wall between two copies of one XY contour
 * or a flat face at one Z level (see mesh-builder.js). From the axis outwards
 * the contours are: the bore (a circle or a shaped loop, see buildBoreContour),
 * hub R_h, rim inner circle R_i, the working surface of
 * the rim (see rims.js) and the flange edges R_o + E_f. A helical working surface
 * is a stack of walls between turned copies of one contour, a bevel one a wall
 * between the contour and its copy scaled towards the axis. Axially the rim spans [−W/2, +W/2], flanges add
 * their thickness outside it, the hub spans [hubLowerZ, hubUpperZ] and the web
 * [webLowerZ, webUpperZ]. Between the web levels the hub cylinder and the rim
 * inner surface are covered by the web; with spokes they stay exposed inside
 * the windows, whose walls are built from the same loop vertices.
 *
 * A tapered hub or rim (see taper.js) is a stack of walls between circles of
 * different radii with the same vertex count and marks, so vertex i of one lies
 * on the ray of vertex i of the next; the web and the spokes meet them at their
 * web radii.
 */
export function buildPulleyMesh(description, derived) {
  const { rim, flanges, web } = description; // web.type "none": the web levels are the faces, see derive
  const { hubRadius, rimInnerRadius, hubWebRadius, rimInnerWebRadius, outsideRadius, webLowerZ, webUpperZ, hubLowerZ, hubUpperZ } = derived;
  const maxChordError = description.generation.maxChordError;
  const rimLowerZ = -rim.width / 2;
  const rimUpperZ = rim.width / 2;
  // outer limits of the belt part: flange far faces or rim ends
  const shellLowerZ = flanges.lower ? rimLowerZ - flanges.lower.axialThickness : rimLowerZ;
  const shellUpperZ = flanges.upper ? rimUpperZ + flanges.upper.axialThickness : rimUpperZ;

  // rim-side circles get the vertices the working surface asks for
  const surface = rimSurface(description.kind, rim, { outside: outsideRadius }, maxChordError);
  const layout = web.type === "spokes" ? layoutSpokes({
    count: web.count,
    width: web.width,
    filletRadius: web.filletRadius,
    hubRadius: hubWebRadius,
    rimRadius: rimInnerWebRadius,
    maxChordError
  }) : null;
  // spoke k uses hub marks 3k..3k+2 and rim marks 4k..4k+3 (after the surface marks)
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

  const bore = buildBoreContour(description.bore, maxChordError);
  // after the spoke marks, so their indices stay 3k..3k+2
  const hubBoreMarks = [...hubMarks, ...bore.corners];

  const circle = (radius, marks) => buildMarkedCircle(radius, circleSegmentCount(radius, maxChordError), marks);
  const flangeEdge = (flange) => flange ? circle(outsideRadius + flange.radialExtension, surface.marks) : null;
  // without a web the rim ends and the flanges start right at the hub: one loop serves as both
  const noWeb = web.type === "none";
  const hubLoopMarks = noWeb ? [...hubBoreMarks, ...surface.marks] : hubBoreMarks;
  const rimInnerMarks = [...surface.marks, ...rimSpokeMarks];
  // every circle of a tapered surface has the vertex count of its largest one
  const hubSegments = circleSegmentCount(hubWebRadius, maxChordError);
  const rimInnerSegments = circleSegmentCount(rimInnerRadius, maxChordError);
  const hub = buildMarkedCircle(hubRadius, hubSegments, hubLoopMarks);
  const rimInner = noWeb ? hub : buildMarkedCircle(rimInnerRadius, rimInnerSegments, rimInnerMarks);
  /** Circles of one surface by radius, so equal radii at different levels share a contour. */
  const family = (radius, contour, segments, marks) => {
    const circles = new Map([[radius, contour]]);
    return (other) => {
      if (!circles.has(other)) circles.set(other, buildMarkedCircle(other, segments, marks));
      return circles.get(other);
    };
  };
  const hubCircle = family(hubRadius, hub, hubSegments, hubLoopMarks);
  const rimInnerCircle = noWeb ? hubCircle : family(rimInnerRadius, rimInner, rimInnerSegments, rimInnerMarks);
  const hubAt = (z) => hubCircle(taperedRadius(hubRadius, 1, derived.hubTaper, webLowerZ, webUpperZ, z));
  const rimInnerAt = (z) => rimInnerCircle(taperedRadius(rimInnerRadius, -1, derived.rimTaper, webLowerZ, webUpperZ, z));
  const contours = {
    bore,
    // the spokes meet the hub and the rim at the web
    hub: hubAt(webLowerZ),
    rimInner: rimInnerAt(webLowerZ),
    profile: { points: surface.points },
    lowerFlange: flangeEdge(flanges.lower),
    upperFlange: flangeEdge(flanges.upper)
  };
  const circles = [contours.bore, hub, rimInner, contours.profile, contours.lowerFlange, contours.upperFlange];
  if (circles.some((contour) => contour && contour.points.length > MAX_LOOP_SEGMENTS)) return complexityFailure();
  // the working surface alone would exceed the triangle limit: stop before building it
  if (2 * contours.profile.points.length * (surface.sections.length - 1) > MAX_TRIANGLES) return complexityFailure();
  // sections without a turn or a scale share the profile contour, so the rim ends of straight teeth stay as they were
  const sections = surface.sections.map(({ z, turn, scale = 1 }) => {
    if (turn === 0 && scale === 1) return { z, contour: contours.profile };
    const turned = turnContour(surface.points, turn);
    return { z, contour: { points: scale === 1 ? turned : turned.map(([x, y]) => [x * scale, y * scale]) } };
  });

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
  else if (!noWeb) addSolidWeb();

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
        hub: hub.points.length,
        rimInner: rimInner.points.length
      }
    }
  };

  /** Bore, hub end rings and the hub surface outside the web levels. */
  function addHub() {
    const { bore } = contours;
    mesh.wall({ lower: loop(bore, hubLowerZ), upper: loop(bore, hubUpperZ), normal: "inward" });
    mesh.annulus({ inner: loop(bore, hubLowerZ), outer: loop(hubAt(hubLowerZ), hubLowerZ), normal: "-Z" });
    mesh.annulus({ inner: loop(bore, hubUpperZ), outer: loop(hubAt(hubUpperZ), hubUpperZ), normal: "+Z" });
    if (hubLowerZ < webLowerZ) surfaceWalls(hubAt, derived.hubTaper, hubLowerZ, webLowerZ, "outward");
    if (webUpperZ < hubUpperZ) surfaceWalls(hubAt, derived.hubTaper, webUpperZ, hubUpperZ, "outward");
  }

  /** Walls of the hub or the rim inner surface from z0 up to z1, split where a cone ends. */
  function surfaceWalls(circleAt, taper, z0, z1, normal) {
    const levels = [z0, ...taperBreaks(taper, webLowerZ, webUpperZ, z0, z1), z1];
    for (let index = 1; index < levels.length; index += 1) {
      const [lower, upper] = [levels[index - 1], levels[index]];
      mesh.wall({ lower: loop(circleAt(lower), lower), upper: loop(circleAt(upper), upper), normal });
    }
  }

  /** Working surface, flangeless rim ends and the rim inner surface outside the web levels. */
  function addRim() {
    for (let index = 1; index < sections.length; index += 1) {
      const [lower, upper] = [sections[index - 1], sections[index]];
      mesh.wall({ lower: loop(lower.contour, lower.z), upper: loop(upper.contour, upper.z), normal: "outward" });
    }
    // a turned end starts on its first tooth, so the ring starts from the inner vertex under it
    const [lowerEnd, upperEnd] = [surface.sections[0], surface.sections.at(-1)];
    if (!flanges.lower) mesh.annulus({ inner: startAt(loop(rimInnerAt(rimLowerZ), rimLowerZ), lowerEnd.turn), outer: loop(sections[0].contour, rimLowerZ), normal: "-Z" });
    if (!flanges.upper) mesh.annulus({ inner: startAt(loop(rimInnerAt(rimUpperZ), rimUpperZ), upperEnd.turn), outer: loop(sections.at(-1).contour, rimUpperZ), normal: "+Z" });
    // the inner surface continues through the flanges, which are rings from R_i
    if (shellLowerZ < webLowerZ) surfaceWalls(rimInnerAt, derived.rimTaper, shellLowerZ, webLowerZ, "inward");
    if (webUpperZ < shellUpperZ) surfaceWalls(rimInnerAt, derived.rimTaper, webUpperZ, shellUpperZ, "inward");
  }

  /**
   * One flange: a ring from R_i to its edge, extruded away from the rim end.
   * On the rim side only the ledge outside the working surface is exposed; the
   * area under it is interior material and gets no surface.
   */
  function addFlange(side) {
    if (!flanges[side]) return;
    const upper = side === "upper";
    const edge = contours[`${side}Flange`];
    const rimZ = upper ? rimUpperZ : rimLowerZ;
    const farZ = upper ? shellUpperZ : shellLowerZ;
    mesh.annulus({ inner: loop(contours.profile, rimZ), outer: loop(edge, rimZ), normal: upper ? "-Z" : "+Z" });
    mesh.annulus({ inner: loop(rimInnerAt(farZ), farZ), outer: loop(edge, farZ), normal: upper ? "+Z" : "-Z" });
    mesh.wall({ lower: loop(edge, Math.min(rimZ, farZ)), upper: loop(edge, Math.max(rimZ, farZ)), normal: "outward" });
  }

  /** A solid web is two flat rings between the hub and the rim inner circle. */
  function addSolidWeb() {
    mesh.annulus({ inner: loop(hubAt(webLowerZ), webLowerZ), outer: loop(rimInnerAt(webLowerZ), webLowerZ), normal: "-Z" });
    mesh.annulus({ inner: loop(hubAt(webUpperZ), webUpperZ), outer: loop(rimInnerAt(webUpperZ), webUpperZ), normal: "+Z" });
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
    const rimIndex = (spoke, side) => contours.rimInner.markIndices[surface.marks.length + 4 * spoke + (side === "leading" ? 3 : 0)];
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

/**
 * The same loop starting at its vertex nearest to the clockwise angle; the rim
 * marks put a vertex exactly there. Angle 0 keeps the loop as it is.
 */
function startAt(loop, angle) {
  if (angle === 0) return loop;
  const target = [Math.sin(angle), Math.cos(angle)];
  let start = 0;
  loop.points.forEach(([x, y], index) => {
    const [bestX, bestY] = loop.points[start];
    const along = (x * target[0] + y * target[1]) / Math.hypot(x, y);
    if (along > (bestX * target[0] + bestY * target[1]) / Math.hypot(bestX, bestY)) start = index;
  });
  const turn = (items) => items.map((_, offset) => items[(start + offset) % items.length]);
  return { ids: turn(loop.ids), points: turn(loop.points) };
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
