/*!
 * KitchenPlanner v0.1.0
 * Drag & drop planer kuhinja iz elemenata. Bez zavisnosti.
 *
 *   <div id="planer"></div>
 *   <script src="kitchen-planner.js"></script>
 *   <script>KitchenPlanner.create({ container: '#planer', elementsUrl: '/api/elementi' })</script>
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KitchenPlanner = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '0.1.0';

  // Heights in cm. Base units are 82 cm including 10 cm legs; wall units hang with
  // their top aligned to the top of the tall units.
  const BASE_HEIGHT = 82;
  const PLINTH = 10;
  const WORKTOP = 4;
  const WALL_TOP = 212;
  const MAX_WALLS = 4;
  const WALL_IDS = ['A', 'B', 'C', 'D'];

  // ---------------------------------------------------------------------------
  // Catalog normalization
  // ---------------------------------------------------------------------------

  const TYPES = {
    'base':         { zone: 'base', group: 'base' },
    'drawers':      { zone: 'base', group: 'base' },
    'sink':         { zone: 'base', group: 'base' },
    'oven':         { zone: 'base', group: 'base' },
    'dishwasher':   { zone: 'base', group: 'other' },
    'base-corner':  { zone: 'base', group: 'corner' },
    'base-end':     { zone: 'base', group: 'other' },
    'wall':         { zone: 'wall', group: 'wall' },
    'wall-glass':   { zone: 'wall', group: 'wall' },
    'wall-flap':    { zone: 'wall', group: 'wall' },
    'hood':         { zone: 'wall', group: 'wall' },
    'wall-corner':  { zone: 'wall', group: 'corner' },
    'wall-end':     { zone: 'wall', group: 'other' },
    'tall-shelves': { zone: 'tall', group: 'tall' },
    'tall-oven':    { zone: 'tall', group: 'tall' },
    'tall-fridge':  { zone: 'tall', group: 'tall' },
    'plinth':       { zone: 'accessory', group: 'accessory' },
  };
  const TYPE_ORDER = Object.keys(TYPES);

  // Order matters: "grafit siva" must match before "siva".
  const COLORS = [
    [/grafit/, '#4b4f55'],
    [/walnut|orah/, '#6f4b34'],
    [/sonoma/, '#d3b184'],
    [/artisan/, '#b98d62'],
    [/kašmir|kasmir/, '#c9b9a4'],
    [/zelen|aquamarine/, '#4f7d72'],
    [/crn/, '#2c2c2e'],
    [/siv/, '#a3a7ac'],
    [/bijel/, '#f4f3ef'],
  ];

  function colorHex(name, fallback) {
    const n = String(name || '').toLowerCase();
    for (const [re, hex] of COLORS) if (re.test(n)) return hex;
    return fallback;
  }

  function classify(desc, name, height, depth) {
    const d = desc.toLowerCase();
    const n = name.toLowerCase();
    if (/cokla/.test(n)) return 'plinth';
    if (/perilic/.test(d + ' ' + n)) return 'dishwasher';
    if (/završni|zavr\./.test(d + ' ' + n)) return /gornji/.test(d) ? 'wall-end' : 'base-end';
    if (/ugaoni/.test(d)) return /gornji/.test(d) ? 'wall-corner' : 'base-corner';
    if (/za napu/.test(d)) return 'hood';
    if (/ormar za (ugradbeni )?frižider/.test(d)) return 'tall-fridge';
    if (/ormar za (rernu|pećnicu|štednjak)/.test(d)) return 'tall-oven';
    if (/ormar sa policama/.test(d)) return 'tall-shelves';
    if (/za štednjak/.test(d)) return 'oven';
    if (/za sudoper/.test(d)) return 'sink';
    if (/ladičar|sa \d+ ladic/.test(d)) return 'drawers';
    if (/gornji element/.test(d)) return /staklom/.test(d) ? 'wall-glass' : /kipom/.test(d) ? 'wall-flap' : 'wall';
    if (/donji element/.test(d)) return 'base';
    if (height >= 180) return 'tall-shelves';
    if (depth <= 40) return 'wall';
    return 'base';
  }

  function parseFronts(type, desc, name, width) {
    const d = desc.toLowerCase();
    let drawers = 0;
    const m = d.match(/sa (\d+) ladic/);
    if (m) drawers = +m[1];
    else if (/sa ladicom/.test(d)) drawers = 1;
    else if (type === 'drawers') drawers = 3;
    const f = name.match(/(?:^|\s)(\d)\s?[FV](?=$|[\s-])/);
    let doors = f ? +f[1] : TYPES[type].zone === 'tall' ? 2 : width >= 80 ? 2 : 1;
    if (type === 'drawers' || drawers >= 2) doors = 0;
    return { doors, drawers, glass: type === 'wall-glass' };
  }

  function num(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }

  /** Converts one element from the shop format (naziv, sirina, opis, slike…) to the planner format. */
  function normalize(raw) {
    const name = String(raw.naziv || '').trim();
    const desc = String(raw.opis || '').trim();
    const width = num(raw.sirina);
    const height = num(raw.visina);
    const depth = num(raw.dubina);
    const type = classify(desc, name, height, depth);
    const seriesMatch = name.match(/^Kuhinja\s+(\S+)/i);
    const series = seriesMatch ? seriesMatch[1] : '';
    const color = String(raw.boja || '').trim();
    const [corpusName, frontName] = color.includes('/') ? color.split('/').map(s => s.trim()) : [color, color];
    return {
      id: raw.id,
      sku: raw.sifra == null ? '' : String(raw.sifra),
      barcode: raw.barkod == null ? '' : String(raw.barkod),
      name,
      fullName: raw.dugiNaziv || name,
      description: desc,
      series,
      seriesList: series ? series.split('/') : [],
      type,
      zone: TYPES[type].zone,
      group: TYPES[type].group,
      width,
      height,
      depth,
      color,
      corpusColor: colorHex(corpusName, '#e9e6df'),
      frontColor: colorHex(frontName, '#d9d6cf'),
      gloss: /visoki sjaj|lak folij/i.test(desc),
      fronts: parseFronts(type, desc, name, width),
      withWorktop: !!raw.radnaPloca || /dolazi sa radnom pločom/i.test(desc),
      weight: parseFloat(raw.tezina) || null,
      images: (raw.slike || [])
        .slice()
        .sort((a, b) => (a.redniBroj || 0) - (b.redniBroj || 0))
        .map(s => s.path)
        .filter(Boolean),
      price: num(raw.vpCijena) > 0 ? num(raw.vpCijena) : null,
      isNew: !!raw.novi,
      active: raw.aktivan !== false,
    };
  }

  /** Data checks that point at likely mistakes in the source catalog. */
  function validate(el, raw) {
    const out = [];
    const add = (code, message) => out.push({ code, message });
    if (el.zone === 'base' && el.type !== 'dishwasher' && el.height !== BASE_HEIGHT)
      add('base-height', `visina ${el.height} cm, a donji elementi su ${BASE_HEIGHT} cm`);
    if (el.zone === 'wall' && el.type !== 'wall-corner' && el.depth > 40)
      add('wall-depth', `dubina ${el.depth} cm je prevelika za gornji element`);
    const sw = el.description.match(/širine (\d+)\s?cm/);
    if (sw && +sw[1] !== el.width)
      add('width-text', `opis kaže širina ${sw[1]} cm, a polje sirina je ${el.width} cm`);
    if (!raw.radnaPloca && /dolazi sa radnom pločom/i.test(el.description))
      add('worktop-flag', 'opis kaže da dolazi sa radnom pločom, a radnaPloca je false');
    if (el.description) {
      const d = el.description.toLowerCase();
      // A dishwasher door is only a front, so only the front colour has to match.
      const parts = el.color.split('/');
      (el.type === 'dishwasher' ? parts.slice(-1) : parts).forEach(part => {
        const hit = COLORS.find(([re]) => re.test(part.toLowerCase()));
        if (hit && !hit[0].test(d)) add('color-text', `boja "${part.trim()}" se ne spominje u opisu`);
      });
    }
    if (!el.images.length) add('no-images', 'nema slika');
    if (!el.price) add('no-price', 'nema cijene (vpCijena = 0)');
    return out;
  }

  function normalizeAll(rawList) {
    const elements = [];
    const warnings = [];
    for (const raw of rawList || []) {
      const el = normalize(raw);
      elements.push(el);
      const w = validate(el, raw);
      if (w.length) warnings.push({ id: el.id, name: el.name, issues: w });
    }
    return { elements, warnings };
  }

  // ---------------------------------------------------------------------------
  // Drawing (SVG, units = cm)
  // ---------------------------------------------------------------------------

  const STROKE = 'rgba(0,0,0,.38)';

  function n2(v) {
    return Math.round(v * 100) / 100;
  }

  function rect(x, y, w, h, fill, extra) {
    return `<rect x="${n2(x)}" y="${n2(y)}" width="${n2(Math.max(0, w))}" height="${n2(Math.max(0, h))}" fill="${fill}" stroke="${STROKE}" stroke-width="1" vector-effect="non-scaling-stroke"${extra || ''}/>`;
  }

  function fillRect(x, y, w, h, fill, extra) {
    return `<rect x="${n2(x)}" y="${n2(y)}" width="${n2(Math.max(0, w))}" height="${n2(Math.max(0, h))}" fill="${fill}"${extra || ''}/>`;
  }

  function hexRgb(hex) {
    const h = String(hex).replace('#', '');
    if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(h)) return [170, 170, 170];
    const v = parseInt(h.length === 3 ? h.replace(/./g, c => c + c) : h, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  function luminance(hex) {
    const [r, g, b] = hexRgb(hex);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  function shade(hex, amt) {
    const f = c => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
    return '#' + hexRgb(hex).map(c => f(c).toString(16).padStart(2, '0')).join('');
  }

  function renderHeight(el) {
    return el.zone === 'base' ? BASE_HEIGHT : el.height;
  }

  function handleSvg(el, x, y, w, h, pos, long) {
    if (!pos) return '';
    const c = luminance(el.frontColor) > 0.55 ? '#7a7f86' : '#d5d8dc';
    const T = 1.1;
    const m = 3;
    if (pos === 'top' || pos === 'bottom') {
      const len = Math.min(16, w * 0.4);
      return fillRect(x + (w - len) / 2, pos === 'top' ? y + m : y + h - m - T, len, T, c);
    }
    const [side, v] = pos.split('-');
    const len = Math.min(long ? 32 : 12, h * 0.4);
    const hx = side === 'right' ? x + w - m - T : x + m;
    const hy = v === 'top' ? y + m : y + h - m - len;
    return fillRect(hx, hy, T, len, c);
  }

  function frontPanel(el, x, y, w, h, handlePos, opt) {
    opt = opt || {};
    let s = rect(x, y, w, h, el.frontColor);
    if (opt.glass) {
      const ix = Math.min(5, w * 0.15);
      const iy = Math.min(5, h * 0.1);
      s += fillRect(x + ix, y + iy, w - 2 * ix, h - 2 * iy, '#cfe0e6', ' opacity=".65"');
    }
    if (el.gloss && opt.shine !== false) {
      s += `<path d="M${n2(x)} ${n2(y)}h${n2(w * 0.5)}L${n2(x)} ${n2(y + Math.min(h, w) * 0.5)}z" fill="#fff" opacity=".25"/>`;
    }
    return s + handleSvg(el, x, y, w, h, handlePos, opt.long);
  }

  function drawFronts(el, x, y, w, h, shine) {
    const f = el.fronts || { doors: 1, drawers: 0 };
    const G = 0.5;
    let s = '';
    const panel = (px, py, pw, ph, hp, opt) => { s += frontPanel(el, px, py, pw, ph, hp, Object.assign({ shine }, opt)); };
    const doorsRow = (px, py, pw, ph, n, v, opt) => {
      const dw = (pw - G * (n - 1)) / n;
      for (let i = 0; i < n; i++) {
        const side = i < n / 2 ? 'right' : 'left';
        panel(px + i * (dw + G), py, dw, ph, side + '-' + v, Object.assign({ glass: f.glass }, opt));
      }
    };
    const drawerStack = (px, py, pw, ph, n) => {
      const first = n >= 3 ? ph * 0.2 : (ph - G * (n - 1)) / n;
      const rest = n > 1 ? (ph - first - G * (n - 1)) / (n - 1) : 0;
      let cy = py;
      for (let i = 0; i < n; i++) {
        const dh = i === 0 ? first : rest;
        panel(px, cy, pw, dh, 'top');
        cy += dh + G;
      }
    };
    const oven = (px, py, pw, ph) => {
      s += rect(px, py, pw, ph, '#25282c');
      s += fillRect(px + pw * 0.12, py + ph * 0.32, pw * 0.76, ph * 0.5, '#3f464d');
      s += fillRect(px + pw * 0.15, py + ph * 0.1, pw * 0.7, 1.4, '#b9bec4');
    };

    switch (el.type) {
      case 'drawers':
        drawerStack(x, y, w, h, Math.max(1, f.drawers || 3));
        break;
      case 'oven': {
        const dh = Math.min(14, h * 0.2);
        panel(x, y, w, dh, 'top');
        oven(x, y + dh + G, w, h - dh - G);
        break;
      }
      case 'dishwasher':
        panel(x, y, w, h, 'top');
        break;
      case 'base-end':
      case 'wall-end': {
        s += fillRect(x + 1.5, y + 1.5, w - 3, h - 3, shade(el.corpusColor, -0.14));
        for (let i = 1; i <= 2; i++) s += fillRect(x + 1.5, y + (h * i) / 3 - 0.8, w - 3, 1.6, el.corpusColor);
        break;
      }
      case 'wall-flap':
        panel(x, y, w, h, 'bottom');
        break;
      case 'hood': {
        const vh = Math.min(5, h * 0.15);
        panel(x, y, w, h - vh - G, 'bottom');
        s += fillRect(x + 1, y + h - vh, w - 2, vh, '#3a3e43');
        s += fillRect(x + w * 0.3, y + h - vh * 0.45, w * 0.4, vh * 0.2, '#efe8c9');
        break;
      }
      case 'tall-oven': {
        const bh = Math.min(72, h * 0.36);
        const oh = Math.min(60, h * 0.3);
        const th = h - bh - oh - 2 * G;
        doorsRow(x, y, w, th, 1, 'bottom');
        oven(x, y + th + G, w, oh);
        doorsRow(x, y + th + oh + 2 * G, w, bh, 1, 'top');
        break;
      }
      case 'tall-shelves':
      case 'tall-fridge': {
        const cols = w >= 80 ? 2 : 1;
        const fridge = el.type === 'tall-fridge';
        const th = h * (fridge ? 0.36 : 0.38);
        doorsRow(x, y, w, th, cols, 'bottom', { long: fridge });
        doorsRow(x, y + th + G, w, h - th - G, cols, 'top', { long: fridge });
        break;
      }
      default: {
        let cy = y;
        let ch = h;
        if (f.drawers === 1) {
          const dh = Math.min(14, h * 0.2);
          panel(x, y, w, dh, 'top');
          cy += dh + G;
          ch -= dh + G;
        }
        doorsRow(x, cy, w, ch, Math.max(1, f.doors || 1), el.zone === 'wall' ? 'bottom' : 'top');
      }
    }
    return s;
  }

  /**
   * SVG front view of one element (units: cm).
   * opt.thumb keeps the aspect ratio in a fixed box, opt.legs=false leaves out the plinth,
   * opt.gloss=false drops the painted shine (the 3D view has real reflections), opt.size=[w,h] in px.
   */
  function drawSvg(el, opt) {
    opt = opt || {};
    const w = el.width;
    const full = renderHeight(el);
    const ch = el.zone !== 'wall' ? full - PLINTH : full;
    const legs = el.zone !== 'wall' && opt.legs !== false;
    const h = legs ? full : ch;
    let s = '';
    if (legs) s += fillRect(1.5, ch, w - 3, PLINTH, shade(el.corpusColor, -0.45));
    s += rect(0, 0, w, ch, el.corpusColor);
    s += drawFronts(el, 0.5, 0.5, w - 1, ch - 1, opt.gloss !== false);
    const size = opt.size ? ` width="${opt.size[0]}" height="${opt.size[1]}"` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"${size} preserveAspectRatio="${opt.thumb ? 'xMidYMax meet' : 'none'}" aria-hidden="true" focusable="false">${s}</svg>`;
  }

  // A dishwasher "element" is only its door; in plan view it takes a full base depth.
  function depthOf(el) {
    return el.type === 'dishwasher' ? 56 : el.depth || 0;
  }

  const FAUCET_SVG = '<svg viewBox="0 0 16 24" aria-hidden="true"><path d="M8 22V7q0-5 4.5-5T17 7v2.5" fill="none" stroke="#9aa0a6" stroke-width="1.8" stroke-linecap="round"/><rect x="5" y="21" width="6" height="3" rx="1" fill="#8a9096"/></svg>';
  const HOB_SVG = '<svg viewBox="0 0 10 1" preserveAspectRatio="none" aria-hidden="true"><rect width="10" height="1" fill="#26292d"/></svg>';

  // ---------------------------------------------------------------------------
  // 3D view. three.js is loaded only when the 3D view is opened.
  // Walls form a chain: wall A runs along +X, every next wall starts at the end of the
  // previous one and turns 90° (L = A+B, U = A+B+C). Each wall has its own group whose
  // local +X runs along the wall and local +Z points into the room.
  // ---------------------------------------------------------------------------

  const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
  const ROOM_HEIGHT = 260;
  const threeLoads = new Map();

  function loadThree(opts) {
    if (opts.three) return Promise.resolve(opts.three);
    if (typeof window !== 'undefined' && window.THREE && window.THREE.WebGLRenderer) return Promise.resolve(window.THREE);
    const url = opts.threeUrl || THREE_URL;
    if (!threeLoads.has(url)) {
      threeLoads.set(url, import(/* webpackIgnore: true */ url).catch(err => {
        threeLoads.delete(url);
        throw err;
      }));
    }
    return threeLoads.get(url);
  }

  function createScene3D(THREE, ctx) {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const canvas = renderer.domElement;
    canvas.className = 'kp-3d-canvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', ctx.label);
    ctx.wrap.prepend(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 5, 12000);
    const hemi = new THREE.HemisphereLight(0xffffff, 0xd8d0c4, 1.15);
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    scene.add(hemi, sun, sun.target);
    const world = new THREE.Group();
    scene.add(world);

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const orbit = { theta: 0, phi: 1.12, radius: 700, target: new THREE.Vector3() };
    const materials = new Map();
    const fronts = new Map();
    const pickMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
    let frames = [];
    let wallGroups = new Map();
    let itemGroups = new Map();
    let pickables = [];
    let preview = null;
    let outline = null;
    let selected = null;
    let hidden = null;
    let wallCount = -1;
    let raf = 0;
    let disposed = false;

    function requestRender() {
      if (raf || disposed) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        renderer.render(scene, camera);
      });
    }

    function resize() {
      const r = ctx.wrap.getBoundingClientRect();
      if (!r.width || !r.height) return;
      renderer.setSize(r.width, r.height, false);
      camera.aspect = r.width / r.height;
      camera.updateProjectionMatrix();
      requestRender();
    }
    const ro = new ResizeObserver(resize);
    ro.observe(ctx.wrap);

    function material(color, extra) {
      const key = color + JSON.stringify(extra || {});
      let m = materials.get(key);
      if (!m) {
        m = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.8, metalness: 0 }, extra));
        materials.set(key, m);
      }
      return m;
    }

    // The front face reuses the 2D drawing, rasterised into a texture.
    function frontMaterial(el) {
      const key = String(el.id);
      if (fronts.has(key)) return fronts.get(key);
      const m = new THREE.MeshStandardMaterial({ color: el.frontColor, roughness: el.gloss ? 0.3 : 0.75, metalness: 0 });
      fronts.set(key, m);
      const w = el.width;
      const h = renderHeight(el) - (el.zone !== 'wall' ? PLINTH : 0);
      const k = clamp(Math.floor(1600 / Math.max(w, h)), 2, 6);
      const pw = Math.round(w * k);
      const ph = Math.round(h * k);
      const img = new Image();
      img.onload = () => {
        if (disposed) return;
        const c = document.createElement('canvas');
        c.width = pw;
        c.height = ph;
        c.getContext('2d').drawImage(img, 0, 0, pw, ph);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        m.map = tex;
        m.color.set(0xffffff);
        m.needsUpdate = true;
        requestRender();
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(drawSvg(el, { legs: false, gloss: false, size: [pw, ph] }));
      return m;
    }

    function computeFrames() {
      let ox = 0;
      let oz = 0;
      return ctx.state().walls.map((w, i) => {
        const angle = (-Math.PI / 2) * i;
        const dir = [Math.round(Math.cos(angle)), Math.round(-Math.sin(angle))];
        const inward = [Math.round(Math.sin(angle)), Math.round(Math.cos(angle))];
        const f = { id: w.id, width: w.width, angle, ox, oz, dir, inward };
        ox += dir[0] * w.width;
        oz += dir[1] * w.width;
        return f;
      });
    }

    function bounds(inwardDepth) {
      const xs = [];
      const zs = [];
      frames.forEach(f => {
        const ex = f.ox + f.dir[0] * f.width;
        const ez = f.oz + f.dir[1] * f.width;
        xs.push(f.ox, ex, f.ox + f.inward[0] * inwardDepth, ex + f.inward[0] * inwardDepth);
        zs.push(f.oz, ez, f.oz + f.inward[1] * inwardDepth, ez + f.inward[1] * inwardDepth);
      });
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minZ = Math.min(...zs);
      const maxZ = Math.max(...zs);
      return { minX, maxX, minZ, maxZ, w: maxX - minX, d: maxZ - minZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
    }

    function buildItem(it, el) {
      const g = new THREE.Group();
      g.userData.uid = it.uid;
      const legs = el.zone !== 'wall';
      const full = renderHeight(el);
      const ch = legs ? full - PLINTH : full;
      const d = Math.max(2, depthOf(el) || 50);
      const y0 = el.zone === 'wall' ? ctx.wallTop - el.height : 0;
      const cx = it.x + el.width / 2;
      const side = material(el.type === 'dishwasher' ? '#9ea3a9' : el.corpusColor);
      const box = new THREE.Mesh(new THREE.BoxGeometry(el.width, ch, d), [side, side, side, side, frontMaterial(el), side]);
      box.position.set(cx, y0 + (legs ? PLINTH : 0) + ch / 2, d / 2);
      box.castShadow = true;
      box.receiveShadow = true;
      box.userData.main = true;
      g.add(box);
      if (legs) {
        const pd = Math.max(4, d - 6);
        const plinth = new THREE.Mesh(new THREE.BoxGeometry(el.width - 0.6, PLINTH, pd), material(shade(el.corpusColor, -0.5)));
        plinth.position.set(cx, PLINTH / 2, pd / 2);
        g.add(plinth);
      }
      if (el.zone === 'base') {
        const wd = (el.type === 'base-corner' ? d : Math.max(d, 58)) + 2;
        const top = new THREE.Mesh(new THREE.BoxGeometry(el.width, WORKTOP, wd), material(ctx.colors().worktop, { roughness: 0.55 }));
        top.position.set(cx, BASE_HEIGHT + WORKTOP / 2, wd / 2);
        top.castShadow = true;
        top.receiveShadow = true;
        g.add(top);
        const y = BASE_HEIGHT + WORKTOP;
        if (el.type === 'sink') {
          const steel = material('#aeb4ba', { roughness: 0.3, metalness: 0.6 });
          const basin = new THREE.Mesh(new THREE.BoxGeometry(Math.max(20, el.width - 28), 0.6, wd * 0.55), material('#7d848b', { roughness: 0.35, metalness: 0.5 }));
          basin.position.set(cx, y + 0.3, wd * 0.52);
          const stem = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.6, 26, 16), steel);
          stem.position.set(cx, y + 13, wd * 0.16);
          const spout = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 16, 12), steel);
          spout.rotation.x = Math.PI / 2;
          spout.position.set(cx, y + 25, wd * 0.16 + 8);
          stem.castShadow = spout.castShadow = true;
          g.add(basin, stem, spout);
        } else if (el.type === 'oven') {
          const hob = new THREE.Mesh(new THREE.BoxGeometry(el.width - 8, 0.8, Math.max(20, wd - 14)), material('#1b1d20', { roughness: 0.25 }));
          hob.position.set(cx, y + 0.4, wd / 2 + 1);
          g.add(hob);
        }
      }
      return g;
    }

    function clearWorld() {
      if (preview) preview.removeFromParent();
      outline = null;
      world.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      world.clear();
    }

    function rebuild() {
      const st = ctx.state();
      const colors = ctx.colors();
      scene.background = new THREE.Color(colors.bg);
      clearWorld();
      frames = computeFrames();
      wallGroups = new Map();
      itemGroups = new Map();
      pickables = [];
      const wallMat = material(colors.wall, { roughness: 0.95 });
      frames.forEach(f => {
        const g = new THREE.Group();
        g.position.set(f.ox, 0, f.oz);
        g.rotation.y = f.angle;
        world.add(g);
        wallGroups.set(f.id, g);
        const wall = new THREE.Mesh(new THREE.PlaneGeometry(f.width, ROOM_HEIGHT), wallMat);
        wall.position.set(f.width / 2, ROOM_HEIGHT / 2, 0);
        wall.receiveShadow = true;
        g.add(wall);
        const pick = new THREE.Mesh(new THREE.PlaneGeometry(f.width + 80, 320), pickMat);
        pick.position.set(f.width / 2, 160, 0.1);
        pick.userData.pickWall = f.id;
        g.add(pick);
        pickables.push(pick);
      });
      st.items.forEach(it => {
        const el = ctx.get(it.id);
        const g = wallGroups.get(it.wall);
        if (!el || !g) return;
        const ig = buildItem(it, el);
        ig.visible = it.uid !== hidden;
        g.add(ig);
        itemGroups.set(it.uid, ig);
      });
      const room = bounds(280);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(room.w + 200, room.d + 200), material(colors.floor, { roughness: 0.9 }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(room.cx, 0, room.cz);
      floor.receiveShadow = true;
      floor.userData.floor = true;
      world.add(floor);
      pickables.push(floor);

      const k = bounds(60);
      const avg = frames.reduce((a, f) => [a[0] + f.inward[0], a[1] + f.inward[1]], [0, 0]);
      const len = Math.hypot(avg[0], avg[1]) || 1;
      const size = Math.max(k.w, k.d, 240);
      sun.position.set(k.cx + (avg[0] / len) * 320 - 160, 520, k.cz + (avg[1] / len) * 320 + 120);
      sun.target.position.set(k.cx, 0, k.cz);
      const sc = sun.shadow.camera;
      sc.left = sc.bottom = -(size / 2 + 260);
      sc.right = sc.top = size / 2 + 260;
      sc.near = 10;
      sc.far = 3000;
      sc.updateProjectionMatrix();
      if (frames.length !== wallCount) {
        wallCount = frames.length;
        resetView();
      }
      setSelected(selected);
      requestRender();
    }

    function applyCamera() {
      const sp = Math.sin(orbit.phi);
      camera.position.set(
        orbit.target.x + orbit.radius * sp * Math.sin(orbit.theta),
        orbit.target.y + orbit.radius * Math.cos(orbit.phi),
        orbit.target.z + orbit.radius * sp * Math.cos(orbit.theta));
      camera.lookAt(orbit.target);
      requestRender();
    }

    // Looks into the open side of the layout.
    function resetView() {
      const k = bounds(60);
      const avg = frames.reduce((a, f) => [a[0] + f.inward[0], a[1] + f.inward[1]], [0, 0]);
      orbit.theta = avg[0] || avg[1] ? Math.atan2(avg[0], avg[1]) : 0;
      orbit.phi = frames.length >= 3 ? 0.82 : frames.length === 2 ? 1.0 : 1.12;
      orbit.target.set(k.cx, 105, k.cz);
      orbit.radius = clamp(Math.max(k.w, k.d, 240) * 1.45 + 140, 380, 3200);
      applyCamera();
    }

    function topView() {
      orbit.phi = 0.12;
      applyCamera();
    }

    function rotate(dx, dy) {
      orbit.theta -= dx * 0.0065;
      orbit.phi = clamp(orbit.phi - dy * 0.0065, 0.12, 1.5);
      applyCamera();
    }

    function zoom(factor) {
      orbit.radius = clamp(orbit.radius * factor, 120, 4000);
      applyCamera();
    }

    function setRay(cx, cy) {
      const r = canvas.getBoundingClientRect();
      ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
    }

    function contains(cx, cy) {
      const r = canvas.getBoundingClientRect();
      return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
    }

    function pickItem(cx, cy) {
      setRay(cx, cy);
      const hit = raycaster.intersectObjects([...itemGroups.values()].filter(g => g.visible), true)[0];
      if (!hit) return null;
      let o = hit.object;
      while (o && !o.userData.uid) o = o.parent;
      if (!o) return null;
      return { uid: o.userData.uid, localX: o.parent.worldToLocal(hit.point.clone()).x };
    }

    // Position along a wall under the pointer; pointing at the floor picks the nearest wall.
    function wallHit(cx, cy) {
      setRay(cx, cy);
      for (const h of raycaster.intersectObjects(pickables, false)) {
        if (h.object.userData.pickWall) {
          const id = h.object.userData.pickWall;
          return { wallId: id, localX: wallGroups.get(id).worldToLocal(h.point.clone()).x };
        }
        if (h.object.userData.floor) {
          let best = null;
          frames.forEach(f => {
            const dx = h.point.x - f.ox;
            const dz = h.point.z - f.oz;
            const lx = dx * f.dir[0] + dz * f.dir[1];
            const lz = dx * f.inward[0] + dz * f.inward[1];
            if (lx < -40 || lx > f.width + 40 || lz < -20 || lz > 180) return;
            if (!best || lz < best.lz) best = { wallId: f.id, localX: lx, lz };
          });
          return best;
        }
      }
      return null;
    }

    function showPreview(el, wallId, x) {
      const g = wallGroups.get(wallId);
      if (!g) return hidePreview();
      if (!preview) {
        const ok = ctx.colors().ok;
        const unit = new THREE.BoxGeometry(1, 1, 1);
        preview = new THREE.Mesh(unit, new THREE.MeshBasicMaterial({ color: ok, transparent: true, opacity: 0.35, depthWrite: false }));
        preview.add(new THREE.LineSegments(new THREE.EdgesGeometry(unit), new THREE.LineBasicMaterial({ color: ok })));
        preview.renderOrder = 10;
      }
      if (preview.parent !== g) g.add(preview);
      const h = renderHeight(el);
      const d = Math.max(2, depthOf(el));
      const y0 = el.zone === 'wall' ? ctx.wallTop - el.height : 0;
      preview.scale.set(el.width, h, d);
      preview.position.set(x + el.width / 2, y0 + h / 2, d / 2);
      preview.visible = true;
      requestRender();
    }

    function hidePreview() {
      if (preview && preview.visible) {
        preview.visible = false;
        requestRender();
      }
    }

    function setSelected(uid) {
      selected = uid || null;
      if (outline) {
        outline.removeFromParent();
        outline.children.forEach(c => { c.geometry.dispose(); c.material.dispose(); });
        outline = null;
      }
      const g = selected && itemGroups.get(selected);
      const main = g && g.children.find(c => c.userData.main);
      if (main) {
        const accent = ctx.colors().accent;
        outline = new THREE.Group();
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(main.geometry), new THREE.LineBasicMaterial({ color: accent }));
        const glow = new THREE.Mesh(main.geometry.clone(), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.16, depthWrite: false }));
        outline.add(edges, glow);
        outline.position.copy(main.position);
        outline.scale.setScalar(1.015);
        g.add(outline);
      }
      requestRender();
    }

    function setHidden(uid) {
      hidden = uid || null;
      itemGroups.forEach((g, k) => { g.visible = k !== hidden; });
      requestRender();
    }

    function dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      clearWorld();
      materials.forEach(m => m.dispose());
      fronts.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
      renderer.dispose();
      canvas.remove();
    }

    resize();
    return { canvas, rebuild, resize, contains, pickItem, wallHit, showPreview, hidePreview, setSelected, setHidden, rotate, zoom, resetView, topView, dispose };
  }

  // ---------------------------------------------------------------------------
  // UI text (override with the `labels` option)
  // ---------------------------------------------------------------------------

  const DEFAULT_LABELS = {
    loading: 'Učitavam elemente…',
    loadError: 'Elementi se nisu mogli učitati.',
    catalog: 'Katalog elemenata',
    series: 'Linija',
    allSeries: 'Sve linije',
    color: 'Boja',
    allColors: 'Sve boje',
    search: 'Traži po nazivu ili šifri',
    add: 'Dodaj',
    groups: { base: 'Donji elementi', wall: 'Gornji elementi', tall: 'Visoki elementi', corner: 'Ugaoni elementi', other: 'Ostalo' },
    types: {
      'base': 'Donji element',
      'drawers': 'Ladičar',
      'sink': 'Za sudoper',
      'oven': 'Za štednjak',
      'dishwasher': 'Vrata za perilicu',
      'base-corner': 'Donji ugaoni',
      'base-end': 'Donji završni',
      'wall': 'Gornji element',
      'wall-glass': 'Gornji sa staklom',
      'wall-flap': 'Gornji sa kipom',
      'hood': 'Za napu',
      'wall-corner': 'Gornji ugaoni',
      'wall-end': 'Gornji završni',
      'tall-shelves': 'Visoki ormar',
      'tall-oven': 'Ormar za rernu',
      'tall-fridge': 'Ormar za frižider',
      'plinth': 'Cokla',
    },
    layout: 'Raspored zidova',
    layouts: ['Jedan zid (I)', 'Dva zida (L)', 'Tri zida (U)'],
    wall: 'Zid',
    width: 'Širina',
    view: 'Prikaz',
    view2d: '2D',
    view3d: '3D',
    loading3d: 'Učitavam 3D prikaz…',
    error3d: '3D prikaz nije dostupan u ovom pregledniku.',
    canvas3d: 'Kuhinja u 3D prikazu',
    resetView: 'Početni pogled',
    topView: 'Odozgo',
    hint3d: 'Povuci za okretanje · točkić ili dva prsta za zum · prevuci element da ga pomjeriš, van prikaza da ga ukloniš · strelice i Delete rade na odabranom elementu',
    corner: 'ugao',
    cornerTitle: name => `Ovdje je element iz ugla: ${name}`,
    cornerConflict: 'Ta promjena bi izazvala preklapanje u uglu.',
    undo: 'Poništi',
    redo: 'Ponovi',
    clear: 'Očisti',
    freeBase: 'donji red slobodno',
    freeWall: 'gornji red slobodno',
    cornerHint: prev => `lijevi kraj je ugao sa desnim krajem zida ${prev}`,
    emptyStage: 'Prevuci element iz kataloga na zid ili klikni na njega u katalogu.',
    noResults: 'Nema elemenata za ovaj filter.',
    summary: 'Vaša kuhinja',
    emptySummary: 'Još niste dodali nijedan element.',
    total: 'Ukupno',
    totalPartial: 'Ukupno (bez stavki na upit)',
    priceOnRequest: 'Cijena na upit',
    worktop: 'Radna ploča (nije uključena)',
    plinth: 'Cokla',
    plinthAdd: 'Dodaj coklu u narudžbu',
    plinthSuggest: 'Prijedlog',
    checkout: 'Pošalji upit',
    exportCsv: 'Preuzmi specifikaciju (CSV)',
    remove: 'Ukloni',
    duplicate: 'Dupliraj',
    moveLeft: 'Pomjeri lijevo',
    moveRight: 'Pomjeri desno',
    sku: 'Šifra',
    withWorktop: 'dolazi sa radnom pločom',
    inspectorHint: 'Klikni element na zidu za detalje. Strelice ga pomjeraju za 1 cm (Shift = 10 cm), Delete ga briše, a element prevučen van zida se uklanja.',
    added: (name, wall) => `Dodano: ${name} (zid ${wall})`,
    noSpace: 'Nema mjesta za ovaj element ni na jednom zidu.',
    removed: 'Element uklonjen. Ctrl+Z vraća.',
    cleared: 'Kuhinja očišćena. Ctrl+Z vraća.',
    csvHeaders: ['Šifra', 'Naziv', 'Količina', 'Cijena', 'Ukupno'],
    csvWalls: 'Zidovi',
    csvWallHeaders: ['Zid', 'Širina (cm)'],
    csvLayout: 'Raspored',
    csvLayoutHeaders: ['Zid', 'Od lijevog ruba (cm)', 'Šifra', 'Naziv', 'Š × V × D (cm)'],
    csvKeep: 'Ovaj red služi za ponovno učitavanje kuhinje u planer, ne mijenjajte ga.',
    fileName: 'kuhinja',
    importSpec: 'Učitaj specifikaciju',
    importError: 'Ovaj fajl nije specifikacija kuhinje iz planera.',
    imported: (n, miss) => `Učitano elemenata: ${n}.` + (miss ? ` Nije pronađeno ili ne staje: ${miss}.` : '') + ' Ctrl+Z vraća prethodnu kuhinju.',
    elementsCount: n => {
      const a = n % 10;
      const b = n % 100;
      const word = a === 1 && b !== 11 ? 'element' : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'elementa' : 'elemenata';
      return `${n} ${word}`;
    },
    wallsRemoved: n => `Uklonjeni zidovi su imali ${n} el. Ctrl+Z vraća.`,
    tooNarrow: min => `Zid ne može biti uži od ${min} cm zbog postavljenih elemenata.`,
    switchSeries: s => `Prebaci cijelu kuhinju na liniju ${s}`,
    switched: (ok, miss) => `Zamijenjeno: ${ok}.` + (miss ? ` Bez odgovarajućeg elementa: ${miss}.` : ''),
  };

  // ---------------------------------------------------------------------------
  // Styles (scoped by Shadow DOM)
  // ---------------------------------------------------------------------------

  const CSS = `
:host{all:initial;display:block;
  --kp-accent:#2f6f62;--kp-accent-ink:#fff;--kp-bg:#fff;--kp-surface:#f7f6f3;--kp-border:#e3e0d9;
  --kp-text:#1d2125;--kp-muted:#686d74;--kp-danger:#b93a26;--kp-ok:#2f8f5b;
  --kp-wall:#f2f0ea;--kp-floor:#d5cfc3;--kp-worktop:#cdbfa9;--kp-radius:12px;--kp-height:780px}
*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none!important}
.kp-root{container:kp/inline-size;font:14px/1.45 var(--kp-font,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif);color:var(--kp-text);-webkit-font-smoothing:antialiased}
.kp-status{padding:48px 16px;text-align:center;color:var(--kp-muted);background:var(--kp-surface);border:1px solid var(--kp-border);border-radius:var(--kp-radius)}
.kp-error{color:var(--kp-danger)}
.kp{display:grid;grid-template-columns:290px minmax(0,1fr) 310px;grid-template-areas:"cat main sum";height:var(--kp-height);background:var(--kp-bg);border:1px solid var(--kp-border);border-radius:var(--kp-radius);overflow:hidden}
.kp.is-dragging,.kp.is-dragging *{cursor:grabbing!important}
button{font:inherit;color:inherit}
.kp-muted{color:var(--kp-muted)}

.kp-catalog{grid-area:cat;display:flex;flex-direction:column;min-height:0;background:var(--kp-surface);border-right:1px solid var(--kp-border)}
.kp-cat-head{display:grid;gap:10px;padding:14px;border-bottom:1px solid var(--kp-border)}
.kp-title{font-weight:650;font-size:15px}
.kp-row2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.kp-field{display:grid;gap:4px;font-size:12px;font-weight:550;color:var(--kp-muted);min-width:0}
.kp-select,.kp-input{height:34px;width:100%;min-width:0;padding:0 8px;border:1px solid var(--kp-border);border-radius:8px;background:var(--kp-bg);color:var(--kp-text);font:inherit;font-size:14px}
.kp-select:focus-visible,.kp-input:focus-visible{outline:2px solid var(--kp-accent);outline-offset:0;border-color:transparent}
.kp-switch[hidden]{display:none}
.kp-cat-list{flex:1;min-height:0;overflow:auto;padding:2px 14px 16px;scrollbar-gutter:stable}
.kp-group-title{margin:16px 0 8px;font-size:11.5px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:var(--kp-muted)}
.kp-cards{display:grid;gap:6px}
.kp-card{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:10px;padding:7px 9px;background:var(--kp-bg);border:1px solid var(--kp-border);border-radius:9px;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:pan-y;transition:border-color .12s,box-shadow .12s}
.kp-card:hover{border-color:color-mix(in srgb,var(--kp-accent) 50%,var(--kp-border));box-shadow:0 1px 3px rgba(0,0,0,.06)}
.kp-card:focus-visible{outline:2px solid var(--kp-accent);outline-offset:1px}
.kp-thumb{flex:none;width:46px;height:54px;display:flex;align-items:flex-end;justify-content:center}
.kp-thumb svg{width:100%;height:100%;overflow:visible}
.kp-card-body{display:grid;min-width:0;gap:1px}
.kp-card-name{font-weight:600;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kp-card-meta{font-size:12px;color:var(--kp-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kp-card-price{font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums}

.kp-main{grid-area:main;position:relative;display:flex;flex-direction:column;min-width:0;min-height:0}
.kp-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--kp-border)}
.kp-spacer{flex:1}
.kp-seg{display:inline-flex;border:1px solid var(--kp-border);border-radius:8px;overflow:hidden}
.kp-seg button{all:unset;display:grid;place-items:center;width:40px;height:32px;cursor:pointer;color:var(--kp-muted)}
.kp-seg button+button{border-left:1px solid var(--kp-border)}
.kp-seg button:hover{background:var(--kp-surface);color:var(--kp-text)}
.kp-seg button[aria-pressed="true"]{background:var(--kp-accent);color:var(--kp-accent-ink)}
.kp-seg button:focus-visible{outline:2px solid var(--kp-accent);outline-offset:-2px}
.kp-seg svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.kp-btn{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:34px;padding:0 12px;border:1px solid var(--kp-border);border-radius:8px;background:var(--kp-bg);color:var(--kp-text);font-weight:550;white-space:nowrap;cursor:pointer}
.kp-btn:hover{background:var(--kp-surface)}
.kp-btn:focus-visible{outline:2px solid var(--kp-accent);outline-offset:2px}
.kp-btn[disabled]{opacity:.4;cursor:default;pointer-events:none}
.kp-btn.kp-primary{background:var(--kp-accent);border-color:var(--kp-accent);color:var(--kp-accent-ink)}
.kp-btn.kp-primary:hover{filter:brightness(1.08)}
.kp-btn.kp-danger{color:var(--kp-danger)}
.kp-btn.kp-icon{width:34px;padding:0}
.kp-btn.kp-block{width:100%}
.kp-btn.kp-soft{height:auto;min-height:34px;padding:7px 10px;white-space:normal;text-align:left;background:color-mix(in srgb,var(--kp-accent) 10%,var(--kp-bg));border-color:color-mix(in srgb,var(--kp-accent) 35%,var(--kp-border));color:var(--kp-accent);font-size:13px}

.kp-walls{flex:1;min-height:0;overflow:auto;padding:16px;display:grid;gap:26px;align-content:start;scrollbar-gutter:stable}
.kp-wall-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin-bottom:8px}
.kp-wall-name{font-weight:650}
.kp-wall-width{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--kp-muted)}
.kp-wall-width input{width:76px;height:30px}
.kp-free{font-size:12.5px;color:var(--kp-muted)}
.kp-corner{font-size:12px;color:var(--kp-muted);font-style:italic}
.kp-stage-scroll{overflow-x:auto;overflow-y:hidden;padding:2px 2px 4px}
.kp-stage{position:relative;background-color:var(--kp-wall);background-image:linear-gradient(to right,rgba(0,0,0,.035) 1px,transparent 1px);border-bottom:4px solid var(--kp-floor);border-radius:6px 6px 0 0;touch-action:pan-y}
.kp-stage.is-target{box-shadow:0 0 0 2px color-mix(in srgb,var(--kp-accent) 45%,transparent)}
.kp-guide{position:absolute;left:0;right:0;border-top:1px dashed rgba(0,0,0,.15);pointer-events:none}
.kp-guide span{position:absolute;left:4px;top:-16px;font-size:10px;color:var(--kp-muted)}
.kp-worktop{position:absolute;background:var(--kp-worktop);box-shadow:inset 0 -1px 0 rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.35);pointer-events:none}
.kp-decor{position:absolute;pointer-events:none}
.kp-decor svg{display:block;width:100%;height:100%;overflow:visible}
.kp-empty{position:absolute;inset:0;display:grid;place-items:center;padding:16px;text-align:center;color:var(--kp-muted);font-size:13.5px;pointer-events:none}
.kp-item{position:absolute;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;outline:none}
.kp-item svg{display:block;width:100%;height:100%}
.kp-item:hover{filter:brightness(1.04)}
.kp-item.is-selected::after,.kp-item:focus-visible::after{content:"";position:absolute;inset:-3px;border:2px solid var(--kp-accent);border-radius:3px;pointer-events:none}
.kp-item.is-selected{z-index:2}
.kp-item.is-dragging{opacity:.25}
.kp-item.is-new{animation:kp-pop .28s ease-out}
@keyframes kp-pop{from{transform:translateY(-8px);opacity:.3}to{transform:none;opacity:1}}
.kp-preview{position:absolute;z-index:4;pointer-events:none;opacity:.92;outline:2px dashed var(--kp-ok);outline-offset:1px}
.kp-preview svg{display:block;width:100%;height:100%}
.kp-ghost{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;opacity:.88;filter:drop-shadow(0 8px 16px rgba(0,0,0,.25))}
.kp-ghost svg{display:block;width:100%;height:100%}
.kp-ghost.is-hidden{opacity:0}
.kp-ghost.is-bad{outline:2px solid var(--kp-danger);outline-offset:2px}
.kp-ghost.is-remove{opacity:.55}
.kp-ghost.is-remove::after{content:"×";position:absolute;top:-12px;right:-12px;width:24px;height:24px;display:grid;place-items:center;border-radius:50%;background:var(--kp-danger);color:#fff;font:700 16px/1 system-ui,sans-serif}
.kp-dims{position:relative;height:20px;margin-top:6px;font-size:11px;color:var(--kp-muted);font-variant-numeric:tabular-nums}
.kp-dims+.kp-dims{margin-top:2px}
.kp-dim{position:absolute;top:0;height:100%;display:flex;align-items:center;justify-content:center;border-left:1px solid rgba(0,0,0,.25);border-right:1px solid rgba(0,0,0,.25)}
.kp-dim::before{content:"";position:absolute;left:0;right:0;top:50%;border-top:1px solid rgba(0,0,0,.2)}
.kp-dim span{position:relative;padding:0 3px;background:var(--kp-bg);line-height:1}
.kp-dim.is-gap{color:#9a9ea4;border-color:rgba(0,0,0,.12)}
.kp-dim.is-gap::before{border-top-style:dashed}
.kp-dims.is-total .kp-dim span{font-weight:600;color:var(--kp-text)}

.kp-inspector{display:flex;align-items:flex-start;gap:14px;min-height:86px;max-height:230px;overflow:auto;padding:12px 16px;border-top:1px solid var(--kp-border);background:var(--kp-surface)}
.kp-hint{margin:0;font-size:13px;color:var(--kp-muted);max-width:70ch}
.kp-photo{flex:none;width:92px;height:92px;object-fit:contain;background:#fff;border:1px solid var(--kp-border);border-radius:8px}
.kp-insp-body{display:grid;gap:4px;min-width:0}
.kp-insp-title{font-weight:650}
.kp-insp-meta{font-size:12.5px;color:var(--kp-muted)}
.kp-insp-desc{margin:0;font-size:13px;max-width:75ch}
.kp-insp-actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:4px}
.kp-insp-price{margin-right:6px;font-variant-numeric:tabular-nums}

.kp-cornerblock{position:absolute;display:grid;place-items:center;background:repeating-linear-gradient(-45deg,rgba(0,0,0,.09) 0 3px,transparent 3px 8px);border:1px dashed rgba(0,0,0,.3);pointer-events:none;font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:var(--kp-muted)}
.kp-cornerblock span{padding:1px 4px;border-radius:3px;background:var(--kp-wall)}
.kp-seg.kp-text button{width:auto;padding:0 12px;font-weight:650;font-size:13px}
.kp-3d{position:relative;flex:1;min-height:0;overflow:hidden;background:var(--kp-surface)}
.kp-3d-canvas{position:absolute;inset:0;display:block;width:100%;height:100%;outline:none;cursor:grab;touch-action:none}
.kp-3d-canvas:focus-visible{box-shadow:inset 0 0 0 2px var(--kp-accent)}
.kp-3d-ui{position:absolute;left:12px;top:12px;display:flex;flex-wrap:wrap;gap:6px}
.kp-3d-ui .kp-btn{background:color-mix(in srgb,var(--kp-bg) 88%,transparent);backdrop-filter:blur(4px)}
.kp-3d-hint{position:absolute;left:12px;right:12px;bottom:10px;font-size:12px;color:var(--kp-muted);pointer-events:none}
.kp-3d-msg{position:absolute;inset:0;display:grid;place-items:center;padding:16px;text-align:center;color:var(--kp-muted)}
.kp-toast{position:absolute;left:50%;top:62px;z-index:10;max-width:90%;padding:8px 14px;border-radius:8px;background:#1f2328;color:#fff;font-size:13px;box-shadow:0 6px 18px rgba(0,0,0,.18);opacity:0;transform:translate(-50%,-6px);transition:opacity .2s,transform .2s;pointer-events:none}
.kp-toast.is-on{opacity:1;transform:translate(-50%,0)}

.kp-summary{grid-area:sum;display:flex;flex-direction:column;gap:14px;min-height:0;overflow:auto;padding:16px;border-left:1px solid var(--kp-border)}
.kp-sum-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.kp-sum-head h3{margin:0;font-size:16px}
.kp-lines{list-style:none;margin:0;padding:0;display:grid;gap:2px}
.kp-line{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:8px;align-items:baseline;padding:7px 0;border-bottom:1px solid var(--kp-border);font-size:13.5px}
.kp-qty{font-weight:650;font-variant-numeric:tabular-nums;color:var(--kp-muted)}
.kp-line-name{min-width:0}
.kp-line-name small{display:block;color:var(--kp-muted);font-size:11.5px}
.kp-line-price{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.kp-extras{display:grid;gap:8px;padding:10px 12px;background:var(--kp-surface);border-radius:9px;font-size:13px}
.kp-extra{display:flex;justify-content:space-between;gap:8px}
.kp-extra strong{font-variant-numeric:tabular-nums}
.kp-check{display:flex;align-items:center;gap:8px;cursor:pointer}
.kp-check input{width:16px;height:16px;accent-color:var(--kp-accent);margin:0}
.kp-total{display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding-top:4px;font-size:15px}
.kp-total strong{font-size:20px;font-variant-numeric:tabular-nums}
.kp-actions{display:grid;gap:8px}

@container kp (max-width:1150px){
  .kp{grid-template-columns:270px minmax(0,1fr);grid-template-areas:"cat main" "cat sum";height:auto;min-height:680px}
  .kp-catalog{contain:size}
  .kp-walls{overflow:visible}
  .kp-3d{flex:none;height:min(72vh,560px)}
  .kp-summary{border-left:0;border-top:1px solid var(--kp-border);overflow:visible}
}
@container kp (max-width:720px){
  .kp{grid-template-columns:minmax(0,1fr);grid-template-areas:"main" "cat" "sum";min-height:0}
  .kp-catalog{contain:none;max-height:65vh;border-right:0;border-top:1px solid var(--kp-border)}
  .kp-walls{padding:12px}
  .kp-inspector{flex-direction:column}
  .kp-3d{height:min(62vh,440px)}
  .kp-3d-hint{display:none}
}
@media (prefers-reduced-motion:reduce){.kp-item.is-new{animation:none}.kp-toast{transition:none}}
`;

  const LAYOUT_ICONS = [
    '<svg viewBox="0 0 24 24"><path d="M3 12h18"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M5 4v15h15"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M4 4v15h16V4"/></svg>',
  ];

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function shortName(el) {
    return el.name.replace(/^Kuhinja\s+/i, '');
  }

  // Minimal CSV reader: quotes, "" escapes, CRLF, and ; , or tab as separator (Excel varies by locale).
  function parseCsv(text) {
    text = String(text).replace(/^\ufeff/, '');
    const first = text.split(/\r?\n/, 1)[0];
    const count = ch => first.split(ch).length;
    const sep = [';', ',', '\t'].sort((a, b) => count(b) - count(a))[0];
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c !== '"') cell += c;
        else if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === sep) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  function toBase64(str) {
    let bin = '';
    new TextEncoder().encode(str).forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  function fromBase64(b64) {
    return new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
  }

  // First cell of the CSV row that carries the whole design for re-import.
  const CSV_MARKER = 'kitchen-planner';

  // ---------------------------------------------------------------------------
  // Planner
  // ---------------------------------------------------------------------------

  const DEFAULTS = {
    container: null,
    elements: null,       // array in the shop format or already normalized
    elementsUrl: null,    // or a URL returning such an array
    adapter: null,        // (rawItem) => normalized element, for other shop formats
    walls: null,          // [{ width: 300 }, …]
    design: null,         // a design from getDesign() to start with
    defaultSeries: null,
    prices: null,         // { [sku or id]: price }
    getPrice: null,       // (element) => price | null
    currency: 'BAM',
    locale: 'hr-HR',      // 'bs-BA' is formatted as "KM 1,332.50" in Chrome; hr-HR gives "1.332,50 KM
    storageKey: 'default',
    autosave: true,
    wallTop: WALL_TOP,
    worktopColor: null,
    theme: null,          // { accent: '#…', bg: '#…', … } → --kp-accent, --kp-bg, …
    labels: null,
    three: null,          // a loaded three.js module, if the site already has one
    threeUrl: null,       // otherwise it is imported from here when the 3D view opens (default: jsDelivr)
    onCheckout: null,     // (order) => void; shows the "send" button when set
    onChange: null,       // (design, order) => void
    onReady: null,
  };

  function create(options) {
    if (typeof document === 'undefined') throw new Error('KitchenPlanner.create radi samo u pregledniku');
    const opts = Object.assign({}, DEFAULTS, options);
    const L = Object.assign({}, DEFAULT_LABELS, opts.labels);
    L.groups = Object.assign({}, DEFAULT_LABELS.groups, opts.labels && opts.labels.groups);
    L.types = Object.assign({}, DEFAULT_LABELS.types, opts.labels && opts.labels.types);

    const container = typeof opts.container === 'string' ? document.querySelector(opts.container) : opts.container;
    if (!container) throw new Error('KitchenPlanner: container "' + opts.container + '" nije pronađen');

    const host = document.createElement('div');
    host.className = 'kitchen-planner';
    container.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    if (opts.theme) {
      Object.entries(opts.theme).forEach(([k, v]) => host.style.setProperty('--kp-' + k.replace(/[A-Z]/g, m => '-' + m.toLowerCase()), v));
    }
    if (opts.worktopColor) host.style.setProperty('--kp-worktop', opts.worktopColor);
    shadow.innerHTML = `<style>${CSS}</style><div class="kp-root"><div class="kp-status">${esc(L.loading)}</div></div>`;
    const rootEl = shadow.querySelector('.kp-root');

    const wallTop = opts.wallTop;
    const stageHeight = wallTop + 18;
    const storageId = 'kitchen-planner:' + opts.storageKey;
    const nf = (() => {
      try {
        return new Intl.NumberFormat([opts.locale, 'hr-HR'], { style: 'currency', currency: opts.currency, currencyDisplay: 'narrowSymbol' });
      } catch (e) {
        return { format: v => v.toFixed(2) + ' ' + opts.currency };
      }
    })();

    let catalog = [];
    const byId = new Map();
    let seriesNames = [];
    const state = {
      walls: [],
      items: [],
      plinth: { color: null, include: false },
      ui: { series: '', color: '', q: '', selected: null, activeWall: 'A', view: '2d' },
    };
    const past = [];
    const future = [];
    let els = {};
    let scale = 1;
    let seq = 0;
    let drag = null;
    let suppressClick = false;
    let toastTimer = 0;
    let ro = null;
    let lastAdded = null;
    let focusUid = null;
    let destroyed = false;
    let scene3d = null;
    let loading3d = null;
    let orbitDrag = null;
    const touches3d = new Map();

    const get = id => byId.get(String(id));
    const wallById = id => state.walls.find(w => w.id === id);
    const newUid = () => 'i' + (++seq).toString(36);
    const q = sel => shadow.querySelector(sel);

    function priceOf(el) {
      if (!el) return null;
      let p = null;
      if (typeof opts.getPrice === 'function') p = opts.getPrice(el);
      else if (opts.prices) p = opts.prices[el.sku] != null ? opts.prices[el.sku] : opts.prices[el.id];
      if (p == null) p = el.price;
      p = Number(p);
      return Number.isFinite(p) && p > 0 ? p : null;
    }

    async function loadElements() {
      let raw = opts.elements;
      if (!raw && opts.elementsUrl) {
        const res = await fetch(opts.elementsUrl, { credentials: 'same-origin' });
        if (!res.ok) throw new Error('HTTP ' + res.status + ' za ' + opts.elementsUrl);
        raw = await res.json();
      }
      if (!Array.isArray(raw)) raw = (raw && (raw.elements || raw.data || raw.items)) || [];
      return raw
        .map(r => (opts.adapter ? opts.adapter(r) : r && r.zone && r.type ? r : normalize(r)))
        .filter(e => e && e.active !== false && TYPES[e.type] && e.width > 0);
    }

    // ----- geometry ---------------------------------------------------------

    const ROW_MASK = { base: 1, wall: 2, tall: 3 };

    // Space `el` cannot use on a wall: elements on the same wall plus elements of the
    // neighbouring walls that reach into the shared corner (an overlap test in plan view).
    function blockers(wallId, el, exceptUid, items, walls) {
      items = items || state.items;
      walls = walls || state.walls;
      const idx = walls.findIndex(w => w.id === wallId);
      const wall = walls[idx];
      const prev = walls[idx - 1];
      const next = walls[idx + 1];
      const depth = depthOf(el);
      const out = [];
      items.forEach(i => {
        if (i.uid === exceptUid) return;
        const o = get(i.id);
        if (!o || !(ROW_MASK[o.zone] & ROW_MASK[el.zone])) return;
        if (i.wall === wallId) out.push({ x: i.x, w: o.width });
        else if (prev && i.wall === prev.id && i.x + o.width > prev.width - depth) out.push({ x: 0, w: depthOf(o) });
        else if (next && i.wall === next.id && i.x < depth) out.push({ x: wall.width - depthOf(o), w: depthOf(o) });
      });
      return out;
    }

    function layoutValid() {
      return state.items.every(i => {
        const w = wallById(i.wall);
        return w && fitsAmong(w.width, blockers(i.wall, get(i.id), i.uid), get(i.id), i.x);
      });
    }

    function fitsAmong(wallWidth, others, el, x) {
      return x >= 0 && x + el.width <= wallWidth && others.every(o => x + el.width <= o.x || x >= o.x + o.w);
    }

    /** Free x on the wall closest to `desired`, snapping to neighbours. null if nothing fits nearby. */
    function resolveX(wallId, el, desired, exceptUid) {
      const wall = wallById(wallId);
      if (!wall || el.width > wall.width) return null;
      const others = blockers(wallId, el, exceptUid);
      const all = state.items.filter(i => i.wall === wallId && i.uid !== exceptUid).map(i => ({ x: i.x, w: get(i.id).width }));
      const fits = x => fitsAmong(wall.width, others, el, x);
      desired = Math.round(desired);
      const cands = new Set([desired, 0, wall.width - el.width]);
      others.concat(all).forEach(o => {
        cands.add(o.x + o.w);
        cands.add(o.x - el.width);
        cands.add(o.x);
        cands.add(o.x + o.w - el.width);
      });
      const ok = [...cands].filter(fits).sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired));
      if (!ok.length) return null;
      const snapDist = Math.max(3, 14 / scale);
      const snapped = ok.find(c => c !== desired && Math.abs(c - desired) <= snapDist);
      if (snapped !== undefined) return snapped;
      if (fits(desired)) return desired;
      return Math.abs(ok[0] - desired) <= Math.max(el.width, 60) + 30 ? ok[0] : null;
    }

    function firstFree(wallId, el) {
      const wall = wallById(wallId);
      if (!wall) return null;
      const others = blockers(wallId, el, null);
      const cands = [0, wall.width - el.width];
      others.forEach(o => cands.push(o.x + o.w, o.x - el.width));
      state.items.filter(i => i.wall === wallId).forEach(i => cands.push(i.x, i.x + get(i.id).width));
      const ok = cands.filter(x => fitsAmong(wall.width, others, el, x)).sort((a, b) => a - b);
      return ok.length ? ok[0] : null;
    }

    function minWallWidth(wallId) {
      return state.items.filter(i => i.wall === wallId).reduce((m, i) => Math.max(m, i.x + get(i.id).width), 0);
    }

    // ----- design / history -------------------------------------------------

    function getDesign() {
      return {
        v: 1,
        walls: state.walls.map(w => ({ id: w.id, width: w.width })),
        items: state.items.map(i => ({ id: i.id, wall: i.wall, x: i.x })),
        plinth: { color: state.plinth.color, include: state.plinth.include },
      };
    }

    function loadDesignInto(d) {
      if (!d || !Array.isArray(d.walls) || !d.walls.length) return false;
      const src = d.walls.slice(0, MAX_WALLS);
      const walls = src.map((w, i) => ({ id: WALL_IDS[i], width: clamp(Math.round(+w.width) || 300, 60, 1200) }));
      const idMap = new Map(src.map((w, i) => [String(w.id == null ? WALL_IDS[i] : w.id), WALL_IDS[i]]));
      const items = [];
      for (const it of d.items || []) {
        const el = get(it.id);
        const wallId = idMap.get(String(it.wall));
        if (!el || !wallId || el.zone === 'accessory') continue;
        const wall = walls.find(w => w.id === wallId);
        const x = Math.round(+it.x || 0);
        if (!fitsAmong(wall.width, blockers(wallId, el, null, items, walls), el, x)) continue;
        items.push({ uid: newUid(), id: el.id, wall: wallId, x });
      }
      state.walls = walls;
      state.items = items;
      state.plinth = { color: (d.plinth && d.plinth.color) || null, include: !!(d.plinth && d.plinth.include) };
      if (!wallById(state.ui.activeWall)) state.ui.activeWall = 'A';
      if (!items.some(i => i.uid === state.ui.selected)) state.ui.selected = null;
      return true;
    }

    const snapshot = () => JSON.stringify(getDesign());

    function commit(fn) {
      const before = snapshot();
      fn();
      if (snapshot() === before) return false;
      past.push(before);
      if (past.length > 80) past.shift();
      future.length = 0;
      changed();
      return true;
    }

    function undo() {
      if (!past.length) return;
      future.push(snapshot());
      loadDesignInto(JSON.parse(past.pop()));
      changed();
    }

    function redo() {
      if (!future.length) return;
      past.push(snapshot());
      loadDesignInto(JSON.parse(future.pop()));
      changed();
    }

    function save() {
      if (!opts.autosave) return;
      try {
        localStorage.setItem(storageId, JSON.stringify(Object.assign(getDesign(), { series: state.ui.series, view: state.ui.view })));
      } catch (e) { /* storage unavailable */ }
    }

    function readStorage() {
      if (!opts.autosave) return null;
      try {
        return JSON.parse(localStorage.getItem(storageId) || 'null');
      } catch (e) {
        return null;
      }
    }

    function changed() {
      renderAll();
      save();
      if (typeof opts.onChange === 'function') opts.onChange(getDesign(), buildOrder());
    }

    // ----- actions ----------------------------------------------------------

    function addElement(id, preferWall) {
      const el = get(id);
      if (!el || el.zone === 'accessory') return null;
      const order = [preferWall || state.ui.activeWall].concat(state.walls.map(w => w.id));
      for (const wallId of order) {
        const x = firstFree(wallId, el);
        if (x != null) return placeNew(el, wallId, x);
      }
      toast(L.noSpace);
      return null;
    }

    function placeNew(el, wallId, x) {
      const item = { uid: newUid(), id: el.id, wall: wallId, x };
      lastAdded = item.uid;
      state.ui.selected = item.uid;
      state.ui.activeWall = wallId;
      commit(() => state.items.push(item));
      return item.uid;
    }

    function moveItem(uid, wallId, x) {
      const it = state.items.find(i => i.uid === uid);
      if (!it) return;
      state.ui.activeWall = wallId;
      state.ui.selected = uid;
      commit(() => { it.wall = wallId; it.x = x; });
    }

    function removeItem(uid) {
      if (!state.items.some(i => i.uid === uid)) return;
      if (state.ui.selected === uid) state.ui.selected = null;
      commit(() => { state.items = state.items.filter(i => i.uid !== uid); });
      toast(L.removed);
    }

    function nudge(uid, delta) {
      const it = state.items.find(i => i.uid === uid);
      if (!it) return;
      const el = get(it.id);
      const wall = wallById(it.wall);
      const others = blockers(it.wall, el, uid);
      const dir = Math.sign(delta);
      for (let s = Math.abs(delta); s >= 1; s--) {
        const x = it.x + dir * s;
        if (fitsAmong(wall.width, others, el, x)) {
          focusUid = uid;
          commit(() => { it.x = x; });
          return;
        }
      }
    }

    function duplicate(uid) {
      const it = state.items.find(i => i.uid === uid);
      if (!it) return;
      const el = get(it.id);
      const x = resolveX(it.wall, el, it.x + el.width, null);
      if (x != null) placeNew(el, it.wall, x);
      else addElement(el.id, it.wall);
    }

    function setLayout(n) {
      n = clamp(n, 1, MAX_WALLS);
      let removed = 0;
      commit(() => {
        while (state.walls.length < n) state.walls.push({ id: WALL_IDS[state.walls.length], width: 240 });
        if (state.walls.length > n) {
          const keep = new Set(state.walls.slice(0, n).map(w => w.id));
          removed = state.items.filter(i => !keep.has(i.wall)).length;
          state.items = state.items.filter(i => keep.has(i.wall));
          state.walls = state.walls.slice(0, n);
        }
        if (!wallById(state.ui.activeWall)) state.ui.activeWall = 'A';
      });
      if (removed) toast(L.wallsRemoved(removed));
    }

    function setWallWidth(wallId, value) {
      const wall = wallById(wallId);
      if (!wall) return;
      const min = Math.max(60, minWallWidth(wallId));
      let w = Math.round(+value);
      if (!Number.isFinite(w)) w = wall.width;
      if (w < min) toast(L.tooNarrow(min));
      w = clamp(w, min, 1200);
      const old = wall.width;
      wall.width = w;
      const ok = layoutValid();
      wall.width = old;
      if (!ok) {
        toast(L.cornerConflict);
        renderWalls();
        return;
      }
      if (!commit(() => { wall.width = w; })) renderWalls();
    }

    function clearAll() {
      if (!state.items.length) return;
      state.ui.selected = null;
      commit(() => { state.items = []; });
      toast(L.cleared);
    }

    function select(uid) {
      state.ui.selected = uid;
      const it = state.items.find(i => i.uid === uid);
      if (it) state.ui.activeWall = it.wall;
      shadow.querySelectorAll('.kp-item').forEach(n => n.classList.toggle('is-selected', n.dataset.uid === uid));
      if (scene3d) scene3d.setSelected(uid);
      renderInspector();
    }

    function switchSeries(target) {
      let ok = 0;
      let miss = 0;
      commit(() => {
        state.items.forEach(it => {
          const el = get(it.id);
          if (el.seriesList.includes(target)) return;
          const cands = catalog.filter(c => c.series === target && c.type === el.type && c.width === el.width);
          if (!cands.length) { miss++; return; }
          const score = c =>
            (state.ui.color && c.color !== state.ui.color ? 10 : 0) +
            (c.fronts.drawers === el.fronts.drawers ? 0 : 3) +
            (c.fronts.doors === el.fronts.doors ? 0 : 2) +
            Math.abs(c.height - el.height) / 100;
          cands.sort((a, b) => score(a) - score(b));
          it.prevId = it.id;
          it.id = cands[0].id;
          ok++;
        });
        // A different depth can collide in a corner; keep the original there.
        state.items.forEach(it => {
          if (it.prevId == null) return;
          const wall = wallById(it.wall);
          if (!fitsAmong(wall.width, blockers(it.wall, get(it.id), it.uid), get(it.id), it.x)) {
            it.id = it.prevId;
            ok--;
            miss++;
          }
          delete it.prevId;
        });
      });
      toast(L.switched(ok, miss));
    }

    // ----- order ------------------------------------------------------------

    function baseRowLength(filter) {
      return state.items.reduce((sum, i) => {
        const el = get(i.id);
        return el.zone !== 'wall' && (!filter || filter(el)) ? sum + el.width : sum;
      }, 0);
    }

    function plinthInfo() {
      const used = new Set(state.items.flatMap(i => get(i.id).seriesList));
      const plinths = catalog.filter(e => e.type === 'plinth' && e.seriesList.some(s => used.has(s)));
      if (!plinths.length) return null;
      const colors = [...new Set(plinths.map(p => p.color))];
      const color = colors.includes(state.plinth.color) ? state.plinth.color : colors[0];
      const length = baseRowLength();
      const pieces = plinths.filter(p => p.color === color).sort((a, b) => b.width - a.width);
      return { length, colors, color, pieces: bestCombo(length, pieces) };
    }

    // Fewest centimetres of waste, then fewest pieces.
    function bestCombo(length, pieces) {
      if (!length || !pieces.length) return [];
      let best = null;
      const counts = new Array(pieces.length).fill(0);
      const walk = (k, total) => {
        if (k === pieces.length) {
          if (total < length) return;
          const n = counts.reduce((a, b) => a + b, 0);
          const waste = total - length;
          if (!best || waste < best.waste || (waste === best.waste && n < best.n)) best = { waste, n, counts: counts.slice() };
          return;
        }
        const max = Math.ceil((length - Math.min(total, length)) / pieces[k].width);
        for (let c = 0; c <= max; c++) {
          counts[k] = c;
          walk(k + 1, total + c * pieces[k].width);
        }
        counts[k] = 0;
      };
      walk(0, 0);
      return best ? pieces.map((el, i) => ({ element: el, qty: best.counts[i] })).filter(p => p.qty) : [];
    }

    function buildOrder() {
      const groups = new Map();
      state.items.forEach(i => {
        const el = get(i.id);
        const g = groups.get(el.id) || { element: el, qty: 0 };
        g.qty++;
        groups.set(el.id, g);
      });
      const zoneRank = { base: 0, tall: 1, wall: 2 };
      const entries = [...groups.values()].sort((a, b) =>
        zoneRank[a.element.zone] - zoneRank[b.element.zone] ||
        TYPE_ORDER.indexOf(a.element.type) - TYPE_ORDER.indexOf(b.element.type) ||
        a.element.width - b.element.width);
      const plinth = state.items.length ? plinthInfo() : null;
      if (plinth && state.plinth.include) plinth.pieces.forEach(p => entries.push(p));
      const lines = entries.map(({ element: el, qty }) => {
        const unit = priceOf(el);
        return {
          id: el.id,
          sku: el.sku,
          name: el.fullName || el.name,
          qty,
          unitPrice: unit,
          total: unit == null ? null : Math.round(unit * qty * 100) / 100,
        };
      });
      const priced = lines.filter(l => l.total != null);
      return {
        lines,
        count: state.items.length,
        total: priced.length ? Math.round(priced.reduce((s, l) => s + l.total, 0) * 100) / 100 : null,
        complete: priced.length === lines.length,
        currency: opts.currency,
        worktopCm: baseRowLength(el => el.zone === 'base' && !el.withWorktop),
        plinthCm: plinth ? plinth.length : null,
        design: getDesign(),
      };
    }

    // The CSV is a readable specification (order, walls, positions) and can be loaded back:
    // the last row carries the exact design, the "Zidovi"/"Raspored" rows are the fallback.
    function buildCsv() {
      const o = buildOrder();
      const numCell = v => (v == null ? '' : String(v).replace('.', ','));
      const rows = [L.csvHeaders].concat(o.lines.map(l => [l.sku, l.name, l.qty, numCell(l.unitPrice), numCell(l.total)]));
      rows.push([]);
      if (o.total != null) rows.push(['', o.complete ? L.total : L.totalPartial, '', '', numCell(o.total)]);
      if (o.worktopCm) rows.push(['', L.worktop, o.worktopCm + ' cm']);
      if (o.plinthCm) rows.push(['', L.plinth, o.plinthCm + ' cm']);
      rows.push([], [L.csvWalls], L.csvWallHeaders);
      state.walls.forEach(w => rows.push([w.id, w.width]));
      rows.push([], [L.csvLayout], L.csvLayoutHeaders);
      state.items.slice().sort((a, b) => a.wall.localeCompare(b.wall) || a.x - b.x).forEach(i => {
        const el = get(i.id);
        rows.push([i.wall, i.x, el.sku || el.id, el.fullName || el.name, `${el.width} × ${el.height} × ${el.depth}`]);
      });
      const design = Object.assign(getDesign(), { series: state.ui.series });
      rows.push([], [CSV_MARKER, 'v1:' + toBase64(JSON.stringify(design)), L.csvKeep]);
      return '\ufeff' + rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\r\n') + '\r\n';
    }

    function designFromCsv(text) {
      const rows = parseCsv(text).map(r => r.map(c => c.trim()));
      const marker = rows.find(r => r[0] === CSV_MARKER && /^v1:/.test(r[1] || ''));
      if (marker) {
        try {
          return JSON.parse(fromBase64(marker[1].slice(3)));
        } catch (e) { /* damaged, use the readable rows */ }
      }
      const bySku = new Map(catalog.map(e => [String(e.sku), e]));
      const walls = [];
      const items = [];
      rows.forEach(c => {
        if (!/^[A-D]$/.test(c[0]) || !/^-?\d+([.,]\d+)?$/.test(c[1] || '')) return;
        const n = Math.round(parseFloat(c[1].replace(',', '.')));
        if (c.filter(Boolean).length === 2) walls.push({ id: c[0], width: n });
        else {
          const el = bySku.get(c[2]) || get(c[2]);
          items.push({ id: el ? el.id : c[2], wall: c[0], x: n });
        }
      });
      walls.sort((a, b) => a.id.localeCompare(b.id));
      return walls.length ? { walls, items } : null;
    }

    function importText(text) {
      const t = String(text).replace(/^\ufeff/, '').trim();
      let design = null;
      try {
        if (t.startsWith('{')) {
          const j = JSON.parse(t);
          design = j.design || j;
        } else {
          design = designFromCsv(t);
        }
      } catch (e) {
        design = null;
      }
      if (!design || !Array.isArray(design.walls) || !design.walls.length) {
        toast(L.importError);
        return false;
      }
      const wanted = (design.items || []).length;
      state.ui.selected = null;
      commit(() => { loadDesignInto(design); });
      // The saved catalog filter wins only if the kitchen actually uses that line.
      const usedSeries = state.items.some(i => get(i.id).seriesList.includes(design.series));
      const series = design.series === '' || usedSeries ? design.series : dominantSeries();
      if (series && series !== state.ui.series) {
        state.ui.series = series;
        fillFilters();
        renderCatalog();
        renderSwitch();
        save();
      }
      toast(L.imported(state.items.length, Math.max(0, wanted - state.items.length)));
      return true;
    }

    function importFile(file) {
      return file.text().then(importText);
    }

    function exportCsv() {
      const csv = buildCsv();
      const d = new Date();
      const day = [d.getFullYear(), d.getMonth() + 1, d.getDate()].map(v => String(v).padStart(2, '0')).join('-');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = `${L.fileName}-${day}.csv`;
      shadow.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }

    // ----- rendering --------------------------------------------------------

    function mount() {
      rootEl.innerHTML = `
<div class="kp">
  <aside class="kp-catalog" aria-label="${esc(L.catalog)}">
    <div class="kp-cat-head">
      <div class="kp-title">${esc(L.catalog)}</div>
      <div class="kp-row2">
        <label class="kp-field">${esc(L.series)}<select class="kp-select" data-filter="series"></select></label>
        <label class="kp-field">${esc(L.color)}<select class="kp-select" data-filter="color"></select></label>
      </div>
      <input class="kp-input" type="search" data-filter="q" placeholder="${esc(L.search)}" aria-label="${esc(L.search)}">
      <div class="kp-switch" hidden></div>
    </div>
    <div class="kp-cat-list"></div>
  </aside>
  <section class="kp-main">
    <div class="kp-toolbar">
      <div class="kp-seg" role="group" aria-label="${esc(L.layout)}">
        ${LAYOUT_ICONS.map((icon, i) => `<button type="button" data-layout="${i + 1}" title="${esc(L.layouts[i])}" aria-label="${esc(L.layouts[i])}">${icon}</button>`).join('')}
      </div>
      <div class="kp-seg kp-text" role="group" aria-label="${esc(L.view)}">
        <button type="button" data-view="2d">${esc(L.view2d)}</button><button type="button" data-view="3d">${esc(L.view3d)}</button>
      </div>
      <span class="kp-spacer"></span>
      <button type="button" class="kp-btn" data-act="undo" title="Ctrl+Z">↶ ${esc(L.undo)}</button>
      <button type="button" class="kp-btn" data-act="redo" title="Ctrl+Shift+Z">↷ ${esc(L.redo)}</button>
      <button type="button" class="kp-btn kp-danger" data-act="clear">${esc(L.clear)}</button>
    </div>
    <div class="kp-walls"></div>
    <div class="kp-3d" hidden>
      <div class="kp-3d-ui">
        <button type="button" class="kp-btn" data-act="view-reset">⟲ ${esc(L.resetView)}</button>
        <button type="button" class="kp-btn" data-act="view-top">${esc(L.topView)}</button>
      </div>
      <div class="kp-3d-hint">${esc(L.hint3d)}</div>
      <div class="kp-3d-msg" hidden></div>
    </div>
    <div class="kp-inspector"></div>
    <div class="kp-toast" role="status" aria-live="polite"></div>
    <input type="file" class="kp-file" accept=".csv,.json,text/csv,application/json" hidden>
  </section>
  <aside class="kp-summary" aria-live="polite"></aside>
</div>`;
      els = {
        kp: q('.kp'),
        cat: q('.kp-cat-list'),
        series: q('[data-filter="series"]'),
        color: q('[data-filter="color"]'),
        search: q('[data-filter="q"]'),
        sw: q('.kp-switch'),
        walls: q('.kp-walls'),
        insp: q('.kp-inspector'),
        sum: q('.kp-summary'),
        toast: q('.kp-toast'),
        undo: q('[data-act="undo"]'),
        redo: q('[data-act="redo"]'),
        layouts: [...shadow.querySelectorAll('[data-layout]')],
        views: [...shadow.querySelectorAll('[data-view]')],
        v3d: q('.kp-3d'),
        msg3d: q('.kp-3d-msg'),
        file: q('.kp-file'),
      };

      const saved = opts.design || readStorage();
      if (!loadDesignInto(saved)) {
        state.walls = (opts.walls || [{ width: 300 }]).slice(0, MAX_WALLS)
          .map((w, i) => ({ id: WALL_IDS[i], width: clamp(Math.round(+w.width) || 300, 60, 1200) }));
      }
      state.ui.series = pickSeries(saved && saved.series);
      fillFilters();

      shadow.addEventListener('click', onClick);
      shadow.addEventListener('change', onChange);
      shadow.addEventListener('input', onInput);
      shadow.addEventListener('pointerdown', onPointerDown);
      shadow.addEventListener('keydown', onKeyDown);
      shadow.addEventListener('focusin', onFocusIn);

      renderCatalog();
      renderAll();
      ro = new ResizeObserver(() => {
        if (Math.abs(computeScale() - scale) > 0.005) renderWalls();
      });
      ro.observe(els.walls);
      setView(saved && saved.view === '3d' ? '3d' : '2d');
      if (typeof opts.onReady === 'function') opts.onReady(api);
    }

    function pickSeries(savedSeries) {
      if (opts.defaultSeries && seriesNames.includes(opts.defaultSeries)) return opts.defaultSeries;
      if (savedSeries === '' || seriesNames.includes(savedSeries)) return savedSeries;
      return dominantSeries() || seriesNames[0] || '';
    }

    function dominantSeries() {
      const counts = {};
      state.items.forEach(i => { const s = get(i.id).series; counts[s] = (counts[s] || 0) + 1; });
      const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
      return top && seriesNames.includes(top) ? top : null;
    }

    function fillFilters() {
      els.series.innerHTML = `<option value="">${esc(L.allSeries)}</option>` +
        seriesNames.map(s => `<option value="${esc(s)}"${s === state.ui.series ? ' selected' : ''}>${esc(s)}</option>`).join('');
      const colors = [...new Set(catalog
        .filter(e => e.zone !== 'accessory' && (!state.ui.series || e.seriesList.includes(state.ui.series)))
        .map(e => e.color))].sort((a, b) => a.localeCompare(b));
      if (!colors.includes(state.ui.color)) state.ui.color = '';
      els.color.innerHTML = `<option value="">${esc(L.allColors)}</option>` +
        colors.map(c => `<option value="${esc(c)}"${c === state.ui.color ? ' selected' : ''}>${esc(c)}</option>`).join('');
      els.color.disabled = colors.length < 2;
    }

    function renderCatalog() {
      const { series, color } = state.ui;
      const needle = state.ui.q.trim().toLowerCase();
      const list = catalog
        .filter(e => e.zone !== 'accessory' &&
          (!series || e.seriesList.includes(series)) &&
          (!color || e.color === color) &&
          (!needle || (e.name + ' ' + e.fullName + ' ' + e.sku).toLowerCase().includes(needle)))
        .sort((a, b) =>
          (series ? 0 : a.series.localeCompare(b.series)) ||
          TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) ||
          a.width - b.width ||
          a.name.localeCompare(b.name));
      const html = ['base', 'wall', 'tall', 'corner', 'other'].map(g => {
        const items = list.filter(e => e.group === g);
        if (!items.length) return '';
        return `<h4 class="kp-group-title">${esc(L.groups[g])}</h4><div class="kp-cards">${items.map(cardHtml).join('')}</div>`;
      }).join('');
      els.cat.innerHTML = html || `<p class="kp-muted">${esc(L.noResults)}</p>`;
    }

    function cardHtml(el) {
      const p = priceOf(el);
      const name = state.ui.series ? shortName(el).replace(new RegExp('^' + el.series.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '\\s*'), '') : shortName(el);
      return `<button type="button" class="kp-card" data-add="${esc(el.id)}" title="${esc(el.fullName)}" aria-label="${esc(L.add + ': ' + el.fullName)}">
  <span class="kp-thumb">${drawSvg(el, { thumb: true })}</span>
  <span class="kp-card-body">
    <span class="kp-card-name">${esc(name)}</span>
    <span class="kp-card-meta">${esc(L.types[el.type])} · ${el.width}×${el.height}×${el.depth}</span>
    ${p != null ? `<span class="kp-card-price">${esc(nf.format(p))}</span>` : ''}
  </span>
</button>`;
    }

    function renderSwitch() {
      const s = state.ui.series;
      const show = !!s && state.items.some(i => !get(i.id).seriesList.includes(s));
      els.sw.hidden = !show;
      els.sw.innerHTML = show ? `<button type="button" class="kp-btn kp-soft kp-block" data-act="switch-series">${esc(L.switchSeries(s))}</button>` : '';
    }

    function computeScale() {
      const avail = (els.walls.clientWidth || 800) - 36;
      const maxW = Math.max(...state.walls.map(w => w.width));
      return clamp(avail / maxW, 0.5, 2);
    }

    const px = v => (v * scale).toFixed(2) + 'px';

    function renderWalls() {
      scale = computeScale();
      els.walls.innerHTML = state.walls.map(wallHtml).join('');
      if (focusUid) {
        const n = els.walls.querySelector(`.kp-item[data-uid="${focusUid}"]`);
        if (n) n.focus({ preventScroll: true });
        focusUid = null;
      }
      lastAdded = null;
    }

    function wallHtml(wall, index) {
      const items = state.items.filter(i => i.wall === wall.id);
      const used = zone => items.reduce((s, i) => {
        const el = get(i.id);
        return ROW_MASK[el.zone] & ROW_MASK[zone] ? s + el.width : s;
      }, 0);
      const W = wall.width;
      const blocks = cornerBlocks(index);
      const blocked = row => {
        const spans = blocks.filter(b => ROW_MASK[b.el.zone] & ROW_MASK[row]).map(b => [b.x, b.x + b.w]).sort((a, b) => a[0] - b[0]);
        let total = 0;
        let end = -Infinity;
        spans.forEach(([a, b]) => {
          if (b <= end) return;
          total += b - Math.max(a, end);
          end = b;
        });
        return total;
      };
      const free = row => Math.max(0, W - used(row) - blocked(row));
      const parts = [];
      blocks.forEach(b => {
        const y = b.el.zone === 'wall' ? wallTop - b.el.height : 0;
        const h = b.el.zone === 'base' ? BASE_HEIGHT + WORKTOP : renderHeight(b.el);
        parts.push(`<div class="kp-cornerblock" title="${esc(L.cornerTitle(shortName(b.el)))}" style="left:${px(b.x)};bottom:${px(y)};width:${px(b.w)};height:${px(h)}">${b.w * scale > 36 ? `<span>${esc(L.corner)}</span>` : ''}</div>`);
      });
      parts.push(`<div class="kp-guide" style="bottom:${px(BASE_HEIGHT + WORKTOP)}"><span>${BASE_HEIGHT + WORKTOP} cm</span></div>`);
      parts.push(`<div class="kp-guide" style="bottom:${px(wallTop)}"><span>${wallTop} cm</span></div>`);
      worktopRuns(items).forEach(r => {
        parts.push(`<div class="kp-worktop" style="left:${px(r.x)};width:${px(r.w)};bottom:${px(BASE_HEIGHT)};height:${px(WORKTOP)}"></div>`);
      });
      items.forEach(i => {
        const el = get(i.id);
        const y = el.zone === 'wall' ? wallTop - el.height : 0;
        const cls = 'kp-item' + (i.uid === state.ui.selected ? ' is-selected' : '') + (i.uid === lastAdded ? ' is-new' : '');
        const label = `${shortName(el)}, ${el.width} cm, ${i.x} cm od lijevog ruba`;
        parts.push(`<div class="${cls}" data-uid="${i.uid}" tabindex="0" role="button" aria-label="${esc(label)}" title="${esc(shortName(el))}" style="left:${px(i.x)};bottom:${px(y)};width:${px(el.width)};height:${px(renderHeight(el))}">${drawSvg(el)}</div>`);
        if (el.type === 'sink') {
          parts.push(`<div class="kp-decor" style="left:${px(i.x + el.width / 2 - 8)};bottom:${px(BASE_HEIGHT + WORKTOP)};width:${px(16)};height:${px(24)}">${FAUCET_SVG}</div>`);
        } else if (el.type === 'oven') {
          parts.push(`<div class="kp-decor" style="left:${px(i.x + 5)};bottom:${px(BASE_HEIGHT + WORKTOP)};width:${px(el.width - 10)};height:${px(1.4)}">${HOB_SVG}</div>`);
        }
      });
      if (!items.length) parts.push(`<div class="kp-empty">${esc(L.emptyStage)}</div>`);
      return `<section class="kp-wall">
  <div class="kp-wall-head">
    <span class="kp-wall-name">${esc(L.wall)} ${wall.id}</span>
    <label class="kp-wall-width">${esc(L.width)} <input class="kp-input" type="number" inputmode="numeric" min="60" max="1200" step="1" value="${W}" data-wall-width="${wall.id}"> cm</label>
    <span class="kp-free">${free('base')} cm ${esc(L.freeBase)} · ${free('wall')} cm ${esc(L.freeWall)}</span>
    ${index > 0 ? `<span class="kp-corner">↳ ${esc(L.cornerHint(state.walls[index - 1].id))}</span>` : ''}
  </div>
  <div class="kp-stage-scroll">
    <div class="kp-stage" data-stage="${wall.id}" style="width:${px(W)};height:${px(stageHeight)};background-size:${px(10)} 100%">${parts.join('')}</div>
    <div class="kp-dims" style="width:${px(W)}">${dimsHtml(items, W)}</div>
    <div class="kp-dims is-total" style="width:${px(W)}"><div class="kp-dim" style="left:0;width:${px(W)}"><span>${W} cm</span></div></div>
  </div>
</section>`;
    }

    // Elements of the neighbouring walls that stand in this wall's corners (for drawing only).
    function cornerBlocks(index) {
      const wall = state.walls[index];
      const prev = state.walls[index - 1];
      const next = state.walls[index + 1];
      const reach = el => (el.zone === 'wall' ? 30 : 46);
      const out = new Map();
      const add = (x, el) => out.set(`${x}:${depthOf(el)}:${el.zone}`, { x, w: depthOf(el), el });
      state.items.forEach(i => {
        const el = get(i.id);
        if (prev && i.wall === prev.id && i.x + el.width > prev.width - reach(el)) add(0, el);
        if (next && i.wall === next.id && i.x < reach(el)) add(wall.width - depthOf(el), el);
      });
      return [...out.values()];
    }

    function worktopRuns(items) {
      const base = items.map(i => ({ x: i.x, w: get(i.id).width, zone: get(i.id).zone }))
        .filter(o => o.zone === 'base')
        .sort((a, b) => a.x - b.x);
      const runs = [];
      base.forEach(o => {
        const last = runs[runs.length - 1];
        if (last && o.x <= last.x + last.w) last.w = Math.max(last.w, o.x + o.w - last.x);
        else runs.push({ x: o.x, w: o.w });
      });
      return runs;
    }

    function dimsHtml(items, W) {
      const occ = items.map(i => ({ x: i.x, w: get(i.id).width, zone: get(i.id).zone }))
        .filter(o => o.zone !== 'wall')
        .sort((a, b) => a.x - b.x);
      const segs = [];
      let cur = 0;
      occ.forEach(o => {
        if (o.x > cur) segs.push({ x: cur, w: o.x - cur, gap: true });
        segs.push({ x: o.x, w: o.w });
        cur = Math.max(cur, o.x + o.w);
      });
      if (cur < W) segs.push({ x: cur, w: W - cur, gap: true });
      if (segs.length === 1 && segs[0].gap) return '';
      return segs.map(s => `<div class="kp-dim${s.gap ? ' is-gap' : ''}" style="left:${px(s.x)};width:${px(s.w)}">${s.w * scale >= 22 ? `<span>${s.w}</span>` : ''}</div>`).join('');
    }

    function renderInspector() {
      const it = state.items.find(i => i.uid === state.ui.selected);
      if (!it) {
        els.insp.innerHTML = `<p class="kp-hint">${esc(L.inspectorHint)}</p>`;
        return;
      }
      const el = get(it.id);
      const p = priceOf(el);
      els.insp.innerHTML = `
${el.images[0] ? `<img class="kp-photo" src="${esc(el.images[0])}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
<div class="kp-insp-body">
  <div class="kp-insp-title">${esc(el.fullName)}</div>
  <div class="kp-insp-meta">${esc(L.sku)} ${esc(el.sku)} · ${el.width} × ${el.height} × ${el.depth} cm · ${esc(el.color)}${el.withWorktop ? ' · ' + esc(L.withWorktop) : ''}</div>
  ${el.description ? `<p class="kp-insp-desc">${esc(el.description)}</p>` : ''}
  <div class="kp-insp-actions">
    <strong class="kp-insp-price">${esc(p != null ? nf.format(p) : L.priceOnRequest)}</strong>
    <button type="button" class="kp-btn kp-icon" data-act="left" title="${esc(L.moveLeft)}" aria-label="${esc(L.moveLeft)}">←</button>
    <button type="button" class="kp-btn kp-icon" data-act="right" title="${esc(L.moveRight)}" aria-label="${esc(L.moveRight)}">→</button>
    <button type="button" class="kp-btn" data-act="duplicate">${esc(L.duplicate)}</button>
    <button type="button" class="kp-btn kp-danger" data-act="remove">${esc(L.remove)}</button>
  </div>
</div>`;
      const img = els.insp.querySelector('img');
      if (img) img.addEventListener('error', () => img.remove());
    }

    function renderSummary() {
      const o = buildOrder();
      const plinth = state.items.length ? plinthInfo() : null;
      const head = `<div class="kp-sum-head"><h3>${esc(L.summary)}</h3><span class="kp-muted">${esc(L.elementsCount(o.count))}</span></div>`;
      const importBtn = `<button type="button" class="kp-btn" data-act="import">${esc(L.importSpec)}</button>`;
      if (!o.count) {
        els.sum.innerHTML = head + `<p class="kp-muted">${esc(L.emptySummary)}</p><div class="kp-actions">${importBtn}</div>`;
        return;
      }
      const lines = o.lines.map(l => `<li class="kp-line">
  <span class="kp-qty">${l.qty}×</span>
  <span class="kp-line-name">${esc(l.name.replace(/^Kuhinja\s+/i, ''))}<small>${esc(L.sku)} ${esc(l.sku)}</small></span>
  <span class="kp-line-price">${l.total != null ? esc(nf.format(l.total)) : '—'}</span>
</li>`).join('');
      let extras = '';
      if (o.worktopCm) extras += `<div class="kp-extra"><span>${esc(L.worktop)}</span><strong>${o.worktopCm} cm</strong></div>`;
      if (plinth && plinth.length) {
        const suggestion = plinth.pieces.map(p => `${p.qty}× ${p.element.width >= 100 ? p.element.width / 100 + ' m' : p.element.width + ' cm'}`).join(' + ');
        extras += `<div class="kp-extra"><span>${esc(L.plinth)}</span><strong>${plinth.length} cm</strong></div>
<div class="kp-row2">
  <select class="kp-select" data-plinth="color" aria-label="${esc(L.plinth + ' – ' + L.color)}">${plinth.colors.map(c => `<option${c === plinth.color ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
  <span class="kp-muted" style="align-self:center;font-size:12px">${esc(L.plinthSuggest)}: ${esc(suggestion)}</span>
</div>
<label class="kp-check"><input type="checkbox" data-plinth="include"${state.plinth.include ? ' checked' : ''}> ${esc(L.plinthAdd)}</label>`;
      }
      const total = o.total != null
        ? `<div class="kp-total"><span>${esc(o.complete ? L.total : L.totalPartial)}</span><strong>${esc(nf.format(o.total))}</strong></div>`
        : `<div class="kp-total"><span>${esc(L.total)}</span><strong style="font-size:15px">${esc(L.priceOnRequest)}</strong></div>`;
      els.sum.innerHTML = head +
        `<ul class="kp-lines">${lines}</ul>` +
        (extras ? `<div class="kp-extras">${extras}</div>` : '') +
        total +
        `<div class="kp-actions">
  ${typeof opts.onCheckout === 'function' ? `<button type="button" class="kp-btn kp-primary" data-act="checkout">${esc(L.checkout)}</button>` : ''}
  <button type="button" class="kp-btn" data-act="csv">${esc(L.exportCsv)}</button>
  ${importBtn}
</div>`;
    }

    function renderAll() {
      renderWalls();
      renderSummary();
      renderInspector();
      renderSwitch();
      els.undo.disabled = !past.length;
      els.redo.disabled = !future.length;
      els.layouts.forEach((b, i) => b.setAttribute('aria-pressed', String(i + 1 === state.walls.length)));
      if (scene3d && state.ui.view === '3d') {
        scene3d.rebuild();
        scene3d.setSelected(state.ui.selected);
      }
    }

    function toast(msg) {
      if (!els.toast) return;
      els.toast.textContent = msg;
      els.toast.classList.add('is-on');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => els.toast.classList.remove('is-on'), 3500);
    }

    // ----- events -----------------------------------------------------------

    function onClick(ev) {
      if (suppressClick) return;
      const t = ev.target;
      const card = t.closest('[data-add]');
      if (card) {
        const uid = addElement(card.dataset.add);
        const it = uid && state.items.find(i => i.uid === uid);
        if (it) toast(L.added(shortName(get(it.id)), it.wall));
        return;
      }
      const lay = t.closest('[data-layout]');
      if (lay) { setLayout(+lay.dataset.layout); return; }
      const view = t.closest('[data-view]');
      if (view) { setView(view.dataset.view); return; }
      const act = t.closest('[data-act]');
      if (act) { doAction(act.dataset.act); return; }
      const item = t.closest('.kp-item');
      if (item) { select(item.dataset.uid); return; }
      const stage = t.closest('.kp-stage');
      if (stage) {
        state.ui.activeWall = stage.dataset.stage;
        select(null);
      }
    }

    function doAction(a) {
      const sel = state.ui.selected;
      switch (a) {
        case 'undo': undo(); break;
        case 'redo': redo(); break;
        case 'clear': clearAll(); break;
        case 'csv': exportCsv(); break;
        case 'import': els.file.click(); break;
        case 'checkout': opts.onCheckout(buildOrder()); break;
        case 'switch-series': switchSeries(state.ui.series); break;
        case 'remove': if (sel) removeItem(sel); break;
        case 'duplicate': if (sel) duplicate(sel); break;
        case 'left': if (sel) nudge(sel, -1); break;
        case 'right': if (sel) nudge(sel, 1); break;
        case 'view-reset': if (scene3d) scene3d.resetView(); break;
        case 'view-top': if (scene3d) scene3d.topView(); break;
      }
    }

    function onChange(ev) {
      const t = ev.target;
      if (t === els.file) {
        const file = t.files && t.files[0];
        t.value = '';
        if (file) importFile(file).catch(() => toast(L.importError));
        return;
      }
      if (t === els.series) {
        state.ui.series = t.value;
        fillFilters();
        renderCatalog();
        renderSwitch();
        save();
      } else if (t === els.color) {
        state.ui.color = t.value;
        renderCatalog();
      } else if (t.dataset.wallWidth) {
        state.ui.activeWall = t.dataset.wallWidth;
        setWallWidth(t.dataset.wallWidth, t.value);
      } else if (t.dataset.plinth === 'color') {
        commit(() => { state.plinth.color = t.value; });
      } else if (t.dataset.plinth === 'include') {
        commit(() => { state.plinth.include = t.checked; });
      }
    }

    function onInput(ev) {
      if (ev.target === els.search) {
        state.ui.q = ev.target.value;
        renderCatalog();
      }
    }

    function onFocusIn(ev) {
      const item = ev.target.closest && ev.target.closest('.kp-item');
      if (item && item.dataset.uid !== state.ui.selected) select(item.dataset.uid);
    }

    function onKeyDown(ev) {
      const t = ev.target;
      const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName);
      const mod = ev.ctrlKey || ev.metaKey;
      if (mod && !typing && ev.key.toLowerCase() === 'z') { ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
      if (mod && !typing && ev.key.toLowerCase() === 'y') { ev.preventDefault(); redo(); return; }
      if (ev.key === 'Escape') {
        if (drag) cancelDrag();
        else if (state.ui.selected) select(null);
        return;
      }
      const item = t.closest && t.closest('.kp-item');
      const uid = item ? item.dataset.uid : scene3d && t === scene3d.canvas ? state.ui.selected : null;
      if (!uid) return;
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
        ev.preventDefault();
        nudge(uid, (ev.key === 'ArrowLeft' ? -1 : 1) * (ev.shiftKey ? 10 : 1));
      } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
        ev.preventDefault();
        removeItem(uid);
      } else if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        select(uid);
      }
    }

    // ----- drag & drop ------------------------------------------------------

    function onPointerDown(ev) {
      if (ev.button !== 0 || drag) return;
      const card = ev.target.closest('.kp-card');
      const itemEl = ev.target.closest('.kp-item');
      if (!card && !itemEl) return;
      // On touch screens the catalog must stay scrollable, so cards are added with a tap.
      if (card && ev.pointerType === 'touch') return;
      let el;
      let item = null;
      let grabX;
      let grabY;
      if (card) {
        ev.preventDefault();
        el = get(card.dataset.add);
        grabX = el.width / 2;
        grabY = renderHeight(el) / 2;
      } else {
        item = state.items.find(i => i.uid === itemEl.dataset.uid);
        el = get(item.id);
        const r = itemEl.getBoundingClientRect();
        grabX = (ev.clientX - r.left) / scale;
        grabY = (ev.clientY - r.top) / scale;
        ev.preventDefault();
        itemEl.focus({ preventScroll: true });
      }
      const source = card || itemEl;
      try { source.setPointerCapture(ev.pointerId); } catch (e) { /* not capturable */ }
      drag = { el, item, itemEl, source, pointerId: ev.pointerId, sx: ev.clientX, sy: ev.clientY, grabX, grabY, started: false, target: null, overWall: false, ghost: null, preview: null, stage: null };
      window.addEventListener('pointermove', onPointerMove, { passive: false });
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', cancelDrag);
    }

    function onPointerMove(ev) {
      if (!drag || ev.pointerId !== drag.pointerId) return;
      if (!drag.started) {
        if (Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < 5) return;
        startDrag();
      }
      ev.preventDefault();
      updateDrag(ev.clientX, ev.clientY);
    }

    const noSelect = e => e.preventDefault();

    function startDrag() {
      drag.started = true;
      try { window.getSelection().removeAllRanges(); } catch (e) { /* no selection API */ }
      document.addEventListener('selectstart', noSelect);
      const g = document.createElement('div');
      g.className = 'kp-ghost';
      g.style.width = px(drag.el.width);
      g.style.height = px(renderHeight(drag.el));
      g.innerHTML = drawSvg(drag.el);
      rootEl.appendChild(g);
      drag.ghost = g;
      if (drag.itemEl) drag.itemEl.classList.add('is-dragging');
      if (drag.from3d) scene3d.setHidden(drag.item.uid);
      els.kp.classList.add('is-dragging');
    }

    function stageAt(cx, cy) {
      for (const st of shadow.querySelectorAll('.kp-stage')) {
        const r = st.getBoundingClientRect();
        if (cx >= r.left - 24 && cx <= r.right + 24 && cy >= r.top - 30 && cy <= r.bottom + 48) return { st, r, wallId: st.dataset.stage };
      }
      return null;
    }

    function updateDrag(cx, cy) {
      const d = drag;
      d.ghost.style.transform = `translate(${cx - d.grabX * scale}px, ${cy - d.grabY * scale}px)`;
      const in3d = state.ui.view === '3d' && !!scene3d;
      let hit = null;
      let desired = 0;
      d.over3d = in3d && scene3d.contains(cx, cy);
      if (d.over3d) {
        const wh = scene3d.wallHit(cx, cy);
        if (wh) {
          hit = { wallId: wh.wallId, st: null };
          desired = wh.localX - d.grabX;
        }
      } else if (!in3d) {
        hit = stageAt(cx, cy);
        if (hit) desired = (cx - hit.r.left) / scale - d.grabX;
      }
      const x = hit ? resolveX(hit.wallId, d.el, desired, d.item && d.item.uid) : null;
      d.overWall = !!hit;
      d.target = hit && x != null ? { wall: hit.wallId, x } : null;
      const st = hit && hit.st;
      if (d.stage && d.stage !== st) d.stage.classList.remove('is-target');
      d.stage = st || null;
      if (d.stage) d.stage.classList.add('is-target');

      if (in3d) {
        if (d.target) scene3d.showPreview(d.el, d.target.wall, d.target.x);
        else scene3d.hidePreview();
      } else if (d.target) {
        if (!d.preview) {
          d.preview = document.createElement('div');
          d.preview.className = 'kp-preview';
          d.preview.innerHTML = drawSvg(d.el);
        }
        if (d.preview.parentNode !== st) st.appendChild(d.preview);
        const y = d.el.zone === 'wall' ? wallTop - d.el.height : 0;
        Object.assign(d.preview.style, { left: px(x), bottom: px(y), width: px(d.el.width), height: px(renderHeight(d.el)) });
      } else if (d.preview) {
        d.preview.remove();
      }
      d.ghost.classList.toggle('is-hidden', !!d.target);
      d.ghost.classList.toggle('is-bad', !!hit && x == null);
      d.ghost.classList.toggle('is-remove', !hit && !d.over3d && !!d.item);
      if (!d.over3d) autoScroll(cy);
    }

    function autoScroll(cy) {
      const sc = els.walls;
      const edge = 40;
      const step = 16;
      if (sc.scrollHeight > sc.clientHeight + 2 && getComputedStyle(sc).overflowY !== 'visible') {
        const r = sc.getBoundingClientRect();
        if (cy < r.top + edge) sc.scrollTop -= step;
        else if (cy > r.bottom - edge) sc.scrollTop += step;
      } else if (cy < edge) window.scrollBy(0, -step);
      else if (cy > window.innerHeight - edge) window.scrollBy(0, step);
    }

    function onPointerUp(ev) {
      if (!drag || ev.pointerId !== drag.pointerId) return;
      const d = drag;
      endDrag();
      if (!d.started) {
        if (d.item) select(d.item.uid);
        return;
      }
      // The browser fires a click right after pointerup; it must not add the card again.
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
      if (d.target) {
        if (d.item) moveItem(d.item.uid, d.target.wall, d.target.x);
        else placeNew(d.el, d.target.wall, d.target.x);
      } else if (d.item && !d.overWall && !d.over3d) {
        removeItem(d.item.uid);
      } else if (!d.item && d.overWall) {
        toast(L.noSpace);
      }
    }

    function endDrag() {
      if (!drag) return;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', cancelDrag);
      document.removeEventListener('selectstart', noSelect);
      try { drag.source.releasePointerCapture(drag.pointerId); } catch (e) { /* already released */ }
      if (drag.ghost) drag.ghost.remove();
      if (drag.preview) drag.preview.remove();
      if (drag.stage) drag.stage.classList.remove('is-target');
      if (drag.itemEl) drag.itemEl.classList.remove('is-dragging');
      if (scene3d) {
        if (drag.from3d) scene3d.setHidden(null);
        scene3d.hidePreview();
      }
      if (els.kp) els.kp.classList.remove('is-dragging');
      drag = null;
    }

    // ----- 3D view ------------------------------------------------------------

    function setView(v) {
      if (v !== '2d' && v !== '3d') return;
      state.ui.view = v;
      els.walls.hidden = v === '3d';
      els.v3d.hidden = v !== '3d';
      els.views.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
      save();
      if (v === '2d') {
        renderWalls();
        return;
      }
      ensure3d().then(s => {
        if (state.ui.view !== '3d') return;
        s.resize();
        s.rebuild();
        s.setSelected(state.ui.selected);
      }).catch(() => { /* message is shown in the 3D panel */ });
    }

    function ensure3d() {
      if (scene3d) return Promise.resolve(scene3d);
      if (!loading3d) {
        els.msg3d.textContent = L.loading3d;
        els.msg3d.hidden = false;
        loading3d = loadThree(opts).then(THREE => {
          if (destroyed) throw new Error('destroyed');
          scene3d = createScene3D(THREE, {
            wrap: els.v3d,
            label: L.canvas3d,
            state: () => state,
            get,
            wallTop,
            colors() {
              const cs = getComputedStyle(host);
              const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
              return {
                bg: v('--kp-surface', '#f7f6f3'),
                wall: v('--kp-wall', '#f2f0ea'),
                floor: v('--kp-floor', '#d5cfc3'),
                worktop: v('--kp-worktop', '#cdbfa9'),
                accent: v('--kp-accent', '#2f6f62'),
                ok: v('--kp-ok', '#2f8f5b'),
              };
            },
          });
          els.msg3d.hidden = true;
          const c = scene3d.canvas;
          c.addEventListener('pointerdown', on3dDown);
          c.addEventListener('pointermove', on3dMove);
          c.addEventListener('pointerup', on3dUp);
          c.addEventListener('pointercancel', on3dUp);
          c.addEventListener('wheel', ev => { ev.preventDefault(); scene3d.zoom(Math.exp(ev.deltaY * 0.0012)); }, { passive: false });
          return scene3d;
        }).catch(err => {
          loading3d = null;
          els.msg3d.textContent = L.error3d + ' (' + err.message + ')';
          els.msg3d.hidden = false;
          throw err;
        });
      }
      return loading3d;
    }

    function pinchDistance() {
      const [a, b] = [...touches3d.values()];
      return Math.hypot(a.x - b.x, a.y - b.y) || 1;
    }

    // Pressing on an element drags it (through the shared drag code), anywhere else orbits.
    function on3dDown(ev) {
      if (drag || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
      const c = scene3d.canvas;
      c.focus({ preventScroll: true });
      try { c.setPointerCapture(ev.pointerId); } catch (e) { /* not capturable */ }
      touches3d.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (touches3d.size === 2) {
        orbitDrag = { pinch: pinchDistance() };
        return;
      }
      const hit = scene3d.pickItem(ev.clientX, ev.clientY);
      const item = hit && state.items.find(i => i.uid === hit.uid);
      if (item) {
        touches3d.delete(ev.pointerId);
        const el = get(item.id);
        drag = { el, item, itemEl: null, from3d: true, source: c, pointerId: ev.pointerId, sx: ev.clientX, sy: ev.clientY, grabX: clamp(hit.localX - item.x, 0, el.width), grabY: renderHeight(el) / 2, started: false, target: null, overWall: false, over3d: true, ghost: null, preview: null, stage: null };
        window.addEventListener('pointermove', onPointerMove, { passive: false });
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', cancelDrag);
        return;
      }
      orbitDrag = { x: ev.clientX, y: ev.clientY, moved: false };
    }

    function on3dMove(ev) {
      if (drag || !orbitDrag || !touches3d.has(ev.pointerId)) return;
      touches3d.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (orbitDrag.pinch) {
        if (touches3d.size === 2) {
          const dist = pinchDistance();
          scene3d.zoom(orbitDrag.pinch / dist);
          orbitDrag.pinch = dist;
        }
        return;
      }
      const dx = ev.clientX - orbitDrag.x;
      const dy = ev.clientY - orbitDrag.y;
      if (!orbitDrag.moved && Math.hypot(dx, dy) < 4) return;
      orbitDrag.moved = true;
      orbitDrag.x = ev.clientX;
      orbitDrag.y = ev.clientY;
      scene3d.rotate(dx, dy);
    }

    function on3dUp(ev) {
      if (!touches3d.has(ev.pointerId)) return;
      touches3d.delete(ev.pointerId);
      if (orbitDrag && !orbitDrag.moved && !orbitDrag.pinch && ev.type === 'pointerup') select(null);
      if (!touches3d.size) orbitDrag = null;
      else if (orbitDrag && orbitDrag.pinch) {
        const [p] = touches3d.values();
        orbitDrag = { x: p.x, y: p.y, moved: true };
      }
    }

    function cancelDrag() {
      endDrag();
    }

    // ----- public API -------------------------------------------------------

    const api = {
      version: VERSION,
      ready: null,
      host,
      getDesign,
      getOrder: buildOrder,
      loadDesign(d) {
        commit(() => { loadDesignInto(d); });
      },
      addElement: id => addElement(id),
      setView: v => setView(v),
      exportCsv: () => exportCsv(),
      getSpecification: () => buildCsv(),
      importSpecification: input => (input && typeof input.text === 'function' ? importFile(input) : Promise.resolve(importText(input))),
      setSeries(s) {
        state.ui.series = seriesNames.includes(s) ? s : '';
        fillFilters();
        renderCatalog();
        renderSwitch();
      },
      clear: clearAll,
      undo,
      redo,
      get elements() {
        return catalog.slice();
      },
      destroy() {
        destroyed = true;
        endDrag();
        if (ro) ro.disconnect();
        if (scene3d) scene3d.dispose();
        clearTimeout(toastTimer);
        host.remove();
      },
    };

    api.ready = loadElements().then(list => {
      if (destroyed) return api;
      catalog = list;
      list.forEach(e => byId.set(String(e.id), e));
      seriesNames = [...new Set(list.filter(e => e.zone !== 'accessory').map(e => e.series))].filter(Boolean).sort((a, b) => a.localeCompare(b));
      mount();
      return api;
    }).catch(err => {
      rootEl.innerHTML = `<div class="kp-status kp-error">${esc(L.loadError)}<br><small>${esc(err.message)}</small></div>`;
      throw err;
    });

    return api;
  }

  return { version: VERSION, create, normalize, normalizeAll, drawSvg, TYPES };
});
