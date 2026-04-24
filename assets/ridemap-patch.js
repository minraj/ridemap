/**
 * ridemap-patch.js
 * Adds resizable + collapsible panels to RideComp.
 * Polyline visibility is handled directly in script.js setTileLayer().
 * Runs after DOMContentLoaded; no dependency on script.js internals.
 */
(function () {
  'use strict';

  /* ── Storage helpers ──────────────────────────────────── */
  function lsSet(k, v) { try { localStorage.setItem('rmp_' + k, String(v)); } catch (_) {} }
  function lsGet(k, fb) { try { var v = localStorage.getItem('rmp_' + k); return v !== null ? v : fb; } catch (_) { return fb; } }

  /* ── Create element helper ────────────────────────────── */
  function el(tag, props, parent) {
    var e = document.createElement(tag);
    if (props.id)        e.id        = props.id;
    if (props.className) e.className = props.className;
    if (props.title)     e.title     = props.title;
    if (props.text)      e.textContent = props.text;
    if (parent) parent.appendChild(e);
    return e;
  }

  /* ── Global layout adjustment for all panels ───────────────── */
  function adjustLayout() {
    if (window.map && typeof window.map.invalidateSize === 'function') {
      window.map.invalidateSize({ animate: false });
    }
    var chart = document.getElementById('pc');
    if (chart) {
      try {
        var c = Chart.getChart(chart);
        if (c) c.resize();
      } catch (_) {}
    }
  }

  /* ── Delayed layout for after CSS transitions ───────────────── */
  function adjustLayoutDelayed() {
    clearTimeout(window.rmLayoutTimer);
    window.rmLayoutTimer = setTimeout(adjustLayout, 320);
  }

  /* ── Drag-to-resize ───────────────────────────────────── */
  function makeDraggable(handle, opts) {
    // opts: { axis:'x'|'y', invert:bool, panel:el, getSize:fn, setSize:fn }
    var startPos, startSize;

    function start(cx, cy) {
      startPos  = opts.axis === 'x' ? cx : cy;
      startSize = opts.getSize();
      handle.classList.add('rm-drag');
      opts.panel.classList.add('rm-drag-active');
    }
    function move(cx, cy) {
      var cur   = opts.axis === 'x' ? cx : cy;
      var delta = opts.invert ? startPos - cur : cur - startPos;
      opts.setSize(startSize + delta);
    }
    function end() {
      handle.classList.remove('rm-drag');
      opts.panel.classList.remove('rm-drag-active');
      adjustLayoutDelayed();
    }

    handle.addEventListener('mousedown', function (e) {
      e.preventDefault();
      start(e.clientX, e.clientY);
      function mm(e) { move(e.clientX, e.clientY); }
      function mu()  { end(); document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); }
      document.addEventListener('mousemove', mm);
      document.addEventListener('mouseup', mu);
    });
    handle.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      start(t.clientX, t.clientY);
      function tm(e) { var t = e.touches[0]; move(t.clientX, t.clientY); }
      function te()  { end(); handle.removeEventListener('touchmove', tm); handle.removeEventListener('touchend', te); }
      handle.addEventListener('touchmove', tm, {passive: true});
      handle.addEventListener('touchend', te);
    }, {passive: true});
  }

  /* ═══ SIDEBAR (left) ══════════════════════════════════════════ */
  function setupSidebar() {
    var panel = document.getElementById('sidebar');
    if (!panel) return;

    var sw = lsGet('sb_w', null);
    if (sw) panel.style.width = parseInt(sw) + 'px';

    var rh = el('div', {id:'rm-sb-rh', className:'rm-rh rm-v'}, panel);
    var tog = el('div', {id:'rm-sb-tog', className:'rm-toggle', title:'Toggle sidebar'}, panel);

    if (lsGet('sb_col', '0') === '1') {
      panel.classList.add('rm-col');
      tog.textContent = '▶';
      document.documentElement.style.setProperty('--sbw', '0px');
    } else {
      tog.textContent = '◀';
      var w = lsGet('sb_w', '268');
      document.documentElement.style.setProperty('--sbw', w + 'px');
    }

    makeDraggable(rh, {
      axis: 'x', invert: false, panel: panel,
      getSize: function () { return panel.getBoundingClientRect().width; },
      setSize: function (w) {
        var v = Math.max(180, Math.min(500, w));
        panel.style.width = v + 'px';
        lsSet('sb_w', v);
      }
    });

    tog.addEventListener('click', function () {
      var col = panel.classList.toggle('rm-col');
      tog.textContent = col ? '▶' : '◀';
      lsSet('sb_col', col ? '1' : '0');
      if (col) {
        document.documentElement.style.setProperty('--sbw', '0px');
      } else {
        var w = lsGet('sb_w', '268');
        document.documentElement.style.setProperty('--sbw', w + 'px');
      }
      adjustLayoutDelayed();
    });
  }

  /* ═══ STATS PANEL (right) ═══════════════════════════════════ */
  function setupStatsPanel() {
    var panel = document.getElementById('sp');
    if (!panel) return;

    var sw = lsGet('sp_w', null);
    if (sw) panel.style.width = parseInt(sw) + 'px';

    var rh = el('div', {id:'rm-sp-rh', className:'rm-rh rm-v'}, panel);
    var tog = el('div', {id:'rm-sp-tog', className:'rm-toggle', title:'Toggle stats panel'}, panel);

    if (lsGet('sp_col', '0') === '1') {
      panel.classList.add('rm-col');
      tog.textContent = '▶';
      document.documentElement.style.setProperty('--stw', '0px');
    } else {
      tog.textContent = '◀';
      var w = lsGet('sp_w', '282');
      document.documentElement.style.setProperty('--stw', w + 'px');
    }

    makeDraggable(rh, {
      axis: 'x', invert: true, panel: panel,
      getSize: function () { return panel.getBoundingClientRect().width; },
      setSize: function (w) {
        var v = Math.max(180, Math.min(540, w));
        panel.style.width = v + 'px';
        lsSet('sp_w', v);
      }
    });

    tog.addEventListener('click', function () {
      var col = panel.classList.toggle('rm-col');
      tog.textContent = col ? '◀' : '▶';
      lsSet('sp_col', col ? '1' : '0');
      if (col) {
        document.documentElement.style.setProperty('--stw', '0px');
      } else {
        var w = lsGet('sp_w', '282');
        document.documentElement.style.setProperty('--stw', w + 'px');
      }
      adjustLayoutDelayed();
    });
  }

  /* ═══ CHART BAR (bottom) ═══════════════════════════════════ */
  function setupChartBar() {
    var panel = document.getElementById('cs');
    if (!panel) return;

    var sh = lsGet('cs_h', null);
    if (sh) panel.style.height = parseInt(sh) + 'px';

    var rh = el('div', {id:'rm-cs-rh', className:'rm-rh rm-h'}, panel);
    var tog = el('div', {id:'rm-cs-tog', className:'rm-toggle', title:'Toggle chart'}, panel);

    if (lsGet('cs_col', '0') === '1') {
      panel.classList.add('rm-col');
      tog.textContent = '▲';
      document.documentElement.style.setProperty('--chh', '0px');
    } else {
      tog.textContent = '▼';
      var h = lsGet('cs_h', '146');
      document.documentElement.style.setProperty('--chh', h + 'px');
    }

    makeDraggable(rh, {
      axis: 'y', invert: true, panel: panel,
      getSize: function () { return panel.getBoundingClientRect().height; },
      setSize: function (h) {
        var v = Math.max(80, Math.min(440, h));
        panel.style.height = v + 'px';
        lsSet('cs_h', v);
      }
    });

    tog.addEventListener('click', function () {
      var col = panel.classList.toggle('rm-col');
      tog.textContent = col ? '▲' : '▼';
      lsSet('cs_col', col ? '1' : '0');
      if (col) {
        document.documentElement.style.setProperty('--chh', '0px');
      } else {
        var h = lsGet('cs_h', '146');
        document.documentElement.style.setProperty('--chh', h + 'px');
      }
      adjustLayoutDelayed();
    });
  }

  /* ── Expose global layout function ───────────────────────────── */
  window.rmAdjustLayout = adjustLayout;

  /* ── Boot ─────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setupSidebar();
      setupStatsPanel();
      setupChartBar();
    });
  } else {
    setupSidebar();
    setupStatsPanel();
    setupChartBar();
  }

})();
