import { diagnostic, validateDescription } from "./parameters.js";
import { buildPulleyMesh } from "./mesh.js";
import { MeshBuildError } from "./mesh-builder.js";
import { verifyMesh } from "./verify-mesh.js";

const SPOKE_PATHS = ["/web/count", "/web/width", "/web/filletRadius", "/generation/maxChordError"];

export function generatePulley(input) {
  const result = validateDescription(input);
  if (!result.ok) return result;

  let built;
  try {
    built = buildPulleyMesh(result.normalized, result.derived);
  } catch (error) {
    const known = error instanceof MeshBuildError;
    const code = known ? error.code : "E_BUILD_INTERNAL";
    const paths = code === "E_SELF_INTERSECTION" ? SPOKE_PATHS : [];
    return failed(result, diagnostic(code, "error", "build", paths, known ? error.details : { rule: "unexpected" }));
  }
  if (!built.ok) return failed(result, diagnostic(built.code, "error", "build", ["/generation/maxChordError"]));

  const verification = verifyMesh(built.mesh);
  if (!verification.ok) {
    const unique = new Map(verification.errors.map((error) => [error.code, error]));
    return failed(result, ...[...unique.values()].map((error) => diagnostic(error.code, "error", "build", [], error.details)));
  }

  return { ...result, mesh: built.mesh, contours: built.contours, verification };
}

function failed(result, ...diagnostics) {
  return { ...result, ok: false, diagnostics: [...result.diagnostics, ...diagnostics] };
}

export { validateDescription } from "./parameters.js";
export { verifyMesh } from "./verify-mesh.js";
