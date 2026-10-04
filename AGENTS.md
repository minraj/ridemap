# RideMap AGENTS.md

## Running the app

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

No build step, no node_modules. The app runs directly in the browser.

## Project structure

```
ridemap/
├── index.html            layout: map, control cluster, panel / bottom sheet, modals
├── assets/
│   ├── script.js         main logic: parsers, stats, map, rendering, auth, sync
│   ├── exportGPX.js      GPX + FIT export, shared-segment detection
│   ├── style.css         dark glass theme, responsive layout (< 768px = bottom sheet)
│   ├── config.example.js template for assets/config.js (gitignored)
├── data/sample_ride.gpx
├── README.md             feature overview & Supabase setup
└── AGENTS.md
```

## Key architecture details

- **FIT parser**: pure binary JS in `assets/script.js`, covering Record (msg 20) and Lap (msg 19) messages. Elevation comes from field 78 (enhanced_altitude).
- **GPX parser**: DOMParser, matching extension elements by local name in a single pass.
- **Map**: Leaflet with canvas-rendered polylines, simplified with Ramer-Douglas-Peucker. Free tiles by default. MapTiler and Mapbox keys are optional, are checked with `fetch()`, and fall back to free tiles. Don't use CARTO tiles: they now require an API key.
- **Charts**: Chart.js profile (elevation, speed, HR, cadence, power), with hover synced between chart and map.
- **Persistence**: IndexedDB (`ridecomp_v1`, a legacy name; keep it), JSON backup, optional Supabase sync.
- **Auth/Admin**: Supabase OAuth (GitHub, Google, Facebook) and email. Registration requires admin approval.
- **Segments**: `detectSharedSegments` in `assets/exportGPX.js` finds overlaps within 50m.

Inline `onclick=` handlers call global functions, so renaming a function breaks the HTML.

## Testing

No test suite exists. Test by hand in the browser, at both desktop width and under 768px.

## Deployment

Cloudflare Pages (free):
- Build command: empty
- Output directory: `/`
- Every `git push` auto-deploys.
- `assets/config.js` isn't committed and only holds optional map keys. The Supabase connection is hard-coded in `SUPABASE` in `assets/script.js`.
