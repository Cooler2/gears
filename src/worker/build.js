// Gears — (c) 2026 Ivan Polyacov, Elastic License 2.0, see LICENSE
// Worker side of the browser adapter: one request, one generatePulley call.
// Kept apart from the Worker global scope so that Node tests run the same code.
import { generatePulley } from "../core/generate.js";

/**
 * Build the pulley for one request.
 *
 * The mesh travels as typed arrays whose buffers are transferred, not copied.
 * A failed build carries only diagnostics: the page must never receive a mesh
 * it could mistake for the current part.
 *
 * @param {{ id: number, description: unknown }} request
 * @returns {{ reply: object, transfer: ArrayBuffer[] }}
 */
export function handleBuildRequest({ id, description }) {
  const started = performance.now();
  let result;
  try {
    result = generatePulley(description);
  } catch (error) {
    // the core reports expected failures as diagnostics; an exception is a defect
    return { reply: { type: "crashed", id, message: String(error?.message ?? error) }, transfer: [] };
  }
  const reply = {
    type: "built",
    id,
    ok: result.ok,
    diagnostics: result.diagnostics,
    elapsed: performance.now() - started
  };
  if (!result.ok) return { reply, transfer: [] };

  const vertices = Float64Array.from(result.mesh.vertices);
  const indices = Uint32Array.from(result.mesh.indices);
  reply.mesh = { primitive: result.mesh.primitive, units: result.mesh.units, vertices, indices, bounds: result.mesh.bounds };
  reply.verification = {
    vertexCount: result.verification.vertexCount,
    triangleCount: result.verification.triangleCount,
    volume: result.verification.signedVolume
  };
  return { reply, transfer: [vertices.buffer, indices.buffer] };
}
