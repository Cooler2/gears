// Gears — (c) 2026 Ivan Polyacov, Elastic License 2.0, see LICENSE
// Camera and geometry helpers for the 3D preview. Pure functions, no WebGL, so
// the fit and orientation rules are tested in Node. Matrices are column-major
// Float32Array(16), as WebGL expects; the model's +Z axis points up on screen.

export function sphereOf(bounds) {
  const center = [0, 1, 2].map((axis) => (bounds.min[axis] + bounds.max[axis]) / 2);
  const radius = Math.hypot(...[0, 1, 2].map((axis) => (bounds.max[axis] - bounds.min[axis]) / 2));
  return { center, radius };
}

/** Distance at which a sphere of `radius` fits the narrower of the two view angles, with a margin. */
export function fitDistance(radius, fovY, aspect, margin = 1.08) {
  const fovX = 2 * Math.atan(Math.tan(fovY / 2) * aspect);
  return margin * radius / Math.sin(Math.min(fovY, fovX) / 2);
}

/** Eye position on a sphere around `target`: yaw from +X towards +Y, pitch above the XY plane. */
export function orbitEye(target, distance, yaw, pitch) {
  const horizontal = distance * Math.cos(pitch);
  return [
    target[0] + horizontal * Math.cos(yaw),
    target[1] + horizontal * Math.sin(yaw),
    target[2] + distance * Math.sin(pitch)
  ];
}

export function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

export function lookAt(eye, target, up = [0, 0, 1]) {
  const z = normalize(sub(eye, target));
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1
  ]);
}

export function multiply(a, b) {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/** Upper-left 3×3 of a rigid view matrix: rotates normals into view space. */
export function rotationOf(matrix) {
  return new Float32Array([matrix[0], matrix[1], matrix[2], matrix[4], matrix[5], matrix[6], matrix[8], matrix[9], matrix[10]]);
}

export function transformPoint(matrix, [x, y, z]) {
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  return [0, 1, 2].map((row) => (matrix[row] * x + matrix[4 + row] * y + matrix[8 + row] * z + matrix[12 + row]) / w);
}

/**
 * Unindexed copy of the mesh with one normal per face, shifted by `-origin`.
 * Flat shading shows the facets the STL really has, as a slicer does; the shift
 * keeps float32 precise for parts far from the origin.
 */
export function flatGeometry(vertices, indices, origin = [0, 0, 0]) {
  const positions = new Float32Array(indices.length * 3);
  const normals = new Float32Array(indices.length * 3);
  for (let face = 0; face < indices.length / 3; face += 1) {
    const corners = [0, 1, 2].map((corner) => {
      const id = indices[face * 3 + corner];
      return [vertices[id * 3] - origin[0], vertices[id * 3 + 1] - origin[1], vertices[id * 3 + 2] - origin[2]];
    });
    const normal = normalize(cross(sub(corners[1], corners[0]), sub(corners[2], corners[0])));
    for (let corner = 0; corner < 3; corner += 1) {
      positions.set(corners[corner], (face * 3 + corner) * 3);
      normals.set(normal, (face * 3 + corner) * 3);
    }
  }
  return { positions, normals };
}

/**
 * Square grid on the plane z = `level` around the axis, as line segment pairs.
 * The step is 10 mm for large parts and 5 mm for small ones, so there are always
 * a few lines to judge size by.
 */
export function gridLines(halfSize, level, origin = [0, 0, 0]) {
  const step = halfSize > 30 ? 10 : 5;
  const extent = Math.ceil(halfSize / step) * step;
  const lines = [];
  for (let offset = -extent; offset <= extent + 1e-9; offset += step) {
    lines.push(offset, -extent, level, offset, extent, level, -extent, offset, level, extent, offset, level);
  }
  const data = Float32Array.from(lines);
  for (let index = 0; index < data.length; index += 3) {
    data[index] -= origin[0];
    data[index + 1] -= origin[1];
    data[index + 2] -= origin[2];
  }
  return { data, step, extent };
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v) {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length > 0 ? [v[0] / length, v[1] / length, v[2] / length] : [0, 0, 0];
}
