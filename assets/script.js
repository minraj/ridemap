'use strict';
/* ═══════════════════════════════════════════════════════════════
   CONSTANTS
 ═══════════════════════════════════════════════════════════════ */
const VER = '2.1.0';
const IDB_NAME = 'ridecomp_v1';          // kept from RideComp so existing rides survive
const IDB_STORE = 'rides';
const STATS_VER = 2;                     // bump to force stats recompute on load
const COLORS = ['#F97316','#06B6D4','#A3E635','#E879F9','#FACC15','#38BDF8','#FB7185','#34D399','#C084FC'];
const FIT_EPOCH = 631065600; // seconds from Unix epoch to FIT epoch (1989-12-31)
const SEMICIRCLE = 180.0 / Math.pow(2, 31);
const HR_ZONES = [
  {name:'Z1 Recovery', maxPct:.60, color:'#38BDF8'},
  {name:'Z2 Endurance',maxPct:.70, color:'#22C55E'},
  {name:'Z3 Tempo',    maxPct:.80, color:'#FACC15'},
  {name:'Z4 Threshold',maxPct:.90, color:'#F97316'},
  {name:'Z5 Max',      maxPct:1.0, color:'#EF4444'},
];
const SIMPLIFY_M     = 4;    // Ramer-Douglas-Peucker tolerance for map polylines (metres)
const CHART_POINTS   = 600;  // max samples per chart dataset
const GRADE_WINDOW_M = 100;  // distance window for max-gradient (smooths GPS elevation noise)
const MOBILE_MQ = window.matchMedia('(max-width: 767px)');

const METRICS = {
  elevation: {key:'ele',   label:'Elevation', unit:'m',    dp:0},
  speed:     {key:'speed', label:'Speed',     unit:'km/h', dp:1},
  hr:        {key:'hr',    label:'Heart rate',unit:'bpm',  dp:0, has:'hasHR', short:'HR'},
  cadence:   {key:'cad',   label:'Cadence',   unit:'rpm',  dp:0, has:'hasCad'},
  power:     {key:'power', label:'Power',     unit:'W',    dp:0, has:'hasPower'},
};

/* ═══════════════════════════════════════════════════════════════
   STATE
 ═══════════════════════════════════════════════════════════════ */
let rides        = [];
let view         = 'list';      // 'list' | 'detail' | 'compare'
let activeId     = null;        // ride shown in the detail view
let selectMode   = false;      // feed cards act as checkboxes (compare / delete)
let selectedIds  = new Set();
let compareTab   = 'metrics';
let chartMetric  = 'elevation';
let filter       = {q:'', range:'all'};
let panelCollapsed = false;
let sheet        = 'half';      // mobile bottom sheet: 'peek' | 'half' | 'full'
let map, tileLayer, routeRenderer, profileChart, hoverMarker, detailMarkers, locateLayer;
let currentTile  = 'outdoor';
let tileFallback = false;       // a keyed tile provider failed this session → use free tiles
let sbClient     = null;
let idb          = null;
let segLayers    = [];
// The site's own Supabase project. Fixed in code on purpose — not user-configurable.
// The publishable key is meant to be public; data is protected by RLS policies.
const SUPABASE = {
  url: 'https://exnqyuwqfvbmakojirua.supabase.co',
  key: 'sb_publishable_AO2On8ZzClh-gma3_OIwiA_RIFPoOYQ',
};
const C = (typeof CONFIG !== 'undefined') ? CONFIG : {};
let cfg          = {
  url: SUPABASE.url,
  key: SUPABASE.key,
  mapTilerKey: C.mapTilerKey || '',
  mapboxToken: C.mapboxToken || '',
  maxHR: 190,
  uid: 'local'
};
let currentUser  = null;
let pendingSync  = new Set();

/* ═══════════════════════════════════════════════════════════════
   ICONS — stroke icons, injected into [data-icon] elements
 ═══════════════════════════════════════════════════════════════ */
const ICONS = {
  plus:     '<path d="M12 5v14M5 12h14"/>',
  minus:    '<path d="M5 12h14"/>',
  search:   '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  layers:   '<path d="m12 3 9 4.5-9 4.5-9-4.5z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/>',
  locate:   '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22"/>',
  expand:   '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  shrink:   '<path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/>',
  back:     '<path d="m15 18-6-6 6-6"/>',
  eye:      '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff:   '<path d="m3 3 18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
  upload:   '<path d="M12 21V9M7 14l5-5 5 5"/><path d="M5 3h14"/>',
  trash:    '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
  user:     '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users:    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  focus:    '<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/><circle cx="12" cy="12" r="3"/>',
  columns:  '<rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="14" y="4" width="7" height="16" rx="1.5"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/>',
  x:        '<path d="M18 6 6 18M6 6l12 12"/>',
  panel:    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  cloud:    '<path d="M16 16l-4-4-4 4M12 12v9"/><path d="M20.4 18.6A5 5 0 0 0 18 9h-1.3A8 8 0 1 0 3 16.3"/>',
  route:    '<circle cx="6" cy="19" r="2.5"/><path d="M8.5 19h8a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H15.5"/><circle cx="18" cy="5" r="2.5"/>',
  check:    '<path d="M20 6 9 17l-5-5"/>',
  file:     '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
};
function icon(name, cls) {
  return `<svg class="ic${cls ? ' '+cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}
function hydrateIcons(root) {
  (root || document).querySelectorAll('[data-icon]').forEach(el => {
    if (!el.querySelector(':scope > svg.ic')) el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
  });
}

/* ═══════════════════════════════════════════════════════════════
   INDEXEDDB
═══════════════════════════════════════════════════════════════ */
function openIDB() {
  return new Promise((res,rej) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = e => {
      if (!e.target.result.objectStoreNames.contains(IDB_STORE))
        e.target.result.createObjectStore(IDB_STORE, {keyPath:'id'});
    };
    r.onsuccess = e => res(e.target.result);
    r.onerror   = e => rej(e.target.error);
  });
}
const idbOp = (mode, fn) => new Promise((res,rej) => {
  if (!idb) return res(null);
  const tx = idb.transaction(IDB_STORE, mode);
  const store = tx.objectStore(IDB_STORE);
  const req = fn(store);
  req.onsuccess = e => res(e.target.result);
  req.onerror   = e => rej(e.target.error);
});
const idbPut    = obj  => idbOp('readwrite', s => s.put(obj));
const idbDel    = id   => idbOp('readwrite', s => s.delete(id));
const idbAll    = ()   => idbOp('readonly',  s => s.getAll());
const idbClear  = ()   => idbOp('readwrite', s => s.clear());

/* ═══════════════════════════════════════════════════════════════
   MAP — basemaps
   Free, key-less tiles are the default. If a MapTiler key or Mapbox
   token is configured (config.js or Settings) those are used instead,
   and we fall back to the free tiles if the provider rejects the key.
   Don't add CARTO (basemaps.cartocdn.com): it now serves an
   "API KEY REQUIRED" image with HTTP 200 for every tile, so no
   tileerror fires and the map just shows the placeholder.
═══════════════════════════════════════════════════════════════ */
const BASEMAPS = {
  outdoor: {
    label: 'Standard',
    free: {url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
           attr:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxNativeZoom:19},
    maptiler: 'outdoor-v2', mapbox: 'outdoors-v12',
  },
  topo: {
    label: 'Topo',
    free: {url:'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
           attr:'&copy; OpenStreetMap contributors, SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)', maxNativeZoom:17},
    maptiler: 'topo-v2', mapbox: 'outdoors-v12',
  },
  satellite: {
    label: 'Satellite',
    free: {url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
           attr:'Imagery &copy; Esri, Maxar, Earthstar Geographics', maxNativeZoom:19},
    maptiler: 'satellite', maptilerExt: 'jpg', mapbox: 'satellite-streets-v12',
  },
  dark: {
    label: 'Dark',
    // OSM tiles darkened with a CSS filter (.tiles-dark) — keeps full trail detail, no key
    free: {url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
           attr:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxNativeZoom:19, className:'tiles-dark'},
    maptiler: 'dataviz-dark', mapbox: 'dark-v11',
  },
};
const BASEMAP_ORDER = ['outdoor','topo','satellite','dark'];

function tileSource(name) {
  const b = BASEMAPS[name];
  if (!tileFallback && cfg.mapTilerKey) {
    return {
      provider: 'MapTiler',
      url: `https://api.maptiler.com/maps/${b.maptiler}/256/{z}/{x}/{y}.${b.maptilerExt || 'png'}?key=${encodeURIComponent(cfg.mapTilerKey)}`,
      opts: {attribution:'&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; OpenStreetMap contributors', maxNativeZoom:20},
    };
  }
  if (!tileFallback && cfg.mapboxToken) {
    return {
      provider: 'Mapbox',
      url: `https://api.mapbox.com/styles/v1/mapbox/${b.mapbox}/tiles/512/{z}/{x}/{y}@2x?access_token=${encodeURIComponent(cfg.mapboxToken)}`,
      opts: {attribution:'&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; OpenStreetMap contributors', tileSize:512, zoomOffset:-1},
    };
  }
  return {provider:null, url:b.free.url, opts:{attribution:b.free.attr, maxNativeZoom:b.free.maxNativeZoom, subdomains:'abc', className:b.free.className || ''}};
}

function previewUrl(name) {
  const f = BASEMAPS[name].free;
  return f.url.replace('{s}','a').replace('{z}','11').replace('{x}','1506').replace('{y}','857');
}

function initMap() {
  map = L.map('map', {zoomControl:false, maxZoom:20, worldCopyJump:true}).setView([27.7, 85.3], 12);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  routeRenderer = L.canvas({padding:0.5, tolerance:8});
  detailMarkers = L.layerGroup().addTo(map);
  hoverMarker = L.marker([0,0], {
    icon: L.divIcon({className:'hover-dot', iconSize:[16,16]}),
    interactive:false, keyboard:false, zIndexOffset:1000
  });
  hoverMarker.bindTooltip('', {permanent:true, direction:'top', offset:[0,-12], className:'telemetry', opacity:1});

  map.on('locationfound', onLocationFound);
  map.on('locationerror', e => {
    document.getElementById('btn-locate').classList.remove('busy');
    toast('Location unavailable: ' + e.message, 'err');
  });
  map.on('click', () => toggleLayerMenu(false));
  setTileLayer(currentTile);
}

function setTileLayer(name) {
  if (!BASEMAPS[name]) name = 'outdoor';
  currentTile = name;
  if (tileLayer) map.removeLayer(tileLayer);
  const src = tileSource(name);
  tileLayer = L.tileLayer(src.url, {...src.opts, maxZoom:20}).addTo(map);

  if (src.provider) {
    checkTileKey(src);
    // Network-level failures (provider down, blocked) also fall back
    let loaded = 0, failed = 0;
    tileLayer.on('tileload', () => { loaded++; });
    tileLayer.on('tileerror', () => {
      if (++failed >= 3 && loaded === 0) useFreeTiles(src.provider + ' tiles failed to load');
    });
  }
  document.body.dataset.basemap = name;
  renderLayerMenu();
  saveState();
}

// Providers answer a bad key with HTTP 401/403 *plus a placeholder image*
// ("Invalid key"), which <img> happily displays — no tileerror fires. So probe
// one tile with fetch() (both send CORS headers on errors) and check the status.
const _keyChecks = {};
function checkTileKey(src) {
  const url = src.url.replace('{z}', '0').replace('{x}', '0').replace('{y}', '0');
  _keyChecks[url] = _keyChecks[url] || fetch(url, {cache:'no-store'}).then(r => r.ok, () => true);  // offline ≠ bad key
  _keyChecks[url].then(ok => { if (!ok) useFreeTiles(src.provider + ' rejected the map key'); });
}
function useFreeTiles(reason) {
  if (tileFallback) return;
  tileFallback = true;
  toast(reason + ' — using free OpenStreetMap tiles', 'err');
  setTileLayer(currentTile);
}

function setTile(name) {
  setTileLayer(name);
  toggleLayerMenu(false);
}
function cycleBasemap() {
  setTileLayer(BASEMAP_ORDER[(BASEMAP_ORDER.indexOf(currentTile) + 1) % BASEMAP_ORDER.length]);
  toast('Basemap: ' + BASEMAPS[currentTile].label);
}

function renderLayerMenu() {
  const box = document.getElementById('layer-opts');
  if (!box) return;
  box.innerHTML = BASEMAP_ORDER.map(k => `
    <button class="layer-opt${k === currentTile ? ' on' : ''}" role="menuitemradio" aria-checked="${k === currentTile}" onclick="setTile('${k}')">
      <img src="${previewUrl(k)}" alt="" loading="lazy" class="${BASEMAPS[k].free.className || ''}"/>
      <span>${BASEMAPS[k].label}</span>
    </button>`).join('');
  const src = tileSource(currentTile);
  document.getElementById('layer-note').textContent =
    src.provider ? `Tiles by ${src.provider}` : tileFallback ? 'Map key rejected · using free tiles' : 'Free tiles · no API key needed';
}
function toggleLayerMenu(force) {
  const m = document.getElementById('layer-menu');
  const open = force !== undefined ? force : m.hidden;
  m.hidden = !open;
  document.getElementById('btn-layers').classList.toggle('on', open);
}

/* ─── Locate me & fullscreen ─────────────────────────────────── */
function locateMe() {
  if (!navigator.geolocation) { toast('Geolocation is not supported by this browser', 'err'); return; }
  document.getElementById('btn-locate').classList.add('busy');
  map.locate({setView:false, enableHighAccuracy:true, timeout:10000});
}
function onLocationFound(e) {
  document.getElementById('btn-locate').classList.remove('busy');
  if (locateLayer) map.removeLayer(locateLayer);
  locateLayer = L.layerGroup([
    L.circle(e.latlng, {radius:e.accuracy, color:'#06B6D4', weight:1, opacity:.6, fillOpacity:.12, interactive:false}),
    L.marker(e.latlng, {icon:L.divIcon({className:'me-dot', iconSize:[18,18]}), interactive:false, keyboard:false}),
  ]).addTo(map);
  map.flyTo(e.latlng, Math.max(map.getZoom(), 15), {duration:.8});
}
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(err => toast('Fullscreen unavailable: ' + err.message, 'err'));
}

/* ═══════════════════════════════════════════════════════════════
   FIT BINARY PARSER
   Tested against real Garmin ACTIVITY.fit files.
   Supports: lat/lng (semicircles), enhanced_altitude (field 78),
   heart_rate, cadence, power, distance, speed, timestamp (Record,
   global msg 20) and Lap summaries (global msg 19).
═══════════════════════════════════════════════════════════════ */
function parseFIT(buffer) {
  const bytes = new Uint8Array(buffer);
  const dv    = new DataView(buffer);
  if (bytes.length < 12) throw new Error('File too small');

  const headerLen = bytes[0];
  const magic = String.fromCharCode(bytes[8],bytes[9],bytes[10],bytes[11]);
  if (magic !== '.FIT') throw new Error('Not a valid FIT file — magic bytes missing. Is this a Garmin ACTIVITY.fit?');

  const dataSize = dv.getUint32(4, true);
  const fileEnd  = headerLen + dataSize;

  const defs = {};  // localMsgNum → definition
  const pts  = [];
  const laps = [];
  const U8 = 0xFF, U16 = 0xFFFF, U32 = 0xFFFFFFFF;
  const ok = (v, inv) => v != null && v !== inv;

  let off = headerLen;

  while (off < fileEnd - 1 && off < bytes.length - 1) {
    const rh = bytes[off++];
    const compressed = (rh & 0x80) !== 0;
    const isDef      = !compressed && (rh & 0x40) !== 0;
    const hasDev     = !compressed && (rh & 0x20) !== 0;
    const localNum   = compressed ? (rh >> 5) & 0x03 : (rh & 0x0F);

    if (compressed) {
      const d = defs[localNum];
      if (d) off += d.size;
      continue;
    }

    if (isDef) {
      off++;  // reserved
      const le = bytes[off++] === 0;
      const gmn = le ? dv.getUint16(off,true) : dv.getUint16(off,false); off += 2;
      const nf  = bytes[off++];
      const fields = [];
      let size = 0;
      for (let i = 0; i < nf; i++) {
        const fd = bytes[off], fs = bytes[off+1], bt = bytes[off+2];
        fields.push({fd, fs, bt}); size += fs; off += 3;
      }
      if (hasDev) {
        const nd = bytes[off++];
        for (let i = 0; i < nd; i++) { size += bytes[off+1]; off += 3; }
      }
      defs[localNum] = {gmn, fields, size, le};

    } else {
      const d = defs[localNum];
      if (!d) { off++; continue; }

      if (d.gmn === 20 || d.gmn === 19) {
        let fo = off;
        const p = {};
        for (const {fd, fs, bt} of d.fields) {
          if (fo + fs > bytes.length) break;
          p[fd] = readVal(dv, bytes, fo, fs, bt, d.le);
          fo += fs;
        }

        if (d.gmn === 20) {   // Record message
          const lat = p[0], lng = p[1];
          const INV = 0x7FFFFFFF;
          if (lat != null && lng != null && lat !== INV && lng !== INV) {
            // Enhanced altitude (field 78): raw/5 - 500 (verified on test file)
            let ele = 0;
            if (p[78] != null && p[78] < 0xFFFF) ele = p[78] / 5 - 500;
            else if (p[2]  != null && p[2]  < 0xFFFF) ele = p[2]  / 5 - 100;

            // enhanced_speed (73) / speed (6) are m/s × 1000
            const spd = ok(p[73], U32) ? p[73] : ok(p[6], U16) ? p[6] : null;

            pts.push({
              lat:   lat * SEMICIRCLE,
              lng:   lng * SEMICIRCLE,
              ele:   Math.round(ele * 10) / 10,
              hr:    (p[3]  != null && p[3]  < 250) ? p[3]  : null,
              cad:   (p[4]  != null && p[4]  < 255) ? p[4]  : null,
              power: (p[7]  != null && p[7]  < 9999) ? p[7] : null,
              dist:  ok(p[5], U32) ? p[5] / 100 : null, // cm → m
              speed: spd != null ? Math.round(spd / 1000 * 3.6 * 10) / 10 : null,
              ts:    (p[253]!= null) ? new Date((p[253] + FIT_EPOCH) * 1000) : null,
            });
          }
        } else {              // Lap message
          const timer = ok(p[8], U32) ? p[8] / 1000 : ok(p[7], U32) ? p[7] / 1000 : null;
          const spd   = ok(p[110], U32) ? p[110] : ok(p[13], U16) ? p[13] : null;
          laps.push({
            totalTime: timer,
            distance:  ok(p[9], U32) ? p[9] / 100000 : null,           // cm → km
            avgHr:     ok(p[15], U8) ? p[15] : null,
            maxHr:     ok(p[16], U8) ? p[16] : null,
            avgSpeed:  spd != null ? Math.round(spd / 1000 * 3.6 * 10) / 10 : null,
            ascent:    ok(p[21], U16) ? p[21] : null,
          });
        }
      }
      off += d.size;
    }
  }

  if (!pts.length) throw new Error('No GPS points found. Make sure GPS was active during the activity.');

  // Fill in speed from distance/time deltas where the device didn't record it
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i-1], b = pts[i];
    if (b.speed == null && a.dist != null && b.dist != null && a.ts && b.ts) {
      const dd = b.dist - a.dist;       // metres
      const dt = (b.ts - a.ts) / 1000;  // seconds
      if (dt > 0 && dd >= 0 && dd < 200) {
        b.speed = Math.round((dd / dt) * 3.6 * 10) / 10;
      }
    }
  }

  // Single-lap files just repeat the whole ride — not worth showing
  return {pts, laps: laps.length > 1 ? laps : []};
}

function readVal(dv, bytes, off, size, bt, le) {
  try {
    if (size === 1) return bytes[off];
    if (size === 2) return le ? dv.getUint16(off,true) : dv.getUint16(off,false);
    if (size === 4) {
      if ((bt & 0x7F) === 5) return le ? dv.getInt32(off,true) : dv.getInt32(off,false);
      return le ? dv.getUint32(off,true) : dv.getUint32(off,false);
    }
    return bytes[off];
  } catch { return null; }
}

/* ═══════════════════════════════════════════════════════════════
   GPX PARSER
   Handles plain GPX tracks/routes/waypoints and gpx.studio exports.
   Extensions (Garmin TrackPointExtension etc.) are matched by local
   name in a single pass over each point's descendants, which is far
   faster on large files than per-field namespace/XPath lookups.
═══════════════════════════════════════════════════════════════ */
const GPX_EXT = {hr:'hr', heartrate:'hr', cad:'cad', cadence:'cad', speed:'speed', power:'power', watts:'power'};

function parseGPX(text) {
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length) throw new Error('Invalid XML in GPX file');

  // Try track points first, then route points, then waypoints
  let nodes = xml.getElementsByTagNameNS('*', 'trkpt');
  if (!nodes.length) nodes = xml.getElementsByTagNameNS('*', 'rtept');
  if (!nodes.length) nodes = xml.getElementsByTagNameNS('*', 'wpt');
  if (!nodes.length) throw new Error('No track/route/waypoints found in GPX');

  const pts = [];
  for (const pt of nodes) {
    const lat = parseFloat(pt.getAttribute('lat'));
    const lng = parseFloat(pt.getAttribute('lon'));
    if (!isFinite(lat) || !isFinite(lng)) continue;
    const p = {lat, lng, ele:0, hr:null, cad:null, speed:null, power:null, ts:null};
    for (const el of pt.getElementsByTagName('*')) {
      const name = el.localName.toLowerCase();
      if (name === 'ele') p.ele = parseFloat(el.textContent) || 0;
      else if (name === 'time') { const d = new Date(el.textContent.trim()); if (!isNaN(d)) p.ts = d; }
      else if (GPX_EXT[name] && !el.childElementCount) {
        const v = parseFloat(el.textContent);
        if (!isNaN(v) && p[GPX_EXT[name]] == null) p[GPX_EXT[name]] = v;
      }
    }
    if (p.speed != null) p.speed = Math.round(p.speed * 3.6 * 10) / 10;   // m/s → km/h
    pts.push(p);
  }
  if (!pts.length) throw new Error('No valid coordinates found in GPX');
  deriveSpeed(pts);
  const trk = xml.querySelector('trk > name, rte > name, metadata > name');
  pts.trackName = trk?.textContent.trim() || '';   // used as the ride name on import
  return pts;
}

// Speed from position/time over a ±2 point window, for files that don't record it
function deriveSpeed(pts) {
  if (pts.some(p => p.speed != null)) return;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i-2)], b = pts[Math.min(pts.length-1, i+2)];
    if (!a.ts || !b.ts) continue;
    const dt = (b.ts - a.ts) / 1000;
    if (dt <= 0 || dt > 120) continue;
    let d = 0;
    for (let j = Math.max(0, i-2); j < Math.min(pts.length-1, i+2); j++) d += haversine(pts[j], pts[j+1]);
    const v = d / (dt / 3600);
    if (v < 120) pts[i].speed = Math.round(v * 10) / 10;
  }
}

/* ═══════════════════════════════════════════════════════════════
   FILE HANDLING
═══════════════════════════════════════════════════════════════ */
function openFilePicker() { document.getElementById('fi').click(); }

function handleFiles(fl) {
  const files = Array.from(fl || []);
  document.getElementById('fi').value = '';
  if (!files.length) return;
  processQueue(files, 0, []);
}
function processQueue(files, i, added) {
  if (i >= files.length) {
    if (added.length === 1) openDetail(added[0].id);
    else if (added.length > 1) focusRides(added);
    return;
  }
  const f = files[i];
  const ext = f.name.split('.').pop().toLowerCase();
  loader(true, `Parsing ${f.name}…`);

  const next = r => { if (r) added.push(r); loader(false); setTimeout(() => processQueue(files, i+1, added), 30); };

  if (ext === 'gpx') {
    const r = new FileReader();
    r.onload = async e => {
      let ride = null;
      try {
        const pts = parseGPX(e.target.result);
        ride = await importRide(pts.trackName || f.name.replace(/\.gpx$/i,''), pts, 'gpx');
      }
      catch(err) { toast('GPX error in "'+f.name+'": '+err.message, 'err'); console.error(err); }
      next(ride);
    };
    r.onerror = () => { toast('Cannot read '+f.name, 'err'); next(); };
    r.readAsText(f);

  } else if (ext === 'fit') {
    const r = new FileReader();
    r.onload = async e => {
      let ride = null;
      try {
        const {pts, laps} = parseFIT(e.target.result);
        ride = await importRide(f.name.replace(/\.fit$/i,''), pts, 'fit', laps);
      }
      catch(err) { toast('FIT error in "'+f.name+'": '+err.message, 'err'); console.error(err); }
      next(ride);
    };
    r.onerror = () => { toast('Cannot read '+f.name, 'err'); next(); };
    r.readAsArrayBuffer(f);

  } else {
    toast('Unsupported: '+f.name+' (use .fit or .gpx)', 'err');
    next();
  }
}

/* ═══════════════════════════════════════════════════════════════
   GEOMETRY
═══════════════════════════════════════════════════════════════ */
function haversine(a,b) {
  const R=6371, dLat=(b.lat-a.lat)*Math.PI/180, dLon=(b.lng-a.lng)*Math.PI/180;
  const x=Math.sin(dLat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(Math.max(0,1-x)));
}

// Cumulative distance in km at each point
function cumulativeKm(pts) {
  const c = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) c[i] = c[i-1] + haversine(pts[i-1], pts[i]);
  return c;
}

// Ramer-Douglas-Peucker, iterative (no recursion limit on 100k-point logs).
// Works in a local equirectangular projection so epsilon is in metres.
// Returns the indices of the points to keep.
function simplifyRDP(pts, epsM) {
  const n = pts.length;
  if (n < 3) return pts.map((_, i) => i);
  const kx = 111320 * Math.cos(pts[0].lat * Math.PI / 180), ky = 110540;
  const xs = new Float64Array(n), ys = new Float64Array(n);
  for (let i = 0; i < n; i++) { xs[i] = pts[i].lng * kx; ys[i] = pts[i].lat * ky; }
  const keep = new Uint8Array(n);
  keep[0] = keep[n-1] = 1;
  const eps2 = epsM * epsM;
  const stack = [0, n-1];
  while (stack.length) {
    const b = stack.pop(), a = stack.pop();
    const ax = xs[a], ay = ys[a], dx = xs[b] - ax, dy = ys[b] - ay;
    const len2 = dx*dx + dy*dy;
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      let px = xs[i] - ax, py = ys[i] - ay;
      if (len2 > 0) {
        const t = Math.max(0, Math.min(1, (px*dx + py*dy) / len2));
        px -= t*dx; py -= t*dy;
      }
      const d = px*px + py*py;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps2) {
      keep[idx] = 1;
      stack.push(a, idx, idx, b);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

// Evenly spaced indices (always includes the last point)
function sampleIndices(n, target) {
  if (n <= target) return Array.from({length:n}, (_, i) => i);
  const out = [];
  const step = (n - 1) / (target - 1);
  for (let i = 0; i < target; i++) out.push(Math.round(i * step));
  return out;
}

// Gradient (%) around point i, over ±halfM metres
function gradeAt(r, i, halfM = 50) {
  const c = r.cum, p = r.points, n = p.length;
  let a = i, b = i;
  while (a > 0 && (c[i] - c[a]) * 1000 < halfM) a--;
  while (b < n - 1 && (c[b] - c[i]) * 1000 < halfM) b++;
  const dm = (c[b] - c[a]) * 1000;
  return dm > 10 ? (p[b].ele - p[a].ele) / dm * 100 : 0;
}

// Steepest sustained climb over GRADE_WINDOW_M — raw point-to-point grades are dominated by GPS noise
function maxGradient(pts, cum) {
  let best = 0, j = 0;
  for (let i = 0; i < pts.length; i++) {
    if (j < i) j = i;
    while (j < pts.length - 1 && (cum[j] - cum[i]) * 1000 < GRADE_WINDOW_M) j++;
    const dm = (cum[j] - cum[i]) * 1000;
    if (dm < GRADE_WINDOW_M * 0.8) break;
    const g = (pts[j].ele - pts[i].ele) / dm * 100;
    if (g > best) best = g;
  }
  return Math.round(Math.min(best, 60) * 10) / 10;
}

/* ═══════════════════════════════════════════════════════════════
   STATS ENGINE
═══════════════════════════════════════════════════════════════ */
function computeStats(pts) {
  if (!pts.length) return {v: STATS_VER};

  const cum = cumulativeKm(pts);
  const dist = cum[cum.length - 1];
  let climbDist = 0, moving = 0;
  for (let i=1; i<pts.length; i++) {
    const d = cum[i] - cum[i-1];
    // CLIMB DETECTION (> 8% grade)
    const deltaEle = pts[i].ele - pts[i-1].ele;
    if (d > 0.001) {
      const grade = (deltaEle / (d * 1000)) * 100;
      if (grade > 8) climbDist += d;
    }
    // MOVING TIME: gaps under 2 min where we moved faster than ~2 km/h
    const a = pts[i-1].ts, b = pts[i].ts;
    if (a instanceof Date && b instanceof Date) {
      const dt = (b - a) / 1000;
      if (dt > 0 && dt <= 120 && (d * 1000) / dt > 0.55) moving += dt;
    }
  }

  let eleGain=0, eleLoss=0;
  const eles = pts.map(p=>p.ele||0);
  for (let i=1; i<eles.length; i++) {
    const d = eles[i]-eles[i-1];
    if (d > 0.3) eleGain+=d; else if (d < -0.3) eleLoss+=Math.abs(d);
  }

  const valid = pts.filter(p=>p.ts instanceof Date && !isNaN(p.ts));
  const dur   = valid.length>=2 ? (valid[valid.length-1].ts - valid[0].ts)/1000 : null;

  const hrs  = pts.map(p=>p.hr).filter(v=>v>30&&v<250);
  const spds = pts.map(p=>p.speed).filter(v=>v>0&&v<120);
  const cads = pts.map(p=>p.cad).filter(v=>v>20&&v<200);
  const pows = pts.map(p=>p.power).filter(v=>v>0&&v<2500);

  const avg = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : null;
  const max = a => a.length ? a.reduce((m,v) => v > m ? v : m, -Infinity) : null;
  const min = a => a.length ? a.reduce((m,v) => v < m ? v : m, Infinity) : null;

  // HR zones
  const maxHR = cfg.maxHR || 190;
  const zoneCounts = HR_ZONES.map((z,i) => {
    const lo = i===0 ? 0 : HR_ZONES[i-1].maxPct;
    return hrs.filter(h => { const p=h/maxHR; return p>=lo && (p<z.maxPct || i===HR_ZONES.length-1); }).length;
  });
  const zTotal = zoneCounts.reduce((a,b)=>a+b,0);
  const zonePct = zoneCounts.map(c => zTotal>0 ? Math.round(c/zTotal*100) : 0);

  const avgHrV = avg(hrs);
  const tss = (dur && avgHrV && maxHR) ?
    Math.round((dur/3600) * Math.pow(avgHrV/maxHR,2) * 100) : null;

  const avgSpd = moving > 60 ? dist / (moving / 3600)
               : spds.length ? avg(spds) : (dist && dur ? dist / (dur / 3600) : null);

  return {
    v:        STATS_VER,
    distance: +dist.toFixed(2),
    climbDist: +climbDist.toFixed(2),
    duration: dur,
    movingTime: moving > 60 ? Math.round(moving) : dur,
    eleGain:  Math.round(eleGain),
    eleLoss:  Math.round(eleLoss),
    maxEle:   Math.round(max(eles)||0),
    minEle:   Math.round(min(eles)||0),
    maxGrade: maxGradient(pts, cum),
    avgHr:    hrs.length  ? Math.round(avgHrV) : null,
    maxHr:    hrs.length  ? Math.round(max(hrs)) : null,
    avgSpeed: avgSpd      ? +avgSpd.toFixed(1) : null,
    maxSpeed: spds.length ? +max(spds).toFixed(1) : null,
    avgCad:   cads.length ? Math.round(avg(cads)) : null,
    avgPower: pows.length ? Math.round(avg(pows)) : null,
    maxPower: pows.length ? Math.round(max(pows)) : null,
    zonePct, tss,
    startDate: valid.length ? valid[0].ts : null,
    pointCount: pts.length,
    hasHR:    hrs.length > 0,
    hasSpeed: spds.length > 0,
    hasCad:   cads.length > 0,
    hasPower: pows.length > 0,
  };
}

/* ═══════════════════════════════════════════════════════════════
   RIDE MANAGEMENT
   Stored record: {id, name, color, points, stats, fileType, laps, savedAt}
   Runtime ride adds: cum, simp, smap, thumb, poly, casing, group, visible
═══════════════════════════════════════════════════════════════ */
const rideById = id => rides.find(r => r.id === id);

// owner: id of the account whose cloud this record mirrors. Missing = a ride saved only
// in this browser (guest uploads, or not synced yet). Local only, never sent to Supabase.
function toRecord(r) {
  return {id:r.id, name:r.name, color:r.color, points:r.points, stats:r.stats, fileType:r.fileType, laps:r.laps, savedAt:r.savedAt, owner:r.owner || null};
}

function nextColor() {
  const used = new Set(rides.map(r => r.color));
  return COLORS.find(c => !used.has(c)) || COLORS[rides.length % COLORS.length];
}

// Build the runtime ride (derived data + map layers) from a stored record
function hydrate(rec) {
  if (rideById(rec.id)) return null;
  const pts = rec.points || [];
  pts.forEach(p => { if (p.ts && typeof p.ts === 'string') p.ts = new Date(p.ts); });
  const fresh = !(rec.stats && rec.stats.v === STATS_VER);
  const stats = fresh ? computeStats(pts) : rec.stats;
  if (stats.startDate && !(stats.startDate instanceof Date)) stats.startDate = new Date(stats.startDate);

  const r = {
    id: rec.id, name: rec.name, color: rec.color || nextColor(),
    points: pts, stats, fileType: rec.fileType || rec.file_type || 'gpx',
    laps: rec.laps || [], savedAt: rec.savedAt || Date.parse(rec.created_at) || Date.now(),
    owner: rec.owner || null, visible: true,
  };
  r.fingerprint = pts.length ? rideFingerprint(pts, stats) : null;
  r.cum   = cumulativeKm(pts);
  r.simp  = simplifyRDP(pts, SIMPLIFY_M);
  r.smap  = sampleIndices(pts.length, CHART_POINTS);
  r.thumb = buildThumb(r);
  buildRideLayers(r);
  rides.push(r);
  if (fresh && idb) idbPut(toRecord(r)).catch(()=>{});
  return r;
}

function buildRideLayers(r) {
  const latlngs = r.simp.map(i => [r.points[i].lat, r.points[i].lng]);
  const line = {renderer:routeRenderer, lineCap:'round', lineJoin:'round'};
  r.casing = L.polyline(latlngs, {...line, color:'#0F172A', weight:7, opacity:.55, interactive:false});
  r.poly   = L.polyline(latlngs, {...line, color:r.color, weight:3.5, opacity:1});
  r.poly.on('click', e => { L.DomEvent.stopPropagation(e); openDetail(r.id); });
  r.poly.on('mousemove', e => onRouteHover(r, e.latlng));
  r.poly.on('mouseout', clearChartHover);
  r.group = L.layerGroup([r.casing, r.poly]);
}

// Mini SVG of the route shape for feed cards
function buildThumb(r) {
  let idx = r.simp;
  if (idx.length > 160) idx = sampleIndices(idx.length, 160).map(k => idx[k]);
  if (idx.length < 2) return '';
  const k = Math.cos(r.points[idx[0]].lat * Math.PI / 180);
  const xy = idx.map(i => [r.points[i].lng * k, -r.points[i].lat]);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  xy.forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
  const s = 48 / (Math.max(x1 - x0, y1 - y0) || 1);
  const ox = (56 - (x1 - x0) * s) / 2, oy = (56 - (y1 - y0) * s) / 2;
  const pts = xy.map(([x, y]) => [((x - x0) * s + ox).toFixed(1), ((y - y0) * s + oy).toFixed(1)]);
  return `<svg viewBox="0 0 56 56" aria-hidden="true"><path d="M${pts.map(p => p.join(' ')).join('L')}"/><circle cx="${pts[0][0]}" cy="${pts[0][1]}" r="2.6"/></svg>`;
}

// Identifies the same ride across re-uploads, renames and formats (a GPX exported
// from a FIT, say). Recorded rides: start time to the second — nobody starts two
// rides in the same second. Untimed routes: endpoints + distance.
// Must match the SQL backfill in README.md (stats->>'startDate' → 't:<epoch seconds>').
function rideFingerprint(points, stats) {
  if (stats.startDate) return 't:' + Math.floor(+new Date(stats.startDate) / 1000);
  const c = p => p.lat.toFixed(5) + ',' + p.lng.toFixed(5);
  return 'g:' + c(points[0]) + '|' + c(points[points.length - 1]) + '|' + Math.round((stats.distance || 0) * 100);
}

// Pre-flight for uploads: refuse a ride that's already loaded here or stored in the cloud
async function importRide(name, points, fileType, laps) {
  if (!points || !points.length) { toast('"'+name+'" has no GPS points', 'err'); return null; }
  const stats = computeStats(points);
  const fp = rideFingerprint(points, stats);
  const dup = rides.find(r => r.fingerprint === fp) || await findCloudDuplicate(fp, stats);
  if (dup) { toast(`This ride has already been uploaded ("${dup.name}").`, 'warn'); return null; }
  return addRide(name, points, fileType, laps, stats);
}

function addRide(name, points, fileType, laps, stats) {
  if (!points || !points.length) { toast('"'+name+'" has no GPS points', 'err'); return null; }

  const rec = {
    id: 'r_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
    name, color: nextColor(), points, stats: stats || computeStats(points),
    fileType: fileType || 'gpx', laps: laps || [], savedAt: Date.now(),
  };
  idbPut(rec).catch(()=>{});
  const r = hydrate(rec);
  pendingSync.add(r.id);
  updateUnsavedChip();
  refresh();
  toast('Loaded: '+name+' ('+points.length.toLocaleString()+' pts)', 'ok');
  return r;
}

// Take a ride out of memory and off the map. IndexedDB keeps it.
function unloadRide(r) {
  map.removeLayer(r.group);
  rides = rides.filter(x => x.id !== r.id);
  pendingSync.delete(r.id);
  selectedIds.delete(r.id);
  if (r.id === activeId) { view = 'list'; activeId = null; }
}

// Take a ride out of memory, the map and IndexedDB (not the cloud)
function detachRide(r) {
  unloadRide(r);
  idbDel(r.id).catch(()=>{});
}

const savedHidden = () => {
  try { return new Set(JSON.parse(localStorage.getItem('ridecomp_state') || '{}').hidden || []); }
  catch { return new Set(); }
};

// Show rides from IndexedDB. Only for guests (rides saved in this browser) and for a
// signed-in user who is offline (that account's cached rides plus local ones).
async function restoreCachedRides(uid) {
  const stored = (await idbAll().catch(() => null)) || [];
  const recs = stored.filter(rec => !rec.owner || rec.owner === uid);
  if (!recs.length) return;
  loader(true, `Restoring ${recs.length} ride(s)…`);
  const hidden = savedHidden();
  recs.forEach(rec => { const r = hydrate(rec); if (r && hidden.has(r.id)) r.visible = false; });
  loader(false);
  focusRides(rides.filter(r => r.visible), false);
  refresh();
}

function deleteRide(id) { return deleteRides([id]); }

// Delete from this device and, when signed in, from Supabase. Optimistic: the rides
// disappear immediately and are put back if the cloud delete fails.
async function deleteRides(ids, {confirmed = false} = {}) {
  const list = rides.filter(r => ids.includes(r.id));
  if (!list.length) return;
  const cloud = !!(sbClient && currentUser);
  const what = list.length === 1 ? `"${list[0].name}"` : `${list.length} rides`;
  if (!confirmed && !confirm(`Delete ${what} from this device${cloud ? ' and the cloud' : ''}? This cannot be undone.`)) return;

  const backup = list.map(r => ({rec: toRecord(r), pending: pendingSync.has(r.id), visible: r.visible}));
  list.forEach(detachRide);
  if (list.some(r => r.id === activeId)) { view = 'list'; activeId = null; }
  if (!selectedIds.size) selectMode = false;
  updateUnsavedChip();
  refresh();

  if (!cloud) { toast(`Deleted ${what} from this device`); return; }

  // Rides never synced aren't in the cloud, so don't expect them back
  const expected = backup.filter(b => !b.pending).map(b => b.rec.id);
  let failed = expected;
  try {
    // Chunked so a big delete doesn't exceed URL length limits
    const gone = new Set();
    for (let i = 0; i < expected.length; i += 100) {
      const {data, error} = await sbClient.from('ridecomp_rides')
        .delete().in('id', expected.slice(i, i + 100)).eq('user_id', currentUser.id).select('id');
      if (error) throw error;
      (data || []).forEach(d => gone.add(d.id));
    }
    // RLS without a delete policy "succeeds" but deletes nothing — check what actually went
    failed = expected.filter(id => !gone.has(id));
    if (failed.length) throw new Error(`the cloud kept ${failed.length} ride(s) — is there a delete policy on ridecomp_rides?`);
    toast(`Deleted ${what}`, 'ok');
  } catch (e) {
    console.error('Cloud delete failed', e);
    // Roll back the ones still in the cloud so the list matches the database
    backup.filter(b => failed.includes(b.rec.id)).forEach(b => {
      const r = hydrate(b.rec);
      if (!r) return;
      r.visible = b.visible;
      idbPut(b.rec).catch(()=>{});
    });
    refresh();
    toast('Could not delete from the cloud: ' + e.message, 'err');
  }
}

// Select every extra copy of the same ride, keeping the oldest one
function selectDuplicates() {
  const groups = new Map();
  rides.forEach(r => groups.set(r.fingerprint, [...(groups.get(r.fingerprint) || []), r]));
  selectedIds.clear();
  groups.forEach(list => {
    if (list.length < 2) return;
    list.sort((a, b) => a.savedAt - b.savedAt).slice(1).forEach(r => selectedIds.add(r.id));
  });
  selectMode = true;
  refresh();
  toast(selectedIds.size
    ? `${selectedIds.size} duplicate ride(s) selected — review them, then Delete`
    : 'No duplicate rides found', selectedIds.size ? 'warn' : 'ok');
}

function toggleVis(id) {
  const r = rideById(id);
  if (!r) return;
  r.visible = !r.visible;
  saveState();
  refresh();
}

// Deletes every ride from this device and, when signed in, from the cloud.
// Stays signed in. Needs the word DELETE typed, not just a click.
async function clearAll() {
  const cloud = !!(sbClient && currentUser);
  if (cloud) await loadRidesFromSupabase();   // make sure cloud-only rides are counted and deleted too
  if (!rides.length) { toast('No rides to delete'); return; }
  const where = cloud ? 'from this device AND from your cloud account' : 'from this device';
  const typed = prompt(`This permanently deletes all ${rides.length} ride(s) ${where}.\nIt cannot be undone.\n\nType DELETE to confirm.`);
  if (typed === null) return;
  if (typed.trim() !== 'DELETE') { toast('Nothing deleted — type DELETE (in capitals) to confirm', 'warn'); return; }
  closeSettings();
  await deleteRides(rides.map(r => r.id), {confirmed: true});
}

/* ═══════════════════════════════════════════════════════════════
   NAVIGATION — list / detail / compare
═══════════════════════════════════════════════════════════════ */
function openDetail(id) {
  const r = rideById(id);
  if (!r) return;
  if (selectMode && view === 'list') { toggleSelected(id); return; }
  view = 'detail';
  activeId = id;
  if (!r.visible) { r.visible = true; saveState(); }
  if (!(METRICS[chartMetric].has ? r.stats[METRICS[chartMetric].has] : true)) chartMetric = 'elevation';
  if (isMobile() && sheet === 'peek') setSheet('half');
  refresh();
  focusRides([r]);
}

function backToList() {
  view = 'list';
  activeId = null;
  clearSegLayers();
  hideHoverMarker();
  refresh();
}

function toggleSelectMode(force) {
  selectMode = force !== undefined ? force : !selectMode;
  if (!selectMode) selectedIds.clear();
  refresh();
}
function toggleSelected(id) {
  selectedIds.has(id) ? selectedIds.delete(id) : selectedIds.add(id);
  refresh();
}
function toggleSelectAll() {
  const list = filteredRides();
  const all = list.length && list.every(r => selectedIds.has(r.id));
  list.forEach(r => all ? selectedIds.delete(r.id) : selectedIds.add(r.id));
  refresh();
}
function openCompare() {
  const list = rides.filter(r => selectedIds.has(r.id));
  if (list.length < 2) { toast('Select at least 2 rides to compare', 'warn'); return; }
  view = 'compare';
  list.forEach(r => { r.visible = true; });
  refresh();
  focusRides(list);
}
function setCompareTab(tab) {
  compareTab = tab;
  if (tab !== 'segments') clearSegLayers();
  renderCompare();
}

function setFilter(k, v) {
  filter[k] = v;
  renderFeed();
}

// Map padding so routes aren't hidden behind the panel / bottom sheet
function mapPadding() {
  if (isMobile()) return {paddingTopLeft:[24, 72], paddingBottomRight:[24, sheetVisible(sheet) + 24]};
  const panel = document.getElementById('panel');
  const left = panelCollapsed ? 24 : panel.getBoundingClientRect().right + 32;
  return {paddingTopLeft:[left, 32], paddingBottomRight:[72, 32]};
}

function focusRides(list, animate = true) {
  if (!list.length) return;
  const b = L.latLngBounds([]);   // fresh object — poly.getBounds() is cached, don't mutate it
  list.forEach(r => b.extend(r.poly.getBounds()));
  if (!b.isValid()) return;
  const opts = {...mapPadding(), maxZoom:16};
  animate ? map.flyToBounds(b, {...opts, duration:.9}) : map.fitBounds(b, opts);
}

/* ═══════════════════════════════════════════════════════════════
   MAP STYLING — which routes are highlighted / dimmed
═══════════════════════════════════════════════════════════════ */
function focusSet() {
  if (view === 'detail') return new Set([activeId]);
  if (view === 'compare' || (selectMode && selectedIds.size)) return selectedIds;
  return null;
}

function applyMapStyles() {
  const focus = focusSet();
  const front = [];
  rides.forEach(r => {
    const inFocus = focus ? focus.has(r.id) : true;
    if (!r.visible && !(focus && inFocus)) { map.removeLayer(r.group); return; }
    if (!map.hasLayer(r.group)) r.group.addTo(map);
    const hero = view === 'detail' && r.id === activeId;
    r.poly.setStyle({opacity: inFocus ? 1 : .5, weight: hero ? 5 : inFocus ? 3.5 : 2.5});
    r.casing.setStyle({opacity: inFocus ? .55 : 0, weight: hero ? 10 : 7});
    if (inFocus) front.push(r);
  });
  front.forEach(r => { r.casing.bringToFront(); r.poly.bringToFront(); });
  renderDetailMarkers();
}

function renderDetailMarkers() {
  detailMarkers.clearLayers();
  const r = view === 'detail' && rideById(activeId);
  if (!r || r.points.length < 2) return;
  const a = r.points[0], b = r.points[r.points.length - 1];
  const mk = (p, cls, title) => L.marker([p.lat, p.lng], {
    icon: L.divIcon({className:'pin ' + cls, iconSize:[14,14]}), interactive:false, keyboard:false, title,
  });
  detailMarkers.addLayer(mk(b, 'pin-end', 'Finish'));
  detailMarkers.addLayer(mk(a, 'pin-start', 'Start'));
}

/* ═══════════════════════════════════════════════════════════════
   RENDER — activity feed
═══════════════════════════════════════════════════════════════ */
const rideTime = r => (r.stats.startDate ? +r.stats.startDate : 0) || r.savedAt || 0;

function filteredRides() {
  const q = filter.q.trim().toLowerCase();
  const cutoff = filter.range === 'all' ? null : Date.now() - (+filter.range) * 86400000;
  return rides
    .filter(r => (!q || r.name.toLowerCase().includes(q)) && (!cutoff || rideTime(r) >= cutoff))
    .sort((a, b) => rideTime(b) - rideTime(a));
}

function renderFeed() {
  const feed = document.getElementById('feed');
  const list = filteredRides();
  document.getElementById('feed-empty').hidden = rides.length > 0;
  feed.hidden = !rides.length;
  const km = list.reduce((s, r) => s + (r.stats.distance || 0), 0);
  document.getElementById('feed-count').textContent = rides.length
    ? `${list.length} ride${list.length !== 1 ? 's' : ''} · ${fmtNum(km, 0)} km`
    : '';

  feed.innerHTML = list.length || !rides.length ? list.map(r => {
    const s = r.stats;
    const picked = selectedIds.has(r.id);
    return `<article class="card${r.id === activeId ? ' active' : ''}${!r.visible ? ' muted' : ''}${picked ? ' picked' : ''}"
        role="listitem" tabindex="0" data-id="${r.id}" style="--rc:${r.color}" aria-label="${esc(r.name)}">
      <div class="card-thumb">${r.thumb}${selectMode ? `<span class="card-check">${icon('check')}</span>` : ''}</div>
      <div class="card-body">
        <div class="card-top">
          <h3 class="card-title">${esc(r.name)}</h3>
        </div>
        <div class="card-date">${fmtDate(s.startDate)}${s.startDate ? ' · ' + fmtTime(s.startDate) : ''}<span class="tag">${esc(r.fileType)}</span></div>
        <div class="card-metrics">
          <span><b>${fmtNum(s.distance, 1)}</b> km</span>
          <span><b>${fmtNum(s.eleGain, 0)}</b> m ↑</span>
          <span><b>${fmtDur(s.movingTime)}</b></span>
        </div>
      </div>
      <button class="icon-btn card-vis" title="${r.visible ? 'Hide on map' : 'Show on map'}" aria-pressed="${!r.visible}">${icon(r.visible ? 'eye' : 'eyeOff')}</button>
    </article>`;
  }).join('') : `<div class="note">No rides match your filters.</div>`;

  feed.querySelectorAll('.card').forEach(card => {
    const r = rideById(card.dataset.id);
    card.addEventListener('pointerenter', () => { if (view === 'list' && r && map.hasLayer(r.group)) { r.poly.setStyle({weight:6}); r.casing.setStyle({opacity:.7, weight:11}); r.casing.bringToFront(); r.poly.bringToFront(); } });
    card.addEventListener('pointerleave', () => { if (view === 'list') applyMapStyles(); });
  });

  const modeBtn = document.getElementById('btn-select-mode');
  modeBtn.classList.toggle('on', selectMode);
  modeBtn.hidden = !rides.length;
  document.getElementById('select-bar').hidden = !selectMode;
  const allOn = list.length && list.every(r => selectedIds.has(r.id));
  document.getElementById('btn-select-all').textContent = allOn ? 'None' : 'All';
  document.getElementById('select-count').textContent = `${selectedIds.size} selected`;
  document.getElementById('btn-delete-selected').disabled = !selectedIds.size;
  document.getElementById('btn-compare-go').disabled = selectedIds.size < 2;
}

/* ═══════════════════════════════════════════════════════════════
   RENDER — views
═══════════════════════════════════════════════════════════════ */
function renderView() {
  document.getElementById('view-list').hidden    = view !== 'list';
  document.getElementById('view-detail').hidden  = view !== 'detail';
  document.getElementById('view-compare').hidden = view !== 'compare';
  document.getElementById('panel').dataset.view = view;
  // Empty the hidden views so their ids (canvas etc.) never shadow the active view's
  if (view !== 'detail')  document.getElementById('view-detail').innerHTML = '';
  if (view !== 'compare') document.getElementById('view-compare').innerHTML = '';
  if (view === 'detail') renderDetail();
  else if (view === 'compare') renderCompare();
  else destroyChart();
}

function statTile(label, value, unit, accent) {
  return `<div class="stat${accent ? ' accent' : ''}"><div class="stat-label">${label}</div><div class="stat-value">${value}${unit && value !== '—' ? `<small>${unit}</small>` : ''}</div></div>`;
}

function metricChips(list) {
  const avail = Object.keys(METRICS).filter(k => {
    const m = METRICS[k];
    if (k === 'speed') return list.some(r => r.stats.hasSpeed);
    return !m.has || list.some(r => r.stats[m.has]);
  });
  if (!avail.includes(chartMetric)) chartMetric = 'elevation';
  return avail.length > 1
    ? `<div class="seg-ctl" role="tablist">${avail.map(k => `<button role="tab" class="${k === chartMetric ? 'on' : ''}" aria-selected="${k === chartMetric}" onclick="setChartMetric('${k}')">${METRICS[k].short || METRICS[k].label}</button>`).join('')}</div>`
    : '';
}

function renderDetail() {
  const el = document.getElementById('view-detail');
  const r = rideById(activeId);
  if (!r) { backToList(); return; }
  const s = r.stats;
  const extra = [
    ['Max speed', s.maxSpeed, 'km/h', 1],
    ['Avg heart rate', s.avgHr, 'bpm', 0],
    ['Max heart rate', s.maxHr, 'bpm', 0],
    ['Avg power', s.avgPower, 'W', 0],
    ['Max power', s.maxPower, 'W', 0],
    ['Avg cadence', s.avgCad, 'rpm', 0],
    ['Elevation loss', s.eleLoss, 'm', 0],
    ['Highest point', s.maxEle, 'm', 0],
    ['Lowest point', s.minEle, 'm', 0],
    ['Climbing > 8%', s.climbDist, 'km', 2],
    ['Training stress', s.tss, '', 0],
    ['GPS points', s.pointCount, '', 0],
  ].filter(([, v]) => v != null && v !== 0);

  el.innerHTML = `
    <div class="view-head">
      <button class="icon-btn" onclick="backToList()" title="Back (Esc)">${icon('back')}</button>
      <div class="view-titles">
        <h2 class="view-title" style="--rc:${r.color}"><i class="dot"></i>${esc(r.name)}</h2>
        <div class="view-meta">${fmtDate(s.startDate, true)}${s.startDate ? ' · ' + fmtTime(s.startDate) : ''}<span class="tag">${esc(r.fileType)}</span></div>
      </div>
      <button class="icon-btn" onclick="focusRides([rideById('${r.id}')])" title="Zoom to route">${icon('focus')}</button>
    </div>

    <div class="view-scroll">
      <div class="stat-grid">
        ${statTile('Distance', fmtNum(s.distance, 1), 'km', true)}
        ${statTile('Elevation gain', fmtNum(s.eleGain, 0), 'm', true)}
        ${statTile('Avg speed', fmtNum(s.avgSpeed, 1), 'km/h')}
        ${statTile('Max gradient', fmtNum(s.maxGrade, 1), '%')}
        ${statTile('Moving time', fmtDur(s.movingTime), '')}
        ${statTile('Duration', fmtDur(s.duration), '')}
      </div>

      <div class="chart-card">
        <div class="chart-head">
          <span class="section-label">${METRICS[chartMetric].label} profile</span>
          ${metricChips([r])}
        </div>
        <div class="chart-wrap"><canvas></canvas></div>
      </div>

      ${s.zonePct?.some(v => v > 0) ? `
      <div class="card-block">
        <div class="section-label">Heart rate zones <small>max ${cfg.maxHR} bpm</small></div>
        <div class="zone-bar">${HR_ZONES.map((z, i) => s.zonePct[i] ? `<i style="flex:${s.zonePct[i]};background:${z.color}" title="${z.name}: ${s.zonePct[i]}%"></i>` : '').join('')}</div>
        <div class="zone-legend">${HR_ZONES.map((z, i) => `<span><i style="background:${z.color}"></i>${z.name.split(' ')[0]} <b>${s.zonePct[i]}%</b></span>`).join('')}</div>
      </div>` : ''}

      ${r.laps?.length ? `
      <div class="card-block">
        <div class="section-label">Laps</div>
        <table class="laps">
          <thead><tr><th>#</th><th>Time</th><th>Dist</th><th>Speed</th><th>HR</th></tr></thead>
          <tbody>${r.laps.map((l, i) => `<tr><td>${i + 1}</td><td>${fmtDur(l.totalTime)}</td><td>${l.distance != null ? fmtNum(l.distance, 2) + ' km' : '—'}</td><td>${l.avgSpeed != null ? fmtNum(l.avgSpeed, 1) : '—'}</td><td>${l.avgHr || '—'}</td></tr>`).join('')}</tbody>
        </table>
      </div>` : ''}

      ${extra.length ? `
      <details class="card-block more">
        <summary class="section-label">More metrics</summary>
        <dl class="kv">${extra.map(([k, v, u, d]) => `<dt>${k}</dt><dd>${fmtNum(v, d)}${u ? ' <small>' + u + '</small>' : ''}</dd>`).join('')}</dl>
      </details>` : ''}

      <div class="detail-actions">
        <button class="btn sm" onclick="exportGPX(['${r.id}'])">${icon('download')}GPX</button>
        <button class="btn sm" onclick="exportFIT('${r.id}')">${icon('download')}FIT</button>
        <button class="btn sm danger" onclick="deleteRide('${r.id}')">${icon('trash')}Delete</button>
      </div>
    </div>`;

  renderChart(el.querySelector('.chart-wrap canvas'), [r]);
}

function renderCompare() {
  const el = document.getElementById('view-compare');
  const vis = rides.filter(r => selectedIds.has(r.id));
  if (vis.length < 2) { backToList(); return; }

  el.innerHTML = `
    <div class="view-head">
      <button class="icon-btn" onclick="backToList()" title="Back (Esc)">${icon('back')}</button>
      <div class="view-titles">
        <h2 class="view-title">Compare</h2>
        <div class="view-meta">${vis.length} rides</div>
      </div>
      <button class="icon-btn" onclick="focusRides(rides.filter(r => selectedIds.has(r.id)))" title="Zoom to rides">${icon('focus')}</button>
    </div>
    <div class="view-scroll">
      <div class="legend">${vis.map(r => `<span style="--rc:${r.color}"><i></i>${esc(r.name)}</span>`).join('')}</div>
      <div class="chart-card">
        <div class="chart-head">
          <span class="section-label">${METRICS[chartMetric].label}</span>
          ${metricChips(vis)}
        </div>
        <div class="chart-wrap"><canvas></canvas></div>
      </div>
      <div class="seg-ctl wide" role="tablist">
        ${[['metrics','Metrics'],['insights','Insights'],['segments','Segments']].map(([k, l]) =>
          `<button role="tab" class="${k === compareTab ? 'on' : ''}" aria-selected="${k === compareTab}" onclick="setCompareTab('${k}')">${l}</button>`).join('')}
      </div>
      <div id="cmp-body"></div>
    </div>`;

  renderChart(el.querySelector('.chart-wrap canvas'), vis);
  const body = document.getElementById('cmp-body');
  if (compareTab === 'insights') renderPlan(body, vis);
  else if (compareTab === 'segments') renderSegments(body, vis);
  else renderCompareMetrics(body, vis);
}

function renderCompareMetrics(body, vis) {
  const metrics = [
    {k:'distance',   lbl:'Distance',        fmt:v=>fmtNum(v,1)+' km',   hi:true},
    {k:'movingTime', lbl:'Moving time',     fmt:fmtDur,                 hi:false},
    {k:'eleGain',    lbl:'Elevation gain',  fmt:v=>fmtNum(v,0)+' m',    hi:true},
    {k:'maxGrade',   lbl:'Max gradient',    fmt:v=>fmtNum(v,1)+' %',    hi:true},
    {k:'avgSpeed',   lbl:'Avg speed',       fmt:v=>fmtNum(v,1)+' km/h', hi:true},
    {k:'maxSpeed',   lbl:'Max speed',       fmt:v=>fmtNum(v,1)+' km/h', hi:true},
    {k:'avgHr',      lbl:'Avg heart rate',  fmt:v=>v?v+' bpm':'—',      hi:false},
    {k:'maxHr',      lbl:'Max heart rate',  fmt:v=>v?v+' bpm':'—',      hi:false},
    {k:'avgCad',     lbl:'Avg cadence',     fmt:v=>v?v+' rpm':'—',      hi:true},
    {k:'avgPower',   lbl:'Avg power',       fmt:v=>v?v+' W':'—',        hi:true},
    {k:'tss',        lbl:'Training stress', fmt:v=>v||'—',              hi:false},
  ];

  body.innerHTML = metrics.map(m => {
    const nums = vis.map(r=>parseFloat(r.stats[m.k])).filter(v=>!isNaN(v)&&v>0);
    if (!nums.length) return '';
    const maxV = Math.max(...nums), minV = Math.min(...nums);
    const best = m.hi ? maxV : minV;
    return `<div class="cmp-block"><div class="cmp-label">${m.lbl}</div>`
      + vis.map(r => {
          const val = parseFloat(r.stats[m.k]);
          const pct = maxV>0 && !isNaN(val) ? Math.round(val/maxV*100) : 0;
          const isBest = val===best && nums.length>1;
          return `<div class="cmp-row" style="--rc:${r.color}">
            <span class="cmp-name" title="${esc(r.name)}">${esc(r.name)}</span>
            <span class="cmp-bar"><i style="width:${pct}%"></i></span>
            <span class="cmp-val${isBest?' best':''}">${isNaN(val) ? '—' : m.fmt(r.stats[m.k])}</span>
          </div>`;
        }).join('') + '</div>';
  }).join('');
}

function renderPlan(body, vis) {
  const sorted = [...vis].sort((a,b) => rideTime(a) - rideTime(b));
  const latest = sorted[sorted.length-1];
  const prev   = sorted[sorted.length-2];

  const insights = [];

  const distTrend  = prev.stats.distance  ? (latest.stats.distance  - prev.stats.distance)  / prev.stats.distance  * 100 : 0;
  const speedTrend = prev.stats.avgSpeed  ? (latest.stats.avgSpeed  - prev.stats.avgSpeed)  / prev.stats.avgSpeed  * 100 : 0;
  const hrDelta    = (prev.stats.avgHr && latest.stats.avgHr) ? latest.stats.avgHr - prev.stats.avgHr : null;

  if (Math.abs(distTrend) > 2)
    insights.push(`Distance ${distTrend>0?'▲ up':'▼ down'} <b>${Math.abs(distTrend).toFixed(0)}%</b> from ${esc(prev.name)} to ${esc(latest.name)}.`);
  if (Math.abs(speedTrend) > 2)
    insights.push(`Avg speed ${speedTrend>0?'▲ improved':'▼ dropped'} by <b>${Math.abs(speedTrend).toFixed(0)}%</b>.`);
  if (hrDelta !== null) {
    if (hrDelta > 5)  insights.push(`HR was <b>${hrDelta} bpm higher</b> on the latest ride — consider extra rest.`);
    if (hrDelta < -5) insights.push(`HR <b>${Math.abs(hrDelta)} bpm lower</b> at similar effort — fitness is improving.`);
  }

  const maxTSS = Math.max(...vis.map(r=>r.stats.tss||0));
  if (maxTSS > 150) insights.push(`TSS of <b>${maxTSS}</b> is high. Schedule a recovery ride (&lt;60 TSS) before your next hard effort.`);
  else if (maxTSS > 80) insights.push(`Moderate load (TSS ${maxTSS}). You can repeat or slightly increase intensity next session.`);

  const maxEleGain = Math.max(...vis.map(r=>r.stats.eleGain||0));
  if (maxEleGain > 600) insights.push(`Significant climbing detected (up to <b>${maxEleGain}m</b>). Target 60–90g carbs/hour on efforts &gt; 30 min.`);

  const lowCad = vis.filter(r=>r.stats.avgCad&&r.stats.avgCad<75);
  if (lowCad.length) insights.push(`Cadence below 75 rpm on <b>${lowCad.map(r=>esc(r.name)).join(', ')}</b>. Aim 80–95 rpm to reduce knee load.`);

  const eff = vis.reduce((best,r) => {
    if (!r.stats.avgSpeed||!r.stats.avgHr) return best;
    const e = r.stats.avgSpeed/r.stats.avgHr;
    return e>(best?.e||0) ? {r,e} : best;
  }, null);
  if (eff) insights.push(`<b>${esc(eff.r.name)}</b> had best aerobic efficiency (${(eff.e*100).toFixed(1)} km·h⁻¹ per 100 bpm).`);

  const bestDist = Math.max(...vis.map(r=>r.stats.distance));
  insights.push(`Based on longest ride (<b>${bestDist} km</b>), next target: <b>${Math.round(bestDist*1.08)} km</b> with up to <b>${Math.round(maxEleGain*1.1)}m</b> elevation.`);

  body.innerHTML = `<div class="section-label">Training insights</div>` +
    insights.map(txt => `<div class="insight">${txt}</div>`).join('');
}

/* ═══════════════════════════════════════════════════════════════
   CHART — profile with hover ↔ map sync
═══════════════════════════════════════════════════════════════ */
function setChartMetric(k) {
  chartMetric = k;
  saveState();
  renderView();
}

function destroyChart() {
  if (profileChart) { profileChart.destroy(); profileChart = null; }
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}

// Vertical guide line at the hovered position
const crosshairPlugin = {
  id: 'crosshair',
  afterDatasetsDraw(chart) {
    const act = chart.tooltip?.getActiveElements?.();
    if (!act?.length) return;
    const x = act[0].element.x, {top, bottom} = chart.chartArea, c = chart.ctx;
    c.save();
    c.strokeStyle = 'rgba(226,232,240,.45)';
    c.setLineDash([3, 3]);
    c.beginPath(); c.moveTo(x, top); c.lineTo(x, bottom); c.stroke();
    c.restore();
  },
};

function renderChart(canvas, list) {
  destroyChart();
  const m = METRICS[chartMetric];
  const single = list.length === 1;
  const datasets = list.map(r => ({
    label: r.name,
    rideId: r.id,
    data: r.smap.map(i => {
      const v = r.points[i][m.key];
      const valid = v != null && (m.key === 'ele' || v > 0);
      return {x: r.cum[i], y: valid ? v : null, pi: i};
    }),
    borderColor: r.color,
    backgroundColor: single ? (ctx => {
      const {ctx: c, chartArea} = ctx.chart;
      if (!chartArea) return 'transparent';
      const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
      g.addColorStop(0, hexA(r.color, .45));
      g.addColorStop(1, hexA(r.color, 0));
      return g;
    }) : 'transparent',
    fill: single ? 'start' : false,
    borderWidth: single ? 2 : 1.75,
    pointRadius: 0,
    pointHoverRadius: 4,
    pointHoverBackgroundColor: r.color,
    pointHoverBorderColor: '#fff',
    pointHoverBorderWidth: 2,
    tension: .3,
    spanGaps: true,
  })).filter(ds => ds.data.some(d => d.y != null));

  if (!datasets.length) {
    canvas.parentElement.innerHTML = `<div class="note">No ${m.label.toLowerCase()} data in this ride.</div>`;
    return;
  }

  const tick = {color:'#64748B', font:{size:10, family:'Inter'}};
  profileChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {datasets},
    plugins: [crosshairPlugin],
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false, normalized: true,
      interaction: single ? {mode:'nearest', axis:'x', intersect:false} : {mode:'nearest', intersect:false},
      onHover: (evt, els) => {
        if (!els.length) { hideHoverMarker(); return; }
        const ds = datasets[els[0].datasetIndex];
        const pt = ds?.data[els[0].index];
        const r = ds && rideById(ds.rideId);
        if (r && pt) showHoverMarker(r, pt.pi, !single);
      },
      plugins: {
        legend: {display:false},
        tooltip: {
          backgroundColor:'rgba(15,23,42,.94)', borderColor:'rgba(71,85,105,.6)', borderWidth:1,
          titleColor:'#94A3B8', bodyColor:'#F1F5F9', padding:8, cornerRadius:8, displayColors:!single, boxWidth:8, boxHeight:8,
          titleFont:{family:'Inter', size:10, weight:'500'}, bodyFont:{family:'Inter', size:12, weight:'600'},
          callbacks: {
            title: items => `${items[0].parsed.x.toFixed(2)} km`,
            label: item => {
              const v = item.parsed.y;
              if (v == null) return null;
              return `${single ? '' : item.dataset.label + ': '}${fmtNum(v, m.dp)} ${m.unit}`;
            },
          },
        },
      },
      scales: {
        x: {type:'linear', min:0, max: Math.max(...list.map(r => r.cum[r.cum.length - 1])),
            ticks:{...tick, maxTicksLimit:6, callback:v => fmtNum(v, v < 10 ? 1 : 0) + ' km'},
            grid:{color:'rgba(148,163,184,.08)'}, border:{display:false}},
        y: {ticks:{...tick, maxTicksLimit:5, callback:v => fmtNum(v, 0)},
            grid:{color:'rgba(148,163,184,.08)'}, border:{display:false}},
      },
    },
  });
  canvas.addEventListener('mouseleave', hideHoverMarker);
}

// Map → chart: hovering the active route moves the chart cursor
function onRouteHover(r, latlng) {
  if (view !== 'detail' || r.id !== activeId || !profileChart) return;
  const k = Math.cos(latlng.lat * Math.PI / 180);
  let best = 0, bestD = Infinity;
  r.smap.forEach((pi, j) => {
    const p = r.points[pi];
    const dx = (p.lng - latlng.lng) * k, dy = p.lat - latlng.lat;
    const d = dx*dx + dy*dy;
    if (d < bestD) { bestD = d; best = j; }
  });
  const el = profileChart.getDatasetMeta(0).data[best];
  if (!el) return;
  const act = [{datasetIndex:0, index:best}];
  profileChart.setActiveElements(act);
  profileChart.tooltip.setActiveElements(act, {x:el.x, y:el.y});
  profileChart.update('none');
  showHoverMarker(r, r.smap[best]);
}
function clearChartHover() {
  if (profileChart) {
    profileChart.setActiveElements([]);
    profileChart.tooltip.setActiveElements([], {x:0, y:0});
    profileChart.update('none');
  }
  hideHoverMarker();
}

/* ═══════════════════════════════════════════════════════════════
   HOVER MARKER — telemetry tooltip on the map
═══════════════════════════════════════════════════════════════ */
function showHoverMarker(r, i, withName) {
  const p = r.points[i];
  if (!p || p.lat == null) return;
  hoverMarker.setLatLng([p.lat, p.lng]);
  if (!map.hasLayer(hoverMarker)) hoverMarker.addTo(map);
  hoverMarker.getElement()?.style.setProperty('--c', r.color);
  const rows = [
    ['Distance', fmtNum(r.cum[i], 2) + ' km'],
    ['Elevation', fmtNum(p.ele, 0) + ' m'],
    ['Grade', fmtNum(gradeAt(r, i), 1) + ' %'],
    p.speed != null && ['Speed', fmtNum(p.speed, 1) + ' km/h'],
    p.hr && ['Heart rate', p.hr + ' bpm'],
    p.power && ['Power', p.power + ' W'],
    p.cad && ['Cadence', p.cad + ' rpm'],
  ].filter(Boolean);
  hoverMarker.setTooltipContent(
    (withName ? `<div class="tt-name" style="--c:${r.color}">${esc(r.name)}</div>` : '') +
    `<div class="tt-grid">${rows.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('')}</div>`
  );
}
function hideHoverMarker() {
  if (hoverMarker && map.hasLayer(hoverMarker)) map.removeLayer(hoverMarker);
}

/* ═══════════════════════════════════════════════════════════════
   PANEL — desktop collapse + mobile bottom sheet
═══════════════════════════════════════════════════════════════ */
const isMobile = () => MOBILE_MQ.matches;

function setPanelCollapsed(b) {
  panelCollapsed = b;
  document.body.classList.toggle('panel-collapsed', b);
  saveState();
}

function sheetVisible(state) {
  const H = window.innerHeight;
  if (state === 'full') return H - 56;
  if (state === 'half') return Math.round(H * 0.5);
  return 132;
}
function setSheet(state) {
  sheet = state;
  layoutSheet();
}
function layoutSheet(px) {
  const panel = document.getElementById('panel');
  if (!isMobile()) {
    panel.style.height = '';
    delete document.body.dataset.sheet;
    document.documentElement.style.setProperty('--sheet-visible', '0px');
    return;
  }
  const h = px != null ? px : sheetVisible(sheet);
  panel.style.height = h + 'px';
  panel.dataset.sheet = sheet;
  document.body.dataset.sheet = sheet;
  document.documentElement.style.setProperty('--sheet-visible', h + 'px');
}

function initSheetDrag() {
  const panel = document.getElementById('panel');
  const grip = document.getElementById('sheet-handle');
  let startY = 0, startH = 0, t0 = 0, dragging = false, moved = false;

  const down = e => {
    if (!isMobile() || e.target.closest('button,input,select,a')) return;
    dragging = true; moved = false;
    startY = e.clientY; startH = panel.offsetHeight; t0 = Date.now();
    panel.classList.add('dragging');
    grip.setPointerCapture?.(e.pointerId);
  };
  const move = e => {
    if (!dragging) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > 4) moved = true;
    layoutSheet(Math.max(96, Math.min(window.innerHeight - 40, startH - dy)));
  };
  const up = e => {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove('dragging');
    const h = panel.offsetHeight, dy = e.clientY - startY, fast = Date.now() - t0 < 250 && Math.abs(dy) > 30;
    const order = ['peek', 'half', 'full'];
    if (!moved) {
      setSheet(sheet === 'peek' ? 'half' : sheet === 'half' ? 'full' : 'half');
    } else if (fast) {
      const i = order.indexOf(sheet) + (dy < 0 ? 1 : -1);
      setSheet(order[Math.max(0, Math.min(2, i))]);
    } else {
      setSheet(order.reduce((a, s) => Math.abs(sheetVisible(s) - h) < Math.abs(sheetVisible(a) - h) ? s : a, 'peek'));
    }
  };
  grip.addEventListener('pointerdown', down);
  panel.querySelector('.panel-head').addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

/* ═══════════════════════════════════════════════════════════════
   AUTH — Supabase OAuth + email/password + registration flow
═══════════════════════════════════════════════════════════════ */
function ensureSupabaseClient() {
  if (!sbClient) {
    try {
      sbClient = window.supabase.createClient(cfg.url, cfg.key);
    } catch(e) {
      toast('Supabase initialization failed: ' + e.message, 'err');
      return null;
    }
  }
  return sbClient;
}

async function authWith(provider) {
  if (!ensureSupabaseClient()) return;
  try {
    const {error} = await sbClient.auth.signInWithOAuth({
      provider,
      // Clean URL: no leftover ?code= / #access_token= from a previous attempt,
      // so it matches the Redirect URLs allow-list in Supabase
      options: {redirectTo: location.origin + location.pathname}
    });
    if (error) throw error;
  } catch(e) { toast('OAuth error: '+e.message, 'err'); }
}

async function signInPassword() {
  if (!ensureSupabaseClient()) return;
  const email = document.getElementById('reg-email').value.trim();
  const pass  = document.getElementById('reg-pass').value;
  if (!email||!pass) { toast('Enter email and password', 'err'); return; }
  try {
    const {data, error} = await sbClient.auth.signInWithPassword({email, password:pass});
    if (error) throw error;
    currentUser = data.user;
    onSignedIn();
  } catch(e) { toast('Sign in failed: '+e.message, 'err'); }
}

async function requestAccess() {
  if (!ensureSupabaseClient()) return;
  const name  = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pass  = document.getElementById('reg-pass').value;
  if (!name||!email||!pass) { toast('Fill in name, email and password', 'err'); return; }
  if (pass.length < 8)      { toast('Password must be at least 8 characters', 'err'); return; }

  try {
    // 1. Create auth account (disabled until approved — use signUp + email confirm disabled)
    const {error} = await sbClient.auth.signUp({
      email, password:pass,
      options:{data:{name, role:'pending'}}
    });
    if (error) throw error;

    // 2. Insert into users table as pending
    await sbClient.from('ridecomp_users').upsert({
      email, name, role:'pending',
      requested_at: new Date().toISOString(),
      expires_at:   new Date(Date.now()+86400000).toISOString() // 24h
    });

    toast('Access requested! An admin will review within 24h.', 'ok');
    closeSettings();
  } catch(e) { toast('Registration error: '+e.message, 'err'); }
}

function signOut() {
  if (sbClient) {
    sbClient.auth.signOut().catch(()=>{});
  }
  currentUser = null;
  onSignedOut();
  closeSettings();
  toast('Signed out');
}

let _signedInFor = null;
const isOfflineError = e => !navigator.onLine || /failed to fetch|networkerror|load failed/i.test(e?.message || '');

// Signed in, the cloud decides which rides show: an empty table means no rides.
// IndexedDB is only used when the cloud can't be reached.
async function onSignedIn() {
  renderHeader();
  if (_signedInFor === currentUser?.id) return;   // onAuthStateChange re-fires on load
  _signedInFor = currentUser?.id;
  const uid = currentUser.id;
  closeSettings();
  toast('Signed in as ' + userLabel(), 'ok');
  // Rides shown before signing in were local-only. They're offered for upload below.
  [...rides].filter(r => r.owner !== uid).forEach(unloadRide);
  refresh();
  const {rows, error} = await loadRidesFromSupabase();
  if (currentUser?.id !== uid) return;   // signed out while loading
  if (rows) {
    focusRides(rides.filter(r => r.visible), false);
    await offerLocalRides();
  } else if (isOfflineError(error)) {
    await restoreCachedRides(uid);
    toast('Offline: showing rides saved on this device', 'warn');
  }
}

// Back to guest mode: this account's rides leave the screen (IndexedDB keeps them as
// an offline cache) and only rides saved in this browser show.
function onSignedOut() {
  const wasSignedIn = !!_signedInFor;
  _signedInFor = null;
  renderHeader();
  if (!wasSignedIn) return;
  closeLocalRides();
  localRides = [];
  [...rides].forEach(unloadRide);
  selectMode = false;
  refresh();
  restoreCachedRides();
}

// Rides saved in this browser that the signed-in account doesn't have. Asks whether
// to upload or discard them; copies of rides the cloud already has go without asking.
let localRides = [];
async function offerLocalRides() {
  const uid = currentUser.id;
  const stored = (await idbAll().catch(() => null)) || [];
  const cloudFps = new Set(rides.filter(r => r.owner === uid).map(r => r.fingerprint));
  localRides = [];
  for (const rec of stored) {
    if (rideById(rec.id)) continue;
    // Another account's cache, or this account's copy of a ride deleted from the cloud elsewhere
    if (rec.owner) { idbDel(rec.id).catch(()=>{}); continue; }
    if (!rec.points?.length) continue;
    if (cloudFps.has(rideFingerprint(rec.points, rec.stats || computeStats(rec.points)))) {
      idbDel(rec.id).catch(()=>{});
      continue;
    }
    localRides.push(rec);
  }
  const n = localRides.length;
  if (!n) return;
  document.getElementById('local-msg').textContent =
    `We found ${n} ride${n === 1 ? '' : 's'} saved locally in your browser that ${n === 1 ? "isn't" : "aren't"} ` +
    `in your account. Upload ${n === 1 ? 'it' : 'them'} to your account, or discard the local cache?`;
  document.getElementById('local-mb').classList.add('open');
}
function closeLocalRides() { document.getElementById('local-mb').classList.remove('open'); }

async function uploadLocalRides() {
  closeLocalRides();
  if (!currentUser) return;
  localRides.forEach(rec => { const r = hydrate(rec); if (r) pendingSync.add(r.id); });
  localRides = [];
  refresh();
  await syncToSupabase();   // each uploaded ride becomes this account's cached copy
}

function discardLocalRides() {
  const n = localRides.length;
  if (!confirm(`Delete ${n} ride(s) from this browser? They are not in your account, so this cannot be undone.`)) return;
  localRides.forEach(rec => idbDel(rec.id).catch(()=>{}));
  localRides = [];
  closeLocalRides();
  toast(`Discarded ${n} local ride(s)`);
}
function isAdmin() {
  return currentUser?.user_metadata?.role === 'admin' ||
         currentUser?.app_metadata?.role  === 'admin';
}
const userLabel = () => currentUser?.user_metadata?.name || currentUser?.email || 'signed in';

function renderHeader() {
  const av = document.getElementById('btn-avatar');
  if (currentUser) {
    const initials = userLabel().split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
    av.innerHTML = currentUser.user_metadata?.avatar_url
      ? `<img src="${esc(currentUser.user_metadata.avatar_url)}" alt=""/>`
      : `<span>${esc(initials)}</span>`;
    av.classList.add('signed-in');
    av.title = userLabel() + ' — account & settings';
  } else {
    av.innerHTML = icon('user');
    av.classList.remove('signed-in');
    av.title = 'Sign in & settings';
  }
  document.getElementById('btn-admin').hidden = !isAdmin();
  document.getElementById('btn-sync').hidden = !(sbClient && currentUser);
  updateUnsavedChip();
  updateDBBadge();
}

/* ═══════════════════════════════════════════════════════════════
   ADMIN PANEL
═══════════════════════════════════════════════════════════════ */
async function openAdmin() {
  document.getElementById('admin-mb').classList.add('open');
  loadAdminData();
}
function closeAdmin() { document.getElementById('admin-mb').classList.remove('open'); }
async function loadAdminData() {
  if (!sbClient) { toast('Supabase not configured', 'err'); return; }
  const {data, error} = await sbClient.from('ridecomp_users').select('*').order('requested_at',{ascending:false});
  const list = document.getElementById('admin-list');
  if (error || !data) { list.innerHTML = '<div class="note">Error loading users: ' + esc(error?.message || 'unknown') + '</div>'; return; }
  if (!data.length)   { list.innerHTML = '<div class="note">No registration requests.</div>'; return; }

  list.innerHTML = data.map(u => {
    const ago = u.requested_at ? timeSince(new Date(u.requested_at)) : '—';
    const exp = u.expires_at && u.role==='pending' ? ' · expires '+timeSince(new Date(u.expires_at)) : '';
    return `<div class="admin-row">
      <div class="admin-who">
        <div class="admin-name">${esc(u.name||u.email)}</div>
        <div class="admin-email">${esc(u.email)} · ${ago}${exp}</div>
      </div>
      <span class="pill ${u.role}">${esc(u.role)}</span>
      ${u.role==='pending' ? `
        <button class="btn sm primary" onclick="approveUser('${esc(u.id)}','${esc(u.email)}')">Approve</button>
        <button class="btn sm danger" onclick="denyUser('${esc(u.id)}')">Deny</button>` : ''}
    </div>`;
  }).join('');
}

async function approveUser(id, email) {
  if (!sbClient) return;
  const {error} = await sbClient.from('ridecomp_users').update({role:'member', approved_at:new Date().toISOString()}).eq('id',id);
  if (error) { toast('Error: '+error.message,'err'); return; }
  toast('Approved: '+email, 'ok');
  loadAdminData();
}
async function denyUser(id) {
  if (!sbClient) return;
  const {error} = await sbClient.from('ridecomp_users').update({role:'denied'}).eq('id',id);
  if (error) { toast('Error: '+error.message,'err'); return; }
  toast('User denied');
  loadAdminData();
}
function closeAdminBg(e) { if (e.target === document.getElementById('admin-mb')) closeAdmin(); }

function timeSince(d) {
  if (!d||isNaN(d)) return '?';
  const s = Math.floor((Date.now()-d)/1000);
  const fut = s < 0, a = Math.abs(s);
  const v = a < 60 ? a+'s' : a < 3600 ? Math.floor(a/60)+'m' : a < 86400 ? Math.floor(a/3600)+'h' : Math.floor(a/86400)+'d';
  return fut ? 'in '+v : v+' ago';
}

/* ═══════════════════════════════════════════════════════════════
   SETTINGS MODAL
═══════════════════════════════════════════════════════════════ */
function openSettings() {
  const loggedIn = !!currentUser;
  document.getElementById('view-auth').hidden = loggedIn;
  document.getElementById('view-account').hidden = !loggedIn;
  if (loggedIn) {
    document.getElementById('account-avatar').innerHTML = document.getElementById('btn-avatar').innerHTML;
    document.getElementById('account-name').textContent = currentUser.user_metadata?.name || 'Signed in';
    document.getElementById('account-email').textContent = currentUser.email || '';
  }
  document.getElementById('cfg-maxhr').value    = cfg.maxHR || 190;
  document.getElementById('cfg-maptiler').value = cfg.mapTilerKey || '';
  document.getElementById('cfg-mapbox').value   = cfg.mapboxToken || '';
  document.getElementById('mb').classList.add('open');
}
function closeSettings() { document.getElementById('mb').classList.remove('open'); }
function closeModalBg(e) { if(e.target===document.getElementById('mb')) closeSettings(); }

function saveSettings() {
  const val = id => document.getElementById(id).value.trim();
  const prev = {...cfg};
  cfg.maxHR = parseInt(val('cfg-maxhr')) || 190;
  cfg.mapTilerKey = val('cfg-maptiler');
  cfg.mapboxToken = val('cfg-mapbox');
  const {url, key, ...toSave} = cfg;   // Supabase connection is fixed in code, never stored
  localStorage.setItem('ridecomp_cfg', JSON.stringify(toSave));

  if (cfg.mapTilerKey !== prev.mapTilerKey || cfg.mapboxToken !== prev.mapboxToken) {
    tileFallback = false;
    setTileLayer(currentTile);
  }
  if (cfg.maxHR !== prev.maxHR) {
    // HR zones / TSS depend on max HR
    rides.forEach(r => { r.stats = computeStats(r.points); idbPut(toRecord(r)).catch(()=>{}); });
  }
  toast('Settings saved', 'ok');
  closeSettings();
  refresh();
}

function updateDBBadge() {
  const dot = document.getElementById('dbdot');
  const lbl = document.getElementById('dblbl');
  if (sbClient && currentUser) { dot.className='ok';   lbl.textContent='Cloud sync on · ' + userLabel(); }
  else if (sbClient)           { dot.className='warn'; lbl.textContent='Sign in to sync to the cloud'; }
  else                         { dot.className='';     lbl.textContent='Saved on this device'; }
}

function updateUnsavedChip() {
  document.getElementById('chip-unsaved').hidden = !(pendingSync.size && sbClient && currentUser);
}

/* ═══════════════════════════════════════════════════════════════
   SUPABASE SYNC
═══════════════════════════════════════════════════════════════ */
async function initSupabase() {
  if (!window.supabase) { console.warn('supabase-js failed to load'); return; }
  try {
    sbClient = window.supabase.createClient(cfg.url, cfg.key);
    
    // Restore session. getSession reads local storage, so an offline user stays signed in
    // and gets their cached rides instead of guest mode.
    const {data, error} = await sbClient.auth.getSession();
    if (error) console.warn('Supabase auth:', error.message);
    currentUser = data?.session?.user || null;
    // Listen for auth changes
    sbClient.auth.onAuthStateChange((_evt, session) => {
      currentUser = session?.user || null;
      if (currentUser) onSignedIn(); else onSignedOut();
    });
    if (currentUser) await onSignedIn();
  } catch(e) {
    sbClient = null;
    
    console.warn('Supabase init failed', e);
  }
  renderHeader();
}

// null = unknown, false = the fingerprint column hasn't been added yet (see README SQL)
let cloudHasFingerprint = null;
const isMissingColumn = e => e && (e.code === '42703' || e.code === 'PGRST204' || /fingerprint/.test(e.message || ''));

// Is this ride already stored in the cloud? Uses the fingerprint column when it exists,
// otherwise the start time inside the stored stats JSON (same thing for recorded rides).
async function findCloudDuplicate(fp, stats) {
  if (!sbClient || !currentUser) return null;
  const startIso = stats?.startDate ? new Date(stats.startDate).toISOString() : null;
  const query = byFingerprint => {
    const q = sbClient.from('ridecomp_rides').select('id,name').eq('user_id', currentUser.id).limit(1);
    return byFingerprint ? q.eq('fingerprint', fp) : q.eq('stats->>startDate', startIso);
  };
  if (cloudHasFingerprint !== false) {
    const {data, error} = await query(true);
    if (!error) { cloudHasFingerprint = true; return data?.[0] || null; }
    if (!isMissingColumn(error)) { console.warn('Duplicate check failed', error); return null; }
    cloudHasFingerprint = false;
    console.warn('ridecomp_rides.fingerprint missing — run the SQL in README.md. Falling back to start time.');
  }
  if (!startIso) return null;   // untimed route and no fingerprint column: can't tell
  const {data, error} = await query(false);
  if (error) { console.warn('Duplicate check failed', error); return null; }   // never block on a failed check
  return data?.[0] || null;
}

// Make the screen match the cloud: rides the cloud returns are shown, rides it doesn't
// are removed (except ones added here that are still waiting to upload).
// Resolves to {rows} or {error}.
let _cloudLoad = null;
function loadRidesFromSupabase() {
  // Shared promise: sign-in can fire twice on load and would hydrate rides twice
  return _cloudLoad || (_cloudLoad = (async () => {
    if (!sbClient || !currentUser) return {error: new Error('Not signed in')};
    const uid = currentUser.id;
    try {
      const {data, error} = await sbClient.from('ridecomp_rides').select('*').eq('user_id', uid);
      if (error) throw error;
      const rows = data || [];
      if (rows.length) cloudHasFingerprint = 'fingerprint' in rows[0];
      const inCloud = new Set(rows.map(r => r.id));
      // A ride this account had that's gone from the cloud was deleted elsewhere
      [...rides].filter(r => !inCloud.has(r.id) && !pendingSync.has(r.id))
        .forEach(r => r.owner ? detachRide(r) : unloadRide(r));
      rides.filter(r => inCloud.has(r.id) && r.owner !== uid).forEach(r => {
        r.owner = uid;
        pendingSync.delete(r.id);
        idbPut(toRecord(r)).catch(() => {});
      });
      const fresh = rows.filter(r => !rideById(r.id));
      if (fresh.length) loader(true, `Loading ${fresh.length} ride(s) from cloud…`);
      const hidden = savedHidden();
      for (const row of fresh) {
        const ride = hydrate({...row, owner: uid});
        if (!ride) continue;
        if (hidden.has(ride.id)) ride.visible = false;
        await idbPut(toRecord(ride)).catch(() => {});
      }
      loader(false);
      updateUnsavedChip();
      refresh();
      if (fresh.length) toast(`Loaded ${fresh.length} ride(s) from cloud`, 'ok');
      backfillFingerprints(rows);
      return {rows};
    } catch(e) {
      loader(false);
      console.error('Failed to load rides from Supabase', e);
      if (!isOfflineError(e)) toast('Could not load cloud rides: ' + e.message, 'err');
      return {error: e};
    } finally {
      _cloudLoad = null;
    }
  })());
}

// Rows uploaded before the fingerprint column existed: fill it in from the loaded ride
function backfillFingerprints(rows) {
  if (!cloudHasFingerprint) return;
  rows.filter(row => !row.fingerprint).forEach(row => {
    const fp = rideById(row.id)?.fingerprint;
    if (fp) sbClient.from('ridecomp_rides').update({fingerprint: fp}).eq('id', row.id).eq('user_id', currentUser.id)
      .then(({error}) => { if (error) console.warn('Fingerprint backfill skipped for', row.id, error.message); });
  });
}

async function syncToSupabase() {
  if (!sbClient) { toast('Configure Supabase in Settings first','err'); return; }
  if (!currentUser) { toast('Please sign in to sync rides','err'); return; }
  let toSync = rides.filter(r=>pendingSync.has(r.id));
  if (!toSync.length) {
    if (!rides.length) { toast('No rides to sync'); return; }
    toSync = rides;   // nothing pending → re-upload everything
  }
  loader(true,`Syncing ${toSync.length} ride(s)…`);
  let ok=0, fail=0, dupes=0;
  for (const r of toSync) {
    try {
      const payload = {
        id: r.id,
        user_id: currentUser.id,
        name:r.name,
        file_type:r.fileType,
        points:r.points,
        stats:r.stats,
        color:r.color
      };
      // Without the unique index the database would accept a second copy — check first
      const dup = await findCloudDuplicate(r.fingerprint, r.stats);
      if (dup && dup.id !== r.id) { detachRide(r); dupes++; continue; }   // keep the cloud's copy
      if (cloudHasFingerprint !== false) payload.fingerprint = r.fingerprint;
      let {error} = await sbClient.from('ridecomp_rides').upsert(payload);
      if (error && isMissingColumn(error)) {
        cloudHasFingerprint = false;
        delete payload.fingerprint;
        ({error} = await sbClient.from('ridecomp_rides').upsert(payload));
      }
      // Unique (user_id, fingerprint): the cloud already has this ride under another id
      if (error && error.code === '23505') { detachRide(r); dupes++; continue; }
      if (error) throw error;
      pendingSync.delete(r.id); ok++;
      r.owner = currentUser.id;
      idbPut(toRecord(r)).catch(()=>{});
    } catch(e) {
      fail++;
      console.error('Sync error for ride', r.id, e);
      toast(`Failed: ${r.name} - ${e.message}`, 'err');
    }
  }
  loader(false);
  updateUnsavedChip();
  refresh();
  const skipped = dupes ? ` · ${dupes} already in the cloud (skipped)` : '';
  toast((fail ? `Synced ${ok}, failed ${fail}` : `${ok} ride(s) synced`) + skipped, fail ? 'err' : dupes ? 'warn' : 'ok');
}

/* ═══════════════════════════════════════════════════════════════
   LOCAL JSON BACKUP
═══════════════════════════════════════════════════════════════ */
async function exportJSON() {
  const all = (idb ? await idbAll() : null) || rides.map(toRecord);
  if (!all.length) { toast('No rides to back up', 'err'); return; }
  const blob = new Blob([JSON.stringify({version:VER, exportedAt:new Date().toISOString(), rides:all},null,2)],{type:'application/json'});
  downloadBlob(blob, `ridemap-${new Date().toISOString().slice(0,10)}.json`);
  toast('Backup downloaded');
}
function importJSON(input) {
  const file = input.files[0]; if (!file) return;
  loader(true,'Importing…');
  file.text().then(async txt => {
    try {
      const parsed = JSON.parse(txt);
      const arr = parsed.rides || (Array.isArray(parsed)?parsed:[]);
      if (!arr.length) throw new Error('No rides found in backup');
      let added=0;
      for (const rec of arr) {
        if (!rec.id||!rec.points) continue;
        const r = hydrate({...rec, owner: null});   // local until it's synced
        if (!r) continue;
        await idbPut(toRecord(r)).catch(()=>{});
        if (currentUser) pendingSync.add(r.id);
        added++;
      }
      updateUnsavedChip();
      refresh();
      toast(`Imported ${added} ride(s)`, 'ok');
    } catch(e) { toast('Import failed: '+e.message,'err'); }
    loader(false); input.value='';
  }).catch(e => {
    toast('File read error: ' + e.message, 'err');
    loader(false);
  });
}

function downloadBlob(blob, filename) {
  const a = Object.assign(document.createElement('a'), {href:URL.createObjectURL(blob), download:filename});
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ═══════════════════════════════════════════════════════════════
   MASTER REFRESH
═══════════════════════════════════════════════════════════════ */
let _refreshTimer;
function refresh() {
  clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(() => {
    applyMapStyles();
    renderFeed();
    renderView();
  }, 16);
}

/* ═══════════════════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════════════════ */
function fmtNum(v, dp = 0) {
  if (v == null || v === '' || isNaN(v)) return '—';
  return Number(v).toLocaleString('en-US', {minimumFractionDigits:dp, maximumFractionDigits:dp});
}
function fmtDur(s) {
  if (!s||s<=0) return '—';
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60);
  return h > 0 ? `${h}h ${String(m).padStart(2,'0')}m` : m > 0 ? `${m}m` : `${Math.round(s)}s`;
}
function fmtDate(d, long) {
  if (!d||!(d instanceof Date)||isNaN(d)) return 'No date';
  return d.toLocaleDateString('en-GB', long ? {weekday:'short', day:'numeric', month:'short', year:'numeric'} : {day:'numeric', month:'short', year:'numeric'});
}
function fmtTime(d) {
  return d.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'});
}
function esc(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

let _tt;
function toast(msg, type='') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show' + (type ? ' ' + type : '');
  clearTimeout(_tt);
  _tt = setTimeout(()=>el.className='', type==='err'?4500:2600);
}
function loader(show, msg='Processing…') {
  document.getElementById('lm').textContent = msg;
  document.getElementById('ldr').className = show?'open':'';
}

function openHelp()  { document.getElementById('help-mb').classList.add('open'); }
function closeHelp() { document.getElementById('help-mb').classList.remove('open'); }
function closeHelpBg(e) { if (e.target === document.getElementById('help-mb')) closeHelp(); }

/* ═══════════════════════════════════════════════════════════════
   STATE PERSISTENCE
 ═══════════════════════════════════════════════════════════════ */
function saveState() {
  try {
    localStorage.setItem('ridecomp_state', JSON.stringify({
      basemap: currentTile,
      panelCollapsed,
      chartMetric,
      hidden: rides.filter(r => !r.visible).map(r => r.id),
    }));
  } catch {}
}

function loadState() {
  try {
    const state = JSON.parse(localStorage.getItem('ridecomp_state') || '{}');
    if (BASEMAPS[state.basemap]) currentTile = state.basemap;
    if (METRICS[state.chartMetric]) chartMetric = state.chartMetric;
    panelCollapsed = !!state.panelCollapsed;
    return state;
  } catch(e) { console.error('State load error', e); return {}; }
}

function loadCfg() {
  try {
    const saved = localStorage.getItem('ridecomp_cfg');
    if (saved) cfg = {...cfg, ...JSON.parse(saved)};
    // config.js wins over empty saved values (e.g. after adding keys to config.js)
    if (!cfg.mapTilerKey && C.mapTilerKey) cfg.mapTilerKey = C.mapTilerKey;
    if (!cfg.mapboxToken && C.mapboxToken) cfg.mapboxToken = C.mapboxToken;
  } catch(e) { console.warn('Config load error', e); }
  // Older versions let anyone type a Supabase URL/key into Settings — ignore whatever was saved
  cfg.url = SUPABASE.url;
  cfg.key = SUPABASE.key;
  try {
    const saved = JSON.parse(localStorage.getItem('ridecomp_cfg') || '{}');
    if ('url' in saved || 'key' in saved) {
      delete saved.url; delete saved.key;
      localStorage.setItem('ridecomp_cfg', JSON.stringify(saved));
    }
  } catch(e) { console.warn('Config load error', e); }
}

/* ═══════════════════════════════════════════════════════════════
   GLOBAL EVENTS — drag & drop, keyboard, feed
 ═══════════════════════════════════════════════════════════════ */
function initEvents() {
  // Feed: click / keyboard via delegation
  const feed = document.getElementById('feed');
  feed.addEventListener('click', e => {
    const card = e.target.closest('.card');
    if (!card) return;
    if (e.target.closest('.card-vis')) { toggleVis(card.dataset.id); return; }
    openDetail(card.dataset.id);
  });
  feed.addEventListener('keydown', e => {
    const card = e.target.closest('.card');
    if (!card) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(card.dataset.id); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      (e.key === 'ArrowDown' ? card.nextElementSibling : card.previousElementSibling)?.focus();
    }
  });

  // Drag & drop files anywhere on the page
  const drop = document.getElementById('drop');
  let depth = 0;
  const hasFiles = e => Array.from(e.dataTransfer?.types || []).includes('Files');
  window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; drop.hidden = false; });
  window.addEventListener('dragover',  e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; if (--depth <= 0) { depth = 0; drop.hidden = true; } });
  window.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); depth = 0; drop.hidden = true;
    handleFiles(e.dataTransfer.files);
  });

  // Close the basemap menu on outside click
  document.addEventListener('pointerdown', e => {
    if (!e.target.closest('#layer-menu, #btn-layers')) toggleLayerMenu(false);
  });

  document.addEventListener('fullscreenchange', () => {
    const b = document.getElementById('btn-fs');
    b.innerHTML = icon(document.fullscreenElement ? 'shrink' : 'expand');
    b.title = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
  });
  if (!document.fullscreenEnabled) document.getElementById('btn-fs').hidden = true;

  MOBILE_MQ.addEventListener('change', () => layoutSheet());
  window.addEventListener('resize', () => layoutSheet());

  document.addEventListener('keydown', e => {
    const typing = ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'o') { e.preventDefault(); openFilePicker(); return; }
    if (mod && e.key === 's') { e.preventDefault(); if (sbClient && currentUser) syncToSupabase(); return; }
    if (e.key === 'Escape') {
      const modal = document.querySelector('.modal-bg.open');
      if (modal) { modal.classList.remove('open'); return; }
      if (!document.getElementById('layer-menu').hidden) { toggleLayerMenu(false); return; }
      if (typing) { document.activeElement.blur(); return; }
      if (view !== 'list') backToList();
      else if (selectMode) toggleSelectMode(false);
      return;
    }
    if (typing || mod || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); if (view !== 'list') backToList(); setPanelCollapsed(false); document.getElementById('q').focus(); }
    else if (e.key === '?') { e.preventDefault(); openHelp(); }
    else if (e.key === 'b' || e.key === 'B') cycleBasemap();
    else if (view === 'detail' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      // Step through rides in feed order without leaving the detail view
      e.preventDefault();
      const list = filteredRides();
      const i = list.findIndex(r => r.id === activeId);
      const next = list[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) openDetail(next.id);
    }
  });
}

/* ═══════════════════════════════════════════════════════════════
   BOOT
 ═══════════════════════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', async () => {
  hydrateIcons();
  loadCfg();
  loadState();
  if (typeof L === 'undefined') {
    document.getElementById('map').innerHTML = '<div class="note fatal">Map library failed to load. Check your connection and reload.</div>';
    return;
  }
  Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
  Chart.defaults.color = '#94A3B8';

  initMap();
  initEvents();
  initSheetDrag();
  setPanelCollapsed(panelCollapsed);
  layoutSheet();
  renderHeader();
  

  try { idb = await openIDB(); }
  catch(e) { console.warn('IndexedDB unavailable, running in-memory', e); idb = null; }

  refresh();
  // Signed in: the cloud decides which rides show (onSignedIn). Guest: rides saved in this browser.
  await initSupabase();   // always: also completes a GitHub sign-in redirect landing on this page
  if (!currentUser) await restoreCachedRides();

  console.log(`RideMap v${VER} ready.`);
});
