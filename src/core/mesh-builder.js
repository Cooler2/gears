// Gears — (c) 2026 Ivan Polyacov, Elastic License 2.0, see LICENSE
/**
 * Surface primitives for an indexed triangle mesh assembled from shared
 * boundaries.
 *
 * Conventions shared by all helpers:
 *
 * - A contour is a closed sequence of XY points. A loop is one contour placed
 *   at one Z level: { ids, points }, where ids[i] is the vertex index of
 *   points[i]. A loop is created once and passed to every surface that ends on
 *   it, so neighbouring surfaces share vertex indices and nothing is welded.
 * - Loops around the axis (circles, the tooth profile) run clockwise when
 *   viewed from +Z and start on the +Y ray. The loop of a spoke window runs
 *   clockwise around the window.
 * - Output triangles are counter-clockwise when viewed from outside the solid,
 *   so their right-hand normals point out of the material.
 */

/** Build failure with a public diagnostic code; details never carry a stack trace. */
export class MeshBuildError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

export function createMeshBuilder() {
  const vertices = [];
  const indices = [];

  /** Lift XY points to height z as new vertices; returns { ids, points }. */
  function addPoints(points, z) {
    const ids = points.map(([x, y]) => {
      vertices.push(x, y, z);
      return vertices.length / 3 - 1;
    });
    return { ids, points };
  }

  function triangle(a, b, c, flip) {
    if (flip) indices.push(a, c, b);
    else indices.push(a, b, c);
  }

  /**
   * Vertical band between two copies of the same contour.
   *
   * lower and upper are loops of one contour at two Z levels, so vertex i of
   * one lies exactly above vertex i of the other. Each contour edge becomes a
   * quad of two triangles.
   *
   * normal names the side the band faces, relative to the region enclosed by
   * the clockwise loop:
   * - "outward" — away from the enclosed region: tooth profile, hub cylinder,
   *   flange edge;
   * - "inward" — into the enclosed region: bore, rim inner surface, spoke window.
   */
  function wall({ lower, upper, normal }) {
    const count = lower.ids.length;
    if (upper.ids.length !== count) throw new MeshBuildError("E_BUILD_INTERNAL", { rule: "wallVertexCount" });
    const flip = normal === "inward";
    for (let index = 0; index < count; index += 1) {
      const next = (index + 1) % count;
      triangle(lower.ids[index], upper.ids[index], upper.ids[next], flip);
      triangle(lower.ids[index], upper.ids[next], lower.ids[next], flip);
    }
  }

  /**
   * Flat ring at one Z level between two nested loops around the axis.
   *
   * inner is the loop nearer the axis and outer the loop around it; both lie at
   * the same Z, run clockwise and start on the +Y ray, so inner[0]–outer[0] is
   * the first connecting edge. Their vertex counts may differ. normal selects
   * the exposed side of the ring: "+Z" for a face looking up, "-Z" for one
   * looking down.
   *
   * The ring is a strip of triangles between the two loops. Walking along it,
   * every triangle advances by one edge of either the inner or the outer loop.
   * Dynamic programming over (inner edges used, outer edges used) chooses the
   * sequence: only counter-clockwise (positive-area) triangles are allowed, and
   * among complete sequences the one with the smallest sum of squared
   * connecting edges wins. This handles the concave tooth profile, where a
   * greedy choice can produce folded triangles.
   */
  function annulus({ inner, outer, normal }) {
    const innerCount = inner.ids.length;
    const outerCount = outer.ids.length;
    const OUTER_STEP = 1;
    const INNER_STEP = 2;
    // state (i, j): i inner and j outer edges are covered; the current
    // connecting edge joins inner[i] and outer[j] (indices modulo the counts)
    const columns = outerCount + 1;
    const stateCount = (innerCount + 1) * columns;
    const costs = new Float64Array(stateCount).fill(Infinity);
    const steps = new Uint8Array(stateCount);
    costs[0] = 0;
    const tolerance = areaTolerance([...inner.points, ...outer.points]);

    for (let innerIndex = 0; innerIndex <= innerCount; innerIndex += 1) {
      for (let outerIndex = 0; outerIndex <= outerCount; outerIndex += 1) {
        const state = innerIndex * columns + outerIndex;
        if (!Number.isFinite(costs[state])) continue;
        const innerCurrent = inner.points[innerIndex % innerCount];
        const outerCurrent = outer.points[outerIndex % outerCount];
        if (outerIndex < outerCount) {
          const outerFollowing = outer.points[(outerIndex + 1) % outerCount];
          if (signedArea2(innerCurrent, outerFollowing, outerCurrent) > tolerance) {
            update(state + 1, costs[state] + distanceSquared(innerCurrent, outerFollowing), OUTER_STEP);
          }
        }
        if (innerIndex < innerCount) {
          const innerFollowing = inner.points[(innerIndex + 1) % innerCount];
          if (signedArea2(innerCurrent, innerFollowing, outerCurrent) > tolerance) {
            update(state + columns, costs[state] + distanceSquared(innerFollowing, outerCurrent), INNER_STEP);
          }
        }
      }
    }

    // walk back from the closing edge inner[0]–outer[0] to recover the strip
    let innerIndex = innerCount;
    let outerIndex = outerCount;
    const selected = [];
    while (innerIndex > 0 || outerIndex > 0) {
      const step = steps[innerIndex * columns + outerIndex];
      if (step === OUTER_STEP) {
        selected.push([
          inner.ids[innerIndex % innerCount],
          outer.ids[outerIndex % outerCount],
          outer.ids[(outerIndex - 1) % outerCount]
        ]);
        outerIndex -= 1;
      } else if (step === INNER_STEP) {
        selected.push([
          inner.ids[(innerIndex - 1) % innerCount],
          inner.ids[innerIndex % innerCount],
          outer.ids[outerIndex % outerCount]
        ]);
        innerIndex -= 1;
      } else {
        throw new MeshBuildError("E_BUILD_INTERNAL", { rule: "annulusTriangulation" });
      }
    }
    selected.reverse();
    for (const [a, b, c] of selected) triangle(a, b, c, normal === "-Z");

    function update(destination, cost, step) {
      if (cost < costs[destination]) {
        costs[destination] = cost;
        steps[destination] = step;
      }
    }
  }

  /**
   * Flat face at one Z level bounded by a single simple loop.
   *
   * The loop must run counter-clockwise when viewed from +Z (unlike loops
   * around the axis). normal selects the exposed side: "+Z" or "-Z".
   */
  function polygon({ loop, normal }) {
    for (const [a, b, c] of triangulateSimplePolygon(loop.points)) {
      triangle(loop.ids[a], loop.ids[b], loop.ids[c], normal === "-Z");
    }
  }

  return {
    addPoints,
    wall,
    annulus,
    polygon,
    get triangleCount() {
      return indices.length / 3;
    },
    finish: () => ({ vertices, indices })
  };
}

/**
 * Ear-clipping triangulation of a simple counter-clockwise polygon.
 *
 * An ear is a convex vertex whose triangle with its two neighbours contains no
 * other remaining vertex; cutting it off leaves a smaller simple polygon. The
 * ear with the shortest new diagonal is cut first (ties go to the lowest
 * index), which keeps the result deterministic and avoids long slivers where
 * possible. Returns index triples into points.
 */
export function triangulateSimplePolygon(points) {
  const count = points.length;
  if (count < 3 || polygonArea2(points) <= 0) {
    throw new MeshBuildError("E_BUILD_INTERNAL", { rule: "polygonOrientation" });
  }
  const tolerance = areaTolerance(points);
  const previous = Array.from({ length: count }, (_, index) => (index + count - 1) % count);
  const next = Array.from({ length: count }, (_, index) => (index + 1) % count);
  const removed = new Uint8Array(count);
  const ear = Array.from({ length: count }, (_, index) => isEar(index));
  const triangles = [];

  for (let remaining = count; remaining > 3; remaining -= 1) {
    let best = -1;
    let bestCost = Infinity;
    for (let index = 0; index < count; index += 1) {
      if (removed[index] || !ear[index]) continue;
      const cost = distanceSquared(points[previous[index]], points[next[index]]);
      if (cost < bestCost) {
        best = index;
        bestCost = cost;
      }
    }
    if (best < 0) throw new MeshBuildError("E_SELF_INTERSECTION", { rule: "polygonHasNoEar" });
    triangles.push([previous[best], best, next[best]]);
    removed[best] = 1;
    next[previous[best]] = next[best];
    previous[next[best]] = previous[best];
    ear[previous[best]] = isEar(previous[best]);
    ear[next[best]] = isEar(next[best]);
  }
  const last = removed.indexOf(0);
  if (signedArea2(points[previous[last]], points[last], points[next[last]]) <= tolerance) {
    throw new MeshBuildError("E_SELF_INTERSECTION", { rule: "polygonHasNoEar" });
  }
  triangles.push([previous[last], last, next[last]]);
  return triangles;

  function isEar(index) {
    const a = points[previous[index]];
    const b = points[index];
    const c = points[next[index]];
    if (signedArea2(a, b, c) <= tolerance) return false;
    for (let other = next[next[index]]; other !== previous[index]; other = next[other]) {
      const p = points[other];
      if (signedArea2(a, b, p) >= -tolerance && signedArea2(b, c, p) >= -tolerance && signedArea2(c, a, p) >= -tolerance) {
        return false;
      }
    }
    return true;
  }
}

/** True when no two non-adjacent edges of the closed polygon touch or cross. */
export function isSimplePolygon(points) {
  const count = points.length;
  for (let first = 0; first < count; first += 1) {
    const a = points[first];
    const b = points[(first + 1) % count];
    for (let second = first + 2; second < count; second += 1) {
      if (first === 0 && second === count - 1) continue; // edges sharing vertex 0
      if (segmentsTouch(a, b, points[second], points[(second + 1) % count])) return false;
    }
  }
  return true;
}

function segmentsTouch(a, b, c, d) {
  const abc = signedArea2(a, b, c);
  const abd = signedArea2(a, b, d);
  const cda = signedArea2(c, d, a);
  const cdb = signedArea2(c, d, b);
  if (((abc > 0 && abd < 0) || (abc < 0 && abd > 0)) && ((cda > 0 && cdb < 0) || (cda < 0 && cdb > 0))) return true;
  return (abc === 0 && onSegment(a, b, c)) || (abd === 0 && onSegment(a, b, d))
    || (cda === 0 && onSegment(c, d, a)) || (cdb === 0 && onSegment(c, d, b));
}

function onSegment(a, b, p) {
  return Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0])
    && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1]);
}

/** Twice the signed area of triangle abc; positive when counter-clockwise. */
function signedArea2(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function polygonArea2(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x0, y0] = points[index];
    const [x1, y1] = points[(index + 1) % points.length];
    area += x0 * y1 - x1 * y0;
  }
  return area;
}

function distanceSquared(a, b) {
  return (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
}

/** Smallest doubled triangle area accepted as non-degenerate for these points. */
function areaTolerance(points) {
  let scale = 0;
  for (const [x, y] of points) scale = Math.max(scale, Math.abs(x), Math.abs(y));
  return Math.max(1e-14, 1e-14 * scale * scale);
}
