# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running

```bash
python3 -m http.server 8080   # then open http://localhost:8080
```

No build step, no package.json, no node_modules, no test suite. Test by hand in the browser (`data/sample_ride.gpx` is a sample input). `.eslintrc.json` (eslint:recommended, browser, `sourceType: script`) and `.prettierrc` (single quotes, semicolons, width 100, 2-space) are in the repo for anyone with those tools installed globally, e.g. `npx eslint assets/*.js`. Browsers cache `script.js` aggressively under `http.server`, so hard-reload after edits.

Deployment: Cloudflare Pages with an empty build command and `/` as the output directory. Every push to `main` deploys, so anything pushed goes live. `assets/config.js` is gitignored, so it isn't deployed. Users enter Supabase and map keys under Settings → Connections, which saves them to localStorage.

## Architecture

Plain browser scripts with no modules. Every file shares one global scope. Leaflet 1.9.4, Chart.js 4.4.2 and supabase-js v2 load from CDNs in `index.html`. UI markup calls globals through inline `onclick=` attributes (in `index.html` and in HTML strings built in JS), so **renaming a function breaks the markup**.

**Script load order** (end of `index.html`):
1. `assets/config.js`: optional `CONFIG = {supabaseUrl, supabaseKey, mapTilerKey, mapboxToken}` (template: `config.example.js`). `loadCfg()` merges it with localStorage `ridecomp_cfg`.
2. `assets/script.js`: nearly all app logic, with top-level `let`/`const` state (`rides`, `view`, `activeId`, `compareIds`, `map`, `cfg`, …).
3. `assets/exportGPX.js`: `exportGPX(ids?)`, the FIT encoder `encodeFIT`/`exportFIT`, and shared-segment detection (`renderSegments`, results cached in `segCache`). Uses `script.js` globals directly.

### UI model (script.js)

- **Layout:** the map fills the screen. `#panel` is a glass sidebar on desktop, collapsible via `setPanelCollapsed`. Under 768px it becomes a bottom sheet with a draggable height: `setSheet('peek'|'half'|'full')`, plus `--sheet-visible` and `body[data-sheet]`. The map controls are custom (`#map-ctrl`); Leaflet's zoom control is disabled.
- **Views:** `view` is `'list' | 'detail' | 'compare'`. Use `openDetail(id)`, `backToList()`, `toggleCompareMode()` and `openCompare()`. `renderView()` empties hidden views so their elements don't shadow the active view's. Look canvases up inside the view element, never by global id.
- **Rendering:** every state change calls `refresh()`. It's debounced 16ms and runs `applyMapStyles` (focus/dim routes, start/finish pins), then `renderFeed`, then `renderView`. Charts are destroyed and rebuilt on each render (`renderChart`). Hover sync runs both ways: chart → map through `showHoverMarker`, map → chart through `onRouteHover`.

### Data flow

- **Import:** `handleFiles` → `processQueue` → `parseFIT(ArrayBuffer)` or `parseGPX(text)`. `parseFIT` returns `{pts, laps}` and handles global message 20 Record and 19 Lap. `parseGPX` returns `pts`, with `pts.trackName`. Both go to `addRide(name, points, fileType, laps)`.
- **Stored record** (IndexedDB `ridecomp_v1`/`rides`, and JSON backup): `{id, name, color, points, stats, fileType, laps, savedAt}`, built by `toRecord(r)`. The store names still use the old "RideComp" naming so existing users' data loads. Don't rename them.
- **Runtime ride:** `hydrate(record)` adds derived fields: `cum` (cumulative km), `simp` (RDP indices for the map polyline, `SIMPLIFY_M`), `smap` (chart sample indices), `thumb` (SVG), and the `poly`/`casing`/`group` Leaflet layers. `stats` are recomputed whenever `stats.v !== STATS_VER`, so bump `STATS_VER` after changing `computeStats`. A new field on a ride must be added to `toRecord`, `hydrate` and the Supabase payload in `syncToSupabase`.
- **Stats:** `computeStats` calculates moving time (gaps ≤ 2 min, faster than about 2 km/h), max gradient over a 100 m window (`maxGradient`), HR zones from `cfg.maxHR`, and TSS.

### Map tiles

`BASEMAPS` lists the free, key-less sources: OSM, OpenTopoMap, Esri, and OSM with a CSS dark filter (`.tiles-dark`). If `cfg.mapTilerKey` or `cfg.mapboxToken` is set, `tileSource()` uses those providers instead. Bad keys come back as HTTP 401/403 **with a placeholder image**, so `tileerror` never fires. `checkTileKey()` therefore probes one tile with `fetch()` and calls `useFreeTiles()` when the status is not OK. **Don't add CARTO tiles**: `basemaps.cartocdn.com` now serves an "API KEY REQUIRED" image with HTTP 200.

### Persistence & cloud

- **localStorage:** `ridecomp_cfg` holds settings and keys. `ridecomp_state` holds the basemap, panel-collapsed flag, chart metric and hidden ride ids.
- **Supabase** (schema in `README.md`): tables `ridecomp_rides` (rows scoped by `user_id`) and `ridecomp_users` (`role`: pending | member | admin; admins approve or deny in the Admin modal). `pendingSync` tracks rides waiting to upload. `onSignedIn` is guarded against firing twice, and `loadRidesFromSupabase` shares one in-flight promise.
