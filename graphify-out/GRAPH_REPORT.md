# Graph Report - ridemap  (2026-10-05)

## Corpus Check
- Corpus is ~15,868 words - fits in a single context window. You may not need a graph.

## Summary
- 214 nodes · 526 edges · 10 communities (9 shown, 1 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 13 edges (avg confidence: 0.88)
- Token cost: 63,801 input · 0 output

## Community Hubs (Navigation)
- App Shell & Global State
- Views, Charts & Formatting
- Parsing, Docs & Architecture
- Supabase Auth, Sync & Delete
- Layout, Events & Import UI
- Ride Hydration & Duplicates
- Map Tiles & Controls
- Export & Shared Segments
- ESLint Config
- Optional Map Keys Config

## God Nodes (most connected - your core abstractions)
1. `toast()` - 27 edges
2. `hydrate()` - 18 edges
3. `refresh()` - 17 edges
4. `initEvents()` - 15 edges
5. `renderDetail()` - 13 edges
6. `deleteRides()` - 12 edges
7. `openDetail()` - 12 edges
8. `renderFeed()` - 12 edges
9. `processQueue()` - 11 edges
10. `loadRidesFromSupabase()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `Ramer-Douglas-Peucker polyline simplification` --conceptually_related_to--> `hydrate()`  [EXTRACTED]
  README.md → assets/script.js
- `RLS policy 'Users delete own rides'` --rationale_for--> `deleteRides()`  [EXTRACTED]
  README.md → assets/script.js
- `Supabase OAuth redirect URL configuration` --references--> `authWith()`  [EXTRACTED]
  README.md → assets/script.js
- `Settings / account modal` --calls--> `exportGPX()`  [EXTRACTED]
  index.html → assets/exportGPX.js
- `Pure-JS binary FIT parser (msg 20 Record, msg 19 Lap)` --references--> `parseFIT()`  [INFERRED]
  AGENTS.md → assets/script.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Duplicate ride protection (client fingerprint + cloud lookup + DB unique index)** — assets_script_ridefingerprint, assets_script_importride, assets_script_findcloudduplicate, assets_script_synctosupabase, readme_unique_index_user_fingerprint, readme_ride_fingerprint [EXTRACTED 1.00]
- **Ride import pipeline** — assets_script_handlefiles, assets_script_processqueue, assets_script_parsefit, assets_script_parsegpx, assets_script_importride, assets_script_addride [EXTRACTED 1.00]
- **refresh() render cycle** — assets_script_refresh, assets_script_applymapstyles, assets_script_renderfeed, assets_script_renderview [EXTRACTED 1.00]

## Communities (10 total, 1 thin omitted)

### Community 0 - "App Shell & Global State"
Cohesion: 0.07
Nodes (41): applyMapStyles(), approveUser(), BASEMAP_ORDER, BASEMAPS, cfg, closeAdmin(), closeAdminBg(), closeHelp() (+33 more)

### Community 1 - "Views, Charts & Formatting"
Cohesion: 0.10
Nodes (34): backfillFingerprints(), backToList(), buildRideLayers(), clearChartHover(), destroyChart(), esc(), filteredRides(), fmtDate() (+26 more)

### Community 2 - "Parsing, Docs & Architecture"
Cohesion: 0.09
Nodes (26): Pure-JS binary FIT parser (msg 20 Record, msg 19 Lap), Single-pass DOMParser GPX parser, RideMap AGENTS.md, deriveSpeed(), loadCfg(), parseFIT(), parseGPX(), readVal() (+18 more)

### Community 3 - "Supabase Auth, Sync & Delete"
Cohesion: 0.17
Nodes (27): authWith(), clearAll(), closeModalBg(), closeSettings(), deleteRide(), deleteRides(), downloadBlob(), ensureSupabaseClient() (+19 more)

### Community 4 - "Layout, Events & Import UI"
Cohesion: 0.18
Nodes (20): focusRides(), handleFiles(), initEvents(), initSheetDrag(), isMobile(), layoutSheet(), mapPadding(), openDetail() (+12 more)

### Community 5 - "Ride Hydration & Duplicates"
Cohesion: 0.16
Nodes (19): addRide(), buildThumb(), computeStats(), cumulativeKm(), findCloudDuplicate(), haversine(), hydrate(), importRide() (+11 more)

### Community 6 - "Map Tiles & Controls"
Cohesion: 0.17
Nodes (15): checkTileKey(), cycleBasemap(), initMap(), locateMe(), onLocationFound(), previewUrl(), renderLayerMenu(), setTile() (+7 more)

### Community 7 - "Export & Shared Segments"
Cohesion: 0.24
Nodes (12): Shared-segment detection (50 m overlap), clearSegLayers(), detectSharedSegments(), encodeFIT(), exportFIT(), exportGPX(), FIT_CRC_TABLE, FIT_T (+4 more)

### Community 8 - "ESLint Config"
Cohesion: 0.20
Nodes (9): env, browser, es2021, extends, parserOptions, ecmaVersion, sourceType, rules (+1 more)

## Knowledge Gaps
- **31 isolated node(s):** `browser`, `es2021`, `extends`, `eslint:recommended`, `ecmaVersion` (+26 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 35 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Settings / account modal` connect `Supabase Auth, Sync & Delete` to `Export & Shared Segments`?**
  _High betweenness centrality (0.072) - this node is a cross-community bridge._
- **What connects `browser`, `es2021`, `extends` to the rest of the system?**
  _31 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `App Shell & Global State` be split into smaller, more focused modules?**
  _Cohesion score 0.06659619450317125 - nodes in this community are weakly interconnected._
- **Why does `exportGPX()` connect `Export & Shared Segments` to `Supabase Auth, Sync & Delete`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **Should `Views, Charts & Formatting` be split into smaller, more focused modules?**
  _Cohesion score 0.10338680926916222 - nodes in this community are weakly interconnected._
- **Why does `CLAUDE.md project guide` connect `Parsing, Docs & Architecture` to `Views, Charts & Formatting`, `Ride Hydration & Duplicates`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Should `Parsing, Docs & Architecture` be split into smaller, more focused modules?**
  _Cohesion score 0.08735632183908046 - nodes in this community are weakly interconnected._