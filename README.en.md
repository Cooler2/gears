# Gears: GT2 pulley and gear generator

Site: **https://apus-software.com/gears/** · [Русский](README.md)

A browser generator of power transmission parts for 3D printing: GT2 timing pulleys, smooth idler pulleys and involute gears with straight, helical or herringbone teeth. Parameters are grouped and explained by live drawings; the part is built locally in a background thread of the browser, shown in 3D and downloaded as STL. The interface is in Russian for now.

No generation server is needed: the JavaScript core runs both in the browser and in Node.js. There are no dependencies; Node.js 20 or newer is needed only for the local server, the command line and the tests.

All kinds share the web, the hub and the bore; pulleys also have flanges. Supported: any combination of lower and upper flanges, a solid web or straight spokes with fillets placed at the bottom, the top or the middle of the part, independent (including negative) hub extensions, and round, polygonal, D-flat and keyed bores.

## Running locally

```sh
npm run ui          # or: node tools/serve.js 8517
```

Then open `http://127.0.0.1:8517/`. The server is needed because browsers do not load ES modules from `file://`.

Command line, which writes the same STL as the browser:

```sh
node src/cli/generate.js examples/valid/solid-basic.json out/solid-basic.stl --placement=onBed
```

Tests: `node --test` (75 tests, about 15 seconds, no browser).

## Building the site

```sh
npm run site                    # static site in dist/, the page at its root
node tools/serve.js 8517 dist   # check the built site
```

Nothing is bundled: `dist/` holds the page, the modules, the schema and the examples, and any static web server can serve it.

## Documentation

The description format (`schemaVersion: 5`) is specified in [`docs/contract.md`](docs/contract.md), the geometry in [`docs/geometry.md`](docs/geometry.md), the schema is [`schemas/pulley-v5.schema.json`](schemas/pulley-v5.schema.json). These documents are in Russian.

## Known limitations

- The GT2 tooth profile is experimental: the pitch and the outside diameter match the catalogue, the groove shape is confirmed by printing only.
- Gears have no root fillet, and undercut is not modelled (a warning is shown for small tooth counts). Gear pairs, centre distance and meshing are not checked.
- No load rating is claimed. Printer hole compensation is not built in: put the fit clearance into the bore diameter.
- The core does not fully check self-intersections: unlucky parameter combinations within the limits can give an incorrect model.
- Tested in Chrome and Edge on Windows.

## Author and license

© 2026 Ivan Polyacov. Releases are tagged `vX.Y.Z`.

The code is licensed under the [Elastic License 2.0](LICENSE): you may read it, run it yourself, modify it and send improvements. You may not offer the generator to others as a hosted service (a public copy of the site), nor remove the authorship and license notices. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the contribution terms.

Models made with the generator (STL and JSON files) belong to whoever made them and may be used without restriction, commercially included. The STL header and the JSON `generator` field name the program, its version and its address; removing them is allowed.
