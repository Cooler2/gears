// Gears — (c) 2026 Ivan Polyacov (ivan@apus-software.com), Elastic License 2.0, see LICENSE
// Questions about a description that the fields and the texts of every language ask.

export const isIdler = (description) => description?.kind === "idlerPulley";
/** Involute teeth: a gear on parallel shafts or a bevel gear. */
export const isGear = (description) => description?.kind === "gear" || description?.kind === "bevelGear";
export const isBevel = (description) => description?.kind === "bevelGear";
/** A gear whose teeth may be helical. */
export const isParallel = (description) => description?.kind === "gear";
export const isInclined = (description) => isParallel(description) && description.rim?.helix !== "none";
export const isSpokes = (description) => description.web?.type === "spokes";
export const hasWeb = (description) => description.web?.type !== "none";
