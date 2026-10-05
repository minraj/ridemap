# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running

```bash
python3 -m http.server 8080   # then open http://localhost:8080
```

No build step, no package.json, no node_modules, no test suite. Test by hand in the browser (`data/sample_ride.gpx` is a sample input). `.eslintrc.json` (eslint:recommended, browser, `sourceType: script`) and `.prettierrc` (single quotes, semicolons, width 100, 2-space) are in the repo for anyone with those tools installed globally, e.g. `npx eslint assets/*.js`. Browsers cache `script.js` aggressively under `http.server`, so hard-reload after edits.

Deployment: Cloudflare Pages with an empty build command and `/` as the output directory. Every push to `main` deploys, so anything pushed goes live. The Supabase URL and publishable key are hard-coded in `SUPABASE` at the top of `assets/script.js`, on purpose: the site is private and nobody should be able to point it at another project. Don't make them configurable again. `assets/config.js` (gitignored, not deployed) only holds optional map keys.

## Architecture

Plain browser scripts with no modules. Every file shares one global scope. Leaflet 1.9.4, Chart.js 4.4.2 and supabase-js v2 load from CDNs in `index.html`. UI markup calls globals through inline `onclick=` attributes (in `index.html` and in HTML strings built in JS), so **renaming a function breaks the markup**.

**Script load order** (end of `index.html`):
1. `assets/config.js`: optional `CONFIG = {mapTilerKey, mapboxToken}` (template: `config.example.js`). `loadCfg()` merges it with localStorage `ridecomp_cfg`, then always resets `cfg.url`/`cfg.key` to `SUPABASE` and wipes any Supabase values older versions saved.
2. `assets/script.js`: nearly all app logic, with top-level `let`/`const` state (`rides`, `view`, `activeId`, `selectedIds`, `map`, `cfg`, …).
3. `assets/exportGPX.js`: `exportGPX(ids?)`, the FIT encoder `encodeFIT`/`exportFIT`, and shared-segment detection (`renderSegments`, results cached in `segCache`). Uses `script.js` globals directly.

### UI model (script.js)

- **Layout:** the map fills the screen. `#panel` is a glass sidebar on desktop, collapsible via `setPanelCollapsed`. Under 768px it becomes a bottom sheet with a draggable height: `setSheet('peek'|'half'|'full')`, plus `--sheet-visible` and `body[data-sheet]`. The map controls are custom (`#map-ctrl`); Leaflet's zoom control is disabled.
- **Views:** `view` is `'list' | 'detail' | 'compare'`. Use `openDetail(id)`, `backToList()`, `toggleSelectMode()` and `openCompare()`. `renderView()` empties hidden views so their elements don't shadow the active view's. Look canvases up inside the view element, never by global id.
- **Rendering:** every state change calls `refresh()`. It's debounced 16ms and runs `applyMapStyles` (focus/dim routes, start/finish pins), then `renderFeed`, then `renderView`. Charts are destroyed and rebuilt on each render (`renderChart`). Hover sync runs both ways: chart → map through `showHoverMarker`, map → chart through `onRouteHover`.

### Data flow

- **Import:** `handleFiles` → `processQueue` → `parseFIT(ArrayBuffer)` or `parseGPX(text)`. `parseFIT` returns `{pts, laps}` and handles global message 20 Record and 19 Lap. `parseGPX` returns `pts`, with `pts.trackName`. Both go to `addRide(name, points, fileType, laps)`.
- **Stored record** (IndexedDB `ridecomp_v1`/`rides`, and JSON backup): `{id, name, color, points, stats, fileType, laps, savedAt, owner}`, built by `toRecord(r)`. `owner` is the user id whose cloud the record mirrors; missing means the ride exists only in this browser. It is local only and never sent to Supabase. The store names still use the old "RideComp" naming so existing users' data loads. Don't rename them.
- **Runtime ride:** `hydrate(record)` adds derived fields: `cum` (cumulative km), `simp` (RDP indices for the map polyline, `SIMPLIFY_M`), `smap` (chart sample indices), `thumb` (SVG), and the `poly`/`casing`/`group` Leaflet layers. `stats` are recomputed whenever `stats.v !== STATS_VER`, so bump `STATS_VER` after changing `computeStats`. A new field on a ride must be added to `toRecord`, `hydrate` and the Supabase payload in `syncToSupabase`.
- **Which rides show:** signed in, the cloud is the source of truth. Boot runs `initSupabase()` (`getSession`, which works offline) before it touches IndexedDB. `onSignedIn` unloads the rides that were on screen, `loadRidesFromSupabase` shows exactly the cloud rows (an empty table means no rides) and removes owned rides the cloud no longer has, then `offerLocalRides` opens `#local-mb` for records with no `owner` (Upload → `syncToSupabase`, which sets `owner`; Discard deletes them; Decide later asks again on the next sign-in). IndexedDB is read only for guests (`restoreCachedRides()`, records with no owner) or when the cloud load fails because the user is offline (`isOfflineError`). Signing out unloads everything and shows the local-only rides again. `unloadRide` takes a ride off the screen but keeps it in IndexedDB; `detachRide` also deletes it.
- **Duplicates:** `rideFingerprint(points, stats)` gives `t:<start epoch seconds>`, or `g:<first>|<last>|<distance>` for untimed routes. It's set as `r.fingerprint` in `hydrate`, and must match the SQL backfill in `README.md`. Uploads go through `importRide`, which refuses a fingerprint that's already loaded or in the cloud (`findCloudDuplicate`) before calling `addRide`. The cloud has a unique index on `(user_id, fingerprint)`, and sync treats error `23505` as "already in the cloud". Sync also runs `findCloudDuplicate` on every pending ride and skips the ones the cloud already holds under another id. If the `fingerprint` column is missing (`cloudHasFingerprint === false`), `findCloudDuplicate` falls back to matching `stats->>startDate`, so duplicate blocking never depends on the SQL having been run.
- **Selection & delete:** `selectMode`/`selectedIds` drive both Compare and Delete. `deleteRides(ids)` is optimistic: it detaches the rides, deletes from Supabase with `.select('id')` to see what was actually removed (RLS without a delete policy returns no error but deletes nothing), and re-hydrates whatever the cloud kept. `selectDuplicates()` selects every copy except the oldest. `clearAll()` ("Delete all rides") loads the cloud rides first, requires typing `DELETE`, then calls `deleteRides(allIds, {confirmed: true})`, which deletes from the device and the cloud and keeps the user signed in.
- **Stats:** `computeStats` calculates moving time (gaps ≤ 2 min, faster than about 2 km/h), max gradient over a 100 m window (`maxGradient`), HR zones from `cfg.maxHR`, and TSS.

### Map tiles

`BASEMAPS` lists the free, key-less sources: OSM, OpenTopoMap, Esri, and OSM with a CSS dark filter (`.tiles-dark`). If `cfg.mapTilerKey` or `cfg.mapboxToken` is set, `tileSource()` uses those providers instead. Bad keys come back as HTTP 401/403 **with a placeholder image**, so `tileerror` never fires. `checkTileKey()` therefore probes one tile with `fetch()` and calls `useFreeTiles()` when the status is not OK. **Don't add CARTO tiles**: `basemaps.cartocdn.com` now serves an "API KEY REQUIRED" image with HTTP 200.

### Persistence & cloud

- **localStorage:** `ridecomp_cfg` holds max HR and map keys (never the Supabase connection). `ridecomp_state` holds the basemap, panel-collapsed flag, chart metric and hidden ride ids.
- **Supabase** (schema in `README.md`): tables `ridecomp_rides` (rows scoped by `user_id`) and `ridecomp_users` (`role`: pending | member | admin; admins approve or deny in the Admin modal). `initSupabase()` always runs at boot, which is also what completes a GitHub OAuth redirect. `authWith` passes `redirectTo: origin + pathname`, which must be in Supabase → Auth → URL Configuration → Redirect URLs. `pendingSync` tracks rides waiting to upload. `onSignedIn` is guarded against firing twice, and `loadRidesFromSupabase` shares one in-flight promise.
