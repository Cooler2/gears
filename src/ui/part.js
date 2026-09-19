// Gears — (c) 2026 Ivan Polyacov, Elastic License 2.0, see LICENSE
// Questions about a description that the fields and the texts of every language ask.

export const isIdler = (description) => description?.kind === "idlerPulley";
export const isGear = (description) => description?.kind === "gear";
export const isInclined = (description) => isGear(description) && description.rim?.helix !== "none";
export const isSpokes = (description) => description.web?.type === "spokes";
export const hasWeb = (description) => description.web?.type !== "none";
