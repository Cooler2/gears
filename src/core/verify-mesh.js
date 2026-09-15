export function verifyMesh(mesh) {
  const errors = [];
  const edgeMap = new Map();
  const triangleCount = mesh.indices.length / 3;
  const vertexCount = mesh.vertices.length / 3;
  const maxDimension = Math.max(...mesh.bounds.max.map((value, axis) => value - mesh.bounds.min[axis]));
  const epsilon = Math.max(1e-9, 1e-9 * maxDimension);
  let signedVolume = 0;

  if (mesh.indices.length % 3 !== 0) errors.push({ code: "E_BUILD_INTERNAL", details: { rule: "indexTriples" } });
  for (let face = 0; face < triangleCount; face += 1) {
    const ids = mesh.indices.slice(face * 3, face * 3 + 3);
    if (ids.some((id) => !Number.isInteger(id) || id < 0 || id >= vertexCount)) {
      errors.push({ code: "E_BUILD_INTERNAL", details: { rule: "indexRange", face } });
      continue;
    }
    const [a, b, c] = ids.map((id) => mesh.vertices.slice(id * 3, id * 3 + 3));
    const cross = crossProduct(subtract(b, a), subtract(c, a));
    const doubleArea = Math.hypot(...cross);
    if (!(doubleArea > epsilon * epsilon)) errors.push({ code: "E_DEGENERATE_TRIANGLE", details: { face } });
    signedVolume += dot(a, crossProduct(b, c)) / 6;
    addEdge(ids[0], ids[1], face);
    addEdge(ids[1], ids[2], face);
    addEdge(ids[2], ids[0], face);
  }

  for (const records of edgeMap.values()) {
    if (records.length !== 2 || records[0].from !== records[1].to || records[0].to !== records[1].from) {
      errors.push({ code: "E_NON_MANIFOLD", details: { edge: `${records[0].from},${records[0].to}`, uses: records.length } });
    }
  }

  const pinchedVertex = findPinchedVertex(mesh.indices, vertexCount);
  if (pinchedVertex !== null) errors.push({ code: "E_NON_MANIFOLD", details: { rule: "vertexFan", vertex: pinchedVertex } });

  const connectedComponents = faceComponents(triangleCount, edgeMap);
  if (connectedComponents !== 1) errors.push({ code: "E_NON_MANIFOLD", details: { rule: "connectedComponents", connectedComponents } });
  if (!(signedVolume > 0)) errors.push({ code: "E_NON_MANIFOLD", details: { rule: "positiveVolume", signedVolume } });

  return {
    ok: errors.length === 0,
    vertexCount,
    triangleCount,
    edgeCount: edgeMap.size,
    connectedComponents,
    signedVolume,
    errors
  };

  function addEdge(from, to, face) {
    const key = from < to ? `${from}:${to}` : `${to}:${from}`;
    const records = edgeMap.get(key) ?? [];
    records.push({ from, to, face });
    edgeMap.set(key, records);
  }
}

// With closed, consistently oriented edges the triangles around every vertex must form
// one fan; two fans meeting at a vertex (a pinch) pass the edge test but are not manifold.
// Each triangle (a, b, c) contributes the link step b -> c at a, c -> a at b, a -> b at c.
function findPinchedVertex(indices, vertexCount) {
  const links = Array.from({ length: vertexCount }, () => new Map());
  for (let offset = 0; offset + 2 < indices.length; offset += 3) {
    const [a, b, c] = indices.slice(offset, offset + 3);
    if (![a, b, c].every((id) => Number.isInteger(id) && id >= 0 && id < vertexCount)) continue;
    links[a].set(b, c);
    links[b].set(c, a);
    links[c].set(a, b);
  }
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const link = links[vertex];
    if (link.size === 0) continue;
    const start = link.keys().next().value;
    let steps = 0;
    let current = start;
    do {
      current = link.get(current);
      steps += 1;
    } while (current !== undefined && current !== start && steps <= link.size);
    if (current !== start || steps !== link.size) return vertex;
  }
  return null;
}

function faceComponents(triangleCount, edgeMap) {
  if (triangleCount === 0) return 0;
  const adjacent = Array.from({ length: triangleCount }, () => []);
  for (const records of edgeMap.values()) {
    if (records.length === 2) {
      adjacent[records[0].face].push(records[1].face);
      adjacent[records[1].face].push(records[0].face);
    }
  }
  const visited = new Set();
  let components = 0;
  for (let root = 0; root < triangleCount; root += 1) {
    if (visited.has(root)) continue;
    components += 1;
    const pending = [root];
    visited.add(root);
    while (pending.length) {
      for (const next of adjacent[pending.pop()]) {
        if (!visited.has(next)) {
          visited.add(next);
          pending.push(next);
        }
      }
    }
  }
  return components;
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function crossProduct(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
