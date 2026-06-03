/* ═══════════════════════════════════════════════════════════════════
   ridemap-patch.js — spatial edition
   Manages three resizable, collapsible floating panels:
     #sidebar  (left)    ←→ resize + tri-state toggle
     #sp       (right)   ←→ resize + binary toggle
     #cs       (bottom)  ↑↓ resize + binary toggle
   Panels are position:fixed glass elements (see style.css).
   Toggle tabs are appended to <body> and also position:fixed.
   CSS custom properties drive dependent layout:
     --sbw  sidebar panel width   (set here → CSS reads it)
     --stw  stats panel width
     --chh  chart panel height
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Tiny helpers ────────────────────────────────────────────── */
  function lsGet(k, def) { try { return localStorage.getItem('rmp_' + k) ?? def; } catch (_) { return def; } }
  function lsSet(k, v)   { try { localStorage.setItem('rmp_' + k, v); } catch (_) {} }

  function el(tag, props, parent) {
    var e = document.createElement(tag);
    Object.assign(e, props);
    if (parent) parent.appendChild(e);
    return e;
  }

  function setCssVar(name, value) {
    document.documentElement.style.setProperty(name, value);
  }

  /* Call map.invalidateSize() + chart.resize() after layout changes */
  function adjustLayout() {
    if (window.map && typeof window.map.invalidateSize === 'function') {
      window.map.invalidateSize({ animate: false });
    }
    var canvas = document.getElementById('pc');
    if (canvas) {
      try { var c = Chart.getChart(canvas); if (c) c.resize(); } catch (_) {}
    }
  }

  var _adjustTimer;
  function adjustLayoutDelayed() {
    clearTimeout(_adjustTimer);
    _adjustTimer = setTimeout(adjustLayout, 40);
  }

  /* ── Generic drag-resize ─────────────────────────────────────── */
  /* opts: { axis:'x'|'y', invert:bool, panel:el,
             getSize:fn, setSize:fn }                              */
  function makeDraggable(handle, opts) {
    var dragging = false;
    var startPos = 0;
    var startSize = 0;

    function onMove(e) {
      if (!dragging) return;
      var pos  = opts.axis === 'x' ? (e.clientX || (e.touches && e.touches[0].clientX) || 0)
                                   : (e.clientY || (e.touches && e.touches[0].clientY) || 0);
      var delta = opts.invert ? (startPos - pos) : (pos - startPos);
      opts.setSize(startSize + delta);
    }

    function onEnd() {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('rm-drag');
      opts.panel.classList.remove('rm-drag-active');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend',  onEnd);
      adjustLayoutDelayed();
    }

    handle.addEventListener('mousedown', function (e) {
      e.preventDefault();
      dragging   = true;
      startPos   = opts.axis === 'x' ? e.clientX : e.clientY;
      startSize  = opts.getSize();
      handle.classList.add('rm-drag');
      opts.panel.classList.add('rm-drag-active');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onEnd);
    });
    handle.addEventListener('touchstart', function (e) {
      dragging   = true;
      startPos   = opts.axis === 'x' ? e.touches[0].clientX : e.touches[0].clientY;
      startSize  = opts.getSize();
      handle.classList.add('rm-drag');
      opts.panel.classList.add('rm-drag-active');
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend',  onEnd);
    }, { passive: true });
  }

  /* ══════════════════════════════════════════════════════════════
     LEFT SIDEBAR  —  tri-state: expanded → mini → hidden
     ══════════════════════════════════════════════════════════════ */
  function setupSidebar() {
    var panel = document.getElementById('sidebar');
    if (!panel) return;

    var STATES    = ['expanded', 'mini', 'hidden'];
    var MINI_W    = 56;
    var DEFAULT_W = 268;

    function getExpandedW() {
      var saved = parseInt(lsGet('sb_w', '0'), 10);
      return saved > 120 ? saved : DEFAULT_W;
    }

    /* Resize handle (inside panel, right edge) */
    var rh = el('div', { id: 'rm-sb-rh', className: 'rm-rh rm-v' }, panel);

    /* Toggle tab (fixed to viewport, right of panel) — appended to body */
    var tog = el('div', {
      id:        'rm-sb-tog',
      className: 'rm-toggle',
      title:     'Toggle sidebar'
    }, document.body);

    /* Apply a state, optionally skipping CSS transitions */
    function applyState(s, skip) {
      if (STATES.indexOf(s) < 0) s = 'expanded';
      panel.dataset.sbState = s;

      if (skip) panel.classList.add('rm-drag-active');

      if (s === 'expanded') {
        var w = getExpandedW();
        panel.style.width = w + 'px';
        setCssVar('--sbw', w + 'px');
        tog.textContent = '‹';
        tog.title       = 'Collapse sidebar';
        rh.style.pointerEvents = 'auto';
      } else if (s === 'mini') {
        panel.style.width = MINI_W + 'px';
        setCssVar('--sbw', MINI_W + 'px');
        tog.textContent = '≡';
        tog.title       = 'Hide sidebar';
        rh.style.pointerEvents = 'none';
      } else {
        /* hidden */
        panel.style.width = '0px';
        setCssVar('--sbw', '0px');
        tog.textContent = '›';
        tog.title       = 'Show sidebar';
        rh.style.pointerEvents = 'none';
      }

      if (skip) {
        void panel.offsetWidth;          /* force reflow */
        panel.classList.remove('rm-drag-active');
      }

      lsSet('sb_state', s);
      adjustLayoutDelayed();
    }

    tog.addEventListener('click', function () {
      var cur = panel.dataset.sbState || 'expanded';
      var idx = STATES.indexOf(cur);
      applyState(STATES[(idx + 1) % STATES.length]);
    });

    makeDraggable(rh, {
      axis:    'x',
      invert:  false,
      panel:   panel,
      getSize: function () { return panel.getBoundingClientRect().width; },
      setSize: function (w) {
        if (panel.dataset.sbState !== 'expanded') return;
        var v = Math.max(180, Math.min(540, w));
        panel.style.width = v + 'px';
        setCssVar('--sbw', v + 'px');
        lsSet('sb_w', v);
        adjustLayoutDelayed();
      }
    });

    /* Restore saved state (no transition on first paint) */
    var saved = lsGet('sb_state', 'expanded');
    applyState(saved, true);
  }

  /* ══════════════════════════════════════════════════════════════
     RIGHT STATS PANEL  —  binary: visible → collapsed
     ══════════════════════════════════════════════════════════════ */
  function setupStatsPanel() {
    var panel = document.getElementById('sp');
    if (!panel) return;

    var DEFAULT_W = 284;
    function getW() {
      var saved = parseInt(lsGet('sp_w', '0'), 10);
      return saved > 120 ? saved : DEFAULT_W;
    }

    var rh = el('div', { id: 'rm-sp-rh', className: 'rm-rh rm-v' }, panel);
    var tog = el('div', {
      id:        'rm-sp-tog',
      className: 'rm-toggle',
      title:     'Toggle stats panel'
    }, document.body);

    function setCol(col, skip) {
      if (skip) panel.classList.add('rm-drag-active');

      if (col) {
        panel.classList.add('rm-col');
        setCssVar('--stw', '0px');
        tog.textContent = '‹';
        tog.title       = 'Show stats panel';
      } else {
        panel.classList.remove('rm-col');
        var w = getW();
        panel.style.width = w + 'px';
        setCssVar('--stw', w + 'px');
        tog.textContent = '›';
        tog.title       = 'Hide stats panel';
      }

      if (skip) {
        void panel.offsetWidth;
        panel.classList.remove('rm-drag-active');
      }

      lsSet('sp_col', col ? '1' : '0');
      adjustLayoutDelayed();
    }

    tog.addEventListener('click', function () {
      setCol(!panel.classList.contains('rm-col'));
    });

    makeDraggable(rh, {
      axis:    'x',
      invert:  true,
      panel:   panel,
      getSize: function () { return panel.getBoundingClientRect().width; },
      setSize: function (w) {
        if (panel.classList.contains('rm-col')) return;
        var v = Math.max(180, Math.min(560, w));
        panel.style.width = v + 'px';
        setCssVar('--stw', v + 'px');
        lsSet('sp_w', v);
        adjustLayoutDelayed();
      }
    });

    /* Restore initial width before deciding collapsed state */
    var initW = getW();
    panel.style.width = initW + 'px';
    setCssVar('--stw', initW + 'px');
    setCol(lsGet('sp_col', '0') === '1', true);
  }

  /* ══════════════════════════════════════════════════════════════
     BOTTOM CHART STRIP  —  binary: visible → collapsed
     ══════════════════════════════════════════════════════════════ */
  function setupChartBar() {
    var panel = document.getElementById('cs');
    if (!panel) return;

    var DEFAULT_H = 150;
    function getH() {
      var saved = parseInt(lsGet('cs_h', '0'), 10);
      return saved > 60 ? saved : DEFAULT_H;
    }

    /* Resize handle — top edge of chart strip */
    var rh = el('div', { id: 'rm-cs-rh', className: 'rm-rh rm-h' }, panel);

    /* Toggle tab — fixed above chart strip, centred */
    var tog = el('div', {
      id:        'rm-cs-tog',
      className: 'rm-toggle',
      title:     'Toggle elevation profile'
    }, document.body);

    function setCol(col, skip) {
      if (skip) panel.classList.add('rm-drag-active');

      if (col) {
        panel.classList.add('rm-col');
        setCssVar('--chh', '0px');
        tog.textContent = '▲';
        tog.title       = 'Show elevation profile';
      } else {
        panel.classList.remove('rm-col');
        var h = getH();
        panel.style.height = h + 'px';
        setCssVar('--chh', h + 'px');
        tog.textContent = '▼';
        tog.title       = 'Hide elevation profile';
      }

      if (skip) {
        void panel.offsetWidth;
        panel.classList.remove('rm-drag-active');
      }

      lsSet('cs_col', col ? '1' : '0');
      adjustLayoutDelayed();
    }

    tog.addEventListener('click', function () {
      setCol(!panel.classList.contains('rm-col'));
    });

    makeDraggable(rh, {
      axis:    'y',
      invert:  true,
      panel:   panel,
      getSize: function () { return panel.getBoundingClientRect().height; },
      setSize: function (h) {
        if (panel.classList.contains('rm-col')) return;
        var v = Math.max(80, Math.min(480, h));
        panel.style.height = v + 'px';
        setCssVar('--chh', v + 'px');
        lsSet('cs_h', v);
        adjustLayoutDelayed();
      }
    });

    /* Restore initial height then apply collapsed state */
    var initH = getH();
    panel.style.height = initH + 'px';
    setCssVar('--chh', initH + 'px');
    setCol(lsGet('cs_col', '0') === '1', true);
  }

  /* ══════════════════════════════════════════════════════════════
     TILE ↔ THEME SYNC
     Switch map tiles automatically when the user toggles light/dark.
     Uses 'light' tile (CartoDB Positron) for light mode — this tile
     is added to TILES in index.html before script.js runs.
     ══════════════════════════════════════════════════════════════ */
  function activeTheme() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark' || t === 'light') return t;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function syncTileToTheme() {
    /* Map 'light' theme → 'light' tile (CartoDB Positron, clean & minimal).
       Falls back to 'street' if the light tile hasn't been registered yet. */
    var target  = activeTheme() === 'dark' ? 'dark' : 'light';
    var buttons = document.querySelectorAll('#mc .mb');
    var found   = false;

    buttons.forEach(function (b) {
      var name = b.onclick
        ? (b.getAttribute('onclick') || '').match(/setTile\('([^']+)'/)?.[1]
        : null;
      if (name === target) { b.click(); found = true; }
    });

    /* Fallback: if 'light' tile doesn't exist yet, use 'street' */
    if (!found && target === 'light') {
      buttons.forEach(function (b) {
        var name = (b.getAttribute('onclick') || '').match(/setTile\('([^']+)'/)?.[1];
        if (name === 'street') b.click();
      });
    }
  }

  /* ══════════════════════════════════════════════════════════════
     KEYBOARD SHORTCUTS (Ctrl+[ / Ctrl+] for panel cycling)
     ══════════════════════════════════════════════════════════════ */
  function setupKeyboard() {
    document.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      /* Ctrl+[ — cycle sidebar */
      if (e.ctrlKey && e.key === '[') {
        e.preventDefault();
        var btn = document.getElementById('rm-sb-tog');
        if (btn) btn.click();
      }
      /* Ctrl+] — toggle stats panel */
      if (e.ctrlKey && e.key === ']') {
        e.preventDefault();
        var btn = document.getElementById('rm-sp-tog');
        if (btn) btn.click();
      }
      /* Ctrl+\ — toggle chart */
      if (e.ctrlKey && e.key === '\\') {
        e.preventDefault();
        var btn = document.getElementById('rm-cs-tog');
        if (btn) btn.click();
      }
    });
  }

  /* ══════════════════════════════════════════════════════════════
     LEAFLET ZOOM CONTROL  —  restyle to glass
     ══════════════════════════════════════════════════════════════ */
  function styleLeafletControls() {
    /* Leaflet renders after DOMContentLoaded, so we poll briefly. */
    var attempts = 0;
    var iv = setInterval(function () {
      var zc = document.querySelector('.leaflet-control-zoom');
      if (zc || ++attempts > 30) {
        clearInterval(iv);
        /* Controls are already styled via CSS — nothing extra needed. */
      }
    }, 100);
  }

  /* ══════════════════════════════════════════════════════════════
     BOOT
     ══════════════════════════════════════════════════════════════ */
  function boot() {
    /* Extend TILES with CartoDB Positron 'light' tile
       (TILES is a global const declared in script.js — mutating
        the object is safe even though the binding is const).     */
    if (typeof TILES !== 'undefined' && !TILES.light) {
      TILES.light = [
        'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        '© OpenStreetMap contributors © CARTO'
      ];
    }

    setupSidebar();
    setupStatsPanel();
    setupChartBar();
    setupKeyboard();
    styleLeafletControls();

    /* Sync tile to current theme after map is ready */
    setTimeout(syncTileToTheme, 200);

    /* Re-sync whenever the theme is toggled */
    var _themeObs = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (m.attributeName === 'data-theme') syncTileToTheme();
      });
    });
    _themeObs.observe(document.documentElement, { attributes: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
