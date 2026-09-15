// Browser adapter without a browser: the worker's build step, the request
// client driven through a fake worker and clock, and the 3D preview's camera
// and geometry rules.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { generatePulley } from "../src/core/generate.js";
import { exportBinaryStl } from "../src/export/stl.js";
import { parseColor } from "../src/ui/viewer.js";
import { fitDistance, flatGeometry, gridLines, lookAt, multiply, orbitEye, perspective, sphereOf, transformPoint } from "../src/ui/viewer-math.js";
import { handleBuildRequest } from "../src/worker/build.js";
import { BuildClient } from "../src/worker/client.js";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const trial60 = await readJson("../examples/valid/trial-60t.json");
const trial20 = await readJson("../examples/valid/trial-20t.json");

// ------------------------------------------------------------------ worker

test("the worker reply carries the core mesh as transferable typed arrays", () => {
  const { reply, transfer } = handleBuildRequest({ id: 7, description: trial60 });
  const direct = generatePulley(trial60);
  assert.equal(reply.type, "built");
  assert.equal(reply.id, 7);
  assert.equal(reply.ok, true);
  assert.ok(reply.mesh.vertices instanceof Float64Array);
  assert.ok(reply.mesh.indices instanceof Uint32Array);
  assert.deepEqual(transfer, [reply.mesh.vertices.buffer, reply.mesh.indices.buffer]);
  assert.deepEqual([...reply.mesh.vertices], direct.mesh.vertices);
  assert.deepEqual([...reply.mesh.indices], direct.mesh.indices);
  assert.deepEqual(reply.mesh.bounds, direct.mesh.bounds);
  assert.equal(reply.verification.triangleCount, direct.verification.triangleCount);
  assert.deepEqual(reply.diagnostics, direct.diagnostics);
  // the reply survives the structured clone postMessage performs
  assert.deepEqual(structuredClone(reply).mesh.bounds, reply.mesh.bounds);
});

test("STL from the worker's typed arrays equals STL from the core's plain arrays", () => {
  const { reply } = handleBuildRequest({ id: 1, description: trial20 });
  const direct = generatePulley(trial20);
  for (const placement of ["model", "onBed"]) {
    const fromWorker = exportBinaryStl(reply.mesh, { placement }).data;
    const fromCore = exportBinaryStl(direct.mesh, { placement }).data;
    assert.equal(Buffer.compare(Buffer.from(fromWorker), Buffer.from(fromCore)), 0, placement);
  }
});

test("a description that cannot be built gets diagnostics and no mesh", () => {
  const description = structuredClone(trial60);
  description.hub.outerDiameter = 36;
  const { reply, transfer } = handleBuildRequest({ id: 2, description });
  assert.equal(reply.type, "built");
  assert.equal(reply.ok, false);
  assert.equal(reply.mesh, undefined);
  assert.deepEqual(transfer, []);
  assert.ok(reply.diagnostics.some(({ code }) => code === "E_RADIAL_ORDER"));
});

test("an exception inside the core is reported, not thrown out of the worker", () => {
  const hostile = { get schemaVersion() { throw new Error("getter"); } };
  const { reply } = handleBuildRequest({ id: 3, description: hostile });
  assert.deepEqual(reply, { type: "crashed", id: 3, message: "getter" });
});

// ------------------------------------------------------------------ client

class FakeClock {
  constructor() { this.time = 0; this.timers = new Map(); this.next = 1; }
  now() { return this.time; }
  setTimeout(callback, ms) { const id = this.next++; this.timers.set(id, { at: this.time + ms, callback }); return id; }
  clearTimeout(id) { this.timers.delete(id); }
  advance(ms) {
    const until = this.time + ms;
    for (;;) {
      const due = [...this.timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.time = due[1].at;
      due[1].callback();
    }
    this.time = until;
  }
}

class FakeWorker {
  constructor() { this.posted = []; this.listeners = {}; this.terminated = false; }
  addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
  postMessage(message) { this.posted.push(message); }
  terminate() { this.terminated = true; }
  reply(data) { for (const listener of this.listeners.message ?? []) listener({ data }); }
  crash(message) { for (const listener of this.listeners.error ?? []) listener({ message, preventDefault() {} }); }
  answer(ok = true) {
    const { id } = this.posted.at(-1);
    this.reply({ type: "built", id, ok, diagnostics: [] });
  }
}

function harness(options = {}) {
  const clock = new FakeClock();
  const workers = [];
  const results = [];
  const client = new BuildClient({
    createWorker: () => {
      if (options.noWorker) throw new Error("no Worker");
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    onResult: (answer) => results.push(answer),
    timeoutMs: 1000,
    supersedeAfterMs: 300,
    clock
  });
  return { clock, workers, results, client };
}

test("a single request is built and delivered with its key", () => {
  const { workers, results, client } = harness();
  client.request("A", { a: 1 });
  assert.equal(workers.length, 1);
  assert.deepEqual(workers[0].posted, [{ type: "build", id: 1, description: { a: 1 } }]);
  assert.equal(client.busy, true);
  workers[0].answer();
  assert.deepEqual(results.map(({ key, reply }) => [key, reply.id]), [["A", 1]]);
  assert.equal(client.busy, false);
});

test("while a build runs only the latest request waits, and the stale answer is dropped", () => {
  const { workers, results, client } = harness();
  client.request("A", "a");
  client.request("B", "b");
  client.request("C", "c");
  assert.equal(workers[0].posted.length, 1, "one build at a time");
  workers[0].answer(); // answer for A: no longer current
  assert.deepEqual(results, []);
  assert.deepEqual(workers[0].posted.map(({ description }) => description), ["a", "c"], "B was superseded by C before it started");
  workers[0].answer();
  assert.deepEqual(results.map(({ key }) => key), ["C"]);
});

test("asking again for the key being built does not queue it twice", () => {
  const { workers, results, client } = harness();
  client.request("A", "a");
  client.request("B", "b");
  client.request("A", "a");
  workers[0].answer();
  assert.equal(workers[0].posted.length, 1);
  assert.deepEqual(results.map(({ key }) => key), ["A"]);
});

test("parameters that cannot be built make the running build stale", () => {
  const { workers, results, client } = harness();
  client.request("A", "a");
  client.request("broken", null);
  assert.equal(client.busy, false);
  workers[0].answer();
  assert.deepEqual(results, []);
  assert.equal(workers[0].posted.length, 1);
});

test("answers with unknown ids are ignored", () => {
  const { workers, results, client } = harness();
  client.request("A", "a");
  workers[0].reply({ type: "built", id: 99, ok: true, diagnostics: [] });
  assert.deepEqual(results, []);
  workers[0].answer();
  assert.equal(results.length, 1);
});

test("a silent worker times out, is terminated and replaced on the next request", () => {
  const { clock, workers, results, client } = harness();
  client.request("A", "a");
  clock.advance(999);
  assert.deepEqual(results, []);
  clock.advance(1);
  assert.equal(workers[0].terminated, true);
  assert.deepEqual(results.map(({ key, reply }) => [key, reply.type, reply.message]), [["A", "crashed", "timeout"]]);
  client.request("B", "b");
  assert.equal(workers.length, 2);
  workers[1].answer();
  assert.deepEqual(results.map(({ key }) => key), ["A", "B"]);
});

test("a worker error fails the running build and the waiting request goes to a new worker", () => {
  const { workers, results, client } = harness();
  client.request("A", "a");
  client.request("B", "b");
  workers[0].crash("boom");
  assert.equal(workers[0].terminated, true);
  assert.deepEqual(results, [], "the failure of A is stale: B is current");
  assert.equal(workers.length, 2);
  assert.equal(workers[1].posted[0].description, "b");
  workers[1].answer();
  assert.deepEqual(results.map(({ key }) => key), ["B"]);
});

test("a long build is cancelled when a newer request has waited long enough", () => {
  const { clock, workers, results, client } = harness();
  client.request("A", "a");
  clock.advance(100);
  client.request("B", "b");
  clock.advance(199);
  assert.equal(workers.length, 1);
  clock.advance(1); // 300 ms since A started
  assert.equal(workers[0].terminated, true);
  assert.equal(workers[1].posted[0].description, "b");
  workers[1].answer();
  assert.deepEqual(results.map(({ key }) => key), ["B"]);
  clock.advance(5000);
  assert.equal(results.length, 1, "no timeout fires for the cancelled build");
});

test("without a worker the request fails visibly instead of hanging", () => {
  const { clock, results, client } = harness({ noWorker: true });
  client.request("A", "a");
  assert.deepEqual(results, []);
  clock.advance(0);
  assert.deepEqual(results.map(({ key, reply }) => [key, reply.type, reply.message]), [["A", "crashed", "no Worker"]]);
});

// ------------------------------------------------------------------ viewer

test("the fitted camera keeps the whole bounding sphere on screen", () => {
  const { mesh } = generatePulley(trial60);
  const { center, radius } = sphereOf(mesh.bounds);
  const fov = Math.PI / 6;
  for (const aspect of [0.5, 1, 4 / 3, 2.5]) {
    const distance = fitDistance(radius, fov, aspect);
    for (const [yaw, pitch] of [[0, 0], [-1.1, 0.6], [2, -1.2]]) {
      const eye = orbitEye(center, distance, yaw, pitch);
      const matrix = multiply(perspective(fov, aspect, distance - radius, distance + radius), lookAt(eye, center));
      assert.deepEqual(transformPoint(matrix, center).slice(0, 2).map((value) => Math.round(value * 1e6) / 1e6 + 0), [0, 0]);
      for (let index = 0; index < mesh.vertices.length; index += 3) {
        const [x, y] = transformPoint(matrix, mesh.vertices.slice(index, index + 3));
        assert.ok(Math.abs(x) <= 1 && Math.abs(y) <= 1, `aspect ${aspect}, vertex ${index / 3}`);
      }
    }
  }
});

test("flat geometry keeps outward faces: its divergence volume equals the mesh volume", () => {
  const result = generatePulley(trial60);
  const { center } = sphereOf(result.mesh.bounds);
  const { positions, normals } = flatGeometry(result.mesh.vertices, result.mesh.indices, center);
  assert.equal(positions.length, result.mesh.indices.length * 3);
  let volume = 0;
  for (let face = 0; face < positions.length / 9; face += 1) {
    const corner = (k) => [0, 1, 2].map((axis) => positions[face * 9 + k * 3 + axis]);
    const [a, b, c] = [corner(0), corner(1), corner(2)];
    const normal = [0, 1, 2].map((axis) => normals[face * 9 + axis]);
    assert.ok(Math.abs(Math.hypot(...normal) - 1) < 1e-5);
    const ab = [0, 1, 2].map((axis) => b[axis] - a[axis]);
    const ac = [0, 1, 2].map((axis) => c[axis] - a[axis]);
    const area = Math.hypot(ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]) / 2;
    const centroid = [0, 1, 2].map((axis) => (a[axis] + b[axis] + c[axis]) / 3);
    volume += (area * (centroid[0] * normal[0] + centroid[1] * normal[1] + centroid[2] * normal[2])) / 3;
  }
  assert.ok(Math.abs(volume - result.verification.signedVolume) / result.verification.signedVolume < 1e-4, `${volume} vs ${result.verification.signedVolume}`);
});

test("the bed grid covers the part and lies on the given level", () => {
  const small = gridLines(11, -4.5);
  assert.equal(small.step, 5);
  assert.equal(small.extent, 15);
  const large = gridLines(45, 0, [1, 2, 3]);
  assert.equal(large.step, 10);
  assert.equal(large.extent, 50);
  for (let index = 0; index < small.data.length; index += 3) assert.equal(small.data[index + 2], -4.5);
  for (let index = 0; index < large.data.length; index += 3) assert.equal(large.data[index + 2], -3);
});

test("preview colours are read from CSS values", () => {
  assert.deepEqual(parseColor(" #ff8000 "), [1, 128 / 255, 0]);
  assert.deepEqual(parseColor("#fff"), [1, 1, 1]);
  assert.deepEqual(parseColor("rgb(0, 51, 255)"), [0, 0.2, 1]);
  assert.equal(parseColor("var(--x)"), null);
});
