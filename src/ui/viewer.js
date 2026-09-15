// 3D preview of the built mesh: plain WebGL, no libraries, rendered on demand.
//
// The part is drawn flat-shaded, facet by facet, as the STL really is. Faces seen
// from behind get their own colour: on a closed, outward-oriented mesh they are
// never visible from outside, so that colour on screen means a broken surface.
// A grid on the bed plane gives the scale. Drag rotates, Shift/right/middle drag
// pans, the wheel or two fingers zoom, double click or 0 restores the view.
import { fitDistance, flatGeometry, gridLines, lookAt, multiply, orbitEye, perspective, rotationOf, sphereOf } from "./viewer-math.js";

const FOV = (30 * Math.PI) / 180;
const HOME = { yaw: -0.36 * Math.PI, pitch: 0.2 * Math.PI, zoom: 1 };
const PITCH_LIMIT = 0.49 * Math.PI;
const ZOOM_RANGE = [0.12, 8];

const MESH_VERTEX = `
attribute vec3 position;
attribute vec3 normal;
uniform mat4 viewProjection;
uniform mat3 viewRotation;
varying vec3 viewNormal;
void main() {
  viewNormal = viewRotation * normal;
  gl_Position = viewProjection * vec4(position, 1.0);
}`;

const MESH_FRAGMENT = `
precision mediump float;
varying vec3 viewNormal;
uniform vec3 frontColor;
uniform vec3 backColor;
uniform float stale;
void main() {
  vec3 n = normalize(viewNormal);
  if (!gl_FrontFacing) n = -n;
  float light = 0.34 + 0.56 * max(dot(n, normalize(vec3(0.35, 0.55, 0.9))), 0.0)
              + 0.18 * max(dot(n, normalize(vec3(-0.7, -0.3, 0.4))), 0.0);
  vec3 color = (gl_FrontFacing ? frontColor : backColor) * light;
  float grey = dot(color, vec3(0.299, 0.587, 0.114));
  gl_FragColor = vec4(mix(color, vec3(grey), stale * 0.85), 1.0);
}`;

const LINE_VERTEX = `
attribute vec3 position;
uniform mat4 viewProjection;
void main() {
  gl_Position = viewProjection * vec4(position, 1.0);
}`;

const LINE_FRAGMENT = `
precision mediump float;
uniform vec4 color;
void main() {
  gl_FragColor = color;
}`;

export class MeshViewer {
  /** Throws when the browser gives no WebGL context; the caller shows why. */
  constructor(canvas) {
    this.canvas = canvas;
    const options = { antialias: true, alpha: false };
    this.gl = canvas.getContext("webgl2", options) ?? canvas.getContext("webgl", options);
    if (!this.gl) throw new Error("no WebGL context");
    this.view = { ...HOME, pan: [0, 0, 0] };
    this.source = null; // { vertices, indices, bounds } of the part on screen
    this.stale = false;
    this.frame = 0;
    this.init();
    this.readColors();
    this.bindInput();
    new ResizeObserver(() => this.requestRender()).observe(canvas);
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      this.readColors();
      this.requestRender();
    });
    canvas.addEventListener("webglcontextlost", (event) => event.preventDefault());
    canvas.addEventListener("webglcontextrestored", () => {
      this.init();
      if (this.source) this.upload();
      this.requestRender();
    });
  }

  /**
   * Show a new mesh. The rotation and relative zoom stay, so changing a size
   * does not throw the view away; the camera distance follows the new size.
   */
  setMesh(mesh) {
    this.source = { vertices: mesh.vertices, indices: mesh.indices, bounds: mesh.bounds };
    this.view.pan = [0, 0, 0];
    this.upload();
    this.requestRender();
  }

  setStale(stale) {
    if (this.stale === stale) return;
    this.stale = stale;
    this.requestRender();
  }

  resetView() {
    this.view = { ...HOME, pan: [0, 0, 0] };
    this.requestRender();
  }

  init() {
    const gl = this.gl;
    this.meshProgram = program(gl, MESH_VERTEX, MESH_FRAGMENT);
    this.lineProgram = program(gl, LINE_VERTEX, LINE_FRAGMENT);
    this.buffers = { positions: gl.createBuffer(), normals: gl.createBuffer(), grid: gl.createBuffer() };
    gl.enable(gl.DEPTH_TEST);
  }

  upload() {
    const gl = this.gl;
    const { vertices, indices, bounds } = this.source;
    this.sphere = sphereOf(bounds);
    const origin = this.sphere.center;
    const { positions, normals } = flatGeometry(vertices, indices, origin);
    const halfSize = Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]) * 0.75;
    // a hair below the bottom faces, so the grid does not fight with them in the depth buffer
    const grid = gridLines(halfSize, bounds.min[2] - 0.02, origin);
    this.gridLevel = bounds.min[2] - origin[2];
    this.counts = { triangles: positions.length / 3, grid: grid.data.length / 3 };
    this.sceneRadius = Math.max(this.sphere.radius, grid.extent * Math.SQRT2);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.positions);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.normals);
    gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.grid);
    gl.bufferData(gl.ARRAY_BUFFER, grid.data, gl.STATIC_DRAW);
  }

  readColors() {
    const style = getComputedStyle(this.canvas);
    const read = (name, fallback) => parseColor(style.getPropertyValue(name)) ?? fallback;
    this.colors = {
      background: read("--paper", [0.98, 0.98, 0.97]),
      front: read("--model", [0.85, 0.62, 0.35]),
      back: read("--model-back", [0.8, 0.1, 0.1]),
      grid: read("--grid", [0.6, 0.6, 0.6])
    };
  }

  requestRender() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  /** Current camera: eye and target around the part centre, which is the origin of the uploaded data. */
  camera(aspect) {
    const { yaw, pitch, zoom, pan } = this.view;
    const distance = fitDistance(this.sphere.radius, FOV, aspect) * zoom;
    const eye = orbitEye(pan, distance, yaw, pitch);
    return { eye, target: pan, distance };
  }

  render() {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) Object.assign(this.canvas, { width, height });
    gl.viewport(0, 0, width, height);
    gl.clearColor(...this.colors.background, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.source) return;

    const aspect = width / height;
    const { eye, target } = this.camera(aspect);
    const view = lookAt(eye, target);
    const reach = Math.hypot(...eye);
    const near = Math.max(reach - 1.2 * this.sceneRadius, reach * 0.01);
    const viewProjection = multiply(perspective(FOV, aspect, near, reach + 1.2 * this.sceneRadius), view);

    // seen from below, the bed would cover the part: the grid is only drawn from above
    if (eye[2] > this.gridLevel) {
      gl.useProgram(this.lineProgram.handle);
      gl.uniformMatrix4fv(this.lineProgram.uniforms.viewProjection, false, viewProjection);
      gl.uniform4f(this.lineProgram.uniforms.color, ...this.colors.grid, 1);
      const gridAttributes = [attribute(gl, this.lineProgram, "position", this.buffers.grid)];
      gl.drawArrays(gl.LINES, 0, this.counts.grid);
      release(gl, gridAttributes);
    }

    gl.useProgram(this.meshProgram.handle);
    gl.uniformMatrix4fv(this.meshProgram.uniforms.viewProjection, false, viewProjection);
    gl.uniformMatrix3fv(this.meshProgram.uniforms.viewRotation, false, rotationOf(view));
    gl.uniform3f(this.meshProgram.uniforms.frontColor, ...this.colors.front);
    gl.uniform3f(this.meshProgram.uniforms.backColor, ...this.colors.back);
    gl.uniform1f(this.meshProgram.uniforms.stale, this.stale ? 1 : 0);
    const meshAttributes = [
      attribute(gl, this.meshProgram, "position", this.buffers.positions),
      attribute(gl, this.meshProgram, "normal", this.buffers.normals)
    ];
    gl.drawArrays(gl.TRIANGLES, 0, this.counts.triangles);
    release(gl, meshAttributes);
  }

  // ------------------------------------------------------------------ input

  rotate(dYaw, dPitch) {
    this.view.yaw += dYaw;
    this.view.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.view.pitch + dPitch));
    this.requestRender();
  }

  zoomBy(factor) {
    this.view.zoom = Math.max(ZOOM_RANGE[0], Math.min(ZOOM_RANGE[1], this.view.zoom * factor));
    this.requestRender();
  }

  /** Move the target with the screen: `dx`, `dy` in CSS pixels. */
  panBy(dx, dy) {
    if (!this.source) return;
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const { eye, target, distance } = this.camera(aspect);
    const view = lookAt(eye, target);
    const perPixel = (2 * distance * Math.tan(FOV / 2)) / Math.max(1, this.canvas.clientHeight);
    for (let axis = 0; axis < 3; axis += 1) {
      // rows of the view rotation are the screen right and up directions in model space
      this.view.pan[axis] += (-dx * view[axis * 4] + dy * view[axis * 4 + 1]) * perPixel;
    }
    this.requestRender();
  }

  bindInput() {
    const canvas = this.canvas;
    const pointers = new Map();
    let mode = "rotate";
    let pinch = 0;
    const spread = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    canvas.addEventListener("pointerdown", (event) => {
      canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      mode = event.button === 1 || event.button === 2 || event.shiftKey ? "pan" : "rotate";
      if (pointers.size === 2) pinch = spread();
    });
    canvas.addEventListener("pointermove", (event) => {
      const last = pointers.get(event.pointerId);
      if (!last) return;
      const dx = event.clientX - last.x;
      const dy = event.clientY - last.y;
      last.x = event.clientX;
      last.y = event.clientY;
      if (pointers.size === 2) {
        const next = spread();
        if (pinch > 0 && next > 0) this.zoomBy(pinch / next);
        pinch = next;
      } else if (mode === "pan") {
        this.panBy(dx, dy);
      } else {
        this.rotate(-dx * 0.008, dy * 0.008);
      }
    });
    const release = (event) => {
      pointers.delete(event.pointerId);
      pinch = 0;
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    canvas.addEventListener("dblclick", () => this.resetView());
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.zoomBy(Math.exp(event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0015)));
    }, { passive: false });
    canvas.addEventListener("keydown", (event) => {
      const step = Math.PI / 12;
      const actions = {
        ArrowLeft: () => (event.shiftKey ? this.panBy(-20, 0) : this.rotate(step, 0)),
        ArrowRight: () => (event.shiftKey ? this.panBy(20, 0) : this.rotate(-step, 0)),
        ArrowUp: () => (event.shiftKey ? this.panBy(0, -20) : this.rotate(0, -step)),
        ArrowDown: () => (event.shiftKey ? this.panBy(0, 20) : this.rotate(0, step)),
        "+": () => this.zoomBy(1 / 1.25),
        "=": () => this.zoomBy(1 / 1.25),
        "-": () => this.zoomBy(1.25),
        "0": () => this.resetView(),
        Home: () => this.resetView()
      };
      const action = actions[event.key];
      if (!action) return;
      event.preventDefault();
      action();
    });
  }
}

function program(gl, vertexSource, fragmentSource) {
  const handle = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(shader));
    gl.attachShader(handle, shader);
  }
  gl.linkProgram(handle);
  if (!gl.getProgramParameter(handle, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(handle));
  const uniforms = {};
  for (let index = 0; index < gl.getProgramParameter(handle, gl.ACTIVE_UNIFORMS); index += 1) {
    const { name } = gl.getActiveUniform(handle, index);
    uniforms[name] = gl.getUniformLocation(handle, name);
  }
  return { handle, uniforms, attributes: {} };
}

function attribute(gl, prog, name, buffer) {
  prog.attributes[name] ??= gl.getAttribLocation(prog.handle, name);
  const location = prog.attributes[name];
  if (location < 0) return location;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
  return location;
}

/** Disable after drawing: an array left enabled would be checked against the next program's draw. */
function release(gl, locations) {
  for (const location of locations) if (location >= 0) gl.disableVertexAttribArray(location);
}

/** "#rgb", "#rrggbb" or "rgb(r, g, b)" → [r, g, b] in 0…1; null for anything else. */
export function parseColor(text) {
  const value = text.trim();
  let match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (match) {
    const hex = match[1].length === 3 ? [...match[1]].map((digit) => digit + digit).join("") : match[1];
    return [0, 2, 4].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  }
  match = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(value);
  return match ? match.slice(1, 4).map((channel) => Number(channel) / 255) : null;
}
