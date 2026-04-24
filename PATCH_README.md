# ridemap patch — installation guide

Two files fix both reported issues. Drop them into your `assets/` folder and
add **two lines** to `index.html`.

---

## Files

| File | Purpose |
|------|---------|
| `assets/ridemap-patch.css` | Polyline glow on light tiles + panel layout rules |
| `assets/ridemap-patch.js`  | Tile-switcher patch + halo polylines + resize/hide panels |

---

## Installation

### Step 1 — Copy the files

```
ridemap/
├── assets/
│   ├── style.css          ← existing
│   ├── script.js          ← existing
│   ├── exportGPX.js       ← existing
│   ├── ridemap-patch.css  ← ADD THIS
│   └── ridemap-patch.js   ← ADD THIS
└── index.html
```

### Step 2 — Edit `index.html`

Add **one CSS line** inside `<head>` (after the existing `style.css` link):

```html
<link rel="stylesheet" href="assets/style.css"/>
<link rel="stylesheet" href="assets/ridemap-patch.css"/>   <!-- ADD -->
```

Add **one JS line** inside `<body>` (after the existing `script.js` tag):

```html
<script src="assets/script.js"/>
<script src="assets/ridemap-patch.js"></script>            <!-- ADD -->
<script src="assets/exportGPX.js"></script>
```

That's it — no other files touched.

---

## What changes

### Fix 1 — Route visibility on Topo / Street tiles

**Root cause:** The ride polylines use bright neon colors (e.g. `#00e5a0`,
`#ff6b35`) which are clearly visible against dark CARTO tiles but blend into
the pale grey/beige of OpenTopoMap and Street tiles.

**Solution (two layers):**
1. Every time a polyline is added to the Leaflet map, the patch intercepts
   `map.addLayer()` and draws a **white halo polyline** (weight +6, opacity
   0.55) *beneath* the colored track.
2. When you switch to **Topo** or **Street** mode, the halo weight increases
   to +8 and a CSS `drop-shadow` glow is added via a `tile-topo` / `tile-street`
   body class.
3. The colored track weight also increases by 1 px on light tiles so it reads
   more clearly even without the halo.

### Fix 2 — Resizable & hideable panels

All three panels are now independently controllable:

| Panel | Resize | Hide/Show |
|-------|--------|-----------|
| Left sidebar (`#sidebar`) | Drag the right edge handle | Click ◀ / ▶ button |
| Right stats panel (`#sp`) | Drag the left edge handle  | Click ▶ / ◀ button |
| Bottom chart bar (`#cs`)  | Drag the top edge handle   | Click ▼ / ▲ button |

- Panel sizes and collapsed states survive page refresh (stored in
  `localStorage` under keys prefixed `ridemap_panel_`).
- After any panel resize/collapse, `map.invalidateSize()` is called so
  Leaflet redraws tiles correctly in the new space.
- Chart.js (`window.profileChart.resize()`) is also called after chart-bar
  resize/collapse so the graph reflows properly.

---

## Compatibility notes

- The patch **does not modify** `script.js`, `style.css`, or `index.html`
  logic — it only extends them via monkey-patching.
- If a future `script.js` update renames `setTile` or `map`, update the
  corresponding references in `ridemap-patch.js` lines ~56 and ~62.
- Tested with Leaflet 1.9.x and Chart.js 4.x (the versions already used).
