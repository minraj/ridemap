# Graph Report - ridemap  (2026-10-05)

## Corpus Check
- Corpus is ~16,974 words - fits in a single context window. You may not need a graph.

## Summary
- 236 nodes · 622 edges · 11 communities (8 shown, 3 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 12 edges (avg confidence: 0.87)
- Token cost: 48,202 input · 0 output

## Community Hubs (Navigation)
- App Shell & Charts
- Export, FIT & Segments
- Admin, Settings & Delete
- Ride Import & Stats
- Views & Map Layout
- Auth & Cloud Sync
- Map Tiles & Basemaps
- ESLint Config
- Map Key Config
- Free Basemap Rules
- Keyboard Shortcuts

## God Nodes (most connected - your core abstractions)
1. `Inline onclick/onchange handlers in index.html` - 31 edges
2. `toast()` - 28 edges
3. `refresh()` - 23 edges
4. `hydrate()` - 20 edges
5. `loadRidesFromSupabase()` - 17 edges
6. `onSignedIn()` - 15 edges
7. `syncToSupabase()` - 15 edges
8. `initEvents()` - 15 edges
9. `deleteRides()` - 13 edges
10. `renderFeed()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `Pure-JS binary FIT parser (msg 20 Record, msg 19 Lap)` --references--> `parseFIT()`  [INFERRED]
  AGENTS.md → assets/script.js
- `Single-pass DOMParser GPX parser` --references--> `parseGPX()`  [INFERRED]
  AGENTS.md → assets/script.js
- `Script load order (config.js, script.js, exportGPX.js)` --references--> `exportGPX()`  [EXTRACTED]
  CLAUDE.md → assets/exportGPX.js
- `Inline onclick/onchange handlers in index.html` --references--> `exportGPX()`  [EXTRACTED]
  index.html → assets/exportGPX.js
- `Inline onclick/onchange handlers in index.html` --references--> `toggleLayerMenu()`  [EXTRACTED]
  index.html → assets/script.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Ride import & dedup flow** — assets_script_handlefiles, assets_script_processqueue, assets_script_parsefit, assets_script_parsegpx, assets_script_importride, assets_script_findcloudduplicate, assets_script_addride [EXTRACTED 1.00]
- **Sign-in cloud load flow** — assets_script_initsupabase, assets_script_onsignedin, assets_script_loadridesfromsupabase, assets_script_offerlocalrides, assets_script_restorecachedrides [EXTRACTED 1.00]
- **Refresh render pipeline** — assets_script_refresh, assets_script_applymapstyles, assets_script_renderfeed, assets_script_renderview, assets_script_renderchart [EXTRACTED 1.00]

## Communities (11 total, 3 thin omitted)

### Community 0 - "App Shell & Charts"
Cohesion: 0.07
Nodes (50): backToList(), BASEMAP_ORDER, BASEMAPS, buildRideLayers(), cfg, clearChartHover(), closeAdmin(), closeAdminBg() (+42 more)

### Community 1 - "Export, FIT & Segments"
Cohesion: 0.08
Nodes (33): Pure-JS binary FIT parser (msg 20 Record, msg 19 Lap), Single-pass DOMParser GPX parser, RideMap AGENTS.md, Shared-segment detection (50 m overlap), clearSegLayers(), detectSharedSegments(), encodeFIT(), exportFIT() (+25 more)

### Community 2 - "Admin, Settings & Delete"
Cohesion: 0.10
Nodes (34): approveUser(), authWith(), clearAll(), closeModalBg(), closeSettings(), deleteRide(), deleteRides(), denyUser() (+26 more)

### Community 3 - "Ride Import & Stats"
Cohesion: 0.11
Nodes (30): addRide(), buildThumb(), computeStats(), cumulativeKm(), deriveSpeed(), findCloudDuplicate(), haversine(), hydrate() (+22 more)

### Community 4 - "Views & Map Layout"
Cohesion: 0.12
Nodes (29): applyMapStyles(), cycleBasemap(), destroyChart(), focusRides(), focusSet(), initEvents(), initSheetDrag(), isMobile() (+21 more)

### Community 5 - "Auth & Cloud Sync"
Cohesion: 0.18
Nodes (23): backfillFingerprints(), closeLocalRides(), detachRide(), discardLocalRides(), idbAll(), idbDel(), initSupabase(), isAdmin() (+15 more)

### Community 6 - "Map Tiles & Basemaps"
Cohesion: 0.27
Nodes (11): checkTileKey(), initMap(), onLocationFound(), previewUrl(), renderLayerMenu(), setTile(), setTileLayer(), tileSource() (+3 more)

### Community 7 - "ESLint Config"
Cohesion: 0.20
Nodes (9): env, browser, es2021, extends, parserOptions, ecmaVersion, sourceType, rules (+1 more)

## Knowledge Gaps
- **38 isolated node(s):** `browser`, `es2021`, `extends`, `eslint:recommended`, `ecmaVersion` (+33 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 44 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Inline onclick/onchange handlers in index.html` connect `Admin, Settings & Delete` to `App Shell & Charts`, `Export, FIT & Segments`, `Ride Import & Stats`, `Views & Map Layout`, `Auth & Cloud Sync`, `Map Tiles & Basemaps`?**
  _High betweenness centrality (0.080) - this node is a cross-community bridge._
- **What connects `browser`, `es2021`, `extends` to the rest of the system?**
  _38 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `App Shell & Charts` be split into smaller, more focused modules?**
  _Cohesion score 0.07256894049346879 - nodes in this community are weakly interconnected._
- **Why does `exportGPX()` connect `Export, FIT & Segments` to `Admin, Settings & Delete`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._
- **Should `Export, FIT & Segments` be split into smaller, more focused modules?**
  _Cohesion score 0.08095238095238096 - nodes in this community are weakly interconnected._
- **Why does `GPX / FIT export and JSON backup` connect `Export, FIT & Segments` to `Admin, Settings & Delete`, `Ride Import & Stats`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **Should `Admin, Settings & Delete` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._