# Gears: GT2 pulley and gear generator

Site: **https://apus-software.com/gears/** · [Русский](README.ru.md)

A browser generator of power transmission parts for 3D printing: a GT2 timing pulley, a smooth pulley (a tensioner or a belt idler) and an involute gear with straight, helical or herringbone teeth. Parameters are set in groups with explanatory drawings, and the part is built locally in a background thread of the browser. The result is shown in 3D and downloaded as STL. The interface is in Russian for now.

No generation server is needed: the JavaScript core runs both in the browser and in Node.js. There are no external dependencies and no build step; only Node.js 20 or newer is needed, for the local server, the command line and the tests.

The web, the hub and the bore are shared by all part kinds, flanges belong to pulleys only. Supported are any combination of lower and upper flanges, a solid web or straight spokes with fillets placed at the bottom, the top or the middle of the part, independent hub extensions, negative ones included, and four bore shapes: round, polygonal, D-shaped (with a flat) and keyed.

## Running

```powershell
npm run ui          # or node tools/serve.js 8517
```

Then open `http://127.0.0.1:8517/`. The server serves the project files and listens on `127.0.0.1` only; it is needed because browsers do not load ES modules, the schema and the examples from `file://`. If the port is taken, pass another one: `npm run ui -- 8518`. The address `localhost` may not work: browsers often try the IPv6 address `::1` first, where another program may answer.

The workflow: on the «Варианты» (variants) page you choose a part kind and a ready-made variant or a new part with default sizes, then set the parameters group by group — the rim, flanges, web and spokes, hub, shaft bore, model accuracy. Values are kept in `localStorage`; an address like `#group=web&field=/web/filletRadius` opens the group with the field focused. Next to the form, drawings explain every field: cross and axial sections, the chord tolerance diagram, and for a gear also close-up and side views of the teeth. Clicking a dimension goes to its field, clicking a part of the drawing opens its group. Errors and recommendations are shown next to the fields. «Скачать STL» (download STL) saves the part standing on the bed with its bottom face, «Сохранить» (save) and «Открыть» (open) save and load its description as JSON.

## Supported parts

| Parameter | Range | Default |
| --- | --- | --- |
| GT2 pulley: groove count `N` | 14…120 | 40 |
| Smooth pulley: rim diameter `D` | 5…150 mm | 20 |
| Gear: module `m` | 0.3…10 mm | 1 |
| Gear: tooth count `N` | 6…200 | 30 |
| Gear: pressure angle `α` | 14.5…30° | 20 |
| Gear: profile shift coefficient `x` | −1…1 | 0 |
| Gear: tooth thinning `j` | 0…1 mm | 0.1 |
| Gear: teeth / helix angle `β` | straight, helical, herringbone / −45…45° | straight / 20 |
| Width of the toothed part, gear rim or smooth rim `W` | 2…50 mm | 6 |
| Rim under the grooves or teeth, smooth rim wall `T_r` (radial) | 1…25 mm | 2 |
| Pulley flange: thickness / extension beyond the tips or the rim surface | 0.4…5 / 0.5…10 mm | 1 / 1 |
| Web or spokes: thinning / alignment / offset | 0…59 mm / bottom, centre, top / −60…60 mm | 0 / bottom / 0 |
| Spokes: count / width / fillet radius | 3…12 / 1…20 / 0.5…10 mm | 6 / 2.5 / 1 |
| Hub outer diameter | 2…100 mm | 10 |
| Bore: diameter (circumscribed circle for a polygon) | 0.5…50 mm | 5, round |
| Polygonal bore: side count | 3…12 | 6 |
| D-shaped bore: size across the flat | 0.3…50 mm, over `d/2` and under `d` | 4.5 |
| Keyed bore: key width / depth from the circle | 0.3…20 / 0.2…10 mm, width under `d` | 2 / 1 |
| Hub extensions below and above the faces of the part | −5…50 mm | 0 |
| Chord tolerance | 0.01…0.25 mm | 0.05 |

Besides the ranges, related constraints apply: tooth thickness after thinning and the space between teeth, the hub wall at its thinnest point, room between the hub and the rim, a web at least 1 mm thick, the web within the part, the hub along the whole height of the web, fillets and the spoke layout. A violation is explained next to the field. A gear warns about root undercut at small tooth counts and about pointed teeth. The sign of the helix angle sets the hand: plus is right-hand, minus is left-hand; the two gears of a pair have opposite signs.

The description format is `schemaVersion: 5`: the `kind` field (`timingPulley`, `idlerPulley` or `gear`) selects the rim. The web and the hub are measured from the faces of the part — the outer faces of the flanges, or the rim ends without a flange. By default the web is aligned to the bottom, and the part lies on the bed on its flat base. Files of earlier versions open and read with the same geometry and are saved as version 5. The full specification is [`docs/contract.md`](docs/contract.md), geometry and assumptions are in [`docs/geometry.md`](docs/geometry.md), the schema is [`schemas/pulley-v5.schema.json`](schemas/pulley-v5.schema.json); the documents are in Russian.

## Command line

```powershell
node src/cli/generate.js examples/valid/solid-basic.json out/solid-basic.stl --placement=onBed
```

The output directory must exist. By default the STL keeps the canonical model centred on `z=0`; `--placement=onBed` puts it on the bed, like the browser button, and such a file is byte-identical to the one downloaded from the browser. The command prints the size, the vertex and triangle counts, and on failure stable diagnostic codes.

Building a catalogue of all examples — STL files and `catalog.json` with sizes, diagnostics and hashes:

```powershell
node tools/build-catalog.js out/catalog "--blender=C:\Program Files\Blender 4.5\blender.exe"
```

The `--blender` option is optional: with it, Blender in background mode additionally checks every mesh — self-intersections, manifoldness, volume, overhang area — and renders an overview picture.

## Tests

```powershell
node --test
```

75 tests, about 15 seconds, no browser needed. The core is checked for reproducibility, profile formulas, related constraints and mesh invariants — orientation, closed edges, a single connected shell, positive volume; contour shapes and volume are compared with the analytical description, and the STL is read back by a separate parser. Form tests make sure every visible field has a dimension on the drawing of its group and every diagnostic has a text. Integration tests check the background thread: agreement with the core, the request queue, cancelling a long build and replacing a crashed thread. The end-to-end browser check is manual.

## Building the site

```powershell
npm run site                    # or node tools/build-site.js [directory]
node tools/serve.js 8517 dist   # check the built site
```

The build puts a static site into `dist/`: the page at the root, the modules, the schema and the examples next to it, without bundling or minification. Any static web server can serve the directory, for example nginx at `/gears/`; it has to serve `.js` as JavaScript and `.json` and `.svg` with their own types. There is no server side.

## Layout

- `src/core/` — the core, free of the browser and DOM: structure and diagnostics (`parameters.js`), rims and profiles (`rims.js`, `involute.js`, `contours.js`), spokes, mesh assembly and verification, drawing geometry, the entry point `generate.js`;
- `src/export/stl.js` — binary STL and placement on the bed;
- `src/worker/` — the background thread and its client: request queue, answer freshness, timeout and restart;
- `src/ui/` — the interface: fields and groups, state, SVG drawings, diagnostic texts, ready-made variants, a WebGL 3D view without libraries;
- `src/cli/generate.js` — generation from JSON;
- `src/about.js` — version, author and addresses, which sign the page and the generated files;
- `tools/` — local server, site and catalogue builds, Blender check; the core does not need them.

## Known limitations

- The `gt2-2mm-experimental-v1` profile is experimental: the pitch and the outside diameter match the catalogue, the groove shape is confirmed by printing only. Belt fit on test pulleys has not been checked.
- Gears are built without a root fillet, and real undercut is not modelled: below the base circle the flank runs radially, and a warning is shown for small tooth counts. Gear pairs — centre distance and meshing — are not checked; keeping the same module, pressure angle and helix angle magnitude in a pair is up to the user. Meshing of printed gears has not been tested.
- No load rating is claimed. Printer hole compensation is not built into the model: put the fit clearance into the bore diameter.
- The upper flange is printed as an overhang above the grooves, and its lower face comes out rough.
- The core does not fully check self-intersections: unlucky parameter combinations within the limits can give an incorrect model.
- Tested in Chrome and Edge on Windows, both Chromium-based; Firefox and Safari have not been tested. Without WebGL the 3D view is replaced by a message; building and STL still work.

## Author and license

Author: Ivan Polyacov, © 2026. The version is in `package.json` and `src/about.js`; releases are tagged `vX.Y.Z`.

The code is licensed under the [Elastic License 2.0](LICENSE): you may read it, run it yourself, modify it and send improvements. You may not offer the generator as a publicly available service (a public copy of the site) or remove the authorship and license notices. Contribution terms are in [`CONTRIBUTING.md`](CONTRIBUTING.md).

Models made with the generator — STL and JSON — belong to whoever made them and may be used without restriction, commercially included. The STL header and the JSON `generator` field carry the name, version and address of the program; removing them is allowed.
