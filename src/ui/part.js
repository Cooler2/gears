// Gears — (c) 2026 Ivan Polyacov (ivan@apus-software.com), Elastic License 2.0, see LICENSE
// Questions about a description that the fields and the texts of every language ask.

export const isIdler = (description) => description?.kind === "idlerPulley";
/** Involute teeth: a gear on parallel shafts or a bevel gear. */
export const isGear = (description) => description?.kind === "gear" || description?.kind === "bevelGear";
export const isBevel = (description) => description?.kind === "bevelGear";
/** A gear whose teeth may be helical. */
export const isParallel = (description) => description?.kind === "gear";
export const isRack = (description) => description?.kind === "rack";
// gears and a rack share the involute tooth fields
export const isInvolute = (description) => isGear(description) || isRack(description);
// a rack meshes with a parallel gear, so its teeth may be inclined too
export const isInclined = (description) => (isParallel(description) || isRack(description)) && description.rim?.helix !== "none";
export const isSpokes = (description) => description.web?.type === "spokes";
// a rack has no axis: no web, hub or bore
export const hasWeb = (description) => !isRack(description) && description.web?.type !== "none";
