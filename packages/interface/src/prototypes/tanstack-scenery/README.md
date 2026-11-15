# Review the TanStack scenery prototype

This throwaway prototype tests whether a bundled geographic overview works for the scenery library. It uses TanStack Charts and D3 gestures. It has no production route, IPC calls, persistent data, or tile requests.

Run this command from the repository root with Node 24:

```sh
pnpm prototype:scenery
```

The runner installs isolated dependencies with `npm ci --ignore-scripts` on first use, builds the page, and serves it at localhost:5180. Installation needs internet. The built page works offline. Stop the server with Ctrl+C.

Open either layout:

- `http://127.0.0.1:5180/?variant=overview` shows the map first.
- `http://127.0.0.1:5180/?variant=inspector` puts a wider inventory beside the map.

Use the floating arrows to switch layouts. Left and right keyboard arrows also switch layouts when focus is outside inputs and the map. Both layouts use the same library, filters, and selection. A layout or viewport resize restores the world view.

## Review the interactions

1. Select KSEA on the map or in the list. Its details list both simulator installations.
2. Click **Focus airport** to center the selected location at regional zoom. Selection alone preserves the camera.
3. Drag to pan. Use **+**, **−**, and **World overview** to change the view. The mouse wheel remains available for page scroll.
4. Search for an airport, code, or package. Filter by simulator or location availability. The map, list, and counts use the same filtered records.
5. Select Vancouver or Regional scenery. Both remain in the inventory without a map point. The focus button is disabled.
6. Try the empty library, missing coordinates, and synthetic density scenarios. The density scenario is not a performance benchmark.

Zoom magnifies the bundled Natural Earth 110m land geometry. It does not load more detailed roads, terrain, or airport outlines. Nearby points do not form zoom-dependent clusters. Exactly coincident points share one marker and retain their installation choices.

## Import an inventory snapshot

Open **Review an inventory JSON snapshot**. Download the sample JSON to inspect the input format. Import that file or an existing snapshot of `SimulatorInventory[]`.

The app has no export action yet. This prototype does not automatically read installed scenery. Imported data stays in memory and disappears on reload. The source label distinguishes samples from imports.

The importer checks the fields this view uses. It joins packages by simulator and folder, and identifies airports by simulator, folder, and source key. An airport with no code remains an airport. Missing, partial, nonfinite, or out-of-range coordinates become unavailable. Zero coordinates remain valid. Duplicate identities or malformed collections reject the import and preserve the previous library. Airport records with no matching package remain visible with a diagnostic message.

## Build a standalone page

```sh
node packages/interface/src/prototypes/tanstack-scenery/build.mjs
```

Open `dist/index.html` inside this prototype directory. The file bundles JavaScript, CSS, and geography. The generated file is gitignored. Source and the isolated npm lockfile reproduce the bundle.

The land geometry comes from [Natural Earth 110m land](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson), under its [public-domain terms](https://www.naturalearthdata.com/about/terms-of-use/). TanStack Charts uses MIT. The D3 packages use ISC. The bundle retains dependency license comments. Keep those notices when sharing the generated page.
