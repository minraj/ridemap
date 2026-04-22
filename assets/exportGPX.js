/* ═══════════════════════════════════════════════════════════════
   GPX EXPORT
═══════════════════════════════════════════════════════════════ */
function exportGPX() {
  const vis = rides.filter(r => r.visible);
  if (!vis.length) { toast('No rides to export', 'err'); return; }
  vis.forEach(r => {
    const trkpts = r.points.map(p => {
      const timeStr = p.ts ? '<time>' + p.ts.toISOString() + '</time>' : '';
      const hr   = p.hr    ? '<gpxtpx:hr>'    + p.hr    + '</gpxtpx:hr>'    : '';
      const cad  = p.cad   ? '<gpxtpx:cad>'   + p.cad   + '</gpxtpx:cad>'   : '';
      const pwr  = p.power ? '<gpxtpx:power>' + p.power + '</gpxtpx:power>' : '';
      const exts = (hr||cad||pwr) ? '<extensions><gpxtpx:TrackPointExtension>' + hr + cad + pwr + '</gpxtpx:TrackPointExtension></extensions>' : '';
      return '<trkpt lat="' + p.lat.toFixed(7) + '" lon="' + p.lng.toFixed(7) + '"><ele>' + (p.ele||0).toFixed(1) + '</ele>' + timeStr + exts + '</trkpt>';
    }).join('\n    ');
    const gpx = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="RideComp v' + VER + '" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">\n  <trk><name>' + esc(r.name) + '</name><trkseg>\n    ' + trkpts + '\n  </trkseg></trk>\n</gpx>';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([gpx], {type:'application/gpx+xml'}));
    a.download = r.name.replace(/[^a-z0-9_-]/gi, '_') + '.gpx';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  toast('Exported ' + vis.length + ' GPX file(s)', 'ok');
}

/* ═══════════════════════════════════════════════════════════════
   SEGMENT DETECTION — shared road sections between rides
═══════════════════════════════════════════════════════════════ */
function detectSharedSegments(rideA, rideB, thresholdM) {
  if (thresholdM === undefined) thresholdM = 50;
  const shared = [];
  let inSeg = false, segStart = null;
  const step = Math.max(1, Math.floor(rideA.points.length / 500));
  for (let i = 0; i < rideB.points.length; i++) {
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

function renderSegments(body, vis) {
  const lbl = document.createElement('div');
  lbl.className = 'slbl'; lbl.textContent = 'Shared road segments';
  body.appendChild(lbl);
  if (vis.length < 2) {
    const el = document.createElement('div'); el.className = 'ins';
    el.innerHTML = '<b>Load 2+ rides</b> to detect shared road sections.';
    body.appendChild(el); return;
  }
  if (window._segLayers) { window._segLayers.forEach(l => map.removeLayer(l)); }
  window._segLayers = [];
  let totalFound = 0;
  for (let i = 0; i < vis.length; i++) {
    for (let j = i + 1; j < vis.length; j++) {
      const A = vis[i], B = vis[j];
      const segs = detectSharedSegments(A, B);
      segs.forEach((seg, k) => {
        totalFound++;
        const layer = L.polyline(seg.map(p => [p.lat, p.lng]), {color:'#ffffff', weight:4, opacity:.6, dashArray:'8 4'}).addTo(map);
        window._segLayers.push(layer);
        const distKm = seg.length > 1 ? haversine(seg[0], seg[seg.length-1]).toFixed(1) : '?';
        const row = document.createElement('div'); row.className = 'seg-row';
        row.innerHTML = '<div class="seg-dot" style="background:' + A.color + '"></div><div class="seg-dot" style="background:' + B.color + '"></div><div style="flex:1;font-size:10px">Seg ' + (k+1) + ': ' + esc(A.name) + ' ↔ ' + esc(B.name) + '</div><div style="font-size:9px;color:var(--mu)">' + distKm + ' km</div>';
        row.onclick = () => map.fitBounds(layer.getBounds(), {padding:[30,30]});
        body.appendChild(row);
      });
    }
  }
  if (totalFound === 0) {
    const el = document.createElement('div'); el.className = 'ins';
    el.textContent = 'No shared sections found within 50m. Rides do not appear to overlap.';
    body.appendChild(el);
  }
}

/* ═══════════════════════════════════════════════════════════════
   LAP PARSING (FIT global msg 19)
═══════════════════════════════════════════════════════════════ */
function parseFITLaps(bytes, dv) {
  const headerLen = bytes[0];
  const dataSize  = dv.getUint32(4, true);
  const fileEnd   = Math.min(headerLen + dataSize, bytes.length);
  const defs = {}, laps = [];
  let off = headerLen;
  while (off < fileEnd - 1) {
    if (off >= bytes.length) break;
    const rh = bytes[off++];
    const compressed = (rh & 0x80) !== 0;
    const isDef = !compressed && (rh & 0x40) !== 0;
    const hasDev = !compressed && (rh & 0x20) !== 0;
    const localNum = compressed ? (rh >> 5) & 0x03 : (rh & 0x0F);
    if (compressed) { const d = defs[localNum]; if (d) off += d.size; continue; }
    if (isDef) {
      if (off + 5 > bytes.length) break;
      off++;
      const le = bytes[off++] === 0;
      const gmn = le ? dv.getUint16(off,true) : dv.getUint16(off,false); off += 2;
      const nf = bytes[off++]; const fields = []; let size = 0;
      for (let i = 0; i < nf; i++) { if (off+3>bytes.length) break; fields.push({fd:bytes[off],fs:bytes[off+1],bt:bytes[off+2]}); size+=bytes[off+1]; off+=3; }
      if (hasDev) { const nd = bytes[off++]; for (let i=0;i<nd;i++){if(off+3>bytes.length)break;size+=bytes[off+1];off+=3;} }
      defs[localNum] = {gmn, fields, size, le};
    } else {
      const d = defs[localNum];
      if (!d) { off++; continue; }
      if (d.gmn === 19) {
        let fo = off; const p = {};
        for (const {fd,fs,bt} of d.fields) {
          if (fo+fs>bytes.length) break;
          p[fd] = readVal(dv, bytes, fo, fs, bt, d.le); fo += fs;
        }
        const lap = {
          totalTime: p[9]  != null ? p[9]/1000   : null,
          distance:  p[7]  != null ? p[7]/100000  : null,
          avgHr:     (p[16]!= null && p[16]<250)  ? p[16] : null,
          avgCad:    (p[18]!= null && p[18]<220)  ? p[18] : null,
          avgSpeed:  p[13] != null ? Math.round(p[13]/1000*3.6*10)/10 : null,
        };
        if (lap.totalTime && lap.totalTime > 5) laps.push(lap);
      }
      off += d.size;
    }
  }
  return laps;
}

/* ═══════════════════════════════════════════════════════════════
   THEME TOGGLE
═══════════════════════════════════════════════════════════════ */
function toggleTheme() {
  const html = document.documentElement;
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('ridecomp_theme', next);
}

/* ═══════════════════════════════════════════════════════════════
   MOBILE PANEL TOGGLE
═══════════════════════════════════════════════════════════════ */
function toggleMobPanel(id) {
  const el    = document.getElementById(id);
  const other = id === 'sidebar' ? 'sp' : 'sidebar';
  el.classList.toggle('mob-open');
  document.getElementById(other).classList.remove('mob-open');
}

