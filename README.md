# RideComp — Garmin Ride Comparator

> A production-grade, zero-dependency web app for comparing multiple Garmin rides — built for cyclists who want more than Garmin Connect offers.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![Version](https://img.shields.io/badge/version-1.4.0-blue)
![No build step](https://img.shields.io/badge/build-none-lightgrey)

---

## ✨ Features

| Feature | Details |
|---|---|
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

Then drag `.fit` or `.gpx` files onto the drop zone, or click **Import**.

### Export files from Garmin Connect

1. [connect.garmin.com](https://connect.garmin.com) → Activities → select an activity
2. **⋯ gear** → **Export Original** (gives `.fit`) or **Export GPX**

### Export route plans from gpx.studio

1. Design your route at [gpx.studio](https://gpx.studio)
2. File → Export → GPX
3. Drop the file into RideComp

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

Every `git push` auto-deploys. Live at `https://ridecomp.pages.dev`.

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

### 4. Configure RideComp

In RideComp → ⚙ Settings:
- **Project URL**: Supabase → Settings → API → Project URL
- **Anon key**: Supabase → Settings → API → anon public key

### 5. Promote yourself to admin

In Supabase SQL Editor:
```sql
update ridecomp_users set role = 'admin'
where email = 'your@email.com';
```

Then the **Admin** button appears in the top bar after signing in.

---

## 👥 Family / multi-user workflow

1. You sign up and are auto-promoted to admin (or manually via SQL above)
2. Family members visit your hosted URL and click **Request access**
3. You review requests in the **Admin panel** (top bar) and click ✓ Approve
4. Approved members can sign in — their rides are stored under their own `user_id`
5. Unapproved requests auto-delete after 24 hours

---

## 🔑 Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + O` | Import files |
| `Escape` | Close modal |

---

## 📁 Project structure

```
ridecomp/
├── index.html
├── assets/
│   ├── script.js
│   ├── style.css
│   ├── ridemap-patch.js
│   ├── ridemap-patch.css
│   ├── exportGPX.js
│   └── config.js
├── _headers
├── .gitignore
├── LICENSE
└── README.md
```

No `node_modules`. No build step. No framework.

---

## 🧱 Architecture

```
index.html
├── CSS tokens & layout
├── FIT parser     — pure binary JS, field 78 enhanced_altitude, speed from dist/time
├── GPX parser     — DOMParser + XPath extension namespace traversal
├── IndexedDB      — local persistence, JSON import/export
├── Leaflet        — multi-polyline map, hover crosshair marker
├── Chart.js       — elevation/HR/speed/cadence/power overlay charts
├── Stats engine   — haversine, HR zones Z1-Z5, TSS, efficiency metrics
├── Supabase JS    — OAuth (GitHub/Google/FB), email auth, rides sync
├── Auth flow      — sign in, request access, admin approval, 24h expiry
└── Admin panel    — pending/approve/deny registration management
```

---

## 🤝 Contributing

Issues and PRs welcome! Ideas for contributors:

- [x] Segment detection (highlight shared road sections between rides)
- [x] GPX export of loaded rides
- [ ] Strava import via OAuth
- [x] Mobile responsive layout
- [x] Light theme
- [x] Lap data from FIT files

---

## 📜 License

MIT — free to use, modify, and distribute. See [LICENSE](LICENSE).

---

## 🙏 Credits

[Leaflet](https://leafletjs.com) · [Chart.js](https://chartjs.org) · [Supabase](https://supabase.com)  
Map tiles: [CARTO](https://carto.com) · [OpenStreetMap](https://openstreetmap.org) · [Esri](https://esri.com) · [OpenTopoMap](https://opentopomap.org)
