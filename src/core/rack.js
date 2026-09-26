// Gears — (c) 2026 Ivan Polyacov (ivan@apus-software.com), Elastic License 2.0, see LICENSE
/**
 * Gear rack: a straight bar with the teeth of the basic rack on one side.
 *
 * Model coordinates: X along the rack, from −L/2 to +L/2; Y across it, from the
 * back (y = 0) through the pitch line (y = H_p) to the tips; Z across the width,
 * from −W/2 to +W/2. The rack lies on its side for printing, the lower face
 * z = −W/2 on the bed, like the gears it meshes with.
 *
 * The teeth are those that cut an involute gear (see involute.js): addendum 1·m
 * and dedendum 1.25·m from the pitch line, straight flanks at the pressure angle,
 * the thickness along the pitch line π·m/2 less the backlash. Inclined teeth have
 * the normal module, pressure angle and backlash, like a helical gear, so in the
 * XY section the pitch is π·m/cos β and the flanks are steeper. There is no root
 * fillet.
 *
 * The rack is N pitches long and both ends are cut square at the middle of a
 * space at the mid-plane, so two racks put end to end keep the pitch. Inclined
 * teeth move along X with height: a section at z is the one at z = 0 shifted by
 * −z·tg β (helical) or |z|·tg β (herringbone). The sign of β is the hand, as for
 * a gear: β > 0 is right-hand, and a rack meshes with a gear of the opposite sign.
 */

import { triangulateSimplePolygon } from "./mesh-builder.js";
import { calculateBounds } from "./mesh.js";

const DEGREE = Math.PI / 180;
/** Narrowest tip land kept when the flanks would meet below the tip line, in modules, as for a gear. */
const MIN_LAND = 0.04;
/** Points closer than this are one vertex, mm. */
const WELD = 1e-6;

/** Signed helix angle in radians, 0 for straight teeth. */
function helixOf(rim) {
  return rim.helix && rim.helix !== "none" ? rim.helixAngle * DEGREE : 0;
}

/**
 * Sizes of the rack teeth in the XY section.
 *
 * pitch is the pitch along X; halfThickness(y) half the tooth thickness at height y;
 * rootHalfSpace half the space at the root line. tipHeight is the tip line, lowered
 * to where the tooth keeps a land of MIN_LAND·m when the flanks meet earlier
 * (pointed is then true). thin means the tooth has no material even at the root.
 */
export function rackGeometry(rim) {
  const { module, pressureAngle, backlash, toothCount, pitchHeight } = rim;
  const helix = helixOf(rim);
  const cosine = Math.cos(helix);
  const transverseModule = module / cosine;
  const angle = Math.atan(Math.tan(pressureAngle * DEGREE) / cosine);
  const slope = Math.tan(angle); // flank run along X per unit of height
  const pitch = Math.PI * transverseModule;
  const thickness = pitch / 2 - backlash / cosine;
  const halfThickness = (y) => thickness / 2 - (y - pitchHeight) * slope;
  const rootHeight = pitchHeight - 1.25 * module;
  const fullTipHeight = pitchHeight + module;
  const minimumHalf = MIN_LAND * module / 2;
  const thin = halfThickness(rootHeight) <= minimumHalf;
  const pointed = !thin && halfThickness(fullTipHeight) < minimumHalf;
  const tipHeight = pointed ? pitchHeight + (thickness / 2 - minimumHalf) / slope : fullTipHeight;
  return {
    helix,
    transverseModule,
    transversePressureAngle: angle,
    pitch,
    length: toothCount * pitch,
    thickness,
    halfThickness,
    rootHeight,
    pitchHeight,
    tipHeight,
    fullTipHeight,
    tipHalf: Math.max(halfThickness(tipHeight), 0),
    // the space never closes within the contract limits; kept non-negative for drawings of broken sizes
    rootHalfSpace: Math.max(pitch / 2 - halfThickness(rootHeight), 0),
    pointed,
    thin
  };
}

/** Shift along X of the teeth at height z, relative to the mid-plane. */
export function rackShift(rim, z) {
  const tangent = Math.tan(helixOf(rim));
  if (rim.helix === "herringbone") return Math.abs(z) * tangent;
  return -z * tangent;
}

/**
 * The tooth line of one period as [u, y] corners, u from the middle of a space:
 * the root flat ends at a, the rising flank reaches the tip at pitch/2 − t, the
 * tip ends at pitch/2 + t, the falling flank reaches the root at pitch − a.
 */
function periodCorners(geometry) {
  const { pitch, rootHalfSpace: a, tipHalf: t, rootHeight, tipHeight } = geometry;
  return [[a, rootHeight], [pitch / 2 - t, tipHeight], [pitch / 2 + t, tipHeight], [pitch - a, rootHeight]];
}

/** Height of the tooth line at u, measured from the middle of a space. */
function toothHeight(geometry, corners, u) {
  const { pitch, rootHeight } = geometry;
  const local = u - Math.floor(u / pitch) * pitch;
  let previous = [0, rootHeight];
  for (const corner of [...corners, [pitch, rootHeight]]) {
    if (local <= corner[0]) {
      const span = corner[0] - previous[0];
      return span > 0 ? previous[1] + (corner[1] - previous[1]) * (local - previous[0]) / span : corner[1];
    }
    previous = corner;
  }
  return rootHeight;
}

/**
 * Outline of the XY section at height z as a counter-clockwise polygon: the back
 * from −L/2 to +L/2, up the right end, the tooth line back to the left, down the
 * left end. For drawings; the mesh is built from the same tooth line.
 */
export function rackSection(rim, z = 0) {
  const geometry = rackGeometry(rim);
  const corners = periodCorners(geometry);
  const half = geometry.length / 2;
  // u = x + L/2 − shift: the left end is the middle of a space at the mid-plane
  const offset = half - rackShift(rim, z);
  const top = [];
  const first = Math.floor((-half + offset) / geometry.pitch) - 1;
  const last = Math.ceil((half + offset) / geometry.pitch) + 1;
  for (let period = first; period <= last; period += 1) {
    for (const [u, y] of corners) {
      const x = u + period * geometry.pitch - offset;
      if (x > -half + WELD && x < half - WELD) top.push([x, y]);
    }
  }
  const height = (x) => toothHeight(geometry, corners, x + offset);
  return [[-half, 0], [half, 0], [half, height(half)], ...top.reverse(), [-half, height(-half)]];
}

/**
 * Closed mesh of the rack.
 *
 * The tooth side is a height field y = h(x − shift(z)) over the rectangle
 * |x| ≤ L/2, |z| ≤ W/2. Between two tooth-line corners h is linear, and the shift
 * is linear in z within a band (the whole width, or each half of a herringbone),
 * so every strip between the lines of two neighbouring corners is flat: a
 * parallelogram, cut by the ends into a convex polygon. The ends, the sides and
 * the back are flat polygons through the vertices on their edges. Vertices are
 * shared by position, so every edge is used by exactly two faces.
 */
export function buildRackMesh(normalized, derived) {
  const { rim } = normalized;
  const geometry = rackGeometry(rim);
  const corners = periodCorners(geometry);
  const half = geometry.length / 2;
  const halfWidth = rim.width / 2;
  const vertices = [];
  const indices = [];
  const cells = new Map();

  /** Vertex at a position, created once; nearby positions are the same vertex. */
  function vertex(x, y, z) {
    const key = (dx, dy, dz) => `${Math.round(x / WELD) + dx},${Math.round(y / WELD) + dy},${Math.round(z / WELD) + dz}`;
    for (const dx of [0, -1, 1]) for (const dy of [0, -1, 1]) for (const dz of [0, -1, 1]) {
      const found = cells.get(key(dx, dy, dz));
      if (found !== undefined) {
        const [px, py, pz] = vertices.slice(3 * found, 3 * found + 3);
        if (Math.abs(px - x) <= WELD && Math.abs(py - y) <= WELD && Math.abs(pz - z) <= WELD) return found;
      }
    }
    vertices.push(x, y, z);
    const id = vertices.length / 3 - 1;
    cells.set(key(0, 0, 0), id);
    return id;
  }

  /**
   * A flat face through vertex ids. plane picks the two coordinates it is drawn
   * in, outward the axis and sign its normal must have along it.
   */
  function face(ids, plane, [axis, sign]) {
    const distinct = ids.filter((id, index) => id !== ids[(index + 1) % ids.length]);
    if (distinct.length < 3) return;
    let points = distinct.map((id) => plane.map((coordinate) => vertices[3 * id + coordinate]));
    let order = distinct;
    if (area2(points) < 0) {
      points = [...points].reverse();
      order = [...distinct].reverse();
    }
    for (const triangle of triangulateSimplePolygon(points)) {
      const [a, b, c] = triangle.map((index) => order[index]);
      const normal = normalOf(a, b, c)[axis];
      if (normal * sign > 0) indices.push(a, b, c);
      else indices.push(a, c, b);
    }
  }

  function normalOf(a, b, c) {
    const p = (id) => vertices.slice(3 * id, 3 * id + 3);
    const [pa, pb, pc] = [p(a), p(b), p(c)];
    const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  }

  const X = 0;
  const Y = 1;
  const Z = 2;
  const bands = rim.helix === "herringbone" ? [[-halfWidth, 0], [0, halfWidth]] : [[-halfWidth, halfWidth]];
  const height = (x, z) => toothHeight(geometry, corners, x + half - rackShift(rim, z));
  for (const [z0, z1] of bands) {
    const [shift0, shift1] = [rackShift(rim, z0), rackShift(rim, z1)];
    // x of the line of tooth-line corner u at height z
    const lineX = (u, z) => u - half + shift0 + (shift1 - shift0) * (z - z0) / (z1 - z0);
    // u = x + L/2 − shift runs over [−shift, L − shift] across the band
    const from = Math.floor(-Math.max(shift0, shift1) / geometry.pitch) - 1;
    const to = Math.ceil((geometry.length - Math.min(shift0, shift1)) / geometry.pitch) + 1;
    const lines = [];
    for (let period = from; period <= to; period += 1) {
      for (const [u] of corners) lines.push(u + period * geometry.pitch);
    }
    for (let index = 1; index < lines.length; index += 1) {
      const [left, right] = [lines[index - 1], lines[index]];
      const strip = [[lineX(left, z0), z0], [lineX(right, z0), z0], [lineX(right, z1), z1], [lineX(left, z1), z1]];
      const clipped = clipX(clipX(strip, -half, 1), half, -1);
      if (clipped.length < 3) continue;
      face(clipped.map(([x, z]) => vertex(x, height(x, z), z)), [X, Z], [Y, 1]);
    }
  }

  // vertices on an edge of the tooth side, in order along it
  const topCount = vertices.length / 3;
  const on = (axis, value, along) => {
    const ids = [];
    for (let id = 0; id < topCount; id += 1) if (Math.abs(vertices[3 * id + axis] - value) <= WELD) ids.push(id);
    return ids.sort((a, b) => vertices[3 * a + along] - vertices[3 * b + along]);
  };
  const back = (x, z) => vertex(x, 0, z);
  for (const side of [-1, 1]) {
    // the ends: the back edge, then the tooth line across the width
    const end = on(X, side * half, Z);
    face([back(side * half, -halfWidth), back(side * half, halfWidth), ...end.reverse()], [Z, Y], [X, side]);
    // the sides: the back edge, then the tooth line along the rack
    const edge = on(Z, side * halfWidth, X);
    face([back(-half, side * halfWidth), back(half, side * halfWidth), ...edge.reverse()], [X, Y], [Z, side]);
  }
  face([back(-half, -halfWidth), back(half, -halfWidth), back(half, halfWidth), back(-half, halfWidth)], [X, Z], [Y, -1]);

  return {
    ok: true,
    mesh: { primitive: "triangles", units: "mm", vertices, indices, bounds: calculateBounds(vertices) },
    contours: { toothVertexCount: rackSection(rim).length, circleSegments: {} }
  };
}

/** Part of a convex polygon [x, z] on the side sign·(x − limit) ≥ 0 (Sutherland–Hodgman). */
function clipX(points, limit, sign) {
  const inside = ([x]) => sign * (x - limit) >= 0;
  const result = [];
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    if (inside(point)) result.push(point);
    if (inside(point) !== inside(next)) {
      const t = (limit - point[0]) / (next[0] - point[0]);
      result.push([limit, point[1] + t * (next[1] - point[1])]);
    }
  });
  return result;
}

function area2(points) {
  let area = 0;
  points.forEach(([x0, y0], index) => {
    const [x1, y1] = points[(index + 1) % points.length];
    area += x0 * y1 - x1 * y0;
  });
  return area;
}

