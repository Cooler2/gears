const PROFILE_HALF = [
  [0.00, -0.75],
  [0.14, -0.73],
  [0.28, -0.67],
  [0.42, -0.56],
  [0.50, -0.44],
  [0.56, -0.27],
  [0.59, -0.13],
  [0.61, -0.07],
  [0.66, -0.02],
  [0.74, 0.00]
];

/** Build the documented 19*N GT2 experimental contour in clockwise order. */
export function buildGt2Contour(toothCount, outsideRadius) {
  const result = [];
  for (let tooth = 0; tooth < toothCount; tooth += 1) {
    const angle = -2 * Math.PI * tooth / toothCount;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    for (let signedIndex = -9; signedIndex <= 9; signedIndex += 1) {
      const [halfX, radialOffset] = PROFILE_HALF[Math.abs(signedIndex)];
      const x = Math.sign(signedIndex) * halfX;
      const y = outsideRadius + radialOffset;
      result.push([
        x * cosine - y * sine,
        x * sine + y * cosine
      ]);
    }
  }
  return result;
}

export function circleSegmentCount(radius, maxChordError) {
  const error = Math.min(maxChordError, radius);
  return Math.max(12, Math.ceil(Math.PI / Math.acos(1 - error / radius)));
}

/** Circle starts at +Y and proceeds clockwise, matching the tooth contour. */
export function buildCircleContour(radius, segmentCount) {
  return Array.from({ length: segmentCount }, (_, index) => {
    const angle = 2 * Math.PI * index / segmentCount;
    return [radius * Math.sin(angle), radius * Math.cos(angle)];
  });
}

/** Marks closer than this (radians) are treated as the same vertex. */
const MARK_MERGE_ANGLE = 1e-9;

/**
 * Build a clockwise circle that has a vertex at every marked angle.
 *
 * Angles are clockwise from +Y, as in buildCircleContour. The loop always
 * starts at +Y (angle 0 is an implicit mark). Each gap between neighbouring
 * marks is split evenly so that no segment spans more than 2π/segmentCount;
 * with no marks the result equals buildCircleContour(radius, segmentCount).
 *
 * Returns the points and, for every requested mark, the index of its vertex.
 */
export function buildMarkedCircle(radius, segmentCount, markAngles = []) {
  const fullTurn = 2 * Math.PI;
  const wrap = (angle) => ((angle % fullTurn) + fullTurn) % fullTurn;
  const requested = markAngles.map(wrap);

  const marks = [];
  for (const angle of [0, ...requested].sort((a, b) => a - b)) {
    const last = marks.length ? marks[marks.length - 1] : null;
    if (last !== null && angle - last < MARK_MERGE_ANGLE) continue;
    if (fullTurn - angle < MARK_MERGE_ANGLE) continue; // same vertex as the start at 0
    marks.push(angle);
  }

  const maxStep = fullTurn / segmentCount;
  const points = [];
  const markVertex = [];
  marks.forEach((start, index) => {
    const end = index + 1 < marks.length ? marks[index + 1] : fullTurn;
    // the small bias keeps an exact multiple of maxStep from gaining a segment
    const steps = Math.max(1, Math.ceil((end - start) / maxStep - 1e-9));
    markVertex.push(points.length);
    for (let step = 0; step < steps; step += 1) {
      const angle = start + (end - start) * step / steps;
      points.push([radius * Math.sin(angle), radius * Math.cos(angle)]);
    }
  });

  const markIndices = requested.map((angle) => {
    let nearest = 0;
    let nearestDistance = Infinity;
    marks.forEach((mark, index) => {
      const difference = Math.abs(mark - angle);
      const distance = Math.min(difference, fullTurn - difference);
      if (distance < nearestDistance) {
        nearest = index;
        nearestDistance = distance;
      }
    });
    return markVertex[nearest];
  });
  return { points, markIndices };
}

/** Angles closer than this (radians) to a feature boundary count as lying on it. */
const ANGLE_TOLERANCE = 1e-9;
const wrapAngle = (angle) => ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
const clockwiseAngle = ([x, y]) => wrapAngle(Math.atan2(x, y));

/**
 * Bore contour, a loop around the axis like the circles: clockwise from +Y,
 * starting on the +Y ray.
 *
 * The flat, the keyway and one polygon side face +X, so the axial section
 * through the XZ plane shows them. The relation rules keep the axis inside the
 * bore, so every shape is star-shaped around it and angles grow along the loop.
 * corners are the clockwise angles of the sharp vertices: the hub circle gets
 * vertices there, which keeps the end ring between the two loops well shaped.
 *
 * Out-of-rule sizes (a flat past the axis, a keyway wider than the bore) still
 * give a closed outline for drawings; such a description never reaches the mesh.
 */
export function buildBoreContour(bore, maxChordError) {
  const radius = bore.diameter / 2;
  const segments = circleSegmentCount(radius, maxChordError);
  if (bore.shape === "polygon") return polygonBore(radius, bore.sides);
  if (bore.shape === "dFlat") return flatBore(radius, segments, bore.flatDistance - radius);
  if (bore.shape === "keyed") return keyedBore(radius, segments, bore.keyWidth / 2, bore.keyDepth);
  return { points: buildMarkedCircle(radius, segments).points, corners: [] };
}

/**
 * Exact radial sizes of the bore: outerRadius is the farthest point from the
 * axis, positiveX and negativeX are where the ±X rays leave the bore.
 */
export function boreExtents(bore) {
  const radius = bore.diameter / 2;
  if (bore.shape === "polygon") {
    // the diameter is across corners; a side faces +X, the opposite end is a vertex when the side count is odd
    const apothem = radius * Math.cos(Math.PI / bore.sides);
    return { outerRadius: radius, positiveX: apothem, negativeX: bore.sides % 2 ? radius : apothem };
  }
  if (bore.shape === "dFlat") return { outerRadius: radius, positiveX: bore.flatDistance - radius, negativeX: radius };
  if (bore.shape === "keyed") {
    const bottom = radius + bore.keyDepth;
    return { outerRadius: Math.hypot(bottom, bore.keyWidth / 2), positiveX: bottom, negativeX: radius };
  }
  return { outerRadius: radius, positiveX: radius, negativeX: radius };
}

/** Regular polygon inscribed in the bore circle: radius reaches the vertices. */
function polygonBore(circumradius, sides) {
  const apothem = circumradius * Math.cos(Math.PI / sides);
  const corners = Array.from({ length: sides }, (_, index) => {
    const angle = wrapAngle(Math.PI / 2 + Math.PI / sides + 2 * Math.PI * index / sides);
    return angle < ANGLE_TOLERANCE || 2 * Math.PI - angle < ANGLE_TOLERANCE ? 0 : angle;
  }).sort((a, b) => a - b);
  const points = corners.map((angle) => angle === 0 ? [0, circumradius] : [circumradius * Math.sin(angle), circumradius * Math.cos(angle)]);
  if (corners[0] !== 0) {
    // the +Y ray crosses the side whose middle is nearest to it
    const middle = Math.min(...Array.from({ length: sides }, (_, index) => {
      const angle = wrapAngle(Math.PI / 2 + 2 * Math.PI * index / sides);
      return Math.min(angle, 2 * Math.PI - angle);
    }));
    points.unshift([0, apothem / Math.cos(middle)]);
  }
  return { points, corners };
}

/** Circle without the arc beyond the flat x = offset. */
function flatBore(radius, segments, offset) {
  if (offset >= radius) return { points: buildMarkedCircle(radius, segments).points, corners: [] };
  const half = Math.acos(Math.max(offset, -0.999 * radius) / radius); // half the angle the flat cuts off, seen from the axis
  const corners = [wrapAngle(Math.PI / 2 - half), wrapAngle(Math.PI / 2 + half)];
  const { points } = buildMarkedCircle(radius, segments, corners);
  const kept = points.filter((point) => {
    const fromX = Math.abs(wrapAngle(clockwiseAngle(point) - Math.PI / 2 + Math.PI) - Math.PI);
    return fromX >= half - ANGLE_TOLERANCE;
  });
  return { points: kept, corners };
}

/** Circle with a rectangular slot of half width halfWidth along +X, depth past the circle. */
function keyedBore(radius, segments, halfWidth, depth) {
  const half = Math.min(halfWidth, 0.999 * radius);
  const bottom = radius + depth;
  const edge = Math.sqrt(radius ** 2 - half ** 2); // where the slot sides meet the circle
  const start = Math.atan2(edge, half);
  const end = Math.PI - start;
  const { points, markIndices } = buildMarkedCircle(radius, segments, [start, end]);
  const kept = [];
  points.forEach((point, index) => {
    if (index > markIndices[0] && index < markIndices[1]) return;
    kept.push(point);
    if (index === markIndices[0]) kept.push([bottom, half], [bottom, -half]);
  });
  const corner = Math.atan2(bottom, half);
  return { points: kept, corners: [start, corner, Math.PI - corner, end] };
}

/** Rotate a closed contour so that it starts at startIndex. */
export function rotateContour(points, startIndex) {
  return points.map((_, offset) => points[(startIndex + offset) % points.length]);
}

/** The points turned clockwise about the axis by `angle`, in the same order. */
export function turnContour(points, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return points.map(([x, y]) => [x * cosine + y * sine, y * cosine - x * sine]);
}
