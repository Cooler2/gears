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

  const { normalized, derived } = result;
  return {
    ...result,
    mesh: built.mesh,
    contours: built.contours,
    verification,
    anchors: {
      axis: { origin: [0, 0, 0], direction: [0, 0, 1] },
      radii: {
        bore: derived.boreRadius,
        hub: derived.hubRadius,
        rimInner: derived.rimInnerRadius,
        grooveRoot: derived.grooveRootRadius,
        outside: derived.outsideRadius,
        pitch: derived.pitchRadius
      },
      zLevels: {
        lowerHub: derived.hubLowerZ,
        // far face of the flange, null without it
        lowerFlange: normalized.flanges.lower ? -normalized.rim.toothedWidth / 2 - normalized.flanges.lower.axialThickness : null,
        rimLower: -normalized.rim.toothedWidth / 2,
        webLower: derived.webLowerZ,
        webUpper: derived.webUpperZ,
        rimUpper: normalized.rim.toothedWidth / 2,
        upperFlange: normalized.flanges.upper ? normalized.rim.toothedWidth / 2 + normalized.flanges.upper.axialThickness : null,
        upperHub: derived.hubUpperZ
      }
    }
  };
}

function failed(result, ...diagnostics) {
  return { ...result, ok: false, diagnostics: [...result.diagnostics, ...diagnostics] };
}

export { validateDescription } from "./parameters.js";
export { verifyMesh } from "./verify-mesh.js";
