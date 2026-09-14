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

/** Rotate a closed contour so that it starts at startIndex. */
export function rotateContour(points, startIndex) {
  return points.map((_, offset) => points[(startIndex + offset) % points.length]);
}
