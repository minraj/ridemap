# RideMap — ride tracker & comparator

> A zero-build web app for visualizing, analyzing and comparing GPX / FIT rides on an interactive map — built for mountain bikers and cyclists who want more than Garmin Connect offers.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![Version](https://img.shields.io/badge/version-2.0.0-blue)
![No build step](https://img.shields.io/badge/build-none-lightgrey)

---

## ✨ Features

| Feature | Details |
|---|---|
| **FIT import** | Native binary parser — records, laps, HR / cadence / power / speed, no external library |
| **GPX import** | Tracks, routes, waypoints; Garmin TrackPointExtension HR/cadence/power; gpx.studio exports; track name used as ride name |
| **Free basemaps** | Standard (OSM), Topo (OpenTopoMap), Satellite (Esri), Dark — no API key needed |
| **Optional premium tiles** | MapTiler key or Mapbox token in Settings / `config.js`; automatic fallback to free tiles if the key is rejected |
| **Activity feed** | Route thumbnails, distance, elevation gain, moving time; search and date-range filter |
| **Activity detail** | Distance, elevation gain, avg speed, max gradient, moving time, duration, HR zones, laps, more metrics |
| **Profile chart ↔ map sync** | Elevation / speed / HR / cadence / power; hovering the chart moves a telemetry marker on the map and vice-versa |
| **Compare** | Overlay charts, metric bars, training insights and shared-segment detection for 2+ rides |
| **Export** | Per-ride GPX and FIT export, JSON backup / restore |
| **Performance** | Ramer-Douglas-Peucker simplification for map polylines, canvas rendering, single-pass GPX parsing |
| **Responsive** | Glass sidebar on desktop (collapsible), draggable bottom sheet on mobile (< 768px) |
| **Map tools** | Basemap switcher, locate me, zoom, fullscreen, drag-and-drop files anywhere |
| **Local database** | IndexedDB persistence — rides survive page refreshes |
| **Supabase sync** | Optional cloud sync with GitHub / Google / Facebook / email sign-in |
| **Registration with approval** | New users request access → admin approves/denies → pending requests auto-delete after 24h |
| **Per-user data isolation** | Each member's rides stored under their own user_id |

---|---|
| **FIT import** | Native binary parser — no external library, tested on real Garmin ACTIVITY.fit |
| **GPX import** | Full GPX support: tracks, routes, waypoints. Garmin TrackPointExtension HR/cadence. Works with gpx.studio exports |
| **Multi-ride overlay** | All routes drawn simultaneously in unique colours |
| **Select single ride** | Click any ride in the sidebar to isolate its map route, chart, and stats |
| **Profile charts** | Elevation · Heart Rate · Speed · Cadence · Power — hover syncs a map marker |
| **Chart → Map sync** | Live crosshair on map shows exact GPS position when hovering the chart |
| **Compare tab** | Bar comparison of all key metrics across rides |
| **Vitals tab** | Per-ride HR zones (Z1–Z5), training stress score, full physical data grid |
| **Plan tab** | AI-style training insights: trends, recovery suggestions, next-ride targets |
| **Local database** | IndexedDB persistence — rides survive page refreshes, no re-importing |
| **JSON backup** | Export / import all rides as portable JSON |
| **Supabase sync** | Optional cloud sync — configure URL + anon key in Settings |
| **Auth: GitHub, Google, Facebook** | OAuth sign-in via Supabase Auth |
| **Email/password auth** | Traditional sign-in with Supabase |
| **Registration with approval** | New users request access → admin approves/denies → pending requests auto-delete after 24h |
| **Per-user data isolation** | Each family member's rides stored under their own user_id |
| **Admin panel** | Approve/deny pending registrations in one click |

---

## 🚀 Quick start (local)

```bash
# Python (usually pre-installed on Linux/macOS)
python3 -m http.server 8080
# open http://localhost:8080
```

Then drag `.fit` or `.gpx` files anywhere onto the map, or click **Upload GPX / FIT**.

### Export files from Garmin Connect

1. [connect.garmin.com](https://connect.garmin.com) → Activities → select an activity
2. **⋯ gear** → **Export Original** (gives `.fit`) or **Export GPX**

### Export route plans from gpx.studio

1. Design your route at [gpx.studio](https://gpx.studio)
2. File → Export → GPX
3. Drop the file into RideMap

---

## ☁️ Deploy to Cloudflare Pages (free)

```bash
git init && git add . && git commit -m "Initial"
gh repo create ridecomp --public --push
```

Then in Cloudflare dashboard:
- Workers & Pages → Create → Pages → Connect to Git → select repo
- Build command: *(empty)*
- Build output directory: `/`
- Deploy

Every `git push` auto-deploys. Live at `https://<your-project>.pages.dev`.

---

## 🗄️ Supabase setup (cloud sync + auth)

### 1. Create a Supabase project at [supabase.com](https://supabase.com) (free tier)

### 2. Run this SQL in the Supabase SQL Editor

```sql
-- Rides table (per-user data isolation)
create table ridecomp_rides (
  id           text primary key,
  user_id      text not null,
  name         text not null,
  file_type    text,
  points       jsonb not null,
  stats        jsonb,
  color        text,
  created_at   timestamptz default now()
);
create index on ridecomp_rides (user_id, created_at desc);

-- User registration / approval table
create table ridecomp_users (
  id           uuid primary key default gen_random_uuid(),
  email        text unique not null,
  name         text,
  role         text default 'pending',  -- pending | member | admin
  requested_at timestamptz default now(),
  approved_at  timestamptz,
  expires_at   timestamptz default now() + interval '24 hours'
);

-- Auto-delete expired pending requests (run via pg_cron)
create or replace function delete_expired_requests()
returns void language sql as $$
  delete from ridecomp_users
  where role = 'pending' and expires_at < now();
$$;

-- Schedule cleanup every hour (requires pg_cron extension):
-- select cron.schedule('0 * * * *', $$select delete_expired_requests()$$);
```

### 3. Enable OAuth providers

Supabase → Authentication → Providers → enable GitHub / Google / Facebook and add your OAuth app credentials from each provider's developer console.

### 4. Configure RideMap

The Supabase URL and publishable key are built into `assets/script.js` (`SUPABASE` constant) and
cannot be changed from the website. To use a different project, edit that constant and redeploy.

In Supabase → Authentication → URL Configuration, set **Site URL** to your Pages URL and add it
(e.g. `https://<your-project>.pages.dev/`) under **Redirect URLs**, or OAuth sign-in will fail.

### 5. Promote yourself to admin

In Supabase SQL Editor:
```sql
update ridecomp_users set role = 'admin'
where email = 'your@email.com';
```

Then the **Admin** button appears in the panel header after signing in.

---

## 👥 Family / multi-user workflow

1. You sign up and are auto-promoted to admin (or manually via SQL above)
2. Family members visit your hosted URL and click **Request access**
3. You review requests in the **Admin panel** (panel header) and click Approve
4. Approved members can sign in — their rides are stored under their own `user_id`
5. Unapproved requests auto-delete after 24 hours

---

## 🔑 Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + O` | Upload files |
| `/` | Search rides |
| `↑ / ↓` | Move between rides (feed or detail view) |
| `B` | Cycle basemap |
| `Ctrl/Cmd + S` | Sync to cloud |
| `Escape` | Close modal / go back |
| `?` | Shortcut help |

---

## 🗺️ Map tiles

The default basemaps need no API key. CARTO basemaps (`basemaps.cartocdn.com`) are **not** used:
they now return an "API KEY REQUIRED" placeholder image for every tile.

For premium styles, add a key under Settings → Map tiles (or in `config.js`):

| Setting | Used for |
|---|---|
| `mapTilerKey` | MapTiler outdoor / topo / satellite / dark styles |
| `mapboxToken` | Mapbox outdoors / satellite / dark styles (if no MapTiler key) |

Keys are checked when the map loads; an invalid key falls back to the free tiles with a notice.

---

## 📁 Project structure

```
ridemap/
├── index.html              layout: map, control cluster, panel/sheet, modals
├── assets/
│   ├── script.js           app logic: parsers, stats, map, rendering, auth, sync
│   ├── exportGPX.js        GPX / FIT export, shared-segment detection
│   ├── style.css           dark glass theme, responsive layout
│   ├── config.example.js   template for config.js
│   └── config.js           your keys (gitignored)
├── data/sample_ride.gpx
├── .gitignore
├── LICENSE
└── README.md
```

No `node_modules`. No build step. No framework.

---

## 🧱 Architecture

```
index.html
├── Leaflet           full-screen map, canvas-rendered routes, basemap switcher
├── FIT parser        pure binary JS — records (msg 20) + laps (msg 19)
├── GPX parser        DOMParser, single pass over each point's extension elements
├── Geometry          haversine, RDP simplification, smoothed gradient, moving time
├── Chart.js          profile charts with chart ↔ map hover sync
├── IndexedDB         local persistence, JSON import/export
├── Supabase JS       OAuth (GitHub/Google/FB), email auth, rides sync
└── Admin panel       pending/approve/deny registration management
```

---

## 🤝 Contributing

Issues and PRs welcome! Ideas for contributors:

- [x] Segment detection (highlight shared road sections between rides)
- [x] GPX export of loaded rides
- [ ] Strava import via OAuth
- [x] Mobile responsive layout
- [x] Lap data from FIT files

---

## 📜 License

MIT — free to use, modify, and distribute. See [LICENSE](LICENSE).

---

## 🙏 Credits

[Leaflet](https://leafletjs.com) · [Chart.js](https://chartjs.org) · [Supabase](https://supabase.com)  
Map tiles: [OpenStreetMap](https://openstreetmap.org) · [OpenTopoMap](https://opentopomap.org) · [Esri](https://esri.com) · optional [MapTiler](https://maptiler.com) / [Mapbox](https://mapbox.com)
