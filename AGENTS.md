# RideComp AGENTS.md

## Running the app

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

No build step, no node_modules. The app runs directly in browser.

## Project structure

```
RideComp/
├── index.html              ~1700 LOC, main app (HTML+CSS+JS)
├── assets/
│   ├── script.js          main logic
│   ├── style.css         styles
│   ├── ridemap-patch.js  polyline halo + resizable panels
│   ├── ridemap-patch.css
│   └── exportGPX.js      GPX export, segment detection, lap parsing
├── _headers              Cloudflare Pages security headers
├── README.md             feature overview & Supabase setup
├── PATCH_README.md       patch details
└── AGENTS.md
```

## Key architecture details

- **FIT parser**: Pure binary JS in `assets/script.js` (field 78 enhanced_altitude). `assets/exportGPX.js` handles Lap parsing (global msg 19).
- **GPX parser**: DOMParser + XPath extension namespace traversal.
- **Map**: Leaflet with multi-polyline overlay.
- **Charts**: Chart.js (elevation/HR/speed/cadence/power).
- **Persistence**: IndexedDB (local), JSON backup (import/export), or Supabase (cloud sync).
- **Auth/Admin**: Supabase OAuth (GitHub, Google, FB) + Email. Registration requires admin approval via the Admin panel.
- **Segments**: `detectSharedSegments` in `assets/exportGPX.js` finds overlaps within 50m.

## Patch files

`assets/ridemap-patch.js` and `assets/ridemap-patch.css` are monkey-patches loaded from `index.html`. When modifying `assets/script.js`, watch for:
- `setTileLayer()` at script.js:~76 — patch calls this to update tile layer halos
- `window.map` at script.js:~77 — patch calls `window.map.invalidateSize()` after resize

Name changes here will break the patches.

## Testing

No test suite exists. Manual testing via browser devtools.

## Deployment

Cloudflare Pages (free):
- Build command: empty
- Output directory: `/`
- Every `git push` auto-deploys.
