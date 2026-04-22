/* ═══════════════════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════════════════ */
const VER = '1.4.0';
const IDB_NAME = 'ridecomp_v1';
const IDB_STORE = 'rides';
const COLORS = ['#8fd44a','#4ac8d4','#d4944a','#b44ad4','#d44a7a','#4ad494','#d4d44a','#4a78d4','#d4504a'];
const FIT_EPOCH = 631065600; // seconds from Unix epoch to FIT epoch (1989-12-31)
const SEMICIRCLE = 180.0 / Math.pow(2, 31);
const HR_ZONES = [
  {name:'Z1 Rest',   maxPct:.60, color:'#4ac8d4'},
  {name:'Z2 Easy',   maxPct:.70, color:'#8fd44a'},
  {name:'Z3 Aerobic',maxPct:.80, color:'#d4d44a'},
  {name:'Z4 Tempo',  maxPct:.90, color:'#d4944a'},
  {name:'Z5 Max',    maxPct:1.0, color:'#d44a7a'},
];

/* ═══════════════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════════════ */
let rides       = [];
let selectedId  = null;   // null = show all
let map, tileLayer, profileChart, hoverMarker;
let currentChart = 'elevation';
let currentTab   = 'compare';
let sbClient     = null;
let idb          = null;
let cfg          = {url:'https://exnqyuwqfvbmakojirua.supabase.co', key:'sb_publishable_AO2On8ZzClh-gma3_OIwiA_RIFPoOYQ', maxHR:190, uid:'local'};
let currentUser  = null;
let pendingSync  = new Set();

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
   MAP
═══════════════════════════════════════════════════════════════ */
const TILES = {
  dark:   ['https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png','© OpenStreetMap © CARTO'],
  street: ['https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png','© OpenStreetMap'],
  sat:    ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}','© Esri'],
  topo:   ['https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png','© OpenTopoMap'],
};
function initMap() {
  map = L.map('map', {zoomControl:true}).setView([27.7, 85.3], 12);
  setTileLayer('dark');
  hoverMarker = L.marker([0,0], {
    icon: L.divIcon({className:'',html:'',iconSize:[0,0]}),
    interactive:false, zIndexOffset:1000
  });
}
function setTileLayer(name) {
  if (tileLayer) map.removeLayer(tileLayer);
  const [url, attr] = TILES[name];
  tileLayer = L.tileLayer(url, {attribution:attr, maxZoom:19}).addTo(map);
  // Update polyline styling for better visibility on this map type
  const isDarkMap = name === 'dark';
  rides.forEach(r => {
    if (map.hasLayer(r.poly)) {
      r.poly.setStyle({
        color: r.color,
        weight: isDarkMap ? 2.5 : 3.5,
        opacity: isDarkMap ? 0.88 : 1.0,
        smoothFactor: 1
      });
    }
  });
}
function setTile(name, btn) {
  setTileLayer(name);
  document.querySelectorAll('.mb').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
}

/* ═══════════════════════════════════════════════════════════════
   FIT BINARY PARSER
   Tested against real Garmin ACTIVITY.fit files.
   Supports: lat/lng (semicircles), enhanced_altitude (field 78),
   heart_rate, distance, timestamp. Speed derived from dist/time.
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

      if (d.gmn === 20) {   // Record message
        let fo = off;
        const p = {};
        for (const {fd, fs, bt} of d.fields) {
          if (fo + fs > bytes.length) break;
          p[fd] = readVal(dv, bytes, fo, fs, bt, d.le);
          fo += fs;
        }

        const lat = p[0], lng = p[1];
        const INV = 0x7FFFFFFF;
        if (lat != null && lng != null && lat !== INV && lng !== INV) {
          // Enhanced altitude (field 78): raw/5 - 500 (verified on test file)
          let ele = 0;
          if (p[78] != null && p[78] < 0xFFFF) ele = p[78] / 5 - 500;
          else if (p[2]  != null && p[2]  < 0xFFFF) ele = p[2]  / 5 - 100;

          pts.push({
            lat:   lat * SEMICIRCLE,
            lng:   lng * SEMICIRCLE,
            ele:   Math.round(ele * 10) / 10,
            hr:    (p[3]  != null && p[3]  < 250) ? p[3]  : null,
            cad:   (p[4]  != null && p[4]  < 255) ? p[4]  : null,
            power: (p[7]  != null && p[7]  < 9999) ? p[7] : null,
            dist:  (p[5]  != null) ? p[5] / 100 : null, // cm → m
            ts:    (p[253]!= null) ? new Date((p[253] + FIT_EPOCH) * 1000) : null,
          });
        }
      }
      off += d.size;
    }
  }

  if (!pts.length) throw new Error('No GPS points found. Make sure GPS was active during the activity.');

  // Compute speed from distance/time deltas
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i-1], b = pts[i];
    if (a.dist != null && b.dist != null && a.ts && b.ts) {
      const dd = b.dist - a.dist;       // metres
      const dt = (b.ts - a.ts) / 1000;  // seconds
      if (dt > 0 && dd >= 0 && dd < 200) {
        b.speed = Math.round((dd / dt) * 3.6 * 10) / 10;
      }
    }
  }

  return pts;
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
   Handles plain GPX routes/tracks AND gpx.studio export format.
   Supports Garmin TrackPointExtension namespace for HR/cadence.
═══════════════════════════════════════════════════════════════ */
function parseGPX(text) {
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('Invalid XML in GPX file');

  // Try track points first, then route points, then waypoints
  let trkpts = Array.from(xml.querySelectorAll('trkpt'));
  if (!trkpts.length) trkpts = Array.from(xml.querySelectorAll('rtept'));
  if (!trkpts.length) trkpts = Array.from(xml.querySelectorAll('wpt'));
  if (!trkpts.length) throw new Error('No track/route/waypoints found in GPX');

  return trkpts.map(pt => {
    const lat = parseFloat(pt.getAttribute('lat'));
    const lon = parseFloat(pt.getAttribute('lon'));
    if (isNaN(lat) || isNaN(lon)) return null;

    const ele  = parseFloat(pt.querySelector('ele')?.textContent) || 0;
    const time = pt.querySelector('time')?.textContent;

    // Extension data — support multiple namespace prefixes used by Garmin, gpx.studio, etc.
    const getExt = (...tags) => {
      for (const tag of tags) {
        // Try with common namespace prefixes
        for (const ns of ['gpxtpx','ns3','ns2','gpxdata','']) {
          const sel = ns ? `${ns}\\:${tag}` : tag;
          try {
            const el = pt.querySelector(sel);
            if (el) { const v = parseFloat(el.textContent); if (!isNaN(v)) return v; }
          } catch {}
        }
        // Also try local-name match via evaluate if available
        try {
          const iter = xml.evaluate(`.//*[local-name()='${tag}']`, pt, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          const node = iter.singleNodeValue;
          if (node) { const v = parseFloat(node.textContent); if (!isNaN(v)) return v; }
        } catch {}
      }
      return null;
    };

    return {
      lat, lng: lon, ele,
      hr:      getExt('hr','heartrate','HeartRateBpm'),
      cad:     getExt('cad','cadence','RunCadence'),
      speed:   getExt('speed'),
      power:   getExt('power','Power'),
      ts:      time ? new Date(time) : null,
    };
  }).filter(p => p && !isNaN(p.lat) && !isNaN(p.lng));
}

/* ═══════════════════════════════════════════════════════════════
   FILE HANDLING
═══════════════════════════════════════════════════════════════ */
function handleFiles(fl) {
  const files = Array.from(fl);
  document.getElementById('fi').value = '';
  if (!files.length) return;
  processQueue(files, 0);
}
function processQueue(files, i) {
  if (i >= files.length) return;
  const f = files[i];
  const ext = f.name.split('.').pop().toLowerCase();
  loader(true, `Parsing ${f.name}…`);

  const next = () => { loader(false); setTimeout(() => processQueue(files, i+1), 50); };

  if (ext === 'gpx') {
    const r = new FileReader();
    r.onload = e => {
      try { addRide(f.name.replace(/\.gpx$/i,''), parseGPX(e.target.result), 'gpx'); }
      catch(err) { toast('GPX error in "'+f.name+'": '+err.message, 'err'); console.error(err); }
      next();
    };
    r.onerror = () => { toast('Cannot read '+f.name, 'err'); next(); };
    r.readAsText(f);

  } else if (ext === 'fit') {
    const r = new FileReader();
    r.onload = e => {
      try {
        const raw = parseFIT(e.target.result);
        const pts  = Array.isArray(raw) ? raw : raw.pts;
        const laps = Array.isArray(raw) ? [] : (raw.laps || []);
        addRide(f.name.replace(/\.fit$/i,''), pts, 'fit', laps);
      }
      catch(err) { toast('FIT error in "'+f.name+'": '+err.message, 'err'); console.error(err); }
      next();
    };
    r.onerror = () => { toast('Cannot read '+f.name, 'err'); next(); };
    r.readAsArrayBuffer(f);

  } else {
    toast('Unsupported: '+f.name+' (use .fit or .gpx)', 'err');
    next();
  }
}
function onDragOver(e)  { e.preventDefault(); document.getElementById('dz').classList.add('ov'); }
function onDragLeave()  { document.getElementById('dz').classList.remove('ov'); }
function onDrop(e)      { e.preventDefault(); document.getElementById('dz').classList.remove('ov'); handleFiles(e.dataTransfer.files); }

/* ═══════════════════════════════════════════════════════════════
   RIDE MANAGEMENT
═══════════════════════════════════════════════════════════════ */
function addRide(name, points, fileType, laps) {
  if (!fileType) fileType = 'gpx';
  if (!laps) laps = [];
  if (rides.find(r => r.name === name)) { toast('"'+name+'" already loaded', 'warn'); return; }

  const id    = 'r_'+Date.now()+'_'+Math.random().toString(36).slice(2,6);
  const color = COLORS[rides.length % COLORS.length];
  const stats = computeStats(points);
  const smap  = buildSampleMap(points);

  const poly = L.polyline(points.map(p=>[p.lat,p.lng]), {color, weight:2.5, opacity:.88, smoothFactor:1}).addTo(map);

  const ride = {id, name, color, points, smap, stats, fileType, laps, poly, visible:true};
  rides.push(ride);
  map.fitBounds(poly.getBounds(), {padding:[26,26]});

  // Persist
  idbPut({id, name, color, points, stats, fileType, laps, savedAt:Date.now()}).catch(()=>{});
  pendingSync.add(id);
  updateUnsavedChip();

  refresh();
  toast('Loaded: '+name+' ('+points.length.toLocaleString()+' pts)', 'ok');
}

function buildSampleMap(points) {
  const n = points.length, target = Math.min(n, 600);
  const step = n / target;
  return Array.from({length:target}, (_,i) => Math.min(Math.floor(i*step), n-1));
}

async function removeRide(id, e) {
  e?.stopPropagation();
  const idx = rides.findIndex(r=>r.id===id);
  if (idx<0) return;
  map.removeLayer(rides[idx].poly);
  rides.splice(idx,1);
  pendingSync.delete(id);
  if (selectedId === id) selectedId = null;
  await idbDel(id).catch(()=>{});
  updateUnsavedChip();
  refresh();
}

function toggleVis(id, e) {
  e?.stopPropagation();
  const r = rides.find(r=>r.id===id);
  if (!r) return;
  r.visible = !r.visible;
  r.visible ? r.poly.addTo(map) : map.removeLayer(r.poly);
  refresh();
}
function zoomTo(id, e) {
  e?.stopPropagation();
  const r = rides.find(r=>r.id===id);
  if (r) map.fitBounds(r.poly.getBounds(), {padding:[26,26]});
}

function selectRide(id) {
  // Toggle: clicking same ride again deselects (shows all)
  selectedId = selectedId === id ? null : id;
  refresh();
}

function showAllRides() {
  selectedId = null;
  // Show all polylines
  rides.forEach(r => { r.visible = true; if (!map.hasLayer(r.poly)) r.poly.addTo(map); });
  refresh();
}

async function clearAll() {
  rides.forEach(r => map.removeLayer(r.poly));
  rides = []; selectedId = null; pendingSync.clear();
  if (profileChart) { profileChart.destroy(); profileChart = null; }
  await idbClear().catch(()=>{});
  updateUnsavedChip();
  refresh();
}

/* ═══════════════════════════════════════════════════════════════
   STATS ENGINE
═══════════════════════════════════════════════════════════════ */
function computeStats(pts) {
  if (!pts.length) return {};

  let dist = 0;
  for (let i=1; i<pts.length; i++) dist += haversine(pts[i-1], pts[i]);

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
  const max = a => a.length ? Math.max(...a) : null;
  const min = a => a.length ? Math.min(...a) : null;

  // HR zones
  const maxHR = cfg.maxHR || 190;
  const zoneCounts = HR_ZONES.map((z,i) => {
    const lo = i===0 ? 0 : HR_ZONES[i-1].maxPct;
    return hrs.filter(h => { const p=h/maxHR; return p>=lo && p<z.maxPct; }).length;
  });
  const zTotal = zoneCounts.reduce((a,b)=>a+b,0);
  const zonePct = zoneCounts.map(c => zTotal>0 ? Math.round(c/zTotal*100) : 0);

  const avgHrV = avg(hrs);
  const tss = (dur && avgHrV && maxHR) ?
    Math.round((dur/3600) * Math.pow(avgHrV/maxHR,2) * 100) : null;

  const avgSpd = spds.length ? avg(spds) : (dist&&dur ? dist/(dur/3600) : null);

  return {
    distance: +dist.toFixed(2),
    duration: dur,
    eleGain:  Math.round(eleGain),
    eleLoss:  Math.round(eleLoss),
    maxEle:   Math.round(max(eles)||0),
    minEle:   Math.round(min(eles)||0),
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

function haversine(a,b) {
  const R=6371, dLat=(b.lat-a.lat)*Math.PI/180, dLon=(b.lng-a.lng)*Math.PI/180;
  const x=Math.sin(dLat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}

/* ═══════════════════════════════════════════════════════════════
   VISIBILITY — selected vs all
═══════════════════════════════════════════════════════════════ */
function visibleRides() {
  // If a ride is selected, only show that one in stats/charts
  if (selectedId) {
    const r = rides.find(r=>r.id===selectedId);
    return r ? [r] : [];
  }
  return rides.filter(r=>r.visible);
}

function applyPolylineVisibility() {
  rides.forEach(r => {
    const show = selectedId ? r.id===selectedId : r.visible;
    if (show && !map.hasLayer(r.poly)) r.poly.addTo(map);
    else if (!show && map.hasLayer(r.poly)) map.removeLayer(r.poly);
  });
}

/* ═══════════════════════════════════════════════════════════════
   RENDER SIDEBAR
═══════════════════════════════════════════════════════════════ */
function renderSidebar() {
  const list = document.getElementById('rides-list');
  list.querySelectorAll('.rc').forEach(el=>el.remove());
  document.getElementById('sb-empty').style.display = rides.length ? 'none' : '';

  rides.forEach(r => {
    const isSel = selectedId === r.id;
    const isFad = selectedId && !isSel;
    const el = document.createElement('div');
    el.className = 'rc' + (isSel?' sel':'') + (!r.visible&&!selectedId?' fad':'') + (isFad?' fad':'');
    el.style.setProperty('--rc', r.color);
    el.onclick = () => selectRide(r.id);
    el.innerHTML = `
      <div class="rc-hd">
        <div class="rc-dot"></div>
        <div class="rc-nm" title="${esc(r.name)}">${esc(r.name)}</div>
        <div class="rc-acts">
          <button class="ibb" title="${r.visible?'Hide':'Show'}" onclick="toggleVis('${r.id}',event)">${r.visible?'👁':'○'}</button>
          <button class="ibb" title="Zoom to route" onclick="zoomTo('${r.id}',event)">⊕</button>
          <button class="ibb rm" title="Remove" onclick="removeRide('${r.id}',event)">✕</button>
        </div>
      </div>
      <div class="rc-grid">
        <div class="rc-kv">📅 <b>${fmtDate(r.stats.startDate)}</b></div>
        <div class="rc-kv">⏱ <b>${fmtDur(r.stats.duration)}</b></div>
        <div class="rc-kv">📏 <b>${r.stats.distance} km</b></div>
        <div class="rc-kv">⬆ <b>${r.stats.eleGain} m</b></div>
        ${r.stats.avgHr   ? `<div class="rc-kv">♥ <b>${r.stats.avgHr} bpm</b></div>` : ''}
        ${r.stats.avgSpeed? `<div class="rc-kv">⚡ <b>${r.stats.avgSpeed} km/h</b></div>` : ''}
      </div>`;
    // Lap table (max 5 laps from FIT file)
    if (r.laps && r.laps.length) {
      const lapDiv = document.createElement('div');
      lapDiv.innerHTML = '<div class="lap-hdr"><span>Lap</span><span>Time</span><span>Dist</span><span>HR</span><span>Spd</span></div>' +
        r.laps.slice(0, 5).map((l, i) =>
          '<div class="lap-row"><span>' + (i+1) + '</span><span>' + fmtDur(l.totalTime) + '</span><span>' + (l.distance ? l.distance.toFixed(1)+'k' : '—') + '</span><span>' + (l.avgHr||'—') + '</span><span>' + (l.avgSpeed ? l.avgSpeed+'k' : '—') + '</span></div>'
        ).join('');
      el.appendChild(lapDiv);
    }
    list.appendChild(el);
  });

  document.getElementById('chip-count').textContent = `${rides.length} ride${rides.length!==1?'s':''}`;
  document.getElementById('chip-live').style.display  = rides.length>1 && !selectedId ? '' : 'none';
  document.getElementById('rc-lbl').textContent = rides.length;
}

/* ═══════════════════════════════════════════════════════════════
   RENDER STATS PANEL
═══════════════════════════════════════════════════════════════ */
function renderStats() {
  const body = document.getElementById('sb');
  body.querySelectorAll('.sblk,.vsec,.ins,.insl').forEach(el=>el.remove());
  const vis = visibleRides();
  document.getElementById('st-empty').style.display = vis.length ? 'none' : '';
  if (!vis.length) return;

  if (currentTab==='compare') renderCompare(body, vis);
  else if (currentTab==='vitals') renderVitals(body, vis);
  else if (currentTab==='plan') renderPlan(body, vis);
  else if (currentTab==='segments') renderSegments(body, vis);
}

function renderCompare(body, vis) {
  const metrics = [
    {k:'distance',  lbl:'Distance',        fmt:v=>v+' km',          hi:true},
    {k:'duration',  lbl:'Moving time',     fmt:fmtDur,              hi:false},
    {k:'eleGain',   lbl:'Elevation gain',  fmt:v=>v+' m',           hi:false},
    {k:'eleLoss',   lbl:'Elevation loss',  fmt:v=>v+' m',           hi:false},
    {k:'maxEle',    lbl:'Max elevation',   fmt:v=>v+' m',           hi:false},
    {k:'avgSpeed',  lbl:'Avg speed',       fmt:v=>v?v+' km/h':'—',  hi:true},
    {k:'maxSpeed',  lbl:'Max speed',       fmt:v=>v?v+' km/h':'—',  hi:true},
    {k:'avgHr',     lbl:'Avg heart rate',  fmt:v=>v?v+' bpm':'—',   hi:false},
    {k:'maxHr',     lbl:'Max heart rate',  fmt:v=>v?v+' bpm':'—',   hi:false},
    {k:'avgCad',    lbl:'Avg cadence',     fmt:v=>v?v+' rpm':'—',   hi:true},
    {k:'avgPower',  lbl:'Avg power',       fmt:v=>v?v+' W':'—',     hi:true},
    {k:'tss',       lbl:'Training stress', fmt:v=>v||'—',           hi:false},
  ];

  metrics.forEach(m => {
    const nums = vis.map(r=>parseFloat(r.stats[m.k])).filter(v=>!isNaN(v)&&v>0);
    if (!nums.length) return;
    const maxV = Math.max(...nums), minV = Math.min(...nums);
    const best = m.hi ? maxV : minV;

    const blk = document.createElement('div');
    blk.className = 'sblk';
    blk.innerHTML = `<div class="slbl">${m.lbl}</div>`
      + vis.map(r => {
          const val = parseFloat(r.stats[m.k]);
          const pct = maxV>0 ? Math.round((isNaN(val)?0:val)/maxV*100) : 0;
          const isBest = val===best && nums.length>1;
          return `<div class="sbr">
            <div class="sbd" style="background:${r.color}"></div>
            <div class="sbn" title="${esc(r.name)}">${esc(r.name)}</div>
            <div class="sbb"><div class="sbf" style="width:${isNaN(pct)?0:pct}%;background:${r.color}"></div></div>
            <div class="sbv${isBest?' best':''}" style="${isBest?'color:'+r.color:''}">${m.fmt(r.stats[m.k])}</div>
          </div>`;
        }).join('');
    body.appendChild(blk);
  });
}

function renderVitals(body, vis) {
  vis.forEach(r => {
    const s = r.stats;
    const sec = document.createElement('div');
    sec.className = 'vsec';
    sec.innerHTML = `<div class="vsect" style="color:${r.color}">${esc(r.name)}</div>
      <div class="vg">
        <div class="vc"><div class="vcl">Distance</div><div class="vcv a">${s.distance} km</div></div>
        <div class="vc"><div class="vcl">Duration</div><div class="vcv">${fmtDur(s.duration)}</div></div>
        <div class="vc"><div class="vcl">Elev ↑ / ↓</div><div class="vcv b">↑${s.eleGain}m ↓${s.eleLoss}m</div></div>
        <div class="vc"><div class="vcl">Max elevation</div><div class="vcv">${s.maxEle}m</div></div>
        <div class="vc"><div class="vcl">Avg / max HR</div><div class="vcv c">${s.avgHr||'—'} / ${s.maxHr||'—'} bpm</div></div>
        <div class="vc"><div class="vcl">Avg / max speed</div><div class="vcv">${s.avgSpeed||'—'} / ${s.maxSpeed||'—'} km/h</div></div>
        <div class="vc"><div class="vcl">Avg cadence</div><div class="vcv">${s.avgCad||'—'} rpm</div></div>
        <div class="vc"><div class="vcl">Avg / max power</div><div class="vcv">${s.avgPower||'—'} / ${s.maxPower||'—'} W</div></div>
        <div class="vc"><div class="vcl">Training stress</div><div class="vcv ${(s.tss||0)>150?'d':(s.tss||0)>80?'c':'a'}">${s.tss||'—'}</div></div>
        <div class="vc"><div class="vcl">GPS points</div><div class="vcv">${(s.pointCount||0).toLocaleString()}</div></div>
      </div>`;

    if (s.zonePct?.some(v=>v>0)) {
      sec.innerHTML += `<div style="margin-top:4px"><div class="slbl">Heart rate zones</div>`
        + HR_ZONES.map((z,i)=>`<div class="zr">
            <div class="zl" style="color:${z.color}">${z.name}</div>
            <div class="zbg"><div class="zf" style="width:${s.zonePct[i]}%;background:${z.color}"></div></div>
            <div class="zp">${s.zonePct[i]}%</div>
          </div>`).join('') + '</div>';
    }
    body.appendChild(sec);
  });
}

function renderPlan(body, vis) {
  if (vis.length < 2) {
    const el = document.createElement('div');
    el.className = 'ins';
    el.innerHTML = '<b>Load 2+ rides</b> and set "All" to generate training insights.';
    body.appendChild(el);
    return;
  }

  const sorted = [...vis].sort((a,b) => {
    if (!a.stats.startDate) return 1;
    if (!b.stats.startDate) return -1;
    return a.stats.startDate - b.stats.startDate;
  });
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

  if (!insights.length) insights.push('Load more rides to generate training insights.');

  const lbl = document.createElement('div');
  lbl.className = 'insl'; lbl.textContent = 'Training insights';
  body.appendChild(lbl);
  insights.forEach(txt => {
    const el = document.createElement('div');
    el.className = 'ins'; el.innerHTML = txt;
    body.appendChild(el);
  });
}

function setTab(tab, btn) {
  currentTab = tab;
  if (tab !== 'segments' && window._segLayers) {
    window._segLayers.forEach(l => map.removeLayer(l));
    window._segLayers = [];
  }
  document.querySelectorAll('.stab').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  renderStats();
}

/* ═══════════════════════════════════════════════════════════════
   CHART — all visible rides, with hover → map marker
═══════════════════════════════════════════════════════════════ */
function setChart(type, btn) {
  currentChart = type;
  document.querySelectorAll('.ct').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  renderChart();
}

function renderChart() {
  const canvas = document.getElementById('pc');
  if (profileChart) { profileChart.destroy(); profileChart = null; }

  const vis = visibleRides();
  if (!vis.length) return;

  const KEY = {elevation:'ele', hr:'hr', speed:'speed', cadence:'cad', power:'power'};
  const UNITS = {elevation:' m', hr:' bpm', speed:' km/h', cadence:' rpm', power:' W'};
  const key   = KEY[currentChart] || 'ele';

  // Check if any ride has this data
  const hasData = vis.some(r => r.points.some(p => p[key]!=null && p[key]>0));
  if (!hasData && currentChart !== 'elevation') {
    // Show elevation as fallback with a note
    const fallbackKey = 'ele';
    renderChartWithKey(canvas, vis, fallbackKey, UNITS);
    toast('No '+currentChart+' data in selected rides — showing elevation', 'warn');
    return;
  }

  renderChartWithKey(canvas, vis, key, UNITS);
}

function renderChartWithKey(canvas, vis, key, UNITS) {
  const datasets = vis.map(r => {
    const idxs = r.smap;
    const data = idxs.map(i => {
      const v = r.points[i][key];
      const valid = v != null && (key==='ele' ? true : v > 0);
      return {x: i/(r.points.length-1||1)*100, y: valid ? v : null, pi: i};
    });
    return {
      label: r.name,
      data,
      borderColor: r.color,
      backgroundColor: r.color+'12',
      borderWidth: 1.5,
      pointRadius: 0,
      fill: true,
      tension: .25,
      spanGaps: true,
      rideId: r.id,
    };
  }).filter(ds => ds.data.some(d=>d.y!=null));

  if (!datasets.length) return;

  profileChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {datasets},
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: {duration:220},
      interaction: {mode:'index', intersect:false},
      onHover: (_evt, elements) => {
        if (!elements.length) { hideHoverMarker(); return; }
        const el = elements[0];
        const ds = datasets[el.datasetIndex];
        if (!ds) return;
        const pt = ds.data[el.index];
        if (!pt) return;
        const ride = vis.find(r=>r.id===ds.rideId);
        if (ride && pt.pi!=null) {
          const origPt = ride.points[pt.pi];
          if (origPt) showHoverMarker(origPt, ride.color, currentChart, pt.y);
        }
      },
      plugins: {
        legend:{display:false},
        tooltip:{
          backgroundColor:'#181c1a', borderColor:'rgba(255,255,255,.1)', borderWidth:1,
          titleColor:'#5c6b5f', bodyColor:'#dfe8e0',
          titleFont:{family:"'DM Mono',monospace",size:9},
          bodyFont: {family:"'DM Mono',monospace",size:10},
          padding:7,
          callbacks:{
            title: items => `${items[0].parsed.x.toFixed(1)}% of route`,
            label: item => {
              const v = item.parsed.y;
              if (v==null) return null;
              const unit = UNITS[currentChart]||'';
              return ` ${item.dataset.label}: ${v.toFixed(0)}${unit}`;
            },
          }
        }
      },
      scales:{
        x:{type:'linear',min:0,max:100,
          ticks:{color:'#5c6b5f',font:{family:"'DM Mono',monospace",size:9},callback:v=>v+'%',maxTicksLimit:6},
          grid:{color:'rgba(255,255,255,.04)'}},
        y:{ticks:{color:'#5c6b5f',font:{family:"'DM Mono',monospace",size:9},maxTicksLimit:5},
           grid:{color:'rgba(255,255,255,.04)'}}
      }
    }
  });
  canvas.addEventListener('mouseleave', hideHoverMarker);
}

/* ═══════════════════════════════════════════════════════════════
   HOVER MARKER — chart → map sync
═══════════════════════════════════════════════════════════════ */
function showHoverMarker(pt, color, type, value) {
  if (!pt?.lat || !pt?.lng) return;
  hoverMarker.setIcon(L.divIcon({
    className:'',
    html:`<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,.5);transform:translate(-6px,-6px)"></div>`,
    iconSize:[0,0],
  }));
  hoverMarker.setLatLng([pt.lat, pt.lng]);
  if (!map.hasLayer(hoverMarker)) hoverMarker.addTo(map);

  const units = {elevation:'m', hr:'bpm', speed:'km/h', cadence:'rpm', power:'W'};
  const valStr = value != null ? `${value.toFixed(0)} ${units[type]||''}` : '';
  const lbl = document.getElementById('mhl');
  lbl.textContent = `${valStr}  •  ${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}`;
  lbl.style.display = '';

  try {
    const px = map.latLngToContainerPoint([pt.lat,pt.lng]);
    const mr = document.getElementById('map').getBoundingClientRect();
    lbl.style.left = Math.min(px.x+14, mr.width-200)+'px';
    lbl.style.top  = Math.max(px.y-28, 4)+'px';
  } catch {}
}
function hideHoverMarker() {
  if (map.hasLayer(hoverMarker)) map.removeLayer(hoverMarker);
  document.getElementById('mhl').style.display = 'none';
}

/* ═══════════════════════════════════════════════════════════════
   AUTH — Supabase OAuth + email/password + registration flow
═══════════════════════════════════════════════════════════════ */
async function authWith(provider) {
  if (!sbClient) {
    try {
      sbClient = window.supabase.createClient(cfg.url, cfg.key);
    } catch(e) {
      toast('Supabase initialization failed', 'err');
      return;
    }
  }
  try {
    const {error} = await sbClient.auth.signInWithOAuth({
      provider,
      options: {redirectTo: window.location.href}
    });
    if (error) throw error;
  } catch(e) { toast('OAuth error: '+e.message, 'err'); }
}

async function signInPassword() {
  if (!sbClient) {
    try {
      sbClient = window.supabase.createClient(cfg.url, cfg.key);
    } catch(e) {
      toast('Supabase initialization failed', 'err');
      return;
    }
  }
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
  if (!sbClient) {
    try {
      sbClient = window.supabase.createClient(cfg.url, cfg.key);
    } catch(e) {
      toast('Supabase initialization failed', 'err');
      return;
    }
  }
  const name  = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pass  = document.getElementById('reg-pass').value;
  if (!name||!email||!pass) { toast('Fill in all fields', 'err'); return; }
  if (pass.length < 8)      { toast('Password must be at least 8 characters', 'err'); return; }

  try {
    // 1. Create auth account (disabled until approved — use signUp + email confirm disabled)
    const {data, error} = await sbClient.auth.signUp({
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

async function onSignedIn() {
  const chip = document.getElementById('chip-user');
  chip.textContent = '● '+( currentUser?.user_metadata?.name || currentUser?.email || 'signed in');
  chip.style.display = '';
  chip.className = 'chip on';
  document.getElementById('btn-admin').style.display = isAdmin() ? '' : 'none';
  document.getElementById('btn-sign-out').style.display = '';
  closeSettings();
  toast('Welcome back!', 'ok');
  // Load rides from Supabase
  await loadRidesFromSupabase();
}
function onSignedOut() {
  document.getElementById('chip-user').style.display = 'none';
  document.getElementById('btn-admin').style.display = 'none';
  document.getElementById('btn-sign-out').style.display = 'none';
}
function isAdmin() {
  return currentUser?.user_metadata?.role === 'admin' ||
         currentUser?.app_metadata?.role  === 'admin';
}

/* ═══════════════════════════════════════════════════════════════
   ADMIN PANEL
═══════════════════════════════════════════════════════════════ */
async function openAdmin() {
  document.getElementById('admin-mb').style.display = 'flex';
  loadAdminData();
}
async function loadAdminData() {
  if (!sbClient) { toast('Supabase not configured', 'err'); return; }
  const {data, error} = await sbClient.from('ridecomp_users').select('*').order('requested_at',{ascending:false});
  const list = document.getElementById('admin-list');
  if (error || !data) { list.innerHTML = '<div class="ins">Error loading users: ' + esc(error?.message || 'unknown') + '</div>'; return; }
  if (!data.length)   { list.innerHTML = '<div class="ins">No registration requests.</div>'; return; }

  list.innerHTML = data.map(u => {
    const ago = u.requested_at ? timeSince(new Date(u.requested_at)) : '—';
    const exp = u.expires_at && u.role==='pending' ? ' (expires '+timeSince(new Date(u.expires_at))+')' : '';
    const statusClass = {pending:'sb-pending',member:'sb-approved',admin:'sb-approved',denied:'sb-denied'}[u.role]||'sb-pending';
    return `<div class="admin-row">
      <div>
        <div class="admin-name">${esc(u.name||u.email)}</div>
        <div class="admin-email">${esc(u.email)}</div>
      </div>
      <div class="admin-time">${ago}${exp}</div>
      <span class="status-badge ${statusClass}">${u.role}</span>
      ${u.role==='pending' ? `
        <button class="btn" style="padding:3px 8px;font-size:10px" onclick="approveUser('${u.id}','${esc(u.email)}')">✓ Approve</button>
        <button class="btn dbtn" style="padding:3px 8px;font-size:10px" onclick="denyUser('${u.id}')">✕ Deny</button>` : ''}
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
function closeAdminBg(e) { if(e.target===document.getElementById('admin-mb')) document.getElementById('admin-mb').style.display='none'; }

function timeSince(d) {
  if (!d||isNaN(d)) return '?';
  const s = Math.floor((Date.now()-d)/1000);
  if (s < 60) return s+'s ago';
  if (s < 3600) return Math.floor(s/60)+'m ago';
  if (s < 86400) return Math.floor(s/3600)+'h ago';
  return Math.floor(s/86400)+'d ago';
}

/* ═══════════════════════════════════════════════════════════════
   SETTINGS MODAL
═══════════════════════════════════════════════════════════════ */
function openSettings() {
  document.getElementById('cfg-maxhr').value = cfg.maxHR||190;

  const loggedIn = !!currentUser;
  // Always show the main settings container and the config section
  document.getElementById('view-settings').style.display = '';
  document.getElementById('view-config').style.display = '';

  // Show auth view only if not logged in
  document.getElementById('view-auth').style.display = loggedIn ? 'none' : '';
  // Show user-specific settings only if logged in
  document.getElementById('view-user-settings').style.display = loggedIn ? '' : 'none';
  // Show sign-out button only if logged in
  document.getElementById('btn-sign-out').style.display = loggedIn ? '' : 'none';

  document.getElementById('mb').classList.add('open');
}
function closeSettings() { document.getElementById('mb').classList.remove('open'); }
function closeModalBg(e) { if(e.target===document.getElementById('mb')) closeSettings(); }

function saveSettings() {
  cfg.maxHR = parseInt(document.getElementById('cfg-maxhr').value)||190;
  localStorage.setItem('ridecomp_cfg', JSON.stringify(cfg));

  if (cfg.url && cfg.key) {
    try {
      sbClient = window.supabase.createClient(cfg.url, cfg.key);
      // Re-check session
      sbClient.auth.getUser().then(({data}) => {
        if (data?.user) { currentUser = data.user; onSignedIn(); }
      });
      updateDBBadge(true);
      document.getElementById('btn-sync').style.display = '';
      toast('Settings saved ✓', 'ok');
    } catch(e) { sbClient=null; updateDBBadge(false); toast('Supabase error: '+e.message,'err'); }
  } else {
    sbClient = null; updateDBBadge(false);
    document.getElementById('btn-sync').style.display = 'none';
    toast('Settings saved (local only)');
  }
  closeSettings();
}

function updateDBBadge(ok) {
  const dot = document.getElementById('dbdot');
  const lbl = document.getElementById('dblbl');
  if (ok)        { dot.className='ok';   lbl.textContent='Supabase connected'; }
  else if(cfg.url){ dot.className='warn'; lbl.textContent='Supabase not connected'; }
  else           { dot.className='';     lbl.textContent='Local storage only'; }
}

function updateUnsavedChip() {
  document.getElementById('chip-unsaved').style.display = pendingSync.size&&cfg.url ? '' : 'none';
}

/* ═══════════════════════════════════════════════════════════════
   SUPABASE SYNC
═══════════════════════════════════════════════════════════════ */
async function loadRidesFromSupabase() {
  if (!sbClient || !currentUser) return;
  try {
    const {data, error} = await sbClient.from('ridecomp_rides').select('*').eq('user_id', currentUser.id);
    if (error) throw error;
    if (!data || !data.length) return;
    loader(true, `Loading ${data.length} ride(s) from cloud…`);
    for (const r of data) {
      if (rides.find(x => x.id === r.id)) continue;
      await idbPut(r).catch(() => {});
      hydrate(r);
    }
    loader(false);
    refresh();
    toast(`Loaded ${data.length} ride(s) from cloud`, 'ok');
  } catch(e) {
    console.error('Failed to load rides from Supabase', e);
  }
}

async function syncToSupabase() {
  if (!sbClient) { toast('Configure Supabase in Settings first','err'); return; }
  if (!currentUser) { toast('Please sign in to sync rides','err'); return; }
  const toSync = rides.filter(r=>pendingSync.has(r.id));
  console.log('Sync debug:', { totalRides: rides.length, pendingSync: pendingSync.size, toSync: toSync.length, userId: currentUser?.id });
  if (!toSync.length) {
    // If no pending but rides exist, mark all for sync
    if (rides.length > 0) {
      rides.forEach(r => pendingSync.add(r.id));
      updateUnsavedChip();
      toast('Rides marked for sync - click Sync again','ok');
      return;
    }
    toast('No rides to sync');
    return;
  }
  loader(true,`Syncing ${toSync.length} ride(s) as user ${currentUser.id}…`);
  let ok=0, fail=0;
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
      console.log('Upserting ride:', payload);
      const {data, error} = await sbClient.from('ridecomp_rides').upsert(payload);
      if (error) throw error;
      console.log('Upsert result:', data);
      pendingSync.delete(r.id); ok++;
    } catch(e) {
      fail++;
      console.error('Sync error for ride', r.id, e);
      toast(`Failed: ${r.name} - ${e.message}`, 'err');
    }
  }
  loader(false);
  updateUnsavedChip();
  toast(fail ? `Synced ${ok}, failed ${fail}`:`${ok} ride(s) synced ✓`, fail?'err':'ok');
}

/* ═══════════════════════════════════════════════════════════════
   LOCAL JSON BACKUP
═══════════════════════════════════════════════════════════════ */
async function exportJSON() {
  const all = await idbAll() || [];
  const blob = new Blob([JSON.stringify({version:VER, exportedAt:new Date().toISOString(), rides:all},null,2)],{type:'application/json'});
  const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(blob),download:`ridecomp-${new Date().toISOString().slice(0,10)}.json`});
  a.click();
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
      for (const r of arr) {
        if (!r.id||!r.points) continue;
        if (rides.find(x=>x.id===r.id)) continue;
        await idbPut(r).catch(()=>{});
        hydrate(r); added++;
      }
      refresh();
      toast(`Imported ${added} ride(s)`, 'ok');
    } catch(e) { toast('Import failed: '+e.message,'err'); }
    loader(false); input.value='';
  });
}
async function nukeDB() {
  if (!confirm('Delete all locally stored rides? This cannot be undone.')) return;
  await idbClear().catch(()=>{});
  toast('Local database cleared');
  closeSettings();
}

/* ═══════════════════════════════════════════════════════════════
   HYDRATE — restore ride from DB (no re-parse)
═══════════════════════════════════════════════════════════════ */
function hydrate(r) {
  const color = r.color || COLORS[rides.length%COLORS.length];
  const pts   = r.points || [];
  // Convert ts strings back to Date objects
  pts.forEach(p => { if (p.ts && typeof p.ts==='string') p.ts = new Date(p.ts); });
  const poly = L.polyline(pts.map(p=>[p.lat,p.lng]),{color,weight:2.5,opacity:.88,smoothFactor:1}).addTo(map);
  rides.push({
    id:r.id, name:r.name, color,
    points:pts, smap:buildSampleMap(pts),
    stats: r.stats || computeStats(pts),
    fileType:r.fileType||'gpx',
    laps: r.laps||[],
    poly, visible:true,
  });
}

/* ═══════════════════════════════════════════════════════════════
   MASTER REFRESH
═══════════════════════════════════════════════════════════════ */
function refresh() {
  applyPolylineVisibility();
  renderSidebar();
  renderStats();
  renderChart();
}

/* ═══════════════════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════════════════ */
function fmtDur(s) {
  if (!s||s<=0) return '—';
  return Math.floor(s/3600)>0 ? `${Math.floor(s/3600)}h ${String(Math.floor((s%3600)/60)).padStart(2,'0')}m` : `${Math.floor(s/60)}m`;
}
function fmtDate(d) {
  if (!d||!(d instanceof Date)||isNaN(d)) return '—';
  return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'2-digit'});
}
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

let _tt;
function toast(msg, type='') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show' + (type==='err'?' err':type==='ok'?' ok':'');
  clearTimeout(_tt);
  _tt = setTimeout(()=>el.className='', type==='err'?4500:2600);
}
function loader(show, msg='Processing…') {
  document.getElementById('lm').textContent = msg;
  document.getElementById('ldr').className = show?'open':'';
}

/* ═══════════════════════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', async () => {
  // Restore theme
  const _t = localStorage.getItem('ridecomp_theme');
  if (_t) document.documentElement.setAttribute('data-theme', _t);

  initMap();

  // Load config
  try {
    const saved = localStorage.getItem('ridecomp_cfg');
    if (saved) {
      cfg = {...cfg, ...JSON.parse(saved)};
    }
    if (cfg.url && cfg.key) {
      sbClient = window.supabase.createClient(cfg.url, cfg.key);
      updateDBBadge(true);
      document.getElementById('btn-sync').style.display = '';
      // Restore session
      const {data} = await sbClient.auth.getUser();
      if (data?.user) { currentUser = data.user; onSignedIn(); }
      // Listen for auth changes
      sbClient.auth.onAuthStateChange((_evt, session) => {
        currentUser = session?.user || null;
        if (currentUser) onSignedIn(); else onSignedOut();
      });
    }
  } catch(e) { console.warn('Config load error', e); }

  // Open IndexedDB and restore rides
  try {
    idb = await openIDB();
    const stored = await idbAll();
    if (stored?.length) {
      loader(true, `Restoring ${stored.length} ride(s)…`);
      stored.forEach(r => hydrate(r));
      if (rides.length) {
        const bounds = rides.map(r=>r.poly.getBounds()).reduce((a,b)=>a.extend(b));
        map.fitBounds(bounds, {padding:[26,26]});
      }
      loader(false);
    }
  } catch(e) { console.warn('IndexedDB unavailable, running in-memory', e); idb=null; }

  refresh();
  window.addEventListener('resize', ()=>{ if(profileChart) profileChart.resize(); });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey||e.metaKey)&&e.key==='o') { e.preventDefault(); document.getElementById('fi').click(); }
    if (e.key==='Escape') { closeSettings(); document.getElementById('admin-mb').style.display='none'; }
  });

  console.log(`RideComp v${VER} ready.`);
});
