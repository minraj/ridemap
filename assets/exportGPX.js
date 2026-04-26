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

async function renderSegments(body, vis) {
  const lbl = document.createElement('div');
  lbl.className = 'slbl'; lbl.textContent = 'Shared road segments';
  body.appendChild(lbl);
  if (vis.length < 2) {
    const el = document.createElement('div'); el.className = 'ins';
    el.innerHTML = '<b>Load 2+ rides</b> to detect shared road sections.';
    body.appendChild(el); return;
  }
  if (_segLayers) { _segLayers.forEach(l => map.removeLayer(l)); }
  _segLayers = [];

  loader(true, 'Detecting shared segments…');

  // Collect all segments with metadata
  const allSegs = [];
  for (let i = 0; i < vis.length; i++) {
    for (let j = i + 1; j < vis.length; j++) {
      const A = vis[i], B = vis[j];
      const segs = await detectSharedSegments(A, B);
      segs.forEach((seg, k) => {
        const distKm = seg.length > 1 ? haversine(seg[0], seg[seg.length-1]) : 0;
        // Calculate segment stats
        const eles = seg.map(p => p.ele || 0);
        const eleGain = eles.reduce((acc, e, i) => i === 0 ? acc : acc + Math.max(0, e - eles[i-1]), 0);
        const hrs = seg.map(p => p.hr).filter(v => v > 30 && v < 250);
        const spds = seg.map(p => p.speed).filter(v => v > 0 && v < 120);
        allSegs.push({
          rideA: A, rideB: B, segIndex: k, points: seg,
          distance: distKm, eleGain,
          avgHr: hrs.length ? hrs.reduce((a,b)=>a+b,0)/hrs.length : null,
          avgSpeed: spds.length ? spds.reduce((a,b)=>a+b,0)/spds.length : null,
        });
      });
    }
  }
  loader(false);

  // Sort by distance (longest first)
  allSegs.sort((a, b) => b.distance - a.distance);

  let totalFound = allSegs.length;
  allSegs.forEach((s, idx) => {
    const layer = L.polyline(s.points.map(p => [p.lat, p.lng]), {color:'#ffffff', weight:4, opacity:.6, dashArray:'8 4'}).addTo(map);
    _segLayers.push(layer);
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const row = document.createElement('div'); row.className = 'seg-row';
    const stats = [];
    if (s.avgSpeed) stats.push(Math.round(s.avgSpeed)+' km/h');
    if (s.avgHr) stats.push(Math.round(s.avgHr)+' bpm');
    if (s.eleGain > 5) stats.push('↑'+Math.round(s.eleGain)+'m');
    row.innerHTML = `
      <div class="seg-dot" style="background:${s.rideA.color}"></div>
      <div class="seg-dot" style="background:${s.rideB.color}"></div>
      <div style="flex:1;font-size:10px">
        <div style="font-weight:600;color:var(--tx)">Segment ${idx+1}</div>
        <div style="color:var(--mu);font-size:9px">${esc(s.rideA.name)} ↔ ${esc(s.rideB.name)}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:10px;color:var(--tx);font-weight:600">${s.distance.toFixed(1)} km</div>
        ${stats.length ? '<div style="font-size:8px;color:var(--mu)">'+stats.join(' · ')+'</div>' : ''}
      </div>`;
    row.onclick = () => map.fitBounds(layer.getBounds(), {padding:[30,30]});
    body.appendChild(row);
    // Update segment style based on theme
    layer.setStyle({
      color: isDark ? '#ffffff' : '#333333',
      weight: isDark ? 5 : 4,
      opacity: isDark ? 0.85 : 0.7,
      dashArray: isDark ? '6 6' : '8 4'
    });
  });

  if (totalFound === 0) {
    const el = document.createElement('div'); el.className = 'ins';
    el.innerHTML = 'No shared sections found within 50m. Rides do not appear to overlap on the same roads.';
    body.appendChild(el);
  } else {
    const summary = document.createElement('div');
    summary.className = 'insl';
    summary.textContent = `Found ${totalFound} shared segment${totalFound!==1?'s':''} (sorted by length)`;
    body.insertBefore(summary, body.firstChild);
  }
}

/* ═══════════════════════════════════════════════════════════════
   LAP PARSING (FIT global msg 19)
 ═══════════════════════════════════════════════════════════════ */
// (Removed parseFITLaps)



/* ═══════════════════════════════════════════════════════════════
   MOBILE PANEL TOGGLE
═══════════════════════════════════════════════════════════════ */
function toggleMobPanel(id) {
  const el    = document.getElementById(id);
  const other = id === 'sidebar' ? 'sp' : 'sidebar';
  const isOpen = el.classList.contains('mob-open');
  // Close all first
  closeAllPanels();
  // If it was closed, open it
  if (!isOpen) {
    el.classList.add('mob-open');
    document.getElementById('mob-overlay').classList.add('mob-open');
  }
}
function closeAllPanels() {
  document.getElementById('sidebar').classList.remove('mob-open');
  document.getElementById('sp').classList.remove('mob-open');
  document.getElementById('mob-overlay').classList.remove('mob-open');
}

function openHelp() {
  document.getElementById('help-mb').style.display = 'flex';
}
function closeHelpBg(e) {
  if (e.target === document.getElementById('help-mb')) {
    document.getElementById('help-mb').style.display = 'none';
  }
}

