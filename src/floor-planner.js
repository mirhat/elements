/*!
 * FloorPlanner v0.1.0
 * Crtanje tlocrta stanova i kuća: zidovi, prostorije, vrata, prozori, namještaj, 2D i 3D.
 * Bez zavisnosti; three.js (3D) i jsPDF (PDF) se učitavaju tek kad zatrebaju.
 *
 *   <div id="tlocrt"></div>
 *   <script src="floor-planner.js"></script>
 *   <script>FloorPlanner.create({ container: '#tlocrt' })</script>
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FloorPlanner = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '0.1.0';

  // ---------------------------------------------------------------------------
  // Geometry (plan units are cm, x to the right, y down)
  // ---------------------------------------------------------------------------

  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
  const dot = (a, b) => a.x * b.x + a.y * b.y;
  const cross = (a, b) => a.x * b.y - a.y * b.x;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const unit = a => {
    const l = Math.hypot(a.x, a.y) || 1;
    return { x: a.x / l, y: a.y / l };
  };
  const leftOf = a => ({ x: -a.y, y: a.x });
  const r1 = v => Math.round(v * 10) / 10;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const n2 = v => Math.round(v * 100) / 100;

  function lineX(p, d, q, e) {
    const den = cross(d, e);
    if (Math.abs(den) < 1e-9) return null;
    return add(p, mul(d, cross(sub(q, p), e) / den));
  }

  // Proper crossing of segments ab and cd (not at their ends).
  function segX(a, b, c, d) {
    const r = sub(b, a);
    const s = sub(d, c);
    const den = cross(r, s);
    if (Math.abs(den) < 1e-9) return null;
    const t = cross(sub(c, a), s) / den;
    const u = cross(sub(c, a), r) / den;
    const e = 1e-4;
    if (t <= e || t >= 1 - e || u <= e || u >= 1 - e) return null;
    return { t, u, p: add(a, mul(r, t)) };
  }

  function project(p, a, b) {
    const ab = sub(b, a);
    const L2 = dot(ab, ab) || 1;
    const t = clamp(dot(sub(p, a), ab) / L2, 0, 1);
    const q = add(a, mul(ab, t));
    return { t, point: q, dist: dist(p, q) };
  }

  function polyArea(pts) {
    let s = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      s += a.x * b.y - b.x * a.y;
    }
    return s / 2;
  }

  function inside(p, pts) {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i];
      const b = pts[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  }

  function edgeDistance(p, pts) {
    let m = Infinity;
    for (let i = 0; i < pts.length; i++) m = Math.min(m, project(p, pts[i], pts[(i + 1) % pts.length]).dist);
    return m;
  }

  // A point comfortably inside a polygon, for its label.
  function labelPoint(pts) {
    const A = polyArea(pts);
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const f = a.x * b.y - b.x * a.y;
      cx += (a.x + b.x) * f;
      cy += (a.y + b.y) * f;
    }
    const c = A ? { x: cx / (6 * A), y: cy / (6 * A) } : pts[0];
    if (inside(c, pts) && edgeDistance(c, pts) > 25) return c;
    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const w = Math.max(...xs) - x0;
    const h = Math.max(...ys) - y0;
    let best = null;
    let bd = -1;
    for (let i = 1; i < 16; i++) {
      for (let j = 1; j < 16; j++) {
        const p = { x: x0 + (w * i) / 16, y: y0 + (h * j) / 16 };
        if (!inside(p, pts)) continue;
        const dd = edgeDistance(p, pts);
        if (dd > bd) {
          bd = dd;
          best = p;
        }
      }
    }
    return best || c;
  }

  // ---------------------------------------------------------------------------
  // Plan model. Walls connect nodes; rooms are found as the faces the walls enclose.
  // ---------------------------------------------------------------------------

  const OPENINGS = {
    door: { width: 90, height: 205 },
    double: { width: 140, height: 205 },
    sliding: { width: 160, height: 205 },
    balcony: { width: 90, height: 220 },
    passage: { width: 90, height: 205 },
    window: { width: 120, height: 130, sill: 90 },
  };
  const DOOR_KINDS = ['door', 'double', 'sliding', 'balcony', 'passage'];

  const ITEMS = {
    'bed-double': { w: 160, d: 200, h: 50, color: '#e4dfd5' },
    'bed-single': { w: 90, d: 200, h: 50, color: '#e4dfd5' },
    'sofa': { w: 210, d: 90, h: 80, color: '#b9c4c2' },
    'armchair': { w: 85, d: 85, h: 80, color: '#b9c4c2' },
    'coffee': { w: 100, d: 55, h: 42, color: '#c9a77c' },
    'dining': { w: 160, d: 150, h: 75, color: '#c9a77c' },
    'table': { w: 120, d: 70, h: 75, color: '#c9a77c' },
    'desk': { w: 120, d: 60, h: 75, color: '#c9a77c' },
    'wardrobe': { w: 200, d: 60, h: 210, color: '#efece6' },
    'tv': { w: 160, d: 40, h: 50, color: '#6b6f74' },
    'kitchen': { w: 240, d: 60, h: 90, color: '#efece6' },
    'fridge': { w: 60, d: 65, h: 185, color: '#f4f5f6' },
    'bathtub': { w: 170, d: 75, h: 55, color: '#fbfcfd' },
    'shower': { w: 90, d: 90, h: 200, color: '#dfe9ee' },
    'wc': { w: 40, d: 65, h: 40, color: '#fbfcfd' },
    'basin': { w: 60, d: 45, h: 85, color: '#fbfcfd' },
    'washer': { w: 60, d: 60, h: 85, color: '#f4f5f6' },
    'stairs': { w: 100, d: 300, h: 20, color: '#d8cdb9' },
    'plant': { w: 45, d: 45, h: 90, color: '#8fbf88' },
  };

  const ROOM_NAMES = ['Dnevni boravak', 'Kuhinja', 'Trpezarija', 'Spavaća soba', 'Dječija soba', 'Radna soba', 'Kupatilo', 'WC', 'Hodnik', 'Ulaz', 'Ostava', 'Garderoba', 'Balkon', 'Terasa', 'Garaža', 'Prostorija'];
  const ROOM_COLORS = ['#e2efe8', '#f1e7d3', '#e3eaf4', '#ebe8f4', '#f3e3e6', '#f4efd9', '#eceae6', '#ffffff'];

  function roomColorFor(name) {
    const n = String(name || '').toLowerCase();
    if (/kupat|wc|tuš|tus/.test(n)) return '#e3eaf4';
    if (/kuhinj|trpez/.test(n)) return '#f1e7d3';
    if (/spava|dječ|djec|radna/.test(n)) return '#ebe8f4';
    if (/boravak|dnevn/.test(n)) return '#e2efe8';
    if (/balkon|teras/.test(n)) return '#f4efd9';
    if (/hodnik|ulaz|ostav|garder|garaž/.test(n)) return '#eceae6';
    return '#f3eee6';
  }

  function newDesign() {
    return { v: 1, title: '', nodes: [], walls: [], openings: [], rooms: [], items: [], labels: [], seq: {}, settings: { thickness: 20, height: 260 } };
  }

  function nextId(d, k) {
    d.seq[k] = (d.seq[k] || 0) + 1;
    return k + d.seq[k];
  }

  const nodeOf = (d, id) => d.nodes.find(n => n.id === id);
  const wallOf = (d, id) => d.walls.find(w => w.id === id);
  const ends = (d, w) => [nodeOf(d, w.a), nodeOf(d, w.b)];
  const wallLength = (d, w) => {
    const [A, B] = ends(d, w);
    return A && B ? dist(A, B) : 0;
  };

  function findNode(d, p, tol, except) {
    let best = null;
    let bd = tol;
    d.nodes.forEach(n => {
      if (n.id === except) return;
      const k = dist(n, p);
      if (k <= bd) {
        bd = k;
        best = n;
      }
    });
    return best;
  }

  // Nearest wall centreline; `s` is the distance from the wall's first node.
  function nearestWall(d, p, tol, exceptNode) {
    let best = null;
    d.walls.forEach(w => {
      if (exceptNode && (w.a === exceptNode || w.b === exceptNode)) return;
      const [A, B] = ends(d, w);
      if (!A || !B) return;
      const pr = project(p, A, B);
      if (pr.dist <= tol && (!best || pr.dist < best.dist)) best = { wall: w, point: pr.point, dist: pr.dist, s: pr.t * dist(A, B), t: pr.t };
    });
    return best;
  }

  function newNode(d, p) {
    const n = { id: nextId(d, 'n'), x: r1(p.x), y: r1(p.y) };
    d.nodes.push(n);
    return n;
  }

  function splitWall(d, w, p) {
    const [A, B] = ends(d, w);
    const L = dist(A, B);
    const pr = project(p, A, B);
    const s = pr.t * L;
    if (s < 1) return A;
    if (L - s < 1) return B;
    const n = newNode(d, pr.point);
    const w2 = { id: nextId(d, 'w'), a: n.id, b: w.b, thickness: w.thickness };
    w.b = n.id;
    d.walls.push(w2);
    d.openings.forEach(o => {
      if (o.wall === w.id && o.pos > s) {
        o.wall = w2.id;
        o.pos -= s;
      }
    });
    return n;
  }

  // An existing node, a new node splitting a wall, or a free new node.
  function nodeAt(d, p, tol) {
    const n = findNode(d, p, tol);
    if (n) return n;
    const hit = nearestWall(d, p, tol);
    if (hit) return splitWall(d, hit.wall, hit.point);
    return newNode(d, p);
  }

  function hasWall(d, a, b) {
    return d.walls.some(w => (w.a === a && w.b === b) || (w.a === b && w.b === a));
  }

  // Adds a wall from p1 to p2, splitting it (and the walls it crosses) where they meet.
  function addWall(d, p1, p2, thickness) {
    const A = nodeAt(d, p1, 0.6);
    const B = nodeAt(d, p2, 0.6);
    if (A === B) return [];
    const cuts = [];
    d.walls.slice().forEach(w => {
      const [C, D] = ends(d, w);
      if ([w.a, w.b].includes(A.id) || [w.a, w.b].includes(B.id)) return;
      const hit = segX(A, B, C, D);
      if (hit) cuts.push({ t: hit.t, wall: w, p: hit.p });
    });
    d.nodes.forEach(n => {
      if (n === A || n === B) return;
      const pr = project(n, A, B);
      if (pr.t > 1e-3 && pr.t < 1 - 1e-3 && pr.dist < 0.6) cuts.push({ t: pr.t, node: n });
    });
    cuts.sort((a, b) => a.t - b.t);
    const chain = [A];
    cuts.forEach(c => {
      const n = c.node || splitWall(d, c.wall, c.p);
      if (n !== chain[chain.length - 1]) chain.push(n);
    });
    chain.push(B);
    const made = [];
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i];
      const b = chain[i + 1];
      if (a === b || hasWall(d, a.id, b.id)) continue;
      const w = { id: nextId(d, 'w'), a: a.id, b: b.id, thickness: thickness || d.settings.thickness };
      d.walls.push(w);
      made.push(w);
    }
    return made;
  }

  function pruneNodes(d) {
    const used = new Set();
    d.walls.forEach(w => { used.add(w.a); used.add(w.b); });
    d.nodes = d.nodes.filter(n => used.has(n.id));
  }

  function removeWall(d, id) {
    d.walls = d.walls.filter(w => w.id !== id);
    d.openings = d.openings.filter(o => o.wall !== id);
    pruneNodes(d);
  }

  // Joins node `from` into node `into` and drops walls that collapse or double up.
  function mergeNodes(d, from, into) {
    if (from === into) return;
    d.walls.forEach(w => {
      if (w.a === from) w.a = into;
      if (w.b === from) w.b = into;
    });
    const seen = new Set();
    const drop = new Set();
    d.walls.forEach(w => {
      const k = [w.a, w.b].sort().join('|');
      if (w.a === w.b || seen.has(k)) drop.add(w.id);
      else seen.add(k);
    });
    d.walls = d.walls.filter(w => !drop.has(w.id));
    d.openings = d.openings.filter(o => !drop.has(o.wall));
    d.nodes = d.nodes.filter(n => n.id !== from);
  }

  // Splits walls wherever two of them cross, so the rooms stay closed shapes.
  function planarize(d) {
    for (let guard = 0; guard < 200; guard++) {
      let found = null;
      outer: for (let i = 0; i < d.walls.length; i++) {
        for (let j = i + 1; j < d.walls.length; j++) {
          const w1 = d.walls[i];
          const w2 = d.walls[j];
          if ([w1.a, w1.b].some(n => n === w2.a || n === w2.b)) continue;
          const [A, B] = ends(d, w1);
          const [C, D] = ends(d, w2);
          const hit = segX(A, B, C, D);
          if (hit) {
            found = { w1, w2, p: hit.p };
            break outer;
          }
        }
      }
      if (!found) break;
      const n1 = splitWall(d, found.w1, found.p);
      const n2 = splitWall(d, found.w2, found.p);
      mergeNodes(d, n2.id, n1.id);
    }
    // a node lying on another wall makes a T junction
    d.nodes.slice().forEach(n => {
      const hit = nearestWall(d, n, 0.6, n.id);
      if (hit && hit.t > 0.001 && hit.t < 0.999) {
        const m = splitWall(d, hit.wall, hit.point);
        mergeNodes(d, n.id, m.id);
      }
    });
    d.openings.forEach(o => clampOpening(d, o));
  }

  function clampOpening(d, o) {
    const w = wallOf(d, o.wall);
    if (!w) return;
    const L = wallLength(d, w);
    const half = o.width / 2;
    o.pos = L > o.width + 4 ? clamp(o.pos, half + 2, L - half - 2) : L / 2;
  }

  function openingFits(d, wall, pos, width, exceptId) {
    const L = wallLength(d, wall);
    if (width > L - 4 || pos - width / 2 < 1 || pos + width / 2 > L - 1) return false;
    return d.openings.every(o => o.id === exceptId || o.wall !== wall.id || Math.abs(o.pos - pos) >= (o.width + width) / 2 + 2);
  }

  function addOpening(d, wall, pos, kind, opts) {
    const def = OPENINGS[kind] || OPENINGS.door;
    const o = Object.assign({ id: nextId(d, 'o'), wall: wall.id, pos, kind, width: def.width, height: def.height, flip: false, hinge: 'a' }, def.sill != null ? { sill: def.sill } : null, opts);
    clampOpening(d, o);
    d.openings.push(o);
    return o;
  }

  function addItem(d, type, x, y, rot, w, dp) {
    const def = ITEMS[type] || ITEMS.table;
    const it = { id: nextId(d, 'f'), type, x, y, w: w || def.w, d: dp || def.d, rot: rot || 0 };
    d.items.push(it);
    return it;
  }

  // Faces of the wall graph. Bounded faces come out with a positive area.
  function faces(d) {
    const N = new Map(d.nodes.map(n => [n.id, n]));
    const out = new Map();
    const push = (from, to, wall) => {
      const A = N.get(from);
      const B = N.get(to);
      if (!out.has(from)) out.set(from, []);
      out.get(from).push({ from, to, wall, ang: Math.atan2(B.y - A.y, B.x - A.x) });
    };
    d.walls.forEach(w => {
      if (!N.get(w.a) || !N.get(w.b)) return;
      push(w.a, w.b, w);
      push(w.b, w.a, w);
    });
    out.forEach(list => list.sort((a, b) => a.ang - b.ang));
    const key = e => e.from + '>' + e.to + ':' + e.wall.id;
    const used = new Set();
    const result = [];
    out.forEach(list => list.forEach(start => {
      if (used.has(key(start))) return;
      const loop = [];
      let e = start;
      let guard = 0;
      do {
        used.add(key(e));
        loop.push(e);
        const at = out.get(e.to);
        const i = at.findIndex(x => x.to === e.from && x.wall === e.wall);
        e = at[(i - 1 + at.length) % at.length];
      } while (e && key(e) !== key(start) && ++guard < 5000);
      // drop dead-end spikes (a wall walked there and back)
      for (let changed = true; changed && loop.length > 2;) {
        changed = false;
        for (let i = 0; i < loop.length; i++) {
          const a = loop[i];
          const b = loop[(i + 1) % loop.length];
          if (a.wall === b.wall) {
            loop.splice(Math.max(i, (i + 1) % loop.length), 1);
            loop.splice(Math.min(i, (i + 1) % loop.length), 1);
            changed = true;
            break;
          }
        }
      }
      if (loop.length < 3) return;
      const pts = loop.map(x => N.get(x.from));
      const A = polyArea(pts);
      if (A > 100) result.push({ edges: loop, pts, area: A });
    }));
    return result;
  }

  // The floor of a face: its outline moved inwards by half of each wall's thickness.
  function innerPolygon(d, face) {
    const N = new Map(d.nodes.map(n => [n.id, n]));
    const E = face.edges;
    const n = E.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      const e0 = E[(i - 1 + n) % n];
      const e1 = E[i];
      const P0 = N.get(e0.from);
      const P1 = N.get(e1.from);
      const P2 = N.get(e1.to);
      const d0 = unit(sub(P1, P0));
      const d1 = unit(sub(P2, P1));
      const h0 = e0.wall.thickness / 2;
      const h1 = e1.wall.thickness / 2;
      const q0 = add(P0, mul(leftOf(d0), h0));
      const q1 = add(P1, mul(leftOf(d1), h1));
      const x = lineX(q0, d0, q1, d1);
      out.push(x && dist(x, P1) < 4 * Math.max(h0, h1) + 1 ? x : add(P1, mul(leftOf(d1), h1)));
    }
    return out;
  }

  // Room → its floor polygon and area (the face that contains the room's label point).
  function roomShapes(d, faceList) {
    const list = faceList || faces(d);
    const map = new Map();
    d.rooms.forEach(r => {
      let best = null;
      list.forEach(f => {
        if (inside(r, f.pts) && (!best || f.area < best.area)) best = f;
      });
      if (!best) return map.set(r.id, null);
      const pts = innerPolygon(d, best);
      let perim = 0;
      pts.forEach((p, i) => { perim += dist(p, pts[(i + 1) % pts.length]); });
      map.set(r.id, { pts, area: Math.abs(polyArea(pts)), perimeter: perim, face: best });
    });
    return map;
  }

  // Mitred wall outlines: corner points of every wall at both of its ends.
  function wallCorners(d) {
    const N = new Map(d.nodes.map(n => [n.id, n]));
    const at = new Map();
    d.walls.forEach(w => {
      const A = N.get(w.a);
      const B = N.get(w.b);
      if (!A || !B || dist(A, B) < 0.01) return;
      const u = unit(sub(B, A));
      const h = w.thickness / 2;
      if (!at.has(w.a)) at.set(w.a, []);
      if (!at.has(w.b)) at.set(w.b, []);
      at.get(w.a).push({ wall: w, end: 'a', dir: u, h });
      at.get(w.b).push({ wall: w, end: 'b', dir: mul(u, -1), h });
    });
    const corners = new Map();
    const hubs = [];
    at.forEach((list, nodeId) => {
      const P = N.get(nodeId);
      list.forEach(x => { x.ang = Math.atan2(x.dir.y, x.dir.x); });
      list.sort((a, b) => a.ang - b.ang);
      const k = list.length;
      list.forEach((x, i) => {
        const nl = leftOf(x.dir);
        let L = add(P, mul(nl, x.h));
        let R = sub(P, mul(nl, x.h));
        if (k > 1) {
          const next = list[(i + 1) % k];
          const prev = list[(i - 1 + k) % k];
          const pl = lineX(L, x.dir, sub(P, mul(leftOf(next.dir), next.h)), next.dir);
          if (pl && dist(pl, P) < 3 * Math.max(x.h, next.h) + 1) L = pl;
          const pr = lineX(R, x.dir, add(P, mul(leftOf(prev.dir), prev.h)), prev.dir);
          if (pr && dist(pr, P) < 3 * Math.max(x.h, prev.h) + 1) R = pr;
        }
        const c = corners.get(x.wall.id) || {};
        if (x.end === 'a') {
          c.aL = L;
          c.aR = R;
        } else {
          c.bL = L;
          c.bR = R;
        }
        corners.set(x.wall.id, c);
        x.L = L;
        x.R = R;
      });
      // Where three or more walls meet, the mitred ends leave a small piece in the middle.
      if (k > 2) {
        const hub = [];
        list.forEach(x => [x.R, x.L].forEach(q => {
          const last = hub[hub.length - 1];
          if (!last || dist(last, q) > 0.05) hub.push(q);
        }));
        if (hub.length > 2 && dist(hub[0], hub[hub.length - 1]) < 0.05) hub.pop();
        if (hub.length > 2 && Math.abs(polyArea(hub)) > 0.5) hubs.push(hub);
      }
    });
    corners.hubs = hubs;
    return corners;
  }

  function wallFrame(d, w) {
    const [A, B] = ends(d, w);
    const u = unit(sub(B, A));
    return { A, B, u, n: leftOf(u), L: dist(A, B), h: w.thickness / 2 };
  }

  /**
   * Builds a plan from a short description:
   *   { thickness, walls: [[x1, y1, x2, y2, thickness?]], openings: [[x, y, kind, width, opts?]],
   *     rooms: [[x, y, name, color?]], items: [[type, x, y, rot?, w?, d?]], labels: [[x, y, text]] }
   */
  function sketch(def) {
    const d = newDesign();
    if (def.title) d.title = def.title;
    if (def.thickness) d.settings.thickness = def.thickness;
    (def.walls || []).forEach(w => addWall(d, { x: w[0], y: w[1] }, { x: w[2], y: w[3] }, w[4] || def.thickness || 20));
    (def.openings || []).forEach(o => {
      const hit = nearestWall(d, { x: o[0], y: o[1] }, 60);
      if (hit) addOpening(d, hit.wall, hit.s, o[2], Object.assign(o[3] ? { width: o[3] } : {}, o[4]));
    });
    (def.rooms || []).forEach(r => d.rooms.push({ id: nextId(d, 'r'), x: r[0], y: r[1], name: r[2], color: r[3] || roomColorFor(r[2]) }));
    (def.items || []).forEach(i => addItem(d, i[0], i[1], i[2], i[3], i[4], i[5]));
    (def.labels || []).forEach(l => d.labels.push({ id: nextId(d, 't'), x: l[0], y: l[1], text: l[2], size: l[3] || 14 }));
    return d;
  }

  // ---------------------------------------------------------------------------
  // Drawing (SVG markup in plan units)
  // ---------------------------------------------------------------------------

  const WALL_FILL = '#3b4046';

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  const pts2 = pts => pts.map(p => n2(p.x) + ',' + n2(p.y)).join(' ');

  function fmtArea(m2) {
    return m2.toLocaleString('hr-HR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' m²';
  }

  function openingSvg(d, o, px, opts) {
    const w = wallOf(d, o.wall);
    if (!w) return '';
    const F = wallFrame(d, w);
    const c = add(F.A, mul(F.u, o.pos));
    const half = o.width / 2;
    const p1 = sub(c, mul(F.u, half));
    const p2 = add(c, mul(F.u, half));
    const h = F.h + 0.6;
    const cut = [add(p1, mul(F.n, h)), add(p2, mul(F.n, h)), sub(p2, mul(F.n, h)), sub(p1, mul(F.n, h))];
    const sw = 1.3 * px;
    const ink = '#33373c';
    let s = `<polygon class="fp-op-cut" points="${pts2(cut)}" fill="${opts.cutFill || '#fff'}"/>`;
    const jamb = p => `<line x1="${n2(p.x + F.n.x * F.h)}" y1="${n2(p.y + F.n.y * F.h)}" x2="${n2(p.x - F.n.x * F.h)}" y2="${n2(p.y - F.n.y * F.h)}" stroke="${ink}" stroke-width="${n2(sw)}"/>`;
    s += jamb(p1) + jamb(p2);
    const side = o.flip ? -1 : 1;
    const sdir = mul(F.n, side);
    const leaf = (H, J, width) => {
      const Hf = add(H, mul(sdir, F.h));
      const Jf = add(J, mul(sdir, F.h));
      const open = add(Hf, mul(sdir, width));
      const sweep = cross(sdir, unit(sub(Jf, Hf))) > 0 ? 1 : 0;
      return `<line x1="${n2(Hf.x)}" y1="${n2(Hf.y)}" x2="${n2(open.x)}" y2="${n2(open.y)}" stroke="${ink}" stroke-width="${n2(sw * 1.6)}" stroke-linecap="round"/>` +
        `<path d="M${n2(open.x)} ${n2(open.y)}A${n2(width)} ${n2(width)} 0 0 ${sweep} ${n2(Jf.x)} ${n2(Jf.y)}" fill="none" stroke="${ink}" stroke-width="${n2(sw * 0.8)}" stroke-dasharray="${n2(4 * px)} ${n2(3 * px)}"/>`;
    };
    const line = (a, b, width, color, extra) => `<line x1="${n2(a.x)}" y1="${n2(a.y)}" x2="${n2(b.x)}" y2="${n2(b.y)}" stroke="${color || ink}" stroke-width="${n2(width)}"${extra || ''}/>`;
    if (o.kind === 'window') {
      const a = add(p1, mul(F.n, F.h));
      const b = add(p2, mul(F.n, F.h));
      const cA = sub(p2, mul(F.n, F.h));
      const cB = sub(p1, mul(F.n, F.h));
      s += `<polygon points="${pts2([a, b, cA, cB])}" fill="#eaf3f7" stroke="${ink}" stroke-width="${n2(sw)}"/>`;
      s += line(p1, p2, sw * 1.2, '#5b8aa3');
    } else if (o.kind === 'door' || o.kind === 'balcony') {
      const H = o.hinge === 'b' ? p2 : p1;
      const J = o.hinge === 'b' ? p1 : p2;
      s += leaf(H, J, o.width);
      if (o.kind === 'balcony') s += line(p1, p2, sw * 1.2, '#5b8aa3');
    } else if (o.kind === 'double') {
      s += leaf(p1, c, half) + leaf(p2, c, half);
    } else if (o.kind === 'sliding') {
      const off = F.h * 0.35;
      s += line(add(p1, mul(F.n, off)), add(add(c, mul(F.u, 6)), mul(F.n, off)), sw * 2.4, ink);
      s += line(sub(sub(c, mul(F.u, 6)), mul(F.n, off)), sub(p2, mul(F.n, off)), sw * 2.4, ink);
    } else if (o.kind === 'passage') {
      s += line(add(p1, mul(F.n, F.h)), add(p2, mul(F.n, F.h)), sw * 0.8, '#9a9ea4', ` stroke-dasharray="${n2(5 * px)} ${n2(4 * px)}"`);
      s += line(sub(p1, mul(F.n, F.h)), sub(p2, mul(F.n, F.h)), sw * 0.8, '#9a9ea4', ` stroke-dasharray="${n2(5 * px)} ${n2(4 * px)}"`);
    }
    return s;
  }

  // Furniture symbols in their own box (0..w × 0..d), back side at the top.
  function itemSymbol(type, w, d, px) {
    const sw = n2(1.1 * px);
    const ink = '#55595f';
    const R = (x, y, ww, hh, fill, r, extra) => `<rect x="${n2(x)}" y="${n2(y)}" width="${n2(ww)}" height="${n2(hh)}" rx="${n2(r || 0)}" fill="${fill}" stroke="${ink}" stroke-width="${sw}"${extra || ''}/>`;
    const C = (x, y, r, fill) => `<circle cx="${n2(x)}" cy="${n2(y)}" r="${n2(r)}" fill="${fill}" stroke="${ink}" stroke-width="${sw}"/>`;
    const Ln = (x1, y1, x2, y2, extra) => `<line x1="${n2(x1)}" y1="${n2(y1)}" x2="${n2(x2)}" y2="${n2(y2)}" stroke="${ink}" stroke-width="${sw}"${extra || ''}/>`;
    switch (type) {
      case 'bed-double':
      case 'bed-single': {
        let s = R(0, 0, w, d, '#fff', 4) + R(0, 0, w, 8, '#e3ddd2', 3);
        if (type === 'bed-double') s += R(10, 14, w / 2 - 15, 26, '#f6f3ee', 6) + R(w / 2 + 5, 14, w / 2 - 15, 26, '#f6f3ee', 6);
        else s += R(12, 14, w - 24, 26, '#f6f3ee', 6);
        return s + R(0, d * 0.3, w, d * 0.7, '#e7edf2', 3) + Ln(0, d * 0.3 + 14, w, d * 0.3 + 14);
      }
      case 'sofa':
      case 'armchair': {
        const arm = Math.min(18, w * 0.2);
        let s = R(0, 0, w, d, '#dfe4e3', 8) + R(0, 0, w, 20, '#c9d1cf', 6) + R(0, 0, arm, d, '#c9d1cf', 6) + R(w - arm, 0, arm, d, '#c9d1cf', 6);
        const n = type === 'sofa' ? 3 : 1;
        for (let i = 1; i < n; i++) s += Ln(arm + ((w - 2 * arm) * i) / n, 20, arm + ((w - 2 * arm) * i) / n, d - 4);
        return s;
      }
      case 'coffee':
      case 'table':
        return R(0, 0, w, d, '#efe5d4', 5);
      case 'dining': {
        const tw = w * 0.8;
        const th = d * 0.6;
        const tx = (w - tw) / 2;
        const ty = (d - th) / 2;
        let s = '';
        [0.3, 0.7].forEach(f => {
          s += R(w * f - 20, 0, 40, ty + 6, '#fff', 4);
          s += R(w * f - 20, d - ty - 6, 40, ty + 6, '#fff', 4);
        });
        return s + R(tx, ty, tw, th, '#efe5d4', 4);
      }
      case 'desk':
        return R(0, 0, w, d, '#efe5d4', 3) + R(w * 0.3, 6, w * 0.4, 4, '#55595f', 1);
      case 'wardrobe':
        return R(0, 0, w, d, '#fff', 2) + Ln(4, d / 2, w - 4, d / 2, ` stroke-dasharray="${n2(6 * px)} ${n2(4 * px)}"`) + Ln(w / 2, d - 3, w / 2, d);
      case 'tv':
        return R(0, 0, w, d, '#ece8e1', 2) + R(w * 0.12, 5, w * 0.76, 6, '#2b2e32', 1);
      case 'kitchen': {
        let s = R(0, 0, w, d, '#f5f1ea', 2) + Ln(0, d - 4, w, d - 4);
        if (w >= 100) s += R(w * 0.18, d * 0.18, Math.min(60, w * 0.25), d * 0.6, '#dde5ea', 6);
        if (w >= 160) {
          const hx = w * 0.62;
          s += R(hx, d * 0.12, 56, d * 0.72, '#f0eeea', 2);
          [[14, 14], [42, 14], [14, 32], [42, 32]].forEach(([a, b]) => { s += C(hx + a, d * 0.12 + b, 7, '#fff'); });
        }
        return s;
      }
      case 'fridge':
        return R(0, 0, w, d, '#fff', 3) + Ln(4, d - 6, w - 4, d - 6) + Ln(w * 0.3, d * 0.35, w * 0.7, d * 0.35);
      case 'bathtub':
        return R(0, 0, w, d, '#fff', 10) + R(7, 7, w - 14, d - 14, '#e7f0f5', Math.min(30, d / 2 - 7)) + C(w - 22, d / 2, 3, '#fff');
      case 'shower':
        return R(0, 0, w, d, '#eef4f7', 2) + Ln(0, 0, w, d, ' opacity=".5"') + Ln(w, 0, 0, d, ' opacity=".5"') + C(w / 2, d / 2, 4, '#fff');
      case 'wc':
        return R(w * 0.08, 0, w * 0.84, d * 0.28, '#fff', 3) + `<ellipse cx="${n2(w / 2)}" cy="${n2(d * 0.62)}" rx="${n2(w * 0.42)}" ry="${n2(d * 0.36)}" fill="#fff" stroke="${ink}" stroke-width="${sw}"/>`;
      case 'basin':
        return R(0, 0, w, d, '#fff', 4) + `<ellipse cx="${n2(w / 2)}" cy="${n2(d * 0.58)}" rx="${n2(w * 0.36)}" ry="${n2(d * 0.3)}" fill="#e7f0f5" stroke="${ink}" stroke-width="${sw}"/>` + C(w / 2, 7, 2.5, '#fff');
      case 'washer':
        return R(0, 0, w, d, '#fff', 3) + C(w / 2, d / 2, Math.min(w, d) * 0.32, '#eef1f4') + C(w / 2, d / 2, Math.min(w, d) * 0.18, '#fff');
      case 'stairs': {
        let s = R(0, 0, w, d, '#fff', 0);
        for (let y = 25; y < d; y += 25) s += Ln(0, y, w, y);
        return s + Ln(w / 2, d - 12, w / 2, 14) + `<path d="M${n2(w / 2 - 8)} ${n2(26)}L${n2(w / 2)} ${n2(12)}L${n2(w / 2 + 8)} ${n2(26)}" fill="none" stroke="${ink}" stroke-width="${sw}"/>`;
      }
      case 'plant': {
        let s = C(w / 2, d / 2, Math.min(w, d) * 0.48, '#e7f0e3');
        for (let i = 0; i < 5; i++) {
          const a = (i * 72 * Math.PI) / 180;
          s += `<ellipse cx="${n2(w / 2 + Math.cos(a) * w * 0.2)}" cy="${n2(d / 2 + Math.sin(a) * d * 0.2)}" rx="${n2(w * 0.17)}" ry="${n2(d * 0.09)}" transform="rotate(${i * 72} ${n2(w / 2 + Math.cos(a) * w * 0.2)} ${n2(d / 2 + Math.sin(a) * d * 0.2)})" fill="#8fbf88" stroke="#5e8d58" stroke-width="${sw}"/>`;
        }
        return s;
      }
      default:
        return R(0, 0, w, d, '#f2efe9', 3);
    }
  }

  function itemSvg(it, px, extra) {
    return `<g data-kind="item" data-id="${esc(it.id)}" transform="translate(${n2(it.x)} ${n2(it.y)}) rotate(${n2(it.rot || 0)}) translate(${n2(-it.w / 2)} ${n2(-it.d / 2)})"${extra || ''}>${itemSymbol(it.type, it.w, it.d, px)}</g>`;
  }

  /**
   * The plan (without grid and editing aids). `px` is plan units per screen pixel, so text and
   * lines keep a readable size at any zoom.
   */
  function planSvg(d, px, opts) {
    opts = opts || {};
    const faceList = faces(d);
    const shapes = roomShapes(d, faceList);
    const corners = wallCorners(d);
    let s = '';
    d.rooms.forEach(r => {
      const sh = shapes.get(r.id);
      if (sh) s += `<polygon data-kind="room" data-id="${esc(r.id)}" points="${pts2(sh.pts)}" fill="${esc(r.color || '#f3eee6')}"/>`;
    });
    d.walls.forEach(w => {
      const c = corners.get(w.id);
      if (!c || !c.aL || !c.bL) return;
      s += `<polygon data-kind="wall" data-id="${esc(w.id)}" points="${pts2([c.aL, c.bR, c.bL, c.aR])}" fill="${WALL_FILL}"/>`;
    });
    corners.hubs.forEach(h => { s += `<polygon points="${pts2(h)}" fill="${WALL_FILL}" pointer-events="none"/>`; });
    d.openings.forEach(o => {
      s += `<g data-kind="opening" data-id="${esc(o.id)}">${openingSvg(d, o, px, opts)}</g>`;
    });
    d.items.forEach(it => { s += itemSvg(it, px); });
    if (opts.dims !== false) {
      const fs = 10.5 * px;
      d.walls.forEach(w => {
        const F = wallFrame(d, w);
        if (F.L / px < 46) return;
        const m = add(F.A, mul(F.u, F.L / 2));
        let ang = (Math.atan2(F.u.y, F.u.x) * 180) / Math.PI;
        if (ang > 90.5 || ang < -89.5) ang += 180;
        const text = String(Math.round(F.L));
        const tw = text.length * fs * 0.62 + 8 * px;
        s += `<g transform="translate(${n2(m.x)} ${n2(m.y)}) rotate(${n2(ang)})" pointer-events="none"><rect x="${n2(-tw / 2)}" y="${n2(-fs * 0.72)}" width="${n2(tw)}" height="${n2(fs * 1.44)}" rx="${n2(fs * 0.4)}" fill="#fff" opacity=".92"/><text x="0" y="${n2(fs * 0.36)}" font-size="${n2(fs)}" text-anchor="middle" fill="#33373c" font-family="Helvetica, Arial, sans-serif">${text}</text></g>`;
      });
    }
    const font = 'font-family="Helvetica, Arial, sans-serif" text-anchor="middle"';
    d.rooms.forEach(r => {
      const sh = shapes.get(r.id);
      const name = esc(r.name || '');
      s += `<g data-kind="roomlabel" data-id="${esc(r.id)}"><text x="${n2(r.x)}" y="${n2(r.y)}" font-size="${n2(13 * px)}" font-weight="700" fill="${sh ? '#2b2f33' : '#9a9ea4'}" ${font}>${name}</text>` +
        `<text x="${n2(r.x)}" y="${n2(r.y + 16 * px)}" font-size="${n2(11.5 * px)}" fill="${sh ? '#555a60' : '#9a9ea4'}" ${font}>${sh ? fmtArea(sh.area / 10000) : esc(opts.openRoom || '')}</text></g>`;
    });
    d.labels.forEach(l => {
      s += `<text data-kind="label" data-id="${esc(l.id)}" x="${n2(l.x)}" y="${n2(l.y)}" font-size="${n2((l.size || 14) * px)}" fill="#2b2f33" ${font}>${esc(l.text)}</text>`;
    });
    return { svg: s, shapes, faces: faceList, corners };
  }

  function bounds(d) {
    const xs = [];
    const ys = [];
    d.nodes.forEach(n => { xs.push(n.x); ys.push(n.y); });
    d.items.forEach(it => {
      const r = Math.hypot(it.w, it.d) / 2;
      xs.push(it.x - r, it.x + r);
      ys.push(it.y - r, it.y + r);
    });
    d.labels.forEach(l => { xs.push(l.x); ys.push(l.y); });
    d.rooms.forEach(r => { xs.push(r.x); ys.push(r.y); });
    if (!xs.length) return null;
    const pad = 30;
    const x0 = Math.min(...xs) - pad;
    const y0 = Math.min(...ys) - pad;
    return { x: x0, y: y0, w: Math.max(...xs) + pad - x0, h: Math.max(...ys) + pad - y0 };
  }

  // ---------------------------------------------------------------------------
  // Loaders (three.js for 3D, jsPDF + Roboto for PDF) and image helpers
  // ---------------------------------------------------------------------------

  const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
  const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';
  const PDF_FONTS = {
    normal: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/roboto@0.2.3/Roboto_400Regular.ttf',
    bold: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/roboto@0.2.3/Roboto_700Bold.ttf',
  };
  const loads = new Map();

  function once(key, make) {
    if (!loads.has(key)) loads.set(key, make().catch(err => { loads.delete(key); throw err; }));
    return loads.get(key);
  }

  function loadThree(opts) {
    if (opts.three) return Promise.resolve(opts.three);
    if (typeof window !== 'undefined' && window.THREE && window.THREE.WebGLRenderer) return Promise.resolve(window.THREE);
    const url = opts.threeUrl || THREE_URL;
    return once(url, () => import(/* webpackIgnore: true */ url));
  }

  function loadJsPdf(opts) {
    if (opts.jspdf) return Promise.resolve(opts.jspdf);
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    const url = opts.jspdfUrl || JSPDF_URL;
    return once(url, () => new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = url;
      tag.async = true;
      tag.onload = () => (window.jspdf && window.jspdf.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error('jsPDF')));
      tag.onerror = () => reject(new Error('jsPDF: ' + url));
      document.head.appendChild(tag);
    }));
  }

  function loadFontBase64(url) {
    return once(url, () => fetch(url).then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
      return r.arrayBuffer();
    }).then(buf => {
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    }));
  }

  function rasterize(svg, pw, ph) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = pw;
        c.height = ph;
        const g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, pw, ph);
        g.drawImage(img, 0, 0, pw, ph);
        resolve({ data: c.toDataURL('image/png'), w: pw, h: ph, canvas: c });
      };
      img.onerror = () => reject(new Error('SVG'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  function loadImageData(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
        const h = 240;
        const w = Math.round(h * ratio);
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        try {
          resolve({ data: c.toDataURL('image/png'), w, h });
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error('logo'));
      img.src = url;
    });
  }

  function toBase64(str) {
    let bin = '';
    new TextEncoder().encode(str).forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  function fromBase64(b64) {
    return new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
  }

  const PDF_MARKER = 'floor-planner';

  // ---------------------------------------------------------------------------
  // 3D view
  // ---------------------------------------------------------------------------

  function createScene3D(THREE, ctx) {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const canvas = renderer.domElement;
    canvas.className = 'fp-3d-canvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', ctx.label);
    ctx.wrap.prepend(canvas);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#f4f2ee');
    const camera = new THREE.PerspectiveCamera(40, 1, 5, 20000);
    const sun = new THREE.DirectionalLight(0xffffff, 1.35);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.8;
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd6cfc2, 1.15), sun, sun.target);
    const world = new THREE.Group();
    scene.add(world);
    const orbit = { theta: 0.55, phi: 0.9, radius: 1500, target: new THREE.Vector3() };
    const mats = new Map();
    const mat = (color, extra) => {
      const k = color + JSON.stringify(extra || {});
      if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.85 }, extra)));
      return mats.get(k);
    };
    let raf = 0;
    let first = true;
    let disposed = false;

    const requestRender = () => {
      if (raf || disposed) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        renderer.render(scene, camera);
      });
    };
    const resize = () => {
      const r = ctx.wrap.getBoundingClientRect();
      if (!r.width || !r.height) return;
      renderer.setSize(r.width, r.height, false);
      camera.aspect = r.width / r.height;
      camera.updateProjectionMatrix();
      requestRender();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(ctx.wrap);

    // plan (x, y) → world (x, height, y)
    const prism = (pts, y0, y1, materials) => {
      if (y1 - y0 < 0.5 || pts.length < 3) return null;
      const shape = new THREE.Shape(pts.map(p => new THREE.Vector2(p.x, -p.y)));
      const m = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false }), materials);
      m.rotation.x = -Math.PI / 2;
      m.position.y = y0;
      m.castShadow = true;
      m.receiveShadow = true;
      world.add(m);
      return m;
    };

    function rebuild() {
      const d = ctx.design();
      world.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      world.clear();
      const H = d.settings.height || 260;
      const cap = mat('#40454b', { roughness: 0.9 });
      const side = mat('#f5f3ee', { roughness: 0.95 });
      const glass = mat('#b9d4e0', { transparent: true, opacity: 0.4, roughness: 0.1 });
      const wood = mat('#cfb48c', { roughness: 0.7 });
      const b = bounds(d) || { x: 0, y: 0, w: 600, h: 400 };

      const ground = new THREE.Mesh(new THREE.PlaneGeometry(b.w + 800, b.h + 800), mat('#e6e2da'));
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(b.x + b.w / 2, -0.5, b.y + b.h / 2);
      ground.receiveShadow = true;
      world.add(ground);

      const shapes = roomShapes(d);
      d.rooms.forEach(r => {
        const sh = shapes.get(r.id);
        if (!sh) return;
        const shape = new THREE.Shape(sh.pts.map(p => new THREE.Vector2(p.x, -p.y)));
        const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat(r.color && r.color !== '#ffffff' ? r.color : '#f1eee8'));
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = 0.4;
        floor.receiveShadow = true;
        world.add(floor);
      });

      const corners = wallCorners(d);
      d.walls.forEach(w => {
        const c = corners.get(w.id);
        if (!c || !c.aL || !c.bL) return;
        const F = wallFrame(d, w);
        const at = (s, k) => add(add(F.A, mul(F.u, s)), mul(F.n, k * F.h));
        const foot = (s0, s1) => [
          s0 <= 0.01 ? c.aL : at(s0, 1),
          s1 >= F.L - 0.01 ? c.bR : at(s1, 1),
          s1 >= F.L - 0.01 ? c.bL : at(s1, -1),
          s0 <= 0.01 ? c.aR : at(s0, -1),
        ];
        const ops = d.openings.filter(o => o.wall === w.id).map(o => ({ o, s0: o.pos - o.width / 2, s1: o.pos + o.width / 2 })).sort((p, q) => p.s0 - q.s0);
        let cur = 0;
        ops.forEach(op => {
          if (op.s0 > cur) prism(foot(cur, op.s0), 0, H, [cap, side]);
          cur = Math.max(cur, op.s1);
        });
        if (cur < F.L) prism(foot(cur, F.L), 0, H, [cap, side]);
        ops.forEach(({ o, s0, s1 }) => {
          const fp = foot(s0, s1);
          if (o.kind === 'window') {
            const sill = o.sill != null ? o.sill : 90;
            prism(fp, 0, sill, [cap, side]);
            prism(fp, sill + o.height, H, [cap, side]);
            const pane = new THREE.Mesh(new THREE.PlaneGeometry(o.width, o.height), glass);
            const mid = add(F.A, mul(F.u, o.pos));
            pane.position.set(mid.x, sill + o.height / 2, mid.y);
            pane.rotation.y = -Math.atan2(F.u.y, F.u.x);
            world.add(pane);
            return;
          }
          prism(fp, Math.min(H, o.height || 205), H, [cap, side]);
          if (o.kind === 'door' || o.kind === 'balcony') {
            const sdir = mul(F.n, o.flip ? -1 : 1);
            const hinge = add(add(F.A, mul(F.u, o.hinge === 'b' ? s1 : s0)), mul(sdir, F.h));
            const leaf = new THREE.Mesh(new THREE.BoxGeometry(o.width, o.height || 205, 4), o.kind === 'balcony' ? glass : wood);
            const center = add(hinge, mul(sdir, o.width / 2));
            leaf.position.set(center.x, (o.height || 205) / 2, center.y);
            leaf.rotation.y = -Math.atan2(sdir.y, sdir.x);
            leaf.castShadow = true;
            world.add(leaf);
          }
        });
      });

      corners.hubs.forEach(h => prism(h, 0, H, [cap, side]));

      d.items.forEach(it => {
        const def = ITEMS[it.type] || { h: 70, color: '#ddd' };
        const box = new THREE.Mesh(new THREE.BoxGeometry(it.w, def.h, it.d), mat(def.color));
        box.position.set(it.x, def.h / 2 + 0.5, it.y);
        box.rotation.y = (-(it.rot || 0) * Math.PI) / 180;
        box.castShadow = true;
        box.receiveShadow = true;
        world.add(box);
      });

      const size = Math.max(b.w, b.h, 300);
      sun.position.set(b.x + b.w * 0.2, H + size * 1.2, b.y + b.h * 1.3);
      sun.target.position.set(b.x + b.w / 2, 0, b.y + b.h / 2);
      const sc = sun.shadow.camera;
      sc.left = sc.bottom = -size;
      sc.right = sc.top = size;
      sc.near = 10;
      sc.far = size * 6;
      sc.updateProjectionMatrix();
      if (first) {
        first = false;
        resetView();
      }
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

    function resetView() {
      const b = bounds(ctx.design()) || { x: 0, y: 0, w: 600, h: 400 };
      orbit.target.set(b.x + b.w / 2, 60, b.y + b.h / 2);
      orbit.theta = 0.5;
      orbit.phi = 0.85;
      orbit.radius = clamp(Math.max(b.w, b.h) * 1.65 + 300, 500, 9000);
      applyCamera();
    }

    function topView() {
      orbit.phi = 0.06;
      applyCamera();
    }

    const rotate = (dx, dy) => {
      orbit.theta -= dx * 0.006;
      orbit.phi = clamp(orbit.phi - dy * 0.006, 0.05, 1.5);
      applyCamera();
    };
    const zoom = f => {
      orbit.radius = clamp(orbit.radius * f, 100, 12000);
      applyCamera();
    };

    function dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      world.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      mats.forEach(m => m.dispose());
      renderer.dispose();
      canvas.remove();
    }

    resize();
    return { canvas, rebuild, resize, rotate, zoom, resetView, topView, dispose };
  }

  // ---------------------------------------------------------------------------
  // UI text
  // ---------------------------------------------------------------------------

  const DEFAULT_LABELS = {
    tools: {
      select: 'Odaberi', wall: 'Zid', room: 'Prostorija', door: 'Vrata', window: 'Prozor', furniture: 'Namještaj', text: 'Tekst',
    },
    shortcuts: { select: 'S', wall: 'Z', room: 'P', door: 'V', window: 'O', furniture: 'N', text: 'T' },
    hints: {
      select: 'Klikni element da ga odabereš ili povučeš. Povuci uglove zidova za promjenu oblika. Prazan prostor povuci za pomjeranje, točkićem zumiraj.',
      wall: 'Klikni za početak zida, pa za svaki ugao. Dok crtaš upiši broj za tačnu dužinu. Enter, Esc ili dvoklik završava.',
      wallDrawing: 'Klikni za sljedeći ugao. Upiši broj i Enter za tačnu dužinu. Esc ili dvoklik završava zid.',
      room: 'Povuci pravougaonik i dobiješ prostoriju sa zidovima. Klik unutar zatvorenih zidova pravi prostoriju bez novih zidova.',
      door: 'Klikni na zid da postaviš vrata. Vrstu i širinu biraš desno.',
      window: 'Klikni na zid da postaviš prozor. Širinu biraš desno.',
      furniture: 'Prevuci komad namještaja iz liste desno na plan ili ga klikni.',
      text: 'Klikni na plan da dodaš tekst.',
    },
    kinds: { door: 'Vrata', double: 'Dvokrilna vrata', sliding: 'Klizna vrata', balcony: 'Balkonska vrata', passage: 'Otvor (prolaz)', window: 'Prozor' },
    items: {
      'bed-double': 'Bračni krevet', 'bed-single': 'Krevet', 'sofa': 'Sofa', 'armchair': 'Fotelja', 'coffee': 'Stolić', 'dining': 'Sto i stolice', 'table': 'Sto', 'desk': 'Radni sto',
      'wardrobe': 'Ormar', 'tv': 'TV komoda', 'kitchen': 'Kuhinja', 'fridge': 'Frižider', 'bathtub': 'Kada', 'shower': 'Tuš', 'wc': 'WC', 'basin': 'Umivaonik', 'washer': 'Veš mašina',
      'stairs': 'Stepenice', 'plant': 'Biljka',
    },
    undo: 'Poništi', redo: 'Ponovi', fit: 'Prikaži sve', zoomIn: 'Približi', zoomOut: 'Udalji',
    view: 'Prikaz', grid: 'Mreža', dims: 'Mjere', snap: 'Lijepljenje',
    title: 'Naziv projekta', titlePlaceholder: 'npr. Stan Grbavica',
    total: 'Ukupna površina', rooms: 'Prostorije', noRooms: 'Još nema prostorija. Nacrtaj zidove ili povuci pravougaonik alatom Prostorija.',
    stats: (w, dr, wi) => `Zidova: ${w} · vrata: ${dr} · prozora: ${wi}`,
    wallThickness: 'Debljina novih zidova', wallHeight: 'Visina zidova (3D)',
    openingKind: 'Vrsta', openingWidth: 'Širina',
    wall: 'Zid', length: 'Dužina', thickness: 'Debljina', split: 'Podijeli na pola', remove: 'Ukloni',
    position: 'Od početka zida', flip: 'Okreni stranu', hinge: 'Zamijeni šarke', sill: 'Visina parapeta', height: 'Visina',
    room: 'Prostorija', name: 'Naziv', color: 'Boja', area: 'Površina', perimeter: 'Obim', openRoom: 'nije zatvorena',
    item: 'Namještaj', width: 'Širina', depth: 'Dubina', rotation: 'Rotacija', duplicate: 'Dupliraj',
    label: 'Tekst', text: 'Tekst', size: 'Veličina',
    library: 'Namještaj i sanitarije',
    pdf: 'Preuzmi PDF', pdfBusy: 'Pripremam PDF…', png: 'Preuzmi sliku (PNG)', saveJson: 'Sačuvaj projekat', loadJson: 'Učitaj projekat', clear: 'Očisti',
    pdfTitle: 'Tlocrt', pdfPage: (p, n) => `Strana ${p} / ${n}`, pdfRooms: 'Prostorije', pdfRoom: 'Prostorija', pdfArea: 'Površina',
    pdfError: 'PDF se nije mogao napraviti. Provjerite internet vezu i pokušajte ponovo.',
    loadError: 'Ovaj fajl nije projekat tlocrta.', loaded: 'Projekat učitan. Ctrl+Z vraća prethodni.',
    cleared: 'Plan očišćen. Ctrl+Z vraća.', removed: 'Uklonjeno. Ctrl+Z vraća.',
    noFit: 'Tu ne staje: otvor je preširok ili se preklapa sa drugim.',
    typed: 'Dužina',
    finish: 'Završi zid',
    loading3d: 'Učitavam 3D prikaz…', error3d: '3D prikaz nije dostupan u ovom pregledniku.', resetView: 'Početni pogled', topView: 'Odozgo',
    hint3d: 'Povuci za okretanje · točkić ili dva prsta za zum · uređuje se u 2D',
    canvas: 'Tlocrt', canvas3d: 'Tlocrt u 3D',
    newRoom: n => `Prostorija ${n}`,
    newText: 'Tekst',
  };

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

  const CSS = `
:host{all:initial;display:block;
  --fp-accent:#2f6f62;--fp-accent-ink:#fff;--fp-bg:#fff;--fp-surface:#f7f6f3;--fp-border:#e3e0d9;--fp-text:#1d2125;--fp-muted:#686d74;
  --fp-danger:#b93a26;--fp-ok:#2f8f5b;--fp-paper:#fbfaf7;--fp-radius:12px;--fp-height:760px}
*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none!important}
.fp-root{container:fp/inline-size;font:14px/1.45 var(--fp-font,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif);color:var(--fp-text);-webkit-font-smoothing:antialiased}
.fp{display:grid;grid-template-columns:78px minmax(0,1fr) 300px;grid-template-areas:"tools main panel";height:var(--fp-height);background:var(--fp-bg);border:1px solid var(--fp-border);border-radius:var(--fp-radius);overflow:hidden}
button,input,select{font:inherit;color:inherit}
.fp-tools{grid-area:tools;display:flex;flex-direction:column;gap:4px;padding:10px 8px;background:var(--fp-surface);border-right:1px solid var(--fp-border);overflow:auto}
.fp-tool{all:unset;box-sizing:border-box;display:grid;justify-items:center;gap:3px;padding:8px 2px 7px;border-radius:10px;cursor:pointer;color:var(--fp-muted);font-size:11px;font-weight:650;text-align:center;line-height:1.2}
.fp-tool svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.fp-tool:hover{background:var(--fp-bg);color:var(--fp-text)}
.fp-tool[aria-pressed="true"]{background:var(--fp-accent);color:var(--fp-accent-ink)}
.fp-tool:focus-visible{outline:2px solid var(--fp-accent);outline-offset:1px}
.fp-main{grid-area:main;display:flex;flex-direction:column;min-width:0;min-height:0}
.fp-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 12px;border-bottom:1px solid var(--fp-border)}
.fp-spacer{flex:1}
.fp-btn{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 11px;border:1px solid var(--fp-border);border-radius:8px;background:var(--fp-bg);font-weight:550;white-space:nowrap;cursor:pointer}
.fp-btn:hover{background:var(--fp-surface)}
.fp-btn:focus-visible{outline:2px solid var(--fp-accent);outline-offset:2px}
.fp-btn[disabled]{opacity:.4;pointer-events:none}
.fp-btn.fp-primary{background:var(--fp-accent);border-color:var(--fp-accent);color:var(--fp-accent-ink)}
.fp-btn.fp-primary:hover{filter:brightness(1.08)}
.fp-btn.fp-danger{color:var(--fp-danger)}
.fp-btn.fp-icon{width:32px;padding:0}
.fp-btn.fp-block{width:100%}
.fp-btn[aria-pressed="true"]{background:color-mix(in srgb,var(--fp-accent) 12%,var(--fp-bg));border-color:color-mix(in srgb,var(--fp-accent) 45%,var(--fp-border));color:var(--fp-accent)}
.fp-zoom{min-width:52px;text-align:center;font-size:12.5px;color:var(--fp-muted);font-variant-numeric:tabular-nums}
.fp-seg{display:inline-flex;border:1px solid var(--fp-border);border-radius:8px;overflow:hidden}
.fp-seg button{all:unset;cursor:pointer;padding:0 12px;height:30px;display:grid;place-items:center;font-weight:650;font-size:13px;color:var(--fp-muted)}
.fp-seg button+button{border-left:1px solid var(--fp-border)}
.fp-seg button[aria-pressed="true"]{background:var(--fp-accent);color:var(--fp-accent-ink)}
.fp-stage{position:relative;flex:1;min-height:0;overflow:hidden;background:var(--fp-paper)}
.fp-svg{position:absolute;inset:0;display:block;width:100%;height:100%;touch-action:none;outline:none;user-select:none;-webkit-user-select:none}
.fp-svg.is-draw{cursor:crosshair}
.fp-svg.is-pan{cursor:grabbing}
.fp-svg.is-select [data-kind]{cursor:pointer}
.fp-svg.is-select [data-kind="node"]{cursor:grab}
.fp-svg.is-select [data-kind="wall"]:hover{fill:#565c63}
.fp-svg.is-select [data-kind="opening"]:hover .fp-op-cut{fill:#e8f2ee}
.fp-svg.is-select [data-kind="item"]:hover{filter:brightness(.96)}
.fp-svg.is-select [data-kind="node"]:hover{fill:var(--fp-accent);fill-opacity:.85}
.fp-hint{position:absolute;left:12px;right:12px;bottom:10px;font-size:12.5px;color:var(--fp-muted);pointer-events:none;text-shadow:0 1px 0 #fff,0 0 6px #fff}
.fp-chip{position:absolute;left:50%;top:12px;transform:translateX(-50%);padding:6px 12px;border-radius:999px;background:#1f2328;color:#fff;font-size:13px;font-variant-numeric:tabular-nums;pointer-events:none}
.fp-finish{position:absolute;right:12px;top:12px}
.fp-toast{position:absolute;left:50%;top:12px;z-index:5;max-width:90%;padding:8px 14px;border-radius:8px;background:#1f2328;color:#fff;font-size:13px;opacity:0;transform:translate(-50%,-6px);transition:opacity .2s,transform .2s;pointer-events:none}
.fp-toast.is-on{opacity:1;transform:translate(-50%,0)}
.fp-3d{position:absolute;inset:0;background:var(--fp-surface)}
.fp-3d-canvas{position:absolute;inset:0;display:block;width:100%;height:100%;outline:none;cursor:grab;touch-action:none}
.fp-3d-ui{position:absolute;left:12px;top:12px;display:flex;gap:6px}
.fp-3d-msg{position:absolute;inset:0;display:grid;place-items:center;padding:16px;text-align:center;color:var(--fp-muted)}
.fp-panel{grid-area:panel;display:flex;flex-direction:column;gap:16px;min-height:0;overflow:auto;padding:16px;border-left:1px solid var(--fp-border)}
.fp-panel h3{margin:0;font-size:15px}
.fp-sec{display:grid;gap:8px}
.fp-sec+.fp-sec{padding-top:14px;border-top:1px solid var(--fp-border)}
.fp-field{display:grid;gap:4px;font-size:12px;font-weight:600;color:var(--fp-muted)}
.fp-input,.fp-select{height:34px;width:100%;min-width:0;padding:0 9px;border:1px solid var(--fp-border);border-radius:8px;background:var(--fp-bg);color:var(--fp-text);font-size:14px}
.fp-input:focus-visible,.fp-select:focus-visible{outline:2px solid var(--fp-accent);outline-offset:0;border-color:transparent}
.fp-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.fp-chips{display:flex;flex-wrap:wrap;gap:6px}
.fp-chips .fp-btn{height:30px;padding:0 10px;font-size:13px}
.fp-swatches{display:flex;flex-wrap:wrap;gap:6px}
.fp-swatch{all:unset;width:28px;height:28px;border-radius:7px;border:1px solid rgba(0,0,0,.18);cursor:pointer}
.fp-swatch[aria-pressed="true"]{outline:2px solid var(--fp-accent);outline-offset:2px}
.fp-big{font-size:26px;font-weight:750;font-variant-numeric:tabular-nums;letter-spacing:-.3px}
.fp-muted{color:var(--fp-muted);font-size:13px}
.fp-list{list-style:none;margin:0;padding:0;display:grid}
.fp-list button{all:unset;box-sizing:border-box;display:flex;justify-content:space-between;gap:8px;width:100%;padding:7px 4px;border-bottom:1px solid var(--fp-border);cursor:pointer;font-size:13.5px}
.fp-list button:hover{color:var(--fp-accent)}
.fp-list .fp-dot{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:8px;border:1px solid rgba(0,0,0,.15);vertical-align:-1px}
.fp-list b{font-weight:600;font-variant-numeric:tabular-nums}
.fp-check{display:flex;align-items:center;gap:8px;font-size:13.5px;cursor:pointer}
.fp-check input{width:16px;height:16px;margin:0;accent-color:var(--fp-accent)}
.fp-lib{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.fp-lib button{all:unset;box-sizing:border-box;display:grid;justify-items:center;gap:4px;padding:8px 4px;border:1px solid var(--fp-border);border-radius:9px;background:var(--fp-bg);cursor:grab;font-size:11.5px;text-align:center;line-height:1.2;touch-action:pan-y;user-select:none;-webkit-user-select:none}
.fp-lib button:hover{border-color:color-mix(in srgb,var(--fp-accent) 50%,var(--fp-border))}
.fp-lib svg{width:46px;height:40px}
.fp-actions{display:grid;gap:8px}
.fp-panel .fp-btn{white-space:normal;height:auto;min-height:34px;padding:6px 10px;text-align:center;line-height:1.25}
.fp-row>*{min-width:0}
@container fp (max-width:1000px){
  .fp{grid-template-columns:70px minmax(0,1fr);grid-template-areas:"tools main" "panel panel";height:auto}
  .fp-main{height:min(76vh,640px)}
  .fp-panel{border-left:0;border-top:1px solid var(--fp-border);overflow:visible}
  .fp-lib{grid-template-columns:repeat(auto-fill,minmax(86px,1fr))}
}
@container fp (max-width:640px){
  .fp{grid-template-columns:minmax(0,1fr);grid-template-areas:"tools" "main" "panel"}
  .fp-tools{flex-direction:row;overflow-x:auto;border-right:0;border-bottom:1px solid var(--fp-border);padding:6px}
  .fp-tool{min-width:62px}
  .fp-main{height:min(68vh,560px)}
  .fp-hint{display:none}
}
`;

  const ICONS = {
    select: '<path d="M6 3l12 8-5.5 1.2L10 18z"/>',
    wall: '<path d="M4 19L20 5" stroke-width="4.5"/>',
    room: '<rect x="4" y="5" width="16" height="14" rx="1" stroke-width="2.6"/><path d="M9 12h6" stroke-width="1.6"/>',
    door: '<path d="M3 20h18" stroke-width="2.6"/><path d="M7 20V7"/><path d="M7 7a13 13 0 0 1 13 13" stroke-dasharray="2.5 2.5"/>',
    window: '<rect x="3" y="9" width="18" height="6"/><path d="M3 12h18"/>',
    furniture: '<path d="M4 11h16v6H4z"/><path d="M6 11V8h12v3M5 17v2M19 17v2"/>',
    text: '<path d="M5 6h14M12 6v13M9 19h6"/>',
  };

  // ---------------------------------------------------------------------------
  // Planner UI
  // ---------------------------------------------------------------------------

  const DEFAULTS = {
    container: null,
    design: null,          // a plan from getDesign(), loaded every time
    defaultDesign: null,   // a plan shown to visitors who have nothing saved yet
    storageKey: 'default',
    autosave: true,
    labels: null,
    theme: null,
    pdf: null,             // { title, company, logo, footer }
    three: null,
    threeUrl: null,
    jspdf: null,
    jspdfUrl: null,
    pdfFonts: null,
    onChange: null,
  };

  function create(options) {
    if (typeof document === 'undefined') throw new Error('FloorPlanner.create radi samo u pregledniku');
    const opts = Object.assign({}, DEFAULTS, options);
    const L = Object.assign({}, DEFAULT_LABELS, opts.labels);
    ['tools', 'hints', 'kinds', 'items', 'shortcuts'].forEach(k => { L[k] = Object.assign({}, DEFAULT_LABELS[k], opts.labels && opts.labels[k]); });

    const container = typeof opts.container === 'string' ? document.querySelector(opts.container) : opts.container;
    if (!container) throw new Error('FloorPlanner: container "' + opts.container + '" nije pronađen');
    const host = document.createElement('div');
    host.className = 'floor-planner';
    container.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    if (opts.theme) Object.entries(opts.theme).forEach(([k, v]) => host.style.setProperty('--fp-' + k.replace(/[A-Z]/g, m => '-' + m.toLowerCase()), v));

    const TOOLS = ['select', 'wall', 'room', 'door', 'window', 'furniture', 'text'];
    shadow.innerHTML = `<style>${CSS}</style>
<div class="fp-root"><div class="fp">
  <nav class="fp-tools" aria-label="Alati">
    ${TOOLS.map(t => `<button type="button" class="fp-tool" data-tool="${t}" title="${esc(L.tools[t])} (${L.shortcuts[t]})"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[t]}</svg>${esc(L.tools[t])}</button>`).join('')}
  </nav>
  <section class="fp-main">
    <div class="fp-bar">
      <button type="button" class="fp-btn" data-act="undo" title="Ctrl+Z">↶ ${esc(L.undo)}</button>
      <button type="button" class="fp-btn" data-act="redo" title="Ctrl+Shift+Z">↷</button>
      <span class="fp-spacer"></span>
      <button type="button" class="fp-btn fp-icon" data-act="zoom-out" title="${esc(L.zoomOut)}" aria-label="${esc(L.zoomOut)}">−</button>
      <span class="fp-zoom">100%</span>
      <button type="button" class="fp-btn fp-icon" data-act="zoom-in" title="${esc(L.zoomIn)}" aria-label="${esc(L.zoomIn)}">+</button>
      <button type="button" class="fp-btn" data-act="fit" title="${esc(L.fit)}">⤢</button>
      <div class="fp-seg" role="group" aria-label="${esc(L.view)}"><button type="button" data-view="2d">2D</button><button type="button" data-view="3d">3D</button></div>
    </div>
    <div class="fp-stage">
      <svg class="fp-svg" tabindex="0" role="application" aria-label="${esc(L.canvas)}" xmlns="http://www.w3.org/2000/svg"><g class="fp-layer"></g></svg>
      <div class="fp-3d" hidden>
        <div class="fp-3d-ui"><button type="button" class="fp-btn" data-act="view-reset">⟲ ${esc(L.resetView)}</button><button type="button" class="fp-btn" data-act="view-top">${esc(L.topView)}</button></div>
        <div class="fp-hint">${esc(L.hint3d)}</div>
        <div class="fp-3d-msg" hidden></div>
      </div>
      <div class="fp-hint fp-hint2d"></div>
      <div class="fp-chip" hidden></div>
      <button type="button" class="fp-btn fp-primary fp-finish" data-act="finish" hidden>${esc(L.finish)}</button>
      <div class="fp-toast" role="status" aria-live="polite"></div>
    </div>
  </section>
  <aside class="fp-panel"></aside>
</div>
<input type="file" class="fp-file" accept=".json,.pdf,application/json,application/pdf" hidden>
</div>`;
    const $ = sel => shadow.querySelector(sel);
    const els = {
      svg: $('.fp-svg'), layer: $('.fp-layer'), stage: $('.fp-stage'), panel: $('.fp-panel'), hint: $('.fp-hint2d'), chip: $('.fp-chip'),
      finish: $('.fp-finish'), toast: $('.fp-toast'), zoom: $('.fp-zoom'), undo: $('[data-act="undo"]'), redo: $('[data-act="redo"]'),
      tools: [...shadow.querySelectorAll('[data-tool]')], views: [...shadow.querySelectorAll('[data-view]')], v3d: $('.fp-3d'), msg3d: $('.fp-3d-msg'), file: $('.fp-file'),
    };

    const storageId = 'floor-planner:' + opts.storageKey;
    let design = newDesign();
    const ui = {
      tool: 'select',
      selection: null,
      draw: null,
      typed: '',
      snapPoint: null,
      guides: [],
      preview: null,
      rect: null,
      ghost: null,
      grid: true,
      dims: true,
      snap: true,
      thickness: 20,
      doorKind: 'door',
      widths: { door: 90, double: 140, sliding: 160, balcony: 90, passage: 90, window: 120 },
      view: '2d',
    };
    const view = { x: -100, y: -100, scale: 0.8 };
    const past = [];
    const future = [];
    let raf = 0;
    let gesture = null;
    const pointers = new Map();
    let spaceDown = false;
    let toastTimer = 0;
    let libDrag = null;
    let scene3d = null;
    let loading3d = null;
    let orbitDrag = null;
    let pdfBusy = false;
    let destroyed = false;
    let lastPlan = null;

    // ----- state helpers -----------------------------------------------------

    const snapshot = () => JSON.stringify(design);

    function commit(fn) {
      const before = snapshot();
      fn();
      if (snapshot() === before) return false;
      past.push(before);
      if (past.length > 100) past.shift();
      future.length = 0;
      changed();
      return true;
    }

    function commitFrom(before) {
      if (snapshot() === before) return;
      past.push(before);
      if (past.length > 100) past.shift();
      future.length = 0;
      changed();
    }

    function changed() {
      save();
      renderPanel();
      schedule();
      updateBar();
      if (scene3d && ui.view === '3d') scene3d.rebuild();
      if (typeof opts.onChange === 'function') opts.onChange(getDesign());
    }

    function undo() {
      if (!past.length) return;
      future.push(snapshot());
      design = normalizeDesign(JSON.parse(past.pop()));
      ui.selection = null;
      changed();
    }

    function redo() {
      if (!future.length) return;
      past.push(snapshot());
      design = normalizeDesign(JSON.parse(future.pop()));
      ui.selection = null;
      changed();
    }

    function normalizeDesign(d) {
      const base = newDesign();
      if (!d || typeof d !== 'object') return base;
      const out = Object.assign(base, d);
      ['nodes', 'walls', 'openings', 'rooms', 'items', 'labels'].forEach(k => { if (!Array.isArray(out[k])) out[k] = []; });
      out.settings = Object.assign(newDesign().settings, d.settings);
      out.seq = Object.assign({}, d.seq);
      // keep ids unique even for plans made elsewhere
      ['n', 'w', 'o', 'r', 'f', 't'].forEach(k => {
        const list = { n: out.nodes, w: out.walls, o: out.openings, r: out.rooms, f: out.items, t: out.labels }[k];
        list.forEach(x => {
          const m = String(x.id || '').match(/(\d+)$/);
          if (m) out.seq[k] = Math.max(out.seq[k] || 0, +m[1]);
        });
      });
      return out;
    }

    function save() {
      if (!opts.autosave) return;
      try {
        localStorage.setItem(storageId, snapshot());
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

    function toast(msg) {
      els.toast.textContent = msg;
      els.toast.classList.add('is-on');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => els.toast.classList.remove('is-on'), 3200);
    }

    function getDesign() {
      return JSON.parse(snapshot());
    }

    // ----- view --------------------------------------------------------------

    const stageRect = () => els.svg.getBoundingClientRect();

    function toWorld(ev) {
      const r = stageRect();
      return { x: view.x + (ev.clientX - r.left) / view.scale, y: view.y + (ev.clientY - r.top) / view.scale };
    }

    function zoomAt(cx, cy, factor) {
      const r = stageRect();
      const wx = view.x + (cx - r.left) / view.scale;
      const wy = view.y + (cy - r.top) / view.scale;
      view.scale = clamp(view.scale * factor, 0.05, 8);
      view.x = wx - (cx - r.left) / view.scale;
      view.y = wy - (cy - r.top) / view.scale;
      schedule();
    }

    function fit() {
      const b = bounds(design);
      const r = stageRect();
      if (!r.width || !r.height) return;
      if (!b) {
        view.scale = 1;
        view.x = -60;
        view.y = -60;
      } else {
        view.scale = clamp(Math.min(r.width / (b.w + 80), r.height / (b.h + 80)), 0.05, 4);
        view.x = b.x + b.w / 2 - r.width / 2 / view.scale;
        view.y = b.y + b.h / 2 - r.height / 2 / view.scale;
      }
      schedule();
    }

    function schedule() {
      if (!raf && !destroyed) raf = requestAnimationFrame(render);
    }

    // ----- rendering ---------------------------------------------------------

    function gridSvg(px, r) {
      const x0 = view.x;
      const y0 = view.y;
      const w = r.width * px;
      const h = r.height * px;
      let s = '';
      const lines = (step, color, width) => {
        let p = '';
        for (let x = Math.ceil(x0 / step) * step; x < x0 + w; x += step) p += `M${n2(x)} ${n2(y0)}V${n2(y0 + h)}`;
        for (let y = Math.ceil(y0 / step) * step; y < y0 + h; y += step) p += `M${n2(x0)} ${n2(y)}H${n2(x0 + w)}`;
        return `<path d="${p}" stroke="${color}" stroke-width="${n2(width * px)}" fill="none"/>`;
      };
      if (10 / px >= 7) s += lines(10, '#ece9e2', 1);
      if (100 / px >= 6) s += lines(100, '#dcd8cf', 1);
      return `<g pointer-events="none">${s}</g>`;
    }

    function render() {
      raf = 0;
      if (destroyed) return;
      const r = stageRect();
      if (!r.width) return;
      els.svg.setAttribute('viewBox', `${n2(view.x)} ${n2(view.y)} ${n2(r.width / view.scale)} ${n2(r.height / view.scale)}`);
      const px = 1 / view.scale;
      const plan = planSvg(design, px, { dims: ui.dims, openRoom: L.openRoom });
      lastPlan = plan;
      let s = ui.grid ? gridSvg(px, r) : '';
      s += plan.svg + overlaySvg(px, plan);
      els.layer.innerHTML = s;
      els.zoom.textContent = Math.round(view.scale * 100) + '%';
      els.svg.classList.toggle('is-select', ui.tool === 'select' && !gesture);
      els.svg.classList.toggle('is-draw', ['wall', 'room', 'door', 'window', 'text'].includes(ui.tool));
      els.hint.textContent = ui.draw ? L.hints.wallDrawing : L.hints[ui.tool] || '';
      els.chip.hidden = !(ui.draw && ui.typed);
      if (ui.draw && ui.typed) els.chip.textContent = `${L.typed}: ${ui.typed} cm ↵`;
      els.finish.hidden = !ui.draw;
    }

    function overlaySvg(px, plan) {
      let s = '';
      const accent = 'var(--fp-accent)';
      const sel = ui.selection;
      // selection outline
      if (sel) {
        if (sel.kind === 'wall') {
          const c = plan.corners.get(sel.id);
          if (c && c.aL) s += `<polygon points="${pts2([c.aL, c.bR, c.bL, c.aR])}" fill="none" stroke="${accent}" stroke-width="${n2(2.5 * px)}" pointer-events="none"/>`;
        } else if (sel.kind === 'room') {
          const sh = plan.shapes.get(sel.id);
          if (sh) s += `<polygon points="${pts2(sh.pts)}" fill="none" stroke="${accent}" stroke-width="${n2(2.5 * px)}" stroke-dasharray="${n2(8 * px)} ${n2(5 * px)}" pointer-events="none"/>`;
        } else if (sel.kind === 'item') {
          const it = design.items.find(i => i.id === sel.id);
          if (it) s += `<g transform="translate(${n2(it.x)} ${n2(it.y)}) rotate(${n2(it.rot || 0)})" pointer-events="none"><rect x="${n2(-it.w / 2 - 3 * px)}" y="${n2(-it.d / 2 - 3 * px)}" width="${n2(it.w + 6 * px)}" height="${n2(it.d + 6 * px)}" fill="none" stroke="${accent}" stroke-width="${n2(2 * px)}"/></g>`;
        } else if (sel.kind === 'opening') {
          const o = design.openings.find(x => x.id === sel.id);
          const w = o && wallOf(design, o.wall);
          if (w) {
            const F = wallFrame(design, w);
            const c = add(F.A, mul(F.u, o.pos));
            const a = sub(c, mul(F.u, o.width / 2));
            const b = add(c, mul(F.u, o.width / 2));
            const h = F.h + 4 * px;
            s += `<polygon points="${pts2([add(a, mul(F.n, h)), add(b, mul(F.n, h)), sub(b, mul(F.n, h)), sub(a, mul(F.n, h))])}" fill="none" stroke="${accent}" stroke-width="${n2(2 * px)}" pointer-events="none"/>`;
          }
        } else if (sel.kind === 'label') {
          const l = design.labels.find(x => x.id === sel.id);
          if (l) s += `<circle cx="${n2(l.x)}" cy="${n2(l.y - (l.size || 14) * px * 0.35)}" r="${n2(Math.max(18, String(l.text).length * (l.size || 14) * 0.33) * px)}" fill="none" stroke="${accent}" stroke-width="${n2(1.5 * px)}" stroke-dasharray="${n2(4 * px)} ${n2(3 * px)}" pointer-events="none"/>`;
        }
      }
      // node handles: visible on the selected wall, hit areas everywhere in select mode
      if (ui.tool === 'select') {
        const selWall = sel && sel.kind === 'wall' ? wallOf(design, sel.id) : null;
        design.nodes.forEach(n => {
          const on = selWall && (selWall.a === n.id || selWall.b === n.id);
          s += `<circle data-kind="node" data-id="${esc(n.id)}" cx="${n2(n.x)}" cy="${n2(n.y)}" r="${n2((on ? 7 : 9) * px)}" fill="${on ? '#fff' : 'transparent'}" stroke="${on ? accent : 'none'}" stroke-width="${n2(2 * px)}"/>`;
        });
      }
      // wall being drawn
      if (ui.tool === 'wall' && ui.draw && ui.snapPoint) {
        const a = ui.draw.start;
        const b = ui.snapPoint;
        const t = ui.thickness;
        const u = unit(sub(b, a));
        const nl = leftOf(u);
        const Lw = dist(a, b);
        if (Lw > 0.5) {
          s += `<polygon points="${pts2([add(a, mul(nl, t / 2)), add(b, mul(nl, t / 2)), sub(b, mul(nl, t / 2)), sub(a, mul(nl, t / 2))])}" fill="${WALL_FILL}" opacity=".55" pointer-events="none"/>`;
          const m = add(a, mul(u, Lw / 2));
          s += tagSvg(m, `${Math.round(Lw)} cm`, px, -(t / 2 + 14 * px), u);
        }
      }
      // rectangle room being dragged
      if (ui.rect) {
        const { a, b } = ui.rect;
        const x0 = Math.min(a.x, b.x);
        const y0 = Math.min(a.y, b.y);
        const w = Math.abs(b.x - a.x);
        const h = Math.abs(b.y - a.y);
        s += `<rect x="${n2(x0)}" y="${n2(y0)}" width="${n2(w)}" height="${n2(h)}" fill="rgba(47,111,98,.08)" stroke="${WALL_FILL}" stroke-width="${n2(ui.thickness)}" stroke-opacity=".55" pointer-events="none"/>`;
        s += tagSvg({ x: x0 + w / 2, y: y0 + h / 2 }, `${Math.round(w)} × ${Math.round(h)} cm`, px, 0);
      }
      // door / window preview
      if (ui.preview) {
        const p = ui.preview;
        const ghost = { id: '__preview', wall: p.wall.id, pos: p.pos, width: p.width, kind: p.kind, flip: false, hinge: 'a', height: 205 };
        s += `<g opacity="${p.ok ? 0.9 : 0.5}" pointer-events="none">${openingSvg(Object.assign({}, design, { openings: [] }), ghost, px, { cutFill: p.ok ? '#d9efe5' : '#f6d6d0' })}</g>`;
      }
      // furniture being dragged in from the list
      if (ui.ghost) {
        const def = ITEMS[ui.ghost.type];
        s += itemSvg({ id: '__ghost', type: ui.ghost.type, x: ui.ghost.x, y: ui.ghost.y, w: def.w, d: def.d, rot: 0 }, px, ' opacity=".7" pointer-events="none"');
      }
      // alignment guides and the snap marker
      ui.guides.forEach(g => {
        s += `<line x1="${n2(g.a.x)}" y1="${n2(g.a.y)}" x2="${n2(g.b.x)}" y2="${n2(g.b.y)}" stroke="${accent}" stroke-width="${n2(1 * px)}" stroke-dasharray="${n2(5 * px)} ${n2(4 * px)}" pointer-events="none"/>`;
      });
      if (ui.snapPoint && (ui.tool === 'wall' || (gesture && gesture.type === 'node'))) {
        const sp = ui.snapPoint;
        const r = 5 * px;
        if (sp.kind === 'node') s += `<circle cx="${n2(sp.x)}" cy="${n2(sp.y)}" r="${n2(r * 1.3)}" fill="${accent}" pointer-events="none"/>`;
        else if (sp.kind === 'wall') s += `<rect x="${n2(sp.x - r)}" y="${n2(sp.y - r)}" width="${n2(2 * r)}" height="${n2(2 * r)}" transform="rotate(45 ${n2(sp.x)} ${n2(sp.y)})" fill="${accent}" pointer-events="none"/>`;
        else s += `<path d="M${n2(sp.x - r)} ${n2(sp.y)}h${n2(2 * r)}M${n2(sp.x)} ${n2(sp.y - r)}v${n2(2 * r)}" stroke="${accent}" stroke-width="${n2(1.6 * px)}" pointer-events="none"/>`;
      }
      return s;
    }

    function tagSvg(p, text, px, offset, u) {
      const fs = 12 * px;
      const tw = text.length * fs * 0.6 + 12 * px;
      const off = u ? mul(leftOf(u), offset) : { x: 0, y: offset };
      const c = add(p, off);
      return `<g pointer-events="none"><rect x="${n2(c.x - tw / 2)}" y="${n2(c.y - fs * 0.85)}" width="${n2(tw)}" height="${n2(fs * 1.7)}" rx="${n2(fs * 0.85)}" fill="#1f2328"/><text x="${n2(c.x)}" y="${n2(c.y + fs * 0.36)}" font-size="${n2(fs)}" text-anchor="middle" fill="#fff" font-family="Helvetica, Arial, sans-serif">${esc(text)}</text></g>`;
    }

    // ----- snapping ----------------------------------------------------------

    const STEP = 5;
    const roundTo = (v, s) => Math.round(v / s) * s;

    // Snaps a pointer position: existing corner > wall > 45° direction > alignment > grid.
    function snapPoint(w, from, opts2) {
      const o = opts2 || {};
      const px = 1 / view.scale;
      const tol = 11 * px;
      ui.guides = [];
      const n = findNode(design, w, tol, o.exceptNode);
      if (n && !(o.exceptNeighbours && o.exceptNeighbours.has(n.id))) return { x: n.x, y: n.y, kind: 'node', node: n.id };
      let p = { x: w.x, y: w.y };
      let dir = null;
      if (from && !o.free) {
        const v = sub(w, from);
        const L = Math.hypot(v.x, v.y);
        if (L > 1) {
          const ang = Math.atan2(v.y, v.x);
          const k = Math.round(ang / (Math.PI / 4));
          if (Math.abs(ang - k * (Math.PI / 4)) < (7 * Math.PI) / 180) {
            dir = { x: Math.round(Math.cos(k * (Math.PI / 4)) * 1e6) / 1e6, y: Math.round(Math.sin(k * (Math.PI / 4)) * 1e6) / 1e6 };
            p = add(from, mul(dir, dot(v, dir)));
          }
        }
      }
      const hit = nearestWall(design, p, tol, o.exceptNode);
      if (hit) {
        if (dir) {
          const [A, B] = ends(design, hit.wall);
          const x = lineX(from, dir, A, unit(sub(B, A)));
          if (x && project(x, A, B).dist < 0.5 && dist(x, w) < tol * 2.5) return { x: x.x, y: x.y, kind: 'wall', wall: hit.wall.id };
        }
        return { x: hit.point.x, y: hit.point.y, kind: 'wall', wall: hit.wall.id };
      }
      // alignment with other corners
      let ax = null;
      let ay = null;
      design.nodes.forEach(m => {
        if (m.id === o.exceptNode) return;
        if (Math.abs(m.x - p.x) < tol && (!ax || Math.abs(m.x - p.x) < Math.abs(ax.x - p.x))) ax = m;
        if (Math.abs(m.y - p.y) < tol && (!ay || Math.abs(m.y - p.y) < Math.abs(ay.y - p.y))) ay = m;
      });
      const vertical = dir && Math.abs(dir.x) < 1e-6;
      const horizontal = dir && Math.abs(dir.y) < 1e-6;
      let alignedX = false;
      let alignedY = false;
      if (ax && (!dir || horizontal)) {
        p = { x: ax.x, y: p.y };
        alignedX = true;
        ui.guides.push({ a: { x: ax.x, y: ax.y }, b: { x: ax.x, y: p.y } });
      }
      if (ay && (!dir || vertical)) {
        p = { x: p.x, y: ay.y };
        alignedY = true;
        ui.guides.push({ a: { x: ay.x, y: ay.y }, b: { x: p.x, y: ay.y } });
      }
      if (ui.snap) {
        if (dir) {
          if (!alignedX && !alignedY) p = add(from, mul(dir, roundTo(dot(sub(p, from), dir), STEP)));
        } else {
          if (!alignedX) p.x = roundTo(p.x, STEP);
          if (!alignedY) p.y = roundTo(p.y, STEP);
        }
      }
      return { x: r1(p.x), y: r1(p.y), kind: 'grid' };
    }

    // ----- operations --------------------------------------------------------

    function faceSigs() {
      return new Set(faces(design).map(f => sigOf(f)));
    }

    function sigOf(f) {
      const c = labelPoint(f.pts);
      return Math.round(f.area / 100) + ':' + Math.round(c.x) + ':' + Math.round(c.y);
    }

    function smallestFace(p, list) {
      let best = null;
      (list || faces(design)).forEach(f => {
        if (inside(p, f.pts) && (!best || f.area < best.area)) best = f;
      });
      return best;
    }

    // The room whose label lies in this face (faces are compared by area, as they are rebuilt).
    function roomInFace(f, list) {
      return design.rooms.find(r => {
        const g = smallestFace(r, list);
        return g && Math.abs(g.area - f.area) < 1 && inside(r, f.pts);
      });
    }

    function newRoomIn(f) {
      const c = labelPoint(innerPolygon(design, f));
      const name = L.newRoom(design.rooms.length + 1);
      const room = { id: nextId(design, 'r'), x: r1(c.x), y: r1(c.y), name, color: roomColorFor(name) };
      design.rooms.push(room);
      return room;
    }

    // A room label that ends up on or next to a wall moves to the middle of its room.
    function fixRoomAnchors() {
      const list = faces(design);
      design.rooms.forEach(r => {
        const f = smallestFace(r, list);
        if (!f) return;
        const inner = innerPolygon(design, f);
        if (!inside(r, inner) || edgeDistance(r, inner) < 18) {
          const c = labelPoint(inner);
          r.x = r1(c.x);
          r.y = r1(c.y);
        }
      });
    }

    // When walls go, two rooms can end up in one area: keep the first.
    function dedupeRooms() {
      const list = faces(design);
      const taken = new Set();
      design.rooms = design.rooms.filter(r => {
        const f = smallestFace(r, list);
        if (!f) return true;
        if (taken.has(f)) return false;
        taken.add(f);
        return true;
      });
    }

    // New closed areas get a room automatically.
    function autoRooms(before) {
      const list = faces(design);
      list.forEach(f => {
        if (!before.has(sigOf(f)) && !roomInFace(f, list)) newRoomIn(f);
      });
    }

    function addWallSegment(a, b) {
      const before = faceSigs();
      addWall(design, a, b, ui.thickness);
      autoRooms(before);
      fixRoomAnchors();
    }

    function wallClick(w) {
      const p = snapPoint(w, ui.draw && ui.draw.start);
      if (!ui.draw) {
        ui.draw = { start: { x: p.x, y: p.y }, first: { x: p.x, y: p.y }, existing: p.kind === 'node' || p.kind === 'wall' };
        ui.typed = '';
        schedule();
        return;
      }
      placeWallTo(p);
    }

    function placeWallTo(p) {
      if (dist(p, ui.draw.start) < 1) {
        finishWall();
        return;
      }
      const closesLoop = dist(p, ui.draw.first) < 0.6;
      const ontoExisting = p.kind === 'node' || p.kind === 'wall';
      commit(() => addWallSegment(ui.draw.start, p));
      ui.typed = '';
      if (closesLoop || ontoExisting) finishWall();
      else ui.draw.start = { x: p.x, y: p.y };
      schedule();
    }

    function finishWall() {
      ui.draw = null;
      ui.typed = '';
      ui.snapPoint = null;
      ui.guides = [];
      schedule();
    }

    function typedLength() {
      const v = parseFloat(String(ui.typed).replace(',', '.'));
      if (!ui.draw || !(v > 0)) return;
      const from = ui.draw.start;
      const towards = ui.snapPoint && dist(ui.snapPoint, from) > 0.5 ? ui.snapPoint : add(from, { x: 1, y: 0 });
      const dir = unit(sub(towards, from));
      placeWallTo(Object.assign(add(from, mul(dir, v)), { kind: 'typed' }));
    }

    function makeRectRoom(a, b) {
      const x0 = Math.min(a.x, b.x);
      const y0 = Math.min(a.y, b.y);
      const x1 = Math.max(a.x, b.x);
      const y1 = Math.max(a.y, b.y);
      const c = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
      commit(() => {
        const before = faceSigs();
        const P = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
        for (let i = 0; i < 4; i++) addWall(design, P[i], P[(i + 1) % 4], ui.thickness);
        autoRooms(before);
        const f = smallestFace(c);
        if (f && !roomInFace(f)) newRoomIn(f);
        fixRoomAnchors();
      });
      const f = smallestFace(c);
      const room = f && roomInFace(f);
      if (room) select('room', room.id);
    }

    function roomClick(w) {
      const f = smallestFace(w);
      if (!f) return;
      const existing = roomInFace(f);
      if (existing) {
        select('room', existing.id);
        return;
      }
      const inner = innerPolygon(design, f);
      const c = inside(w, inner) ? w : labelPoint(inner);
      const name = L.newRoom(design.rooms.length + 1);
      const room = { id: nextId(design, 'r'), x: r1(c.x), y: r1(c.y), name, color: roomColorFor(name) };
      commit(() => design.rooms.push(room));
      select('room', room.id);
    }

    function openingPreview(w) {
      const px = 1 / view.scale;
      const hit = nearestWall(design, w, 26 * px + 10);
      if (!hit) return null;
      const kind = ui.tool === 'window' ? 'window' : ui.doorKind;
      const width = ui.widths[kind];
      const Lw = wallLength(design, hit.wall);
      const pos = clamp(roundTo(hit.s, 1), width / 2 + 2, Math.max(width / 2 + 2, Lw - width / 2 - 2));
      return { wall: hit.wall, pos, width, kind, ok: openingFits(design, hit.wall, pos, width) };
    }

    function placeOpening(w) {
      const p = openingPreview(w);
      if (!p) return;
      if (!p.ok) {
        toast(L.noFit);
        return;
      }
      let o = null;
      commit(() => { o = addOpening(design, p.wall, p.pos, p.kind, { width: p.width }); });
      ui.preview = null;
      if (o) select('opening', o.id);
    }

    function placeItem(type, p) {
      const def = ITEMS[type];
      if (!def) return;
      let it = null;
      commit(() => { it = addItem(design, type, roundTo(p.x, STEP), roundTo(p.y, STEP), 0); });
      if (it) select('item', it.id);
    }

    function addLabel(p) {
      const l = { id: nextId(design, 't'), x: r1(p.x), y: r1(p.y), text: L.newText, size: 14 };
      commit(() => design.labels.push(l));
      select('label', l.id);
      setTimeout(() => {
        const input = els.panel.querySelector('[data-prop="text"]');
        if (input) {
          input.focus();
          input.select();
        }
      }, 10);
    }

    function removeSelection() {
      const s = ui.selection;
      if (!s) return;
      commit(() => {
        if (s.kind === 'wall') {
          removeWall(design, s.id);
          dedupeRooms();
        }
        if (s.kind === 'opening') design.openings = design.openings.filter(o => o.id !== s.id);
        if (s.kind === 'room') design.rooms = design.rooms.filter(r => r.id !== s.id);
        if (s.kind === 'item') design.items = design.items.filter(i => i.id !== s.id);
        if (s.kind === 'label') design.labels = design.labels.filter(l => l.id !== s.id);
      });
      ui.selection = null;
      renderPanel();
      toast(L.removed);
    }

    function select(kind, id) {
      ui.selection = kind ? { kind, id } : null;
      renderPanel();
      schedule();
    }

    function selectedObject() {
      const s = ui.selection;
      if (!s) return null;
      const list = { wall: design.walls, opening: design.openings, room: design.rooms, item: design.items, label: design.labels }[s.kind];
      const obj = list && list.find(x => x.id === s.id);
      if (!obj) ui.selection = null;
      return obj ? { kind: s.kind, obj } : null;
    }

    function setTool(t) {
      if (!TOOLS.includes(t)) return;
      ui.tool = t;
      finishWall();
      ui.preview = null;
      ui.rect = null;
      els.tools.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
      renderPanel();
      schedule();
    }

    // ----- panel -------------------------------------------------------------

    const num = v => Math.round(v);

    // Rebuilt after the browser has moved focus, so the field the user went to stays focused;
    // if focus was on a button that is gone, it goes back to the plan (keyboard shortcuts keep working).
    let panelTimer = 0;
    function renderPanel() {
      if (!panelTimer) panelTimer = setTimeout(renderPanelNow, 0);
    }

    function renderPanelNow() {
      panelTimer = 0;
      if (destroyed) return;
      const active = shadow.activeElement;
      const inPanel = active && els.panel.contains(active);
      const prop = inPanel && active.dataset ? active.dataset.prop : null;
      const sel = selectedObject();
      let html = '';
      if (ui.tool === 'furniture') html += libraryHtml();
      if (sel) html += propsHtml(sel);
      else if (ui.tool !== 'furniture') html += toolOptionsHtml() + summaryHtml();
      els.panel.innerHTML = html;
      if (!inPanel) return;
      const again = prop && els.panel.querySelector(`[data-prop="${prop}"]`);
      if (again) {
        again.focus({ preventScroll: true });
        if (again.select && again.type !== 'number') try { again.setSelectionRange(again.value.length, again.value.length); } catch (e) { /* not a text field */ }
      } else els.svg.focus({ preventScroll: true });
    }

    function chips(name, values, current, label) {
      return `<div class="fp-chips">${values.map(v => `<button type="button" class="fp-btn" data-set="${name}" data-value="${esc(v)}" aria-pressed="${String(String(v) === String(current))}">${esc(label ? label(v) : v)}</button>`).join('')}</div>`;
    }

    function toolOptionsHtml() {
      if (ui.tool === 'wall' || ui.tool === 'room') {
        return `<div class="fp-sec"><div class="fp-field">${esc(L.wallThickness)}</div>${chips('thickness', [10, 12, 20, 25, 30], ui.thickness, v => v + ' cm')}</div>`;
      }
      if (ui.tool === 'door') {
        return `<div class="fp-sec"><div class="fp-field">${esc(L.openingKind)}</div>${chips('doorKind', DOOR_KINDS, ui.doorKind, k => L.kinds[k])}
<div class="fp-field">${esc(L.openingWidth)}</div>${chips('width', ui.doorKind === 'double' ? [120, 140, 160] : ui.doorKind === 'sliding' ? [120, 160, 200, 240] : [70, 80, 90, 100], ui.widths[ui.doorKind], v => v + ' cm')}</div>`;
      }
      if (ui.tool === 'window') {
        return `<div class="fp-sec"><div class="fp-field">${esc(L.openingWidth)}</div>${chips('width', [60, 80, 100, 120, 140, 160, 180, 240], ui.widths.window, v => v + ' cm')}</div>`;
      }
      return '';
    }

    function summaryHtml() {
      const plan = { shapes: roomShapes(design) };
      let total = 0;
      const rows = design.rooms.map(r => {
        const sh = plan.shapes.get(r.id);
        if (sh) total += sh.area;
        return `<li><button type="button" data-pick="room:${esc(r.id)}"><span><span class="fp-dot" style="background:${esc(r.color)}"></span>${esc(r.name)}</span><b>${sh ? fmtArea(sh.area / 10000) : '—'}</b></button></li>`;
      }).join('');
      const doors = design.openings.filter(o => o.kind !== 'window').length;
      const windows = design.openings.length - doors;
      return `<div class="fp-sec">
  <label class="fp-field">${esc(L.title)}<input class="fp-input" data-prop="title" value="${esc(design.title)}" placeholder="${esc(L.titlePlaceholder)}"></label>
</div>
<div class="fp-sec">
  <div class="fp-field">${esc(L.total)}</div>
  <div class="fp-big">${fmtArea(total / 10000)}</div>
  ${rows ? `<ul class="fp-list">${rows}</ul>` : `<p class="fp-muted">${esc(L.noRooms)}</p>`}
  <div class="fp-muted">${esc(L.stats(design.walls.length, doors, windows))}</div>
</div>
<div class="fp-sec">
  <label class="fp-check"><input type="checkbox" data-toggle="grid"${ui.grid ? ' checked' : ''}> ${esc(L.grid)}</label>
  <label class="fp-check"><input type="checkbox" data-toggle="dims"${ui.dims ? ' checked' : ''}> ${esc(L.dims)}</label>
  <label class="fp-check"><input type="checkbox" data-toggle="snap"${ui.snap ? ' checked' : ''}> ${esc(L.snap)}</label>
  <label class="fp-field">${esc(L.wallHeight)}<input class="fp-input" type="number" min="200" max="500" step="5" data-prop="height" value="${num(design.settings.height)}"></label>
</div>
<div class="fp-sec fp-actions">
  <button type="button" class="fp-btn fp-primary" data-act="pdf"${pdfBusy ? ' disabled' : ''}>${esc(pdfBusy ? L.pdfBusy : L.pdf)}</button>
  <button type="button" class="fp-btn" data-act="png">${esc(L.png)}</button>
  <div class="fp-row"><button type="button" class="fp-btn" data-act="save">${esc(L.saveJson)}</button><button type="button" class="fp-btn" data-act="load">${esc(L.loadJson)}</button></div>
  <button type="button" class="fp-btn fp-danger" data-act="clear">${esc(L.clear)}</button>
</div>`;
    }

    function libraryHtml() {
      return `<div class="fp-sec"><h3>${esc(L.library)}</h3><div class="fp-lib">${Object.keys(ITEMS).map(t => {
        const def = ITEMS[t];
        const k = Math.max(def.w, def.d);
        return `<button type="button" data-lib="${t}" title="${esc(L.items[t])}"><svg viewBox="${n2(-k * 0.08)} ${n2(-k * 0.08)} ${n2(k * 1.16)} ${n2(k * 1.16)}" aria-hidden="true"><g transform="translate(${n2((k - def.w) / 2)} ${n2((k - def.d) / 2)})">${itemSymbol(t, def.w, def.d, k / 46)}</g></svg>${esc(L.items[t])}</button>`;
      }).join('')}</div></div>`;
    }

    function propsHtml(sel) {
      const o = sel.obj;
      const del = `<button type="button" class="fp-btn fp-danger" data-act="delete">${esc(L.remove)}</button>`;
      if (sel.kind === 'wall') {
        return `<div class="fp-sec"><h3>${esc(L.wall)}</h3>
  <div class="fp-row">
    <label class="fp-field">${esc(L.length)} (cm)<input class="fp-input" type="number" min="10" step="1" data-prop="length" value="${num(wallLength(design, o))}"></label>
    <label class="fp-field">${esc(L.thickness)} (cm)<input class="fp-input" type="number" min="5" max="60" step="1" data-prop="thickness" value="${num(o.thickness)}"></label>
  </div>
  ${chips('wallThickness', [10, 12, 20, 25, 30], o.thickness, v => v + ' cm')}
  <div class="fp-row"><button type="button" class="fp-btn" data-act="split">${esc(L.split)}</button>${del}</div></div>`;
      }
      if (sel.kind === 'opening') {
        const isWindow = o.kind === 'window';
        const kinds = isWindow ? ['window'] : DOOR_KINDS;
        return `<div class="fp-sec"><h3>${esc(L.kinds[o.kind])}</h3>
  ${isWindow ? '' : `<label class="fp-field">${esc(L.openingKind)}<select class="fp-select" data-prop="kind">${kinds.map(k => `<option value="${k}"${k === o.kind ? ' selected' : ''}>${esc(L.kinds[k])}</option>`).join('')}</select></label>`}
  <div class="fp-row">
    <label class="fp-field">${esc(L.width)} (cm)<input class="fp-input" type="number" min="40" max="400" step="5" data-prop="width" value="${num(o.width)}"></label>
    <label class="fp-field">${esc(L.position)} (cm)<input class="fp-input" type="number" min="0" step="1" data-prop="offset" value="${num(o.pos - o.width / 2)}"></label>
  </div>
  ${isWindow ? `<div class="fp-row"><label class="fp-field">${esc(L.sill)} (cm)<input class="fp-input" type="number" min="0" max="200" step="5" data-prop="sill" value="${num(o.sill != null ? o.sill : 90)}"></label><label class="fp-field">${esc(L.height)} (cm)<input class="fp-input" type="number" min="30" max="260" step="5" data-prop="openHeight" value="${num(o.height)}"></label></div>` : ''}
  <div class="fp-row"><button type="button" class="fp-btn" data-act="flip">⇅ ${esc(L.flip)}</button>${isWindow || o.kind === 'double' || o.kind === 'sliding' || o.kind === 'passage' ? '' : `<button type="button" class="fp-btn" data-act="hinge">⇆ ${esc(L.hinge)}</button>`}</div>
  ${del}</div>`;
      }
      if (sel.kind === 'room') {
        const sh = roomShapes(design).get(o.id);
        return `<div class="fp-sec"><h3>${esc(L.room)}</h3>
  <label class="fp-field">${esc(L.name)}<input class="fp-input" data-prop="name" list="fp-room-names" value="${esc(o.name)}"><datalist id="fp-room-names">${ROOM_NAMES.map(n => `<option value="${esc(n)}">`).join('')}</datalist></label>
  <div class="fp-field">${esc(L.color)}</div>
  <div class="fp-swatches">${ROOM_COLORS.map(c => `<button type="button" class="fp-swatch" data-color="${c}" style="background:${c}" aria-label="${c}" aria-pressed="${String(c === o.color)}"></button>`).join('')}</div>
  <div class="fp-row"><div><div class="fp-field">${esc(L.area)}</div><div class="fp-big" style="font-size:20px">${sh ? fmtArea(sh.area / 10000) : '—'}</div></div><div><div class="fp-field">${esc(L.perimeter)}</div><div class="fp-big" style="font-size:20px">${sh ? (sh.perimeter / 100).toLocaleString('hr-HR', { maximumFractionDigits: 2 }) + ' m' : '—'}</div></div></div>
  ${del}</div>`;
      }
      if (sel.kind === 'item') {
        return `<div class="fp-sec"><h3>${esc(L.items[o.type] || L.item)}</h3>
  <div class="fp-row">
    <label class="fp-field">${esc(L.width)} (cm)<input class="fp-input" type="number" min="10" max="800" step="5" data-prop="w" value="${num(o.w)}"></label>
    <label class="fp-field">${esc(L.depth)} (cm)<input class="fp-input" type="number" min="10" max="800" step="5" data-prop="d" value="${num(o.d)}"></label>
  </div>
  <div class="fp-field">${esc(L.rotation)}</div>
  <div class="fp-row"><button type="button" class="fp-btn" data-act="rot-left">↺ 90°</button><button type="button" class="fp-btn" data-act="rot-right">↻ 90°</button></div>
  <div class="fp-row"><button type="button" class="fp-btn" data-act="duplicate">${esc(L.duplicate)}</button>${del}</div></div>`;
      }
      if (sel.kind === 'label') {
        return `<div class="fp-sec"><h3>${esc(L.label)}</h3>
  <label class="fp-field">${esc(L.text)}<input class="fp-input" data-prop="text" value="${esc(o.text)}"></label>
  <div class="fp-field">${esc(L.size)}</div>${chips('labelSize', [11, 14, 18, 24], o.size || 14, v => v + ' px')}
  ${del}</div>`;
      }
      return '';
    }

    function onPanelChange(t) {
      const sel = selectedObject();
      const prop = t.dataset.prop;
      const val = t.value;
      const v = parseFloat(String(val).replace(',', '.'));
      if (prop === 'title') return commit(() => { design.title = val; });
      if (prop === 'height' && v > 0) return commit(() => { design.settings.height = clamp(v, 200, 500); });
      if (!sel) return;
      const o = sel.obj;
      commit(() => {
        if (sel.kind === 'wall') {
          if (prop === 'length' && v > 1) {
            const F = wallFrame(design, o);
            const B = nodeOf(design, o.b);
            B.x = r1(F.A.x + F.u.x * v);
            B.y = r1(F.A.y + F.u.y * v);
            planarize(design);
          }
          if (prop === 'thickness' && v > 0) o.thickness = clamp(v, 5, 60);
        } else if (sel.kind === 'opening') {
          if (prop === 'kind') {
            o.kind = val;
            o.height = (OPENINGS[val] || OPENINGS.door).height;
          }
          if (prop === 'width' && v > 0) o.width = clamp(v, 30, 400);
          if (prop === 'offset' && v >= 0) o.pos = v + o.width / 2;
          if (prop === 'sill' && v >= 0) o.sill = v;
          if (prop === 'openHeight' && v > 0) o.height = v;
          clampOpening(design, o);
        } else if (sel.kind === 'room') {
          if (prop === 'name') {
            const auto = o.color === roomColorFor(o.name) || /^Prostorija \d+$/.test(o.name);
            o.name = val;
            if (auto) o.color = roomColorFor(val);
          }
        } else if (sel.kind === 'item') {
          if (prop === 'w' && v > 0) o.w = clamp(v, 10, 800);
          if (prop === 'd' && v > 0) o.d = clamp(v, 10, 800);
        } else if (sel.kind === 'label') {
          if (prop === 'text') o.text = val;
        }
      });
    }

    function onSet(name, value) {
      const sel = selectedObject();
      if (name === 'thickness') ui.thickness = +value;
      else if (name === 'doorKind') ui.doorKind = value;
      else if (name === 'width') ui.widths[ui.tool === 'window' ? 'window' : ui.doorKind] = +value;
      else if (name === 'wallThickness' && sel) commit(() => { sel.obj.thickness = +value; });
      else if (name === 'labelSize' && sel) commit(() => { sel.obj.size = +value; });
      renderPanel();
      schedule();
    }

    function doAction(a) {
      const sel = selectedObject();
      switch (a) {
        case 'undo': undo(); break;
        case 'redo': redo(); break;
        case 'zoom-in': { const r = stageRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.25); break; }
        case 'zoom-out': { const r = stageRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 0.8); break; }
        case 'fit': fit(); break;
        case 'finish': finishWall(); break;
        case 'delete': removeSelection(); break;
        case 'split':
          if (sel && sel.kind === 'wall') {
            const F = wallFrame(design, sel.obj);
            commit(() => splitWall(design, sel.obj, add(F.A, mul(F.u, F.L / 2))));
          }
          break;
        case 'flip': if (sel) commit(() => { sel.obj.flip = !sel.obj.flip; }); break;
        case 'hinge': if (sel) commit(() => { sel.obj.hinge = sel.obj.hinge === 'b' ? 'a' : 'b'; }); break;
        case 'rot-left': if (sel) commit(() => { sel.obj.rot = ((sel.obj.rot || 0) + 270) % 360; }); break;
        case 'rot-right': if (sel) commit(() => { sel.obj.rot = ((sel.obj.rot || 0) + 90) % 360; }); break;
        case 'duplicate':
          if (sel && sel.kind === 'item') {
            let it = null;
            commit(() => { it = addItem(design, sel.obj.type, sel.obj.x + 20, sel.obj.y + 20, sel.obj.rot, sel.obj.w, sel.obj.d); });
            if (it) select('item', it.id);
          }
          break;
        case 'pdf': exportPdf(); break;
        case 'png': exportPng(); break;
        case 'save': exportJson(); break;
        case 'load': els.file.click(); break;
        case 'clear':
          commit(() => { design = Object.assign(newDesign(), { seq: design.seq, settings: design.settings, title: design.title }); });
          ui.selection = null;
          renderPanel();
          toast(L.cleared);
          break;
        case 'view-reset': if (scene3d) scene3d.resetView(); break;
        case 'view-top': if (scene3d) scene3d.topView(); break;
      }
    }

    function updateBar() {
      els.undo.disabled = !past.length;
      els.redo.disabled = !future.length;
      els.views.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === ui.view)));
    }

    // ----- pointer input on the plan -----------------------------------------

    const DRAGS = new Set(['node', 'wall', 'opening', 'item', 'label', 'roomlabel']);

    function onPointerDown(ev) {
      if (ui.view !== '2d') return;
      els.svg.focus({ preventScroll: true });
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      try { els.svg.setPointerCapture(ev.pointerId); } catch (e) { /* not capturable */ }
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        gesture = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: view.scale, w0: toWorld({ clientX: mid.x, clientY: mid.y }) };
        ui.rect = null;
        return;
      }
      if (pointers.size > 2) return;
      const w = toWorld(ev);
      const base = { sx: ev.clientX, sy: ev.clientY, w0: w, vx: view.x, vy: view.y, moved: false };
      if (ev.button === 1 || spaceDown) {
        gesture = Object.assign(base, { type: 'pan' });
        return;
      }
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      const target = ev.target.closest && ev.target.closest('[data-kind]');
      const kind = target ? target.dataset.kind : null;
      const id = target ? target.dataset.id : null;
      if (ui.tool === 'select') {
        if (kind === 'node') {
          const n = nodeOf(design, id);
          const neigh = new Set();
          design.walls.forEach(x => {
            if (x.a === id) neigh.add(x.b);
            if (x.b === id) neigh.add(x.a);
          });
          gesture = Object.assign(base, { type: 'node', id, start: { x: n.x, y: n.y }, neigh });
        } else if (kind === 'wall') {
          select('wall', id);
          const wl = wallOf(design, id);
          const [A, B] = ends(design, wl);
          gesture = Object.assign(base, { type: 'wall', id, a0: { x: A.x, y: A.y }, b0: { x: B.x, y: B.y }, n: leftOf(unit(sub(B, A))) });
        } else if (kind === 'opening') {
          select('opening', id);
          gesture = Object.assign(base, { type: 'opening', id });
        } else if (kind === 'item') {
          select('item', id);
          const it = design.items.find(i => i.id === id);
          gesture = Object.assign(base, { type: 'item', id, start: { x: it.x, y: it.y } });
        } else if (kind === 'label') {
          select('label', id);
          const l = design.labels.find(i => i.id === id);
          gesture = Object.assign(base, { type: 'label', id, start: { x: l.x, y: l.y } });
        } else if (kind === 'roomlabel') {
          select('room', id);
          const r = design.rooms.find(i => i.id === id);
          gesture = Object.assign(base, { type: 'roomlabel', id, start: { x: r.x, y: r.y }, face: smallestFace(r) });
        } else if (kind === 'room') {
          gesture = Object.assign(base, { type: 'pan', pick: { kind: 'room', id } });
        } else {
          gesture = Object.assign(base, { type: 'pan', pick: { kind: null } });
        }
        return;
      }
      if (ui.tool === 'room') {
        gesture = Object.assign(base, { type: 'rect', a: snapPoint(w, null) });
        return;
      }
      gesture = Object.assign(base, { type: 'click' });
    }

    function onPointerMove(ev) {
      if (ui.view !== '2d') return;
      if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (gesture && gesture.type === 'pinch') {
        if (pointers.size < 2) return;
        const [a, b] = [...pointers.values()];
        const r = stageRect();
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        view.scale = clamp(gesture.s0 * (Math.hypot(a.x - b.x, a.y - b.y) / gesture.d0), 0.05, 8);
        view.x = gesture.w0.x - (mid.x - r.left) / view.scale;
        view.y = gesture.w0.y - (mid.y - r.top) / view.scale;
        schedule();
        return;
      }
      const w = toWorld(ev);
      if (!gesture) {
        hover(w);
        return;
      }
      const g = gesture;
      if (!g.moved) {
        if (Math.hypot(ev.clientX - g.sx, ev.clientY - g.sy) < 4) return;
        g.moved = true;
        if (DRAGS.has(g.type)) g.before = snapshot();
        if (g.type === 'click') g.type = 'pan';
        if (g.type === 'pan') els.svg.classList.add('is-pan');
      }
      switch (g.type) {
        case 'pan':
          view.x = g.vx - (ev.clientX - g.sx) / view.scale;
          view.y = g.vy - (ev.clientY - g.sy) / view.scale;
          break;
        case 'node': {
          const p = snapPoint(w, null, { exceptNode: g.id, exceptNeighbours: g.neigh });
          ui.snapPoint = p;
          const n = nodeOf(design, g.id);
          n.x = p.x;
          n.y = p.y;
          design.openings.forEach(o => clampOpening(design, o));
          break;
        }
        case 'wall': {
          const delta = sub(w, g.w0);
          let off = dot(delta, g.n);
          if (ui.snap) off = roundTo(off, 1);
          const A = nodeOf(design, wallOf(design, g.id).a);
          const B = nodeOf(design, wallOf(design, g.id).b);
          A.x = r1(g.a0.x + g.n.x * off);
          A.y = r1(g.a0.y + g.n.y * off);
          B.x = r1(g.b0.x + g.n.x * off);
          B.y = r1(g.b0.y + g.n.y * off);
          design.openings.forEach(o => clampOpening(design, o));
          break;
        }
        case 'opening': {
          const o = design.openings.find(x => x.id === g.id);
          const hit = nearestWall(design, w, 40 / view.scale + 10);
          if (o && hit && openingFits(design, hit.wall, clamp(hit.s, o.width / 2 + 2, wallLength(design, hit.wall) - o.width / 2 - 2), o.width, o.id)) {
            o.wall = hit.wall.id;
            o.pos = roundTo(hit.s, 1);
            clampOpening(design, o);
          }
          break;
        }
        case 'item': {
          const it = design.items.find(x => x.id === g.id);
          const p = add(g.start, sub(w, g.w0));
          it.x = ui.snap ? roundTo(p.x, STEP) : r1(p.x);
          it.y = ui.snap ? roundTo(p.y, STEP) : r1(p.y);
          break;
        }
        case 'label': {
          const l = design.labels.find(x => x.id === g.id);
          const p = add(g.start, sub(w, g.w0));
          l.x = r1(p.x);
          l.y = r1(p.y);
          break;
        }
        case 'roomlabel': {
          const r = design.rooms.find(x => x.id === g.id);
          const p = add(g.start, sub(w, g.w0));
          if (!g.face || inside(p, g.face.pts)) {
            r.x = r1(p.x);
            r.y = r1(p.y);
          }
          break;
        }
        case 'rect':
          ui.rect = { a: g.a, b: snapPoint(w, null) };
          break;
      }
      schedule();
    }

    function onPointerUp(ev) {
      pointers.delete(ev.pointerId);
      els.svg.classList.remove('is-pan');
      const g = gesture;
      if (!g) return;
      if (g.type === 'pinch') {
        if (!pointers.size) gesture = null;
        return;
      }
      gesture = null;
      const w = toWorld(ev);
      if (!g.moved) {
        click(w, g);
        schedule();
        return;
      }
      if (g.type === 'node') {
        const p = ui.snapPoint;
        if (p && p.kind === 'node' && p.node !== g.id) mergeNodes(design, g.id, p.node);
        planarize(design);
        dedupeRooms();
        fixRoomAnchors();
        ui.snapPoint = null;
        ui.guides = [];
      } else if (g.type === 'wall') {
        planarize(design);
        dedupeRooms();
        fixRoomAnchors();
      } else if (g.type === 'rect') {
        const r = ui.rect;
        ui.rect = null;
        if (r && Math.abs(r.b.x - r.a.x) >= 30 && Math.abs(r.b.y - r.a.y) >= 30) makeRectRoom(r.a, r.b);
        else roomClick(w);
      }
      if (g.before) commitFrom(g.before);
      else renderPanel();
      schedule();
    }

    function click(w, g) {
      switch (ui.tool) {
        case 'select':
          if (g.pick) select(g.pick.kind, g.pick.id || null);
          break;
        case 'wall': wallClick(w); break;
        case 'room': roomClick(w); break;
        case 'door':
        case 'window': placeOpening(w); break;
        case 'text': addLabel(w); break;
        case 'furniture': break;
      }
    }

    function hover(w) {
      if (ui.tool === 'wall') {
        ui.snapPoint = snapPoint(w, ui.draw && ui.draw.start);
        schedule();
      } else if (ui.tool === 'door' || ui.tool === 'window') {
        ui.preview = openingPreview(w);
        schedule();
      } else if (ui.snapPoint || ui.guides.length) {
        ui.snapPoint = null;
        ui.guides = [];
        schedule();
      }
    }

    function onWheel(ev) {
      if (ui.view !== '2d') return;
      ev.preventDefault();
      zoomAt(ev.clientX, ev.clientY, Math.exp(-ev.deltaY * 0.0015));
    }

    function onKeyDown(ev) {
      const t = ev.target;
      const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName);
      const mod = ev.ctrlKey || ev.metaKey;
      if (typing) {
        // Enter / Esc leave the field and hand the keyboard back to the plan (the change is applied on blur).
        if ((ev.key === 'Enter' || ev.key === 'Escape') && t.dataset.prop) els.svg.focus({ preventScroll: true });
        return;
      }
      if (mod && ev.key.toLowerCase() === 'z') { ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
      if (mod && ev.key.toLowerCase() === 'y') { ev.preventDefault(); redo(); return; }
      if (mod) return;
      if (ev.key === ' ') { spaceDown = true; ev.preventDefault(); return; }
      if (ui.draw && /^[0-9.,]$/.test(ev.key)) {
        ui.typed += ev.key;
        ev.preventDefault();
        schedule();
        return;
      }
      if (ev.key === 'Escape') {
        if (ui.typed) ui.typed = '';
        else if (ui.draw) finishWall();
        else if (ui.selection) select(null);
        else setTool('select');
        schedule();
        return;
      }
      if (ev.key === 'Enter') {
        if (ui.draw && ui.typed) typedLength();
        else if (ui.draw) finishWall();
        return;
      }
      if (ev.key === 'Backspace' && ui.typed) {
        ui.typed = ui.typed.slice(0, -1);
        schedule();
        return;
      }
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        if (ui.selection) {
          ev.preventDefault();
          removeSelection();
        }
        return;
      }
      const sel = selectedObject();
      if (sel && (sel.kind === 'item' || sel.kind === 'label') && /^Arrow/.test(ev.key)) {
        ev.preventDefault();
        const step = ev.shiftKey ? 10 : 1;
        const dx = ev.key === 'ArrowLeft' ? -step : ev.key === 'ArrowRight' ? step : 0;
        const dy = ev.key === 'ArrowUp' ? -step : ev.key === 'ArrowDown' ? step : 0;
        commit(() => { sel.obj.x += dx; sel.obj.y += dy; });
        return;
      }
      if (sel && sel.kind === 'item' && ev.key.toLowerCase() === 'r') {
        commit(() => { sel.obj.rot = ((sel.obj.rot || 0) + (ev.shiftKey ? 270 : 90)) % 360; });
        return;
      }
      const tool = Object.keys(L.shortcuts).find(k => L.shortcuts[k].toLowerCase() === ev.key.toLowerCase());
      if (tool) setTool(tool);
    }

    // ----- dragging furniture in from the list -------------------------------

    function onLibDown(ev) {
      const b = ev.target.closest('[data-lib]');
      if (!b) return;
      libDrag = { type: b.dataset.lib, sx: ev.clientX, sy: ev.clientY, moved: false, id: ev.pointerId, touch: ev.pointerType === 'touch' };
      if (!libDrag.touch) ev.preventDefault();
      window.addEventListener('pointermove', onLibMove);
      window.addEventListener('pointerup', onLibUp);
      window.addEventListener('pointercancel', onLibCancel);
    }

    function overStage(ev) {
      const r = stageRect();
      return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
    }

    function onLibMove(ev) {
      if (!libDrag || ev.pointerId !== libDrag.id) return;
      if (libDrag.touch) return;
      if (!libDrag.moved && Math.hypot(ev.clientX - libDrag.sx, ev.clientY - libDrag.sy) < 5) return;
      libDrag.moved = true;
      if (overStage(ev)) {
        const w = toWorld(ev);
        ui.ghost = { type: libDrag.type, x: w.x, y: w.y };
      } else ui.ghost = null;
      schedule();
    }

    function onLibUp(ev) {
      if (!libDrag || ev.pointerId !== libDrag.id) return;
      const d = libDrag;
      onLibCancel();
      if (d.moved && overStage(ev)) placeItem(d.type, toWorld(ev));
      else if (!d.moved) {
        const r = stageRect();
        placeItem(d.type, toWorld({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
      }
    }

    function onLibCancel() {
      libDrag = null;
      ui.ghost = null;
      window.removeEventListener('pointermove', onLibMove);
      window.removeEventListener('pointerup', onLibUp);
      window.removeEventListener('pointercancel', onLibCancel);
      schedule();
    }

    // ----- 3D ----------------------------------------------------------------

    function setView(v) {
      if (v !== '2d' && v !== '3d') return;
      ui.view = v;
      els.svg.style.visibility = v === '3d' ? 'hidden' : '';
      els.v3d.hidden = v !== '3d';
      els.hint.hidden = v === '3d';
      if (v === '3d') {
        finishWall();
        els.chip.hidden = true;
        els.finish.hidden = true;
      }
      updateBar();
      if (v === '2d') {
        schedule();
        return;
      }
      ensure3d().then(s => {
        if (ui.view !== '3d') return;
        s.resize();
        s.rebuild();
      }).catch(() => { /* message shown */ });
    }

    function ensure3d() {
      if (scene3d) return Promise.resolve(scene3d);
      if (!loading3d) {
        els.msg3d.textContent = L.loading3d;
        els.msg3d.hidden = false;
        loading3d = loadThree(opts).then(THREE => {
          scene3d = createScene3D(THREE, { wrap: els.v3d, design: () => design, label: L.canvas3d });
          els.msg3d.hidden = true;
          const c = scene3d.canvas;
          const pts = new Map();
          c.addEventListener('pointerdown', ev => {
            c.setPointerCapture(ev.pointerId);
            pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
            orbitDrag = pts.size === 2 ? { pinch: pinch(pts) } : { x: ev.clientX, y: ev.clientY };
          });
          c.addEventListener('pointermove', ev => {
            if (!orbitDrag || !pts.has(ev.pointerId)) return;
            pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
            if (orbitDrag.pinch) {
              if (pts.size === 2) {
                const dd = pinch(pts);
                scene3d.zoom(orbitDrag.pinch / dd);
                orbitDrag.pinch = dd;
              }
              return;
            }
            scene3d.rotate(ev.clientX - orbitDrag.x, ev.clientY - orbitDrag.y);
            orbitDrag.x = ev.clientX;
            orbitDrag.y = ev.clientY;
          });
          const up = ev => {
            pts.delete(ev.pointerId);
            if (!pts.size) orbitDrag = null;
            else {
              const [p] = pts.values();
              orbitDrag = { x: p.x, y: p.y };
            }
          };
          c.addEventListener('pointerup', up);
          c.addEventListener('pointercancel', up);
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

    function pinch(pts) {
      const [a, b] = [...pts.values()];
      return Math.hypot(a.x - b.x, a.y - b.y) || 1;
    }

    // ----- export ------------------------------------------------------------

    function fileDay() {
      const d = new Date();
      return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map(v => String(v).padStart(2, '0')).join('-');
    }

    function download(blob, name) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      shadow.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }

    // The plan as an image: text sized as on a ~900 px wide screen, drawn at `width` pixels.
    function planImage(width) {
      const b = bounds(design) || { x: 0, y: 0, w: 400, h: 300 };
      const m = Math.max(b.w, b.h) * 0.04;
      const vb = { x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m };
      const px = Math.max(vb.w, vb.h * 1.3) / 900;
      const plan = planSvg(design, px, { dims: true, openRoom: L.openRoom });
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n2(vb.x)} ${n2(vb.y)} ${n2(vb.w)} ${n2(vb.h)}"><rect x="${n2(vb.x)}" y="${n2(vb.y)}" width="${n2(vb.w)}" height="${n2(vb.h)}" fill="#fff"/>${plan.svg}</svg>`;
      const h = Math.round((width * vb.h) / vb.w);
      return rasterize(svg, width, h).then(img => Object.assign(img, { shapes: plan.shapes }));
    }

    function exportPng() {
      planImage(2400).then(img => img.canvas.toBlob(blob => download(blob, `tlocrt-${fileDay()}.png`), 'image/png'));
    }

    function exportJson() {
      download(new Blob([JSON.stringify(design, null, 2)], { type: 'application/json' }), `tlocrt-${fileDay()}.json`);
    }

    async function exportPdf() {
      if (pdfBusy) return;
      pdfBusy = true;
      renderPanel();
      try {
        const urls = Object.assign({}, PDF_FONTS, opts.pdfFonts);
        const [JsPDF, regular, bold] = await Promise.all([loadJsPdf(opts), loadFontBase64(urls.normal), loadFontBase64(urls.bold)]);
        const img = await planImage(2600);
        const logo = opts.pdf && opts.pdf.logo ? await loadImageData(opts.pdf.logo).catch(() => null) : null;
        buildPdf(JsPDF, regular, bold, img, logo).save(`tlocrt-${fileDay()}.pdf`);
      } catch (err) {
        if (typeof console !== 'undefined') console.error(err);
        toast(L.pdfError);
      } finally {
        pdfBusy = false;
        renderPanel();
      }
    }

    function buildPdf(JsPDF, regular, bold, img, logo) {
      const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape', compress: true });
      doc.addFileToVFS('Roboto-Regular.ttf', regular);
      doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
      doc.addFileToVFS('Roboto-Bold.ttf', bold);
      doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');
      const P = Object.assign({ title: L.pdfTitle, company: '', footer: '' }, opts.pdf);
      const W = 297;
      const H = 210;
      const M = 12;
      const font = (style, size, color) => {
        doc.setFont('Roboto', style);
        doc.setFontSize(size);
        doc.setTextColor(color || '#1d2125');
      };
      let hx = M;
      if (logo) {
        const lw = Math.min(40, (9 * logo.w) / logo.h);
        doc.addImage(logo.data, 'PNG', M, M, lw, 9);
        hx += lw + 3;
      }
      font('bold', 10.5, '#4b4f55');
      if (P.company) doc.text(P.company, hx, M + 6);
      font('normal', 10, '#686d74');
      doc.text(new Date().toLocaleDateString('hr-HR'), W - M, M + 6, { align: 'right' });
      font('bold', 19);
      doc.text(design.title || P.title, M, M + 19);
      let total = 0;
      const rows = design.rooms.map(r => {
        const sh = img.shapes.get(r.id);
        if (sh) total += sh.area;
        return [r.name, sh ? fmtArea(sh.area / 10000) : '—', r.color];
      });
      font('normal', 10.5, '#4b4f55');
      doc.text(`${L.total}: ${fmtArea(total / 10000)} · ${L.rooms.toLowerCase()}: ${rows.length}`, M, M + 26);

      const top = M + 32;
      const colW = 70;
      const maxW = W - 2 * M - colW - 8;
      const maxH = H - top - 14;
      let iw = maxW;
      let ih = (iw * img.h) / img.w;
      if (ih > maxH) {
        ih = maxH;
        iw = (ih * img.w) / img.h;
      }
      doc.addImage(img.data, 'PNG', M, top, iw, ih);

      const cx = W - M - colW;
      let y = top;
      font('bold', 12);
      doc.text(L.pdfRooms, cx, y + 4);
      y += 9;
      rows.forEach(([name, a, color]) => {
        doc.setFillColor(color || '#f3eee6');
        doc.setDrawColor('#c9c5bd');
        doc.rect(cx, y - 3.2, 3.6, 3.6, 'FD');
        font('normal', 10);
        doc.text(doc.splitTextToSize(name, colW - 30)[0], cx + 6, y);
        doc.text(a, cx + colW, y, { align: 'right' });
        y += 6.2;
        doc.setDrawColor('#ebe8e2');
        doc.line(cx, y - 3.6, cx + colW, y - 3.6);
      });
      y += 2;
      font('bold', 11);
      doc.text(L.total, cx, y + 2);
      doc.text(fmtArea(total / 10000), cx + colW, y + 2, { align: 'right' });

      font('normal', 8.5, '#868a90');
      if (P.footer) doc.text(String(P.footer), M, H - 7);
      doc.text(L.pdfPage(1, 1), W - M, H - 7, { align: 'right' });
      doc.setProperties({ title: design.title || P.title, creator: 'FloorPlanner ' + VERSION, keywords: PDF_MARKER + ' v1:' + toBase64(JSON.stringify(design)) });
      return doc;
    }

    function importText(text) {
      const t = String(text).replace(/^﻿/, '').trim();
      let d = null;
      try {
        if (t.startsWith('%PDF')) {
          const m = t.match(/floor-planner v1:([A-Za-z0-9+/=]+)/);
          d = m ? JSON.parse(fromBase64(m[1])) : null;
        } else d = JSON.parse(t);
      } catch (e) {
        d = null;
      }
      if (!d || !Array.isArray(d.walls) || !Array.isArray(d.nodes)) {
        toast(L.loadError);
        return false;
      }
      commit(() => { design = normalizeDesign(d); });
      ui.selection = null;
      renderPanel();
      fit();
      toast(L.loaded);
      return true;
    }

    // ----- events ------------------------------------------------------------

    shadow.addEventListener('click', ev => {
      const t = ev.target;
      const tool = t.closest('[data-tool]');
      if (tool) return setTool(tool.dataset.tool);
      const view2 = t.closest('[data-view]');
      if (view2) return setView(view2.dataset.view);
      const act = t.closest('[data-act]');
      if (act) return doAction(act.dataset.act);
      const set = t.closest('[data-set]');
      if (set) return onSet(set.dataset.set, set.dataset.value);
      const color = t.closest('[data-color]');
      if (color) {
        const sel = selectedObject();
        if (sel && sel.kind === 'room') commit(() => { sel.obj.color = color.dataset.color; });
        return;
      }
      const pick = t.closest('[data-pick]');
      if (pick) {
        const [k, id] = pick.dataset.pick.split(':');
        setTool('select');
        select(k, id);
      }
    });
    shadow.addEventListener('change', ev => {
      const t = ev.target;
      if (t === els.file) {
        const f = t.files && t.files[0];
        t.value = '';
        if (f) f.text().then(importText);
        return;
      }
      if (t.dataset.toggle) {
        ui[t.dataset.toggle] = t.checked;
        schedule();
        return;
      }
      if (t.dataset.prop) onPanelChange(t);
    });
    shadow.addEventListener('keydown', onKeyDown);
    shadow.addEventListener('keyup', ev => { if (ev.key === ' ') spaceDown = false; });
    els.panel.addEventListener('pointerdown', onLibDown);
    els.svg.addEventListener('pointerdown', onPointerDown);
    els.svg.addEventListener('pointermove', onPointerMove);
    els.svg.addEventListener('pointerup', onPointerUp);
    els.svg.addEventListener('pointercancel', onPointerUp);
    els.svg.addEventListener('pointerleave', () => {
      if (!gesture && (ui.preview || ui.snapPoint)) {
        ui.preview = null;
        if (!ui.draw) ui.snapPoint = null;
        schedule();
      }
    });
    els.svg.addEventListener('wheel', onWheel, { passive: false });
    els.svg.addEventListener('dblclick', () => { if (ui.draw) finishWall(); });
    els.svg.addEventListener('contextmenu', ev => {
      if (ui.draw) {
        ev.preventDefault();
        finishWall();
      }
    });
    const ro = new ResizeObserver(() => schedule());
    ro.observe(els.stage);

    // ----- start ---------------------------------------------------------------

    const start = opts.design || readStorage() || opts.defaultDesign;
    design = normalizeDesign(start ? JSON.parse(JSON.stringify(start)) : newDesign());
    ui.thickness = design.settings.thickness || 20;
    setTool('select');
    updateBar();
    requestAnimationFrame(() => fit());

    const api = {
      version: VERSION,
      host,
      ready: Promise.resolve(),
      getDesign,
      loadDesign(d) {
        commit(() => { design = normalizeDesign(JSON.parse(JSON.stringify(d))); });
        ui.selection = null;
        renderPanel();
        fit();
      },
      clear: () => doAction('clear'),
      undo,
      redo,
      fit,
      setTool,
      setView,
      exportPdf,
      exportPng,
      exportJson,
      importText,
      areas() {
        const sh = roomShapes(design);
        return design.rooms.map(r => ({ id: r.id, name: r.name, m2: sh.get(r.id) ? Math.round(sh.get(r.id).area / 100) / 100 : null }));
      },
      destroy() {
        destroyed = true;
        clearTimeout(panelTimer);
        ro.disconnect();
        onLibCancel();
        if (scene3d) scene3d.dispose();
        host.remove();
      },
    };
    return api;
  }

  return { version: VERSION, create, sketch, faces, roomShapes, newDesign, addWall, ITEMS, OPENINGS };
});
