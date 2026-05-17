/**
 * ridemap-patch.js  (v4 — clean)
 *
 * What this file does:
 *   1. Theme → tile sync  (FIX 1)
 *      script.js always initialises with 'dark' tile. We detect the active
 *      OS / stored theme and click the matching tile button after initMap().
 *      toggleTheme() is wrapped to keep tile and theme in sync.
 *
 *   2. Sidebar layout management  (FIX 3)
 *      Toggle buttons appended to #main / #map-panel (NOT inside the panels)
 *      so overflow:hidden cannot clip them. Positioned via CSS custom
 *      properties --sbw / --stw / --chh that track live panel size.
 *
 * What was REMOVED vs v2/v3:
 *   - patchSetTileLayer()   — attempted to override window.setTileLayer,
 *                             which never worked because script.js calls
 *                             setTileLayer() via its own lexical scope.
 *   - hookTileButtons()     — attached click listeners to work around the
 *                             above and call repairSteepPolys().
 *   - repairSteepPolys()    — re-applied bringToFront() on steep segment
 *                             overlays after tile switch.
 *
 *   All of the above are now unnecessary because ENABLE_DIFFICULTY_SEGMENTS
 *   is set to false in script.js — buildClimbPolylines() returns [] so no
 *   steep overlay polylines are ever created. The route colouring is purely
 *   file-based (one solid colour per ride) and persists across all tile
 *   changes via the corrected map.hasLayer(r.group) guard in setTileLayer().
 */
(function () {
  'use strict';

  /* ── Storage ────────────────────────────────────────────────── */
  function lsSet(k, v) { try { localStorage.setItem('rmp_' + k, String(v)); } catch (_) {} }
  function lsGet(k, fb) {
    try { var v = localStorage.getItem('rmp_' + k); return v !== null ? v : fb; }
    catch (_) { return fb; }
  }

  /* ── DOM helper ─────────────────────────────────────────────── */
  function el(tag, props, parent) {
    var e = document.createElement(tag);
    if (props.id)        e.id          = props.id;
    if (props.className) e.className   = props.className;
    if (props.title)     e.title       = props.title;
    if (props.text)      e.textContent = props.text;
    if (parent) parent.appendChild(e);
    return e;
  }

  /* ── Layout invalidation ────────────────────────────────────── */
  function adjustLayout() {
    if (window.map && typeof window.map.invalidateSize === 'function') {
      window.map.invalidateSize({ animate: false });
    }
    var canvas = document.getElementById('pc');
    if (canvas) {
      try { var c = Chart.getChart(canvas); if (c) c.resize(); } catch (_) {}
    }
  }
  function adjustLayoutDelayed(ms) {
    clearTimeout(window.rmLayoutTimer);
    window.rmLayoutTimer = setTimeout(adjustLayout, ms || 280);
  }

  /* ── Drag-to-resize ─────────────────────────────────────────── */
  function makeDraggable(handle, opts) {
    var startPos, startSize;
    function start(cx, cy) {
      startPos  = opts.axis === 'x' ? cx : cy;
      startSize = opts.getSize();
      handle.classList.add('rm-drag');
      opts.panel.classList.add('rm-drag-active');
      document.body.style.userSelect = 'none';
    }
    function move(cx, cy) {
      var cur   = opts.axis === 'x' ? cx : cy;
      var delta = opts.invert ? startPos - cur : cur - startPos;
      opts.setSize(startSize + delta);
    }
    function end() {
      handle.classList.remove('rm-drag');
      opts.panel.classList.remove('rm-drag-active');
      document.body.style.userSelect = '';
      adjustLayoutDelayed(50);
    }
    handle.addEventListener('mousedown', function (e) {
      e.preventDefault(); start(e.clientX, e.clientY);
      function mm(ev) { move(ev.clientX, ev.clientY); }
      function mu()   { end(); document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); }
      document.addEventListener('mousemove', mm);
      document.addEventListener('mouseup', mu);
    });
    handle.addEventListener('touchstart', function (e) {
      var t = e.touches[0]; start(t.clientX, t.clientY);
      function tm(ev) { var tt = ev.touches[0]; move(tt.clientX, tt.clientY); }
      function te()   { end(); handle.removeEventListener('touchmove', tm); handle.removeEventListener('touchend', te); }
      handle.addEventListener('touchmove', tm, { passive: true });
      handle.addEventListener('touchend', te);
    }, { passive: true });
  }

  /* ═══════════════════════════════════════════════════════════════
     1. THEME → TILE SYNC
     ═══════════════════════════════════════════════════════════════ */

  function activeTheme() {
    var attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark' || attr === 'light') return attr;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  /**
   * Clicks the correct tile button to match the current theme.
   * Using btn.click() ensures the original setTile() in script.js runs
   * (updates currentTile, chip state, etc.).
   */
  function syncTileToTheme() {
    var targetTile = activeTheme() === 'dark' ? 'dark' : 'street';
    document.querySelectorAll('#mc .mb').forEach(function (b) {
      if (b.textContent.trim().toLowerCase() === targetTile) b.click();
    });
  }

  function hookToggleTheme() {
    if (typeof window.toggleTheme !== 'function') return;
    var orig = window.toggleTheme;
    window.toggleTheme = function () {
      orig();                          /* updates data-theme synchronously */
      setTimeout(syncTileToTheme, 30);
    };
  }

  /* ═══════════════════════════════════════════════════════════════
     2. LEFT SIDEBAR — 3-state (expanded → mini → hidden)
     ═══════════════════════════════════════════════════════════════ */
  function setupSidebar() {
    var panel  = document.getElementById('sidebar');
    var mainEl = document.getElementById('main');
    if (!panel || !mainEl) return;

    var STATES = ['expanded', 'mini', 'hidden'];
    var MINI_W = 56;
    function getExpandedW() { var w = parseInt(lsGet('sb_w','0'),10); return w>120 ? w : 268; }

    /* Handle stays INSIDE panel at right:0 (never clipped) */
    var rh  = el('div', { id:'rm-sb-rh',  className:'rm-rh rm-v' }, panel);
    /* Toggle is a child of #main — left:var(--sbw) tracks panel width */
    var tog = el('div', { id:'rm-sb-tog', className:'rm-toggle', title:'Toggle sidebar' }, mainEl);

    function applyState(s, skip) {
      panel.dataset.sbState = s;
      if (skip) panel.classList.add('rm-drag-active');
      if (s === 'expanded') {
        var w = getExpandedW();
        panel.style.width = w + 'px';
        document.documentElement.style.setProperty('--sbw', w + 'px');
        tog.textContent = '≡'; tog.title = 'Collapse to icon rail';
        rh.style.pointerEvents = 'auto';
      } else if (s === 'mini') {
        panel.style.width = MINI_W + 'px';
        document.documentElement.style.setProperty('--sbw', MINI_W + 'px');
        tog.textContent = '◀'; tog.title = 'Hide sidebar';
        rh.style.pointerEvents = 'none';
      } else {
        panel.style.width = '0px';
        document.documentElement.style.setProperty('--sbw', '0px');
        tog.textContent = '▶'; tog.title = 'Show sidebar';
        rh.style.pointerEvents = 'none';
      }
      if (skip) { void panel.offsetWidth; panel.classList.remove('rm-drag-active'); }
      lsSet('sb_state', s);
      adjustLayoutDelayed();
    }

    tog.addEventListener('click', function () {
      var cur = panel.dataset.sbState || 'expanded';
      applyState(STATES[(STATES.indexOf(cur) + 1) % STATES.length]);
    });

    makeDraggable(rh, {
      axis:'x', invert:false, panel:panel,
      getSize: function () { return panel.getBoundingClientRect().width; },
      setSize: function (w) {
        if (panel.dataset.sbState !== 'expanded') return;
        var v = Math.max(200, Math.min(520, w));
        panel.style.width = v + 'px';
        document.documentElement.style.setProperty('--sbw', v + 'px');
        lsSet('sb_w', v);
      }
    });

    var saved = lsGet('sb_state', 'expanded');
    applyState(STATES.indexOf(saved) >= 0 ? saved : 'expanded', true);
  }

  /* ═══════════════════════════════════════════════════════════════
     3. RIGHT SIDEBAR / STATS — 2-state (visible ↔ hidden)
     ═══════════════════════════════════════════════════════════════ */
  function setupStatsPanel() {
    var panel  = document.getElementById('sp');
    var mainEl = document.getElementById('main');
    if (!panel || !mainEl) return;

    var savedW = parseInt(lsGet('sp_w','0'),10);
    if (savedW > 120) panel.style.width = savedW + 'px';

    /* Handle inside panel at left:0 */
    var rh  = el('div', { id:'rm-sp-rh',  className:'rm-rh rm-v' }, panel);
    /* Toggle is a child of #main — right:var(--stw) tracks panel width */
    var tog = el('div', { id:'rm-sp-tog', className:'rm-toggle', title:'Toggle stats panel' }, mainEl);

    function getW() { var w = parseInt(lsGet('sp_w','0'),10); return w>120 ? w : 284; }

    function setCol(col, skip) {
      if (skip) panel.classList.add('rm-drag-active');
      if (col) {
        panel.classList.add('rm-col');
        document.documentElement.style.setProperty('--stw', '0px');
        tog.textContent = '◀'; tog.title = 'Show stats panel';
      } else {
        panel.classList.remove('rm-col');
        var w = getW();
        panel.style.width = w + 'px';
        document.documentElement.style.setProperty('--stw', w + 'px');
        tog.textContent = '▶'; tog.title = 'Hide stats panel';
      }
      if (skip) { void panel.offsetWidth; panel.classList.remove('rm-drag-active'); }
      lsSet('sp_col', col ? '1' : '0');
      adjustLayoutDelayed();
    }

    tog.addEventListener('click', function () { setCol(!panel.classList.contains('rm-col')); });

    makeDraggable(rh, {
      axis:'x', invert:true, panel:panel,
      getSize: function () { return panel.getBoundingClientRect().width; },
      setSize: function (w) {
        var v = Math.max(200, Math.min(560, w));
        panel.style.width = v + 'px';
        document.documentElement.style.setProperty('--stw', v + 'px');
        lsSet('sp_w', v);
      }
    });

    setCol(lsGet('sp_col','0') === '1', true);
  }

  /* ═══════════════════════════════════════════════════════════════
     4. CHART BAR — 2-state + continuous height resize
     ═══════════════════════════════════════════════════════════════ */
  function setupChartBar() {
    var panel    = document.getElementById('cs');
    var mapPanel = document.getElementById('map-panel');
    if (!panel || !mapPanel) return;

    var savedH = parseInt(lsGet('cs_h','0'),10);
    if (savedH > 60) panel.style.height = savedH + 'px';

    /* Handle inside panel at top:0 */
    var rh  = el('div', { id:'rm-cs-rh',  className:'rm-rh rm-h' }, panel);
    /* Toggle is a child of #map-panel — bottom:var(--chh) tracks panel height */
    var tog = el('div', { id:'rm-cs-tog', className:'rm-toggle', title:'Toggle elevation profile' }, mapPanel);

    function getH() { var h = parseInt(lsGet('cs_h','0'),10); return h>60 ? h : 150; }

    function setCol(col, skip) {
      if (skip) panel.classList.add('rm-drag-active');
      if (col) {
        panel.classList.add('rm-col');
        document.documentElement.style.setProperty('--chh', '0px');
        tog.textContent = '▲'; tog.title = 'Show elevation profile';
      } else {
        panel.classList.remove('rm-col');
        var h = getH();
        panel.style.height = h + 'px';
        document.documentElement.style.setProperty('--chh', h + 'px');
        tog.textContent = '▼'; tog.title = 'Hide elevation profile';
      }
      if (skip) { void panel.offsetWidth; panel.classList.remove('rm-drag-active'); }
      lsSet('cs_col', col ? '1' : '0');
      adjustLayoutDelayed();
    }

    tog.addEventListener('click', function () { setCol(!panel.classList.contains('rm-col')); });

    makeDraggable(rh, {
      axis:'y', invert:true, panel:panel,
      getSize: function () { return panel.getBoundingClientRect().height; },
      setSize: function (h) {
        var v = Math.max(80, Math.min(480, h));
        panel.style.height = v + 'px';
        document.documentElement.style.setProperty('--chh', v + 'px');
        lsSet('cs_h', v);
      }
    });

    setCol(lsGet('cs_col','0') === '1', true);
  }

  /* ── Export ─────────────────────────────────────────────────── */
  window.rmAdjustLayout = adjustLayout;

  /* ── Boot ───────────────────────────────────────────────────── */
  function boot() {
    setupSidebar();
    setupStatsPanel();
    setupChartBar();
    setTimeout(hookToggleTheme, 0);   /* after script.js defines toggleTheme */
    setTimeout(syncTileToTheme, 200); /* after initMap() completes */
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
