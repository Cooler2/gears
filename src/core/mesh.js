import {
  buildCircleContour,
  buildGt2Contour,
  circleSegmentCount,
  clockwiseParameters
} from "./contours.js";

export function buildSolidPulleyMesh(description, derived) {
  const vertices = [];
  const indices = [];
  const loopCache = new Map();
  const circleSegments = new Map();
  const halfWidth = description.rim.toothedWidth / 2;
  const lowerZ = -halfWidth;
  const upperZ = halfWidth;
  const { boreRadius, hubRadius, rimInnerRadius, webLowerZ, webUpperZ, outsideRadius } = derived;
  const error = description.generation.maxChordError;

  for (const radius of [boreRadius, hubRadius]) {
    const count = circleSegmentCount(radius, error);
    if (count > 4096) return complexityFailure();
    circleSegments.set(radius, count);
  }
  const rimMinimum = circleSegmentCount(rimInnerRadius, error);
  // Two aligned vertices per tooth: one at a groove centre and one at the
  // opposite inter-groove tip. N tip-aligned vertices are sufficient for this
  // profile; 2N gives cleaner, symmetric cap triangles.
  const rimAngularPeriod = 2 * description.rim.toothCount;
  const rimSegments = Math.ceil(rimMinimum / rimAngularPeriod) * rimAngularPeriod;
  if (rimSegments > 4096) return complexityFailure();
  circleSegments.set(rimInnerRadius, rimSegments);

  const profilePoints = buildGt2Contour(description.rim.toothCount, outsideRadius);
  const profileStart = 9;

  const circle = (radius, z) => {
    const key = `c:${radius}:${z}`;
    if (!loopCache.has(key)) {
      loopCache.set(key, addLoop(buildCircleContour(radius, circleSegments.get(radius)), z, 0));
    }
    return loopCache.get(key);
  };
  const profile = (z) => {
    const key = `p:${z}`;
    if (!loopCache.has(key)) loopCache.set(key, addLoop(profilePoints, z, profileStart));
    return loopCache.get(key);
  };
  function addLoop(points, z, startIndex) {
    const ids = points.map(([x, y]) => {
      const index = vertices.length / 3;
      vertices.push(x, y, z);
      return index;
    });
    const order = clockwiseParameters(points, startIndex);
    return {
      ids: order.ordered.map((index) => ids[index]),
      parameters: order.parameters,
      points: order.ordered.map((index) => points[index])
    };
  }

  const boreLower = circle(boreRadius, lowerZ);
  const boreUpper = circle(boreRadius, upperZ);
  const hubLower = circle(hubRadius, lowerZ);
  const hubUpper = circle(hubRadius, upperZ);
  const rimLower = circle(rimInnerRadius, lowerZ);
  const rimUpper = circle(rimInnerRadius, upperZ);
  const outerLower = profile(lowerZ);
  const outerUpper = profile(upperZ);
  const hubWebLower = circle(hubRadius, webLowerZ);
  const hubWebUpper = circle(hubRadius, webUpperZ);
  const rimWebLower = circle(rimInnerRadius, webLowerZ);
  const rimWebUpper = circle(rimInnerRadius, webUpperZ);

  annulus(boreUpper, hubUpper, true);
  annulus(rimUpper, outerUpper, true);
  annulus(hubWebUpper, rimWebUpper, true);
  annulus(boreLower, hubLower, false);
  annulus(rimLower, outerLower, false);
  annulus(hubWebLower, rimWebLower, false);

  wall(outerLower, outerUpper, true);
  wall(boreLower, boreUpper, false);
  if (webUpperZ < upperZ) {
    wall(hubWebUpper, hubUpper, true);
    wall(rimWebUpper, rimUpper, false);
  }
  if (webLowerZ > lowerZ) {
    wall(hubLower, hubWebLower, true);
    wall(rimLower, rimWebLower, false);
  }

  function triangle(a, b, c, flip = false) {
    if (flip) indices.push(a, c, b);
    else indices.push(a, b, c);
  }

  function wall(lower, upper, outward) {
    const count = lower.ids.length;
    if (upper.ids.length !== count) throw new Error("Wall loops must have equal vertex counts");
    for (let index = 0; index < count; index += 1) {
      const next = (index + 1) % count;
      if (outward) {
        triangle(lower.ids[index], upper.ids[index], upper.ids[next]);
        triangle(lower.ids[index], upper.ids[next], lower.ids[next]);
      } else {
        triangle(lower.ids[index], lower.ids[next], upper.ids[next]);
        triangle(lower.ids[index], upper.ids[next], upper.ids[index]);
      }
    }
  }

  function annulus(inner, outer, top) {
    const innerCount = inner.ids.length;
    const outerCount = outer.ids.length;
    const columns = outerCount + 1;
    const stateCount = (innerCount + 1) * columns;
    const costs = new Float64Array(stateCount);
    const parents = new Uint8Array(stateCount);
    costs.fill(Infinity);
    costs[0] = 0;
    const scale = Math.max(
      ...inner.points.flatMap(([x, y]) => [Math.abs(x), Math.abs(y)]),
      ...outer.points.flatMap(([x, y]) => [Math.abs(x), Math.abs(y)])
    );
    const areaTolerance = Math.max(1e-14, 1e-14 * scale * scale);

    for (let innerIndex = 0; innerIndex <= innerCount; innerIndex += 1) {
      for (let outerIndex = 0; outerIndex <= outerCount; outerIndex += 1) {
        const state = innerIndex * columns + outerIndex;
        if (!Number.isFinite(costs[state])) continue;
        const innerCurrent = inner.points[innerIndex % innerCount];
        const outerCurrent = outer.points[outerIndex % outerCount];
        if (outerIndex < outerCount) {
          const outerFollowing = outer.points[(outerIndex + 1) % outerCount];
          if (signedArea2(innerCurrent, outerFollowing, outerCurrent) > areaTolerance) {
            update(state + 1, costs[state] + distanceSquared(innerCurrent, outerFollowing), 1);
          }
        }
        if (innerIndex < innerCount) {
          const innerFollowing = inner.points[(innerIndex + 1) % innerCount];
          if (signedArea2(innerCurrent, innerFollowing, outerCurrent) > areaTolerance) {
            update(state + columns, costs[state] + distanceSquared(innerFollowing, outerCurrent), 2);
          }
        }
      }
    }

    let innerIndex = innerCount;
    let outerIndex = outerCount;
    const selected = [];
    while (innerIndex > 0 || outerIndex > 0) {
      const parent = parents[innerIndex * columns + outerIndex];
      if (parent === 1) {
        selected.push([
          inner.ids[innerIndex % innerCount],
          outer.ids[outerIndex % outerCount],
          outer.ids[(outerIndex - 1) % outerCount]
        ]);
        outerIndex -= 1;
      } else if (parent === 2) {
        selected.push([
          inner.ids[(innerIndex - 1) % innerCount],
          inner.ids[innerIndex % innerCount],
          outer.ids[outerIndex % outerCount]
        ]);
        innerIndex -= 1;
      } else {
        throw new Error("No consistently oriented annulus triangulation exists for these contours");
      }
    }
    selected.reverse();
    for (const [a, b, c] of selected) triangle(a, b, c, !top);

    function update(destination, cost, parent) {
      if (cost < costs[destination]) {
        costs[destination] = cost;
        parents[destination] = parent;
      }
    }
  }

  if (indices.length / 3 > 200000) return complexityFailure();
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
      toothVertexCount: profilePoints.length,
      circleSegments: {
        bore: circleSegments.get(boreRadius),
        hub: circleSegments.get(hubRadius),
        rimInner: circleSegments.get(rimInnerRadius)
      }
    }
  };
}

function signedArea2(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function distanceSquared(a, b) {
  return (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
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
