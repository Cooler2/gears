// Numbers for people: up to `digits` decimals, trailing zeros dropped,
// decimal comma and typographic minus as in Russian technical texts.
export function formatNumber(value, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const rounded = Number(value.toFixed(digits));
  return String(Object.is(rounded, -0) ? 0 : rounded).replace(".", ",").replace("-", "−");
}

/** Text for an input box: numbers with a decimal comma, anything else as typed. */
export function inputText(value) {
  return typeof value === "number" ? String(value).replace(".", ",") : String(value ?? "");
}

/** "T_r" → base "T" and subscript "r"; symbols without "_" have no subscript. */
export function splitSymbol(symbol) {
  const index = symbol.indexOf("_");
  return index < 0 ? { base: symbol, sub: "" } : { base: symbol.slice(0, index), sub: symbol.slice(index + 1) };
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[char]);
}

export function symbolHtml(symbol) {
  const { base, sub } = splitSymbol(symbol);
  return `<i>${escapeHtml(base)}</i>${sub ? `<sub>${escapeHtml(sub)}</sub>` : ""}`;
}
