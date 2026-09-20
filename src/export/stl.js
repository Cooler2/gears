// Gears — (c) 2026 Ivan Polyacov (ivan@apus-software.com), Elastic License 2.0, see LICENSE
import { GENERATOR } from "../about.js";

export function exportBinaryStl(mesh, { placement = "model" } = {}) {
  if (!mesh || mesh.primitive !== "triangles" || mesh.units !== "mm") {
    throw new TypeError("A successful millimetre triangle mesh is required");
  }
  if (placement !== "model" && placement !== "onBed") {
    throw new RangeError("placement must be 'model' or 'onBed'");
  }
  const translation = placement === "onBed" ? [0, 0, -mesh.bounds.min[2]] : [0, 0, 0];
  const triangleCount = mesh.indices.length / 3;
  const buffer = new ArrayBuffer(84 + 50 * triangleCount);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const header = new TextEncoder().encode(`${GENERATOR}; units mm`) // ASCII, under 80 bytes;
  bytes.set(header.slice(0, 80));
  view.setUint32(80, triangleCount, true);
  let offset = 84;
  for (let face = 0; face < triangleCount; face += 1) {
    // indexed access rather than slice().map(): a typed index array would map into itself
    const vertices = [0, 1, 2].map((corner) => {
      const id = mesh.indices[face * 3 + corner];
      return [
        mesh.vertices[id * 3] + translation[0],
        mesh.vertices[id * 3 + 1] + translation[1],
        mesh.vertices[id * 3 + 2] + translation[2]
      ];
    });
    const normal = unitNormal(vertices[0], vertices[1], vertices[2]);
    for (const value of normal) { view.setFloat32(offset, value, true); offset += 4; }
    for (const vertex of vertices) {
      for (const value of vertex) { view.setFloat32(offset, value, true); offset += 4; }
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  }
  return {
    format: "stl",
    placement,
    placementTranslation: translation,
    sourceBounds: cloneBounds(mesh.bounds),
    exportedBounds: {
      min: mesh.bounds.min.map((value, axis) => value + translation[axis]),
      max: mesh.bounds.max.map((value, axis) => value + translation[axis])
    },
    data: bytes
  };
}

function unitNormal(a, b, c) {
  const ab = b.map((value, axis) => value - a[axis]);
  const ac = c.map((value, axis) => value - a[axis]);
  const cross = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0]
  ];
  const length = Math.hypot(...cross);
  return cross.map((value) => value / length);
}

function cloneBounds(bounds) {
  return { min: [...bounds.min], max: [...bounds.max] };
}
