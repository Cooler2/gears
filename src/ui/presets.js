// Gears — (c) 2026 Ivan Polyacov, Elastic License 2.0, see LICENSE
// Ready-made variants: files from examples/valid; titles and texts for people are in
// the locale files. The variants page groups them by the kind written in the file.
// All but one lie flat on their lower face, ready to print.
import { T } from "./locale.js";

const preset = (file) => ({ file, get title() { return T.presets[file].title; }, get text() { return T.presets[file].text; } });

export const PRESETS = [
  preset("trial-20t.json"),
  preset("trial-60t.json"),
  preset("motor-d-flat.json"),
  preset("solid-basic.json"),
  preset("asymmetric.json"),
  preset("spokes-flanged.json"),
  preset("idler-shaft.json"),
  preset("idler-bearing.json"),
  preset("idler-spokes.json"),
  preset("gear-keyed-20t.json"),
  preset("gear-pinion-12t.json"),
  preset("gear-motor-12t.json"),
  preset("gear-spokes-60t.json"),
  preset("gear-helical-30t.json"),
  preset("gear-helical-15t.json"),
  preset("gear-herringbone-32t.json"),
  preset("gear-herringbone-12t.json")
];
