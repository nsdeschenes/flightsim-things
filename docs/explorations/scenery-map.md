# Scenery map

The Scenery route owns an offline geographic overview and linked inventory. It reads the existing desktop library query. Settings scan and enrichment results replace inventories in that cache. The view adds no database, IPC, or server state.

Airport identity is the JSON tuple of simulator, folder, and source key. Package identity is the JSON tuple of simulator and folder. Scenery package rows use a separate tagged identity. Airports without codes or matching package metadata stay visible. Positions use longitude then latitude, require both finite values within geographic bounds, and accept zero.

Search, simulator, and location filters drive the map, inventory, counts, and details together. Exactly coincident airports share a marker with individual installation choices in the details. Selecting an installation keeps the camera fixed. Focus airport explicitly moves it. Buttons zoom or reset, dragging pans, and the wheel scrolls the page. Resizing restores the world overview.

The map renders TanStack Charts directly through React. A narrow D3 effect owns gesture listeners and a ResizeObserver, and removes both on unmount. It uses bundled [Natural Earth 110m land](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson), under [public-domain terms](https://www.naturalearthdata.com/about/terms-of-use/). This is an airport location overview, with no tile requests, airport outlines, or zoom-dependent clustering. TanStack Charts uses MIT; D3 uses ISC.

The standalone prototype, sample scenarios, import controls, layout variants, runner, and isolated dependency lock have been removed. Production Content Security Policy is unchanged.
