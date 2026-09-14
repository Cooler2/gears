import { diagnostic, validateDescription } from "./parameters.js";
import { buildSolidPulleyMesh } from "./mesh.js";
import { verifyMesh } from "./verify-mesh.js";

export function generatePulley(input) {
  const result = validateDescription(input);
  if (!result.ok) return result;

  const unsupportedPaths = [];
  if (result.normalized.web.type !== "solid") unsupportedPaths.push("/web/type");
  if (result.normalized.flanges.lower !== null) unsupportedPaths.push("/flanges/lower");
  if (result.normalized.flanges.upper !== null) unsupportedPaths.push("/flanges/upper");
  if (result.normalized.hub.lowerExtension !== 0) unsupportedPaths.push("/hub/lowerExtension");
  if (result.normalized.hub.upperExtension !== 0) unsupportedPaths.push("/hub/upperExtension");
  if (unsupportedPaths.length) {
    return {
      ...result,
      ok: false,
      diagnostics: [...result.diagnostics, diagnostic(
        "E_STAGE2_UNSUPPORTED",
        "error",
        "build",
        unsupportedPaths,
        { supportedVariant: "solid web, no flanges, zero hub extensions" }
      )]
    };
  }

  let built;
  try {
    built = buildSolidPulleyMesh(result.normalized, result.derived);
  } catch {
    return {
      ...result,
      ok: false,
      diagnostics: [...result.diagnostics, diagnostic(
        "E_BUILD_INTERNAL",
        "error",
        "build",
        [],
        { rule: "annulusTriangulation" }
      )]
    };
  }
  if (!built.ok) {
    return {
      ...result,
      ok: false,
      diagnostics: [...result.diagnostics, diagnostic(built.code, "error", "build", ["/generation/maxChordError"])]
    };
  }

  const verification = verifyMesh(built.mesh);
  if (!verification.ok) {
    const unique = new Map(verification.errors.map((error) => [error.code, error]));
    return {
      ...result,
      ok: false,
      diagnostics: [
        ...result.diagnostics,
        ...[...unique.values()].map((error) => diagnostic(error.code, "error", "build", [], error.details))
      ]
    };
  }

  return {
    ...result,
    mesh: built.mesh,
    contours: built.contours,
    verification,
    anchors: {
      axis: { origin: [0, 0, 0], direction: [0, 0, 1] },
      radii: {
        bore: result.derived.boreRadius,
        hub: result.derived.hubRadius,
        rimInner: result.derived.rimInnerRadius,
        grooveRoot: result.derived.grooveRootRadius,
        outside: result.derived.outsideRadius,
        pitch: result.derived.pitchRadius
      },
      zLevels: {
        lowerHub: result.derived.hubLowerZ,
        lowerFlange: -result.normalized.rim.toothedWidth / 2,
        rimLower: -result.normalized.rim.toothedWidth / 2,
        webLower: result.derived.webLowerZ,
        webUpper: result.derived.webUpperZ,
        rimUpper: result.normalized.rim.toothedWidth / 2,
        upperFlange: result.normalized.rim.toothedWidth / 2,
        upperHub: result.derived.hubUpperZ
      }
    }
  };
}

export { validateDescription } from "./parameters.js";
export { verifyMesh } from "./verify-mesh.js";
