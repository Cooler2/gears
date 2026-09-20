// Gears — (c) 2026 Ivan Polyacov (ivan@apus-software.com), Elastic License 2.0, see LICENSE
// Texts of contract diagnostics in the page language, see the locale files.
import { T } from "./locale.js";

export function diagnosticText(diagnostic, description) {
  const text = T.diagnostics[diagnostic.code];
  // the paths tell a smooth rim, which is sized by its diameter, from a toothed one; the description tells it for the rest
  const smooth = diagnostic.paths.includes("/rim/outerDiameter") || description?.kind === "idlerPulley";
  return text ? text(diagnostic.details ?? {}, smooth, diagnostic.paths) : diagnostic.code;
}

/** Warnings of phase "print" are advice, everything else with severity error blocks building. */
export function diagnosticKind(diagnostic) {
  if (diagnostic.severity === "error") return "error";
  return diagnostic.phase === "print" ? "advice" : "warning";
}
