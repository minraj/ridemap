/* ═══════════════════════════════════════════════════════════════
   GPX EXPORT
   exportGPX(ids?) — given ride ids, or all visible rides
═══════════════════════════════════════════════════════════════ */
function exportGPX(ids) {
  const list = ids ? rides.filter(r => ids.includes(r.id)) : rides.filter(r => r.visible);
  if (!list.length) { toast('No rides to export', 'err'); return; }
  list.forEach(r => {
    const trkpts = r.points.map(p => {
      const timeStr = p.ts ? '<time>' + p.ts.toISOString() + '</time>' : '';
      const hr   = p.hr    ? '<gpxtpx:hr>'    + p.hr    + '</gpxtpx:hr>'    : '';
      const cad  = p.cad   ? '<gpxtpx:cad>'   + p.cad   + '</gpxtpx:cad>'   : '';
      const pwr  = p.power ? '<gpxtpx:power>' + p.power + '</gpxtpx:power>' : '';
      const exts = (hr||cad||pwr) ? '<extensions><gpxtpx:TrackPointExtension>' + hr + cad + pwr + '</gpxtpx:TrackPointExtension></extensions>' : '';
      return '<trkpt lat="' + p.lat.toFixed(7) + '" lon="' + p.lng.toFixed(7) + '"><ele>' + (p.ele||0).toFixed(1) + '</ele>' + timeStr + exts + '</trkpt>';
    }).join('\n    ');
    const gpx = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="RideMap v' + VER + '" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">\n  <trk><name>' + esc(r.name) + '</name><trkseg>\n    ' + trkpts + '\n  </trkseg></trk>\n</gpx>';
    downloadBlob(new Blob([gpx], {type:'application/gpx+xml'}), safeName(r.name) + '.gpx');
  });
  toast('Exported ' + list.length + ' GPX file(s)', 'ok');
}

const safeName = s => s.replace(/[^a-z0-9_-]/gi, '_');

/* ═══════════════════════════════════════════════════════════════
   FIT EXPORT
   Minimal FIT activity file: file_id, one record per point, lap,
   session and activity messages — enough for Garmin Connect,
   Strava and our own parseFIT() to read it back.
═══════════════════════════════════════════════════════════════ */
const FIT_CRC_TABLE = [0x0000,0xCC01,0xD801,0x1400,0xF001,0x3C00,0x2800,0xE401,
                       0xA001,0x6C00,0x7800,0xB401,0x5000,0x9C01,0x8801,0x4400];
function fitCrc(bytes, start, end) {
  let crc = 0;
  for (let i = start; i < end; i++) {
    const b = bytes[i];
    let t = FIT_CRC_TABLE[crc & 0xF];
    crc = (crc >> 4) & 0x0FFF; crc = crc ^ t ^ FIT_CRC_TABLE[b & 0xF];
    t = FIT_CRC_TABLE[crc & 0xF];
    crc = (crc >> 4) & 0x0FFF; crc = crc ^ t ^ FIT_CRC_TABLE[(b >> 4) & 0xF];
  }
  return crc;
}

// Base types: [size, id, invalid]
const FIT_T = {enum:[1,0x00,0xFF], u8:[1,0x02,0xFF], u16:[2,0x84,0xFFFF], s32:[4,0x85,0x7FFFFFFF], u32:[4,0x86,0xFFFFFFFF]};

function encodeFIT(r) {
  const out = [];
  const w = (v, t) => {
    const [size, , inv] = FIT_T[t];
    if (v == null || !isFinite(v)) v = inv;
    v = Math.round(v);
    if (t === 's32') v = v | 0;
    for (let i = 0; i < size; i++) out.push((v >>> (8 * i)) & 0xFF);
  };
  // fields: [[fieldNum, type], ...]
  const define = (local, gmn, fields) => {
    out.push(0x40 | local, 0, 0);            // header, reserved, little-endian
    out.push(gmn & 0xFF, gmn >> 8, fields.length);
    fields.forEach(([num, t]) => out.push(num, FIT_T[t][0], FIT_T[t][1]));
  };
  const data = (local, fields, values) => {
    out.push(local);
    fields.forEach(([, t], i) => w(values[i], t));
  };

  const pts = r.points;
  // GPX routes have no timestamps — synthesise 1 s spacing so the file is valid
  const t0 = pts[0].ts ? +pts[0].ts : Date.now();
  const fitTs = (p, i) => Math.round(((p.ts ? +p.ts : t0 + i * 1000) / 1000) - FIT_EPOCH);
  const first = fitTs(pts[0], 0), last = fitTs(pts[pts.length - 1], pts.length - 1);
  const s = r.stats;

  const FILE_ID = [[0,'enum'],[1,'u16'],[2,'u16'],[4,'u32']];
  define(0, 0, FILE_ID);
  data(0, FILE_ID, [4, 255, 0, first]);        // type=activity, manufacturer=development

  const REC = [[253,'u32'],[0,'s32'],[1,'s32'],[78,'u32'],[5,'u32'],[73,'u32'],[3,'u8'],[4,'u8'],[7,'u16']];
  define(1, 20, REC);
  pts.forEach((p, i) => data(1, REC, [
    fitTs(p, i),
    p.lat / SEMICIRCLE,
    p.lng / SEMICIRCLE,
    p.ele != null ? (p.ele + 500) * 5 : null,
    r.cum[i] * 100000,                       // km → cm
    p.speed != null ? p.speed / 3.6 * 1000 : null,
    p.hr, p.cad, p.power,
  ]));

  const elapsed = (last - first) * 1000;
  const timer = (s.movingTime || (last - first)) * 1000;
  const dist = r.cum[r.cum.length - 1] * 100000;
  const LAP = [[253,'u32'],[2,'u32'],[7,'u32'],[8,'u32'],[9,'u32'],[0,'enum'],[1,'enum'],[25,'enum']];
  define(2, 19, LAP);
  data(2, LAP, [last, first, elapsed, timer, dist, 9, 1, 2]);     // event=lap, stop, sport=cycling

  const SES = [[253,'u32'],[2,'u32'],[7,'u32'],[8,'u32'],[9,'u32'],[5,'enum'],[6,'enum'],[26,'u16'],[25,'u16'],[0,'enum'],[1,'enum'],[22,'u16'],[16,'u8'],[17,'u8']];
  define(3, 18, SES);
  data(3, SES, [last, first, elapsed, timer, dist, 2, 0, 1, 0, 8, 1, s.eleGain, s.avgHr, s.maxHr]);

  const ACT = [[253,'u32'],[0,'u32'],[1,'u16'],[2,'enum'],[3,'enum'],[4,'enum']];
  define(4, 34, ACT);
  data(4, ACT, [last, timer, 1, 0, 26, 1]);  // manual, event=activity, stop

  const body = Uint8Array.from(out);
  const file = new Uint8Array(14 + body.length + 2);
  const dv = new DataView(file.buffer);
  file[0] = 14; file[1] = 0x20;                 // header size, protocol 2.0
  dv.setUint16(2, 2132, true);                  // profile 21.32
  dv.setUint32(4, body.length, true);
  file.set([0x2E, 0x46, 0x49, 0x54], 8);        // ".FIT"
  dv.setUint16(12, fitCrc(file, 0, 12), true);
  file.set(body, 14);
  dv.setUint16(14 + body.length, fitCrc(file, 0, 14 + body.length), true);
  return file;
}

function exportFIT(id) {
  const r = rideById(id);
  if (!r) return;
  try {
    downloadBlob(new Blob([encodeFIT(r)], {type:'application/vnd.ant.fit'}), safeName(r.name) + '.fit');
    toast('Exported ' + r.name + '.fit', 'ok');
  } catch (e) {
    console.error(e);
    toast('FIT export failed: ' + e.message, 'err');
  }
}

/* ═══════════════════════════════════════════════════════════════
   SEGMENT DETECTION — shared road sections between rides
═══════════════════════════════════════════════════════════════ */
const segCache = new Map();   // "idA|idB" → shared point runs

async function detectSharedSegments(rideA, rideB, thresholdM) {
  if (thresholdM === undefined) thresholdM = 50;
  const shared = [];
  let inSeg = false, segStart = null;
  const step = Math.max(1, Math.floor(rideA.points.length / 500));
  for (let i = 0; i < rideB.points.length; i++) {
    if (i % 1000 === 0) await new Promise(r => setTimeout(r, 0));
    const pb = rideB.points[i];
    let minDist = Infinity;
    for (let j = 0; j < rideA.points.length; j += step) {
      const pa = rideA.points[j];
      const dLat = (pb.lat - pa.lat) * 111320;
      const dLng = (pb.lng - pa.lng) * 111320 * Math.cos(pa.lat * Math.PI / 180);
      const d = Math.sqrt(dLat*dLat + dLng*dLng);
      if (d < minDist) minDist = d;
      if (minDist < 5) break;
    }
    if (minDist <= thresholdM) {
      if (!inSeg) { inSeg = true; segStart = i; }
    } else {
      if (inSeg && i - segStart >= 10) shared.push(rideB.points.slice(segStart, i));
      inSeg = false; segStart = null;
    }
  }
  if (inSeg && rideB.points.length - segStart >= 10) shared.push(rideB.points.slice(segStart));
  return shared;
}

function clearSegLayers() {
  segLayers.forEach(l => map.removeLayer(l));
  segLayers = [];
}

async function renderSegments(body, vis) {
  clearSegLayers();
  body.innerHTML = '<div class="section-label">Shared road segments</div>';

  const pairs = [];
  for (let i = 0; i < vis.length; i++)
    for (let j = i + 1; j < vis.length; j++) pairs.push([vis[i], vis[j]]);

  const uncached = pairs.filter(([A, B]) => !segCache.has(A.id + '|' + B.id));
  if (uncached.length) loader(true, 'Detecting shared segments…');
  for (const [A, B] of uncached) segCache.set(A.id + '|' + B.id, await detectSharedSegments(A, B));
  loader(false);

  // Bail if the user navigated away while we were computing
  if (view !== 'compare' || compareTab !== 'segments' || !body.isConnected) return;

  const allSegs = [];
  pairs.forEach(([A, B]) => {
    segCache.get(A.id + '|' + B.id).forEach(seg => {
      let distKm = 0;
      for (let i = 1; i < seg.length; i++) distKm += haversine(seg[i-1], seg[i]);
      const eles = seg.map(p => p.ele || 0);
      const eleGain = eles.reduce((acc, e, i) => i === 0 ? acc : acc + Math.max(0, e - eles[i-1]), 0);
      const hrs = seg.map(p => p.hr).filter(v => v > 30 && v < 250);
      const spds = seg.map(p => p.speed).filter(v => v > 0 && v < 120);
      allSegs.push({
        rideA: A, rideB: B, points: seg,
        distance: distKm, eleGain,
        avgHr: hrs.length ? hrs.reduce((a,b)=>a+b,0)/hrs.length : null,
        avgSpeed: spds.length ? spds.reduce((a,b)=>a+b,0)/spds.length : null,
      });
    });
  });

  // Sort by distance (longest first)
  allSegs.sort((a, b) => b.distance - a.distance);

  if (!allSegs.length) {
    body.insertAdjacentHTML('beforeend', '<div class="insight">No shared sections found within 50 m — these rides don\'t overlap on the same roads.</div>');
    return;
  }
  body.insertAdjacentHTML('beforeend', `<div class="note">${allSegs.length} shared segment${allSegs.length !== 1 ? 's' : ''}, longest first. Tap one to zoom.</div>`);

  allSegs.forEach((s, idx) => {
    const latlngs = simplifyRDP(s.points, SIMPLIFY_M).map(i => [s.points[i].lat, s.points[i].lng]);
    const layer = L.polyline(latlngs, {renderer:routeRenderer, color:'#F8FAFC', weight:5, opacity:.9, dashArray:'2 8', lineCap:'round', interactive:false}).addTo(map);
    segLayers.push(layer);
    const stats = [];
    if (s.avgSpeed) stats.push(Math.round(s.avgSpeed)+' km/h');
    if (s.avgHr) stats.push(Math.round(s.avgHr)+' bpm');
    if (s.eleGain > 5) stats.push('↑'+Math.round(s.eleGain)+' m');
    const row = document.createElement('button');
    row.className = 'seg-row';
    row.innerHTML = `
      <span class="seg-dots"><i style="background:${s.rideA.color}"></i><i style="background:${s.rideB.color}"></i></span>
      <span class="seg-main">
        <b>Segment ${idx+1}</b>
        <small>${esc(s.rideA.name)} ↔ ${esc(s.rideB.name)}</small>
      </span>
      <span class="seg-num">
        <b>${fmtNum(s.distance, 1)} km</b>
        ${stats.length ? '<small>'+stats.join(' · ')+'</small>' : ''}
      </span>`;
    row.onclick = () => map.flyToBounds(layer.getBounds(), {...mapPadding(), maxZoom:17, duration:.7});
    body.appendChild(row);
  });
}
