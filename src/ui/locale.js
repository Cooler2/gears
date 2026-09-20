// Gears — (c) 2026 Ivan Polyacov (ivan@apus-software.com), Elastic License 2.0, see LICENSE
// Texts of the page language: <html lang> of the page, English without a page (Node, tests).
import en from "./locale-en.js";
import ru from "./locale-ru.js";

export const LOCALES = { en, ru };
export let LANG = globalThis.document?.documentElement.lang === "ru" ? "ru" : "en";
export let T = LOCALES[LANG];

/** Switches the texts; the page never does it, tests do. */
export function setLanguage(lang) {
  LANG = lang;
  T = LOCALES[lang];
}

/** A text that may depend on the description. */
export function resolve(text, description) {
  return typeof text === "function" ? text(description) : text;
}
