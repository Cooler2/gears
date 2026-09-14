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

export function clockwiseParameters(points, startIndex = 0) {
  const ordered = [];
  for (let offset = 0; offset < points.length; offset += 1) {
    ordered.push((startIndex + offset) % points.length);
  }

  const parameters = [0];
  let previous = clockwiseAngle(points[ordered[0]]);
  for (let offset = 1; offset < ordered.length; offset += 1) {
    let current = clockwiseAngle(points[ordered[offset]]);
    while (current < previous - 1e-12) current += 2 * Math.PI;
    parameters.push(current);
    previous = current;
  }

  const initialAngle = clockwiseAngle(points[ordered[0]]);
  for (let index = 0; index < parameters.length; index += 1) {
    parameters[index] -= initialAngle;
    if (parameters[index] < -1e-12) parameters[index] += 2 * Math.PI;
  }
  return { ordered, parameters };
}

function clockwiseAngle([x, y]) {
  let angle = Math.atan2(x, y);
  if (angle < 0) angle += 2 * Math.PI;
  return angle;
}
