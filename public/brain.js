// Brain map extras (P5.2): file card actions and preview, folder filter, Motion toggle, index refresh.
// Runs after the inline script in index.html and uses its globals (N, adj, sel, on, folder, reduce, select, goTo, init...).
(function () {
  const $ = id => document.getElementById(id)
  const prm = matchMedia('(prefers-reduced-motion: reduce)').matches
  const fsel = $('bFolder'), mot = $('bMotion'), rb = $('bRefresh'), prev = $('cPrev'), view = $('cView'), stat = $('cStat')
  const say = t => { stat.textContent = t }
  const settle = () => { if (!frozen) for (let i = 0; i < 600 && alpha >= 0.001; i++) tick() }
  // Prefixes come from the server (home folder + config trimPrefixes) in the graph payload.
  // Same rule as lib/scan.js trimProject: trim[0] is the home prefix, the rest are config extras.
  const short = f => { const [home = '', ...extra] = window.GRAPH_TRIM || []; return extra.reduce((s, x) => s.startsWith(x) ? s.slice(x.length) : s, home && f.startsWith(home) ? f.slice(home.length) : f.replace(/^[A-Za-z]--/, '')) }

  // ---------- layouts: Force is the live simulation; Circle, Hex and Rings are static, grouped by department (top folder) ----------
  const LAYS = ['force', 'circle', 'hex', 'rings', 'sphere'], layBtns = [...$('bLayout').querySelectorAll('[data-lay]')]
  let geo = null // marks of the static layout: { sectors, bands } (Rings), { groups } (Hex) or { sphere, R } (Sphere)
  try { const v = localStorage.getItem('aos.layout'); if (LAYS.includes(v)) layout = v; else if (document.documentElement.dataset.view === 'depth') layout = 'sphere' } catch {}
  const paintLay = () => layBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lay === layout)))
  paintLay()

  // departments by size, nodes in each by type then name
  function depts(vis) {
    const m = new Map()
    for (const n of vis) { if (!m.has(n.folder)) m.set(n.folder, []); m.get(n.folder).push(n) }
    for (const a of m.values()) a.sort((x, y) => ORDER.indexOf(x.type) - ORDER.indexOf(y.type) || x.label.localeCompare(y.label))
    return [...m].sort((a, b) => b[1].length - a[1].length || short(a[0]).localeCompare(short(b[0])))
  }
  function circleAt(vis) {
    const list = depts(vis).flatMap(d => d[1]), R = Math.max(120, list.length * 16 / (2 * Math.PI))
    list.forEach((n, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / list.length; n.tx = R * Math.cos(a); n.ty = R * Math.sin(a) })
    return null
  }
  // axial hex spiral from the centre, as x, y at spacing sp
  const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]
  function hexCells(count, sp) {
    const out = [[0, 0]]
    for (let k = 1; out.length < count; k++) {
      let q = -k, r = k
      for (const [dq, dr] of DIRS) for (let j = 0; j < k; j++) { out.push([q, r]); q += dq; r += dr }
    }
    return out.slice(0, count).map(([q, r]) => [sp * (q + r / 2), sp * r * Math.sqrt(3) / 2])
  }
  function hexAt(vis) {
    const sp = 18, gap = 30, top = 18
    const gs = depts(vis).map(([f, ns]) => { const cells = hexCells(ns.length, sp); return { f, ns, cells, rad: Math.max(...cells.map(([x, y]) => Math.hypot(x, y))) + sp / 2 } })
    // shelf packing: departments left to right in rows of about square width
    const rowW = Math.sqrt(gs.reduce((s, g) => s + (2 * g.rad + gap) * (2 * g.rad + gap + top), 0)) * 1.15
    let x = 0, y = 0, rowH = 0, w = 0
    for (const g of gs) {
      const d = 2 * g.rad + gap
      if (x && x + d > rowW) { x = 0; y += rowH; rowH = 0 }
      g.cx = x + g.rad; g.cy = y + top + g.rad
      x += d; rowH = Math.max(rowH, d + top); w = Math.max(w, x)
    }
    const ox = (w - gap) / 2, oy = (y + rowH - gap) / 2
    for (const g of gs) g.ns.forEach((n, i) => { n.tx = g.cx - ox + g.cells[i][0]; n.ty = g.cy - oy + g.cells[i][1] })
    return { groups: gs.map(g => ({ x: g.cx - ox, y: g.cy - oy, r: g.rad, label: short(g.f) })) }
  }
  // departments are sectors; node types are bands from the centre out; a band takes rows when a sector is full
  function ringsAt(vis) {
    const gs = depts(vis), types = ORDER.filter(t => vis.some(n => n.type === t))
    const R0 = 160, sp = 15, rowGap = 15, typeGap = 30, GAP = gs.length > 1 ? 0.012 : 0
    const weight = ns => Math.max(ns.length, 4), wsum = gs.reduce((s, g) => s + weight(g[1]), 0), free = 2 * Math.PI - GAP * gs.length
    let a = -Math.PI / 2, r = R0
    const secs = gs.map(([f, ns]) => { const w = free * weight(ns) / wsum, s = { f, ns, a0: a, a1: a + w }; a += w + GAP; return s })
    const perRow = (w, rr) => Math.max(1, Math.floor(w * rr / sp))
    const bands = []
    for (const t of types) {
      let rows = 1
      for (const s of secs) {
        const left = s.ns.filter(n => n.type === t), w = s.a1 - s.a0
        let rr = r, k = 0
        while (left.length) {
          const row = left.splice(0, perRow(w, rr))
          row.forEach((n, j) => { const an = s.a0 + (j + 0.5) * w / row.length; n.tx = rr * Math.cos(an); n.ty = rr * Math.sin(an) })
          rr += rowGap; k++
        }
        rows = Math.max(rows, k)
      }
      bands.push({ r0: r, r1: r + (rows - 1) * rowGap })
      r += (rows - 1) * rowGap + typeGap
    }
    const r1 = r - typeGap + 16
    return { sectors: secs.map(s => ({ a0: s.a0, a1: s.a1, r0: R0 - 16, r1, label: short(s.f) })), bands }
  }

  // Sphere: each folder family (server side, lib/families.js) is a patch on the globe, laid out by a force
  // run on the sphere surface: links pull, files push apart, other families push harder (the gaps).
  // Each node keeps a unit vector (ux, uy, uz); spin() turns it and projects it with perspective.
  const rot = { yaw: 0.6, tilt: 0.35, v: 0, goal: null }, SPIN = 0.00015, PD = 3.2 // rad per ms (about 40 s a turn); camera distance in radii
  function proj(ux, uy, uz) {
    const cy = Math.cos(rot.yaw), sy = Math.sin(rot.yaw), ct = Math.cos(rot.tilt), st = Math.sin(rot.tilt)
    const x = ux * cy + uz * sy, z1 = uz * cy - ux * sy, y = uy * ct - z1 * st, z = uy * st + z1 * ct
    const s = PD / (PD - z)
    return [x * s, y * s, z, s]
  }
  function place(n) {
    const [x, y, z, s] = proj(n.ux, n.uy, n.uz)
    n.x = x * geo.R; n.y = y * geo.R; n.zs = s; n.za = 0.25 + 0.75 * (z + 1) / 2
  }
  const GOLD = Math.PI * (3 - Math.sqrt(5)), unit = p => { const l = Math.hypot(...p) || 1; return [p[0] / l, p[1] / l, p[2] / l] }
  const rnd = k => { const s = Math.sin(k * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s) }
  function sphereAt(vis) {
    const m = vis.length, R = Math.max(120, 17 * Math.sqrt(m)), fm = new Map()
    for (const n of vis) { if (!fm.has(n.fam)) fm.set(n.fam, []); fm.get(n.fam).push(n) }
    // family seeds spread like a Fibonacci sphere, biggest first
    const fams = [...fm].sort((a, b) => b[1].length - a[1].length).map(([label, ns], i, all) => {
      const K = all.length, y = K > 1 ? 1 - 2 * (i + 0.5) / K : 0, r = Math.sqrt(1 - y * y)
      // cap: a patch's fair share of the globe (80% of n/m of the area, the rest are gaps); files spread freely inside it
      return { label, ns, c: [r * Math.cos(i * GOLD), y, r * Math.sin(i * GOLD)], cap: Math.acos(clamp(1 - 1.6 * ns.length / m, -1, 1)) }
    })
    const fi = new Map(), idx = new Map(vis.map((n, i) => [n, i]))
    fams.forEach((f, k) => f.ns.forEach(n => fi.set(n, k)))
    const P = vis.map((n, i) => { const c = fams[fi.get(n)].c; return unit([c[0] + 0.5 * (rnd(i) - 0.5), c[1] + 0.5 * (rnd(i + 0.3) - 0.5), c[2] + 0.5 * (rnd(i + 0.7) - 0.5)]) })
    const L = E.filter(e => idx.has(e.s) && idx.has(e.t)).map(e => [idx.get(e.s), idx.get(e.t), fi.get(e.s) === fi.get(e.t)])
    const F = P.map(() => [0, 0, 0]), rep = 0.35 / m, IT = 260
    for (let it = 0; it < IT; it++) {
      const cool = 1 - it / IT
      for (const f of F) f[0] = f[1] = f[2] = 0
      for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) {
        const a = P[i], b = P[j], dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2], d2 = dx * dx + dy * dy + dz * dz + 1e-4
        const f = (fi.get(vis[i]) === fi.get(vis[j]) ? 1 : 3) * rep / d2
        F[i][0] += dx * f; F[i][1] += dy * f; F[i][2] += dz * f; F[j][0] -= dx * f; F[j][1] -= dy * f; F[j][2] -= dz * f
      }
      for (const [a, b, same] of L) {
        const w = same ? 0.02 : 0.004
        for (let q = 0; q < 3; q++) { const d = (P[b][q] - P[a][q]) * w; F[a][q] += d; F[b][q] -= d }
      }
      if (it % 10 === 0) for (const f of fams) { const s = [0, 0, 0]; for (const n of f.ns) { const p = P[idx.get(n)]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2] } f.c = unit(s) }
      for (let i = 0; i < m; i++) {
        const { c, cap } = fams[fi.get(vis[i])], f = F[i], out = Math.acos(clamp(P[i][0] * c[0] + P[i][1] * c[1] + P[i][2] * c[2], -1, 1)) > cap
        if (out) for (let q = 0; q < 3; q++) f[q] += (c[q] - P[i][q]) * 0.06
        const l = Math.hypot(...f), s = Math.min(l, 0.06 * cool + 0.002) / (l || 1)
        P[i] = unit([P[i][0] + f[0] * s, P[i][1] + f[1] * s, P[i][2] + f[2] * s])
      }
    }
    vis.forEach((n, i) => {
      [n.ux, n.uy, n.uz] = P[i]
      const [px, py] = proj(n.ux, n.uy, n.uz); n.tx = px * R; n.ty = py * R
    })
    // each patch: centre and angular radius (most files inside it), for the outline and the name
    for (const f of fams) {
      f.c = unit(f.ns.reduce((s, n) => [s[0] + n.ux, s[1] + n.uy, s[2] + n.uz], [0, 0, 0]))
      const an = f.ns.map(n => Math.acos(clamp(n.ux * f.c[0] + n.uy * f.c[1] + n.uz * f.c[2], -1, 1))).sort((a, b) => a - b)
      f.th = an[Math.floor(an.length * 0.9)] + 0.08
    }
    return { sphere: true, R, fams: fams.length > 1 ? fams.map(f => ({ label: f.label, c: f.c, th: f.th, n: f.ns.length })) : [] }
  }
  const sphereR = () => frozen && geo && geo.sphere ? geo.R : 0
  // links on the globe: a great-circle arc raised off the surface, higher for files far apart
  function arcPt(e, t) {
    const a = e.s, b = e.t, w = Math.acos(clamp(a.ux * b.ux + a.uy * b.uy + a.uz * b.uz, -1, 1)), sw = Math.sin(w)
    const p = sw < 1e-3 ? 1 - t : Math.sin((1 - t) * w) / sw, q = sw < 1e-3 ? t : Math.sin(t * w) / sw, h = 1 + 0.18 * w * Math.sin(Math.PI * t)
    const [x, y] = proj((p * a.ux + q * b.ux) * h, (p * a.uy + q * b.uy) * h, (p * a.uz + q * b.uz) * h)
    return [x * geo.R, y * geo.R]
  }
  const onGlobe = e => sphereR() && !lay && e.s.ux !== undefined && e.t.ux !== undefined
  function edgePath(c, e) {
    c.moveTo(e.s.x, e.s.y)
    if (!onGlobe(e)) return c.lineTo(e.t.x, e.t.y)
    for (let i = 1; i <= 12; i++) c.lineTo(...arcPt(e, i / 12))
  }
  const edgeAt = (e, t) => onGlobe(e) ? arcPt(e, t) : [lerp(e.s.x, e.t.x, t), lerp(e.s.y, e.t.y, t)]
  // family names on screen (set by drawNames), for hover and click
  let famBoxes = []
  const famAt = (x, y) => (famBoxes.find(b => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]) || [])[4] || null
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a))
  // turn the family patch to the front and zoom in on it
  function famGo(label) {
    const f = geo && geo.fams && geo.fams.find(g => g.label === label)
    if (!f) return
    const [x, y, z] = f.c, r = Math.hypot(x, z)
    rot.hold = true
    rot.goal = { yaw: rot.yaw + wrap(Math.atan2(-x, z) - rot.yaw), tilt: clamp(Math.atan2(y, r), -1.3, 1.3) }
    if (reduce) { rot.yaw = rot.goal.yaw; rot.tilt = rot.goal.tilt; rot.goal = null; for (const n of N) if (shown(n) && n.ux !== undefined) place(n) }
    const a = area(), k = clamp(Math.min(a.r - a.l, a.b - a.t) * 0.38 / (geo.R * Math.max(0.2, Math.sin(Math.min(f.th, 1.5)))), fitK || 0.2, 4)
    goTo(0, 0, k)
  }
  // each frame: turn the sphere and project the shown nodes (not during a layout tween)
  function spin(dt) {
    if (!sphereR() || lay) return
    if (drag && drag.moved) rot.goal = rot.hold = null
    if (rot.goal) {
      const e = Math.min(1, dt * 0.006), dy = rot.goal.yaw - rot.yaw, dt2 = rot.goal.tilt - rot.tilt
      rot.yaw += dy * e; rot.tilt += dt2 * e; rot.v = 0
      if (Math.abs(dy) + Math.abs(dt2) < 1e-3) rot.goal = null
    } else if (!(drag && drag.moved) && !reduce) {
      const want = sel || hover || ringHover || famHover || rot.hold ? 0 : SPIN // hold: a family was turned to the front
      rot.v += (want - rot.v) * Math.min(1, dt * 0.0025)
      rot.yaw += rot.v * dt
    }
    for (const n of N) if (shown(n) && n.ux !== undefined) place(n)
  }
  // drag on the sphere turns it; returns false when the layout is not the sphere
  function turn(dx, dy, ts) {
    if (!sphereR()) return false
    rot.yaw += dx * 0.006; rot.tilt = clamp(rot.tilt - dy * 0.006, -1.3, 1.3)
    rot.v = clamp(dx * 0.006 / Math.max(8, ts - (rot.ts || 0)), -0.004, 0.004); rot.ts = ts
    for (const n of N) if (shown(n) && n.ux !== undefined) place(n)
    return true
  }
  const depthOn = () => document.documentElement.dataset.view === 'depth' && innerWidth > 960

  // move the nodes to a layout; jump = no tween; refit = camera fits the result
  function arrange(name, jump, refit) {
    if (!graphOk) return
    if (name !== 'sphere') for (const n of N) n.zs = n.za = undefined
    if (name === 'force') {
      geo = null
      if (!frozen) return
      for (const n of N) { n.tx = n.hx; n.ty = n.hy }
    } else {
      if (!frozen) for (const n of N) { n.hx = n.x; n.hy = n.y }
      frozen = true
      for (const n of N) { n.tx = n.x; n.ty = n.y } // hidden nodes stay put
      const vis = N.filter(shown)
      geo = vis.length ? (name === 'circle' ? circleAt : name === 'hex' ? hexAt : name === 'sphere' ? sphereAt : ringsAt)(vis) : null
    }
    const toForce = name === 'force'
    if (jump || reduce) {
      lay = null
      for (const n of N) { n.x = n.tx; n.y = n.ty }
      if (toForce) frozen = false
    } else {
      // targets stay in x, y until the next frame so the fit below sees them; stepLay starts from ox, oy
      for (const n of N) { n.ox = n.x; n.oy = n.y; n.x = n.tx; n.y = n.ty }
      lay = { t0: performance.now(), dur: 700, e: 0, done: toForce ? () => { frozen = false } : null }
    }
    if (refit && mode === 'brain') { if (sel && shown(sel)) goTo(sel.x, sel.y, cam.k); else fit() }
    kick()
  }
  // Rings: the whole disc plus room for the sector names outside it (fit() only sees nodes)
  function ringsK(a) {
    if (sphereR()) return clamp(Math.min((a.r - a.l - 160) / (2.3 * geo.R), (a.b - a.t - 100) / (2.3 * geo.R)), 0.2, 2.5)
    if (!frozen || !geo || !geo.sectors) return 0
    const R = geo.sectors[0].r1
    return clamp(Math.min((a.r - a.l - 400) / (2 * R), (a.b - a.t - 70) / (2 * R)), 0.2, 2.5)
  }
  layBtns.forEach(b => b.onclick = () => {
    if (b.dataset.lay === layout) return
    growStop() // unborn nodes would keep their old positions
    layout = b.dataset.lay
    try { localStorage.setItem('aos.layout', layout) } catch {}
    paintLay()
    if (mode === 'brain') arrange(layout, false, true)
  })
  const refilter = () => { growStop(); if (frozen && mode === 'brain' && layout !== 'force') arrange(layout, false, true) }

  function grid(c, k, R) {
    // meridians and parallels; alpha falls with depth so the far side reads as behind
    const curves = []
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 6; curves.push(u => [Math.cos(u) * Math.cos(a), Math.sin(u), Math.cos(u) * Math.sin(a)]) }
    for (const y of [-0.66, -0.33, 0, 0.33, 0.66]) { const r = Math.sqrt(1 - y * y); curves.push(u => [r * Math.cos(u), y, r * Math.sin(u)]) }
    c.lineWidth = 1 / k
    const LV = 6, paths = Array.from({ length: LV }, () => new Path2D())
    for (const f of curves) {
      let p = proj(...f(0))
      for (let j = 1; j <= 64; j++) {
        const q = proj(...f(j * Math.PI / 32)), lv = Math.min(LV - 1, Math.floor((p[2] + q[2] + 2) / 4 * LV))
        paths[lv].moveTo(p[0] * R, p[1] * R); paths[lv].lineTo(q[0] * R, q[1] * R); p = q
      }
    }
    paths.forEach((path, i) => { c.strokeStyle = 'rgba(56,214,245,' + (0.03 + 0.15 * i / (LV - 1)).toFixed(3) + ')'; c.stroke(path) })
    c.strokeStyle = 'rgba(31,111,128,.6)'; c.beginPath(); c.arc(0, 0, R * PD / Math.sqrt(PD * PD - 1), 0, 7); c.stroke()
  }
  // a family patch outline: a small circle on the surface, fading with depth like the grid; f.top = its highest point (name spot)
  function famRing(c, k, f, ga) {
    const [cx, cy, cz] = f.c, a = Math.abs(cy) < 0.9 ? [0, 1, 0] : [1, 0, 0], R = geo.R, th = Math.min(f.th, 2.6)
    const u = unit([a[1] * cz - a[2] * cy, a[2] * cx - a[0] * cz, a[0] * cy - a[1] * cx]), v = [cy * u[2] - cz * u[1], cz * u[0] - cx * u[2], cx * u[1] - cy * u[0]]
    const co = Math.cos(th), si = Math.sin(th), lit = f.label === famHover
    const pt = j => { const p = j * Math.PI / 24, s = Math.cos(p) * si, t = Math.sin(p) * si; return proj(cx * co + u[0] * s + v[0] * t, cy * co + u[1] * s + v[1] * t, cz * co + u[2] * s + v[2] * t) }
    c.lineWidth = (lit ? 1.5 : 1) / k; c.strokeStyle = '#38d6f5'
    let p = pt(0)
    f.top = [p[0] * R, p[1] * R]
    for (let j = 1; j <= 48; j++) {
      const q = pt(j)
      if (q[1] < f.top[1] / R) f.top = [q[0] * R, q[1] * R]
      c.globalAlpha = ga * (lit ? 0.85 : 0.3) * (0.1 + 0.9 * ((p[2] + q[2]) / 2 + 1) / 2)
      c.beginPath(); c.moveTo(p[0] * R, p[1] * R); c.lineTo(q[0] * R, q[1] * R); c.stroke(); p = q
    }
    c.globalAlpha = ga
  }
  // sector wedges and band guides (world space), in dim cyan tints only
  function drawMarks(c, k) {
    if (lay && lay.ghost) { c.globalAlpha = 1 - lay.e; grid(c, k, lay.ghost) }
    if (!geo) return
    c.globalAlpha = lay ? lay.e : 1
    if (geo.sphere) { grid(c, k, geo.R); for (const f of geo.fams || []) famRing(c, k, f, c.globalAlpha) }
    if (geo.sectors) {
      geo.sectors.forEach((s, i) => {
        c.beginPath(); c.arc(0, 0, s.r1, s.a0, s.a1); c.arc(0, 0, s.r0, s.a1, s.a0, true); c.closePath()
        c.fillStyle = i % 2 ? 'rgba(56,214,245,.022)' : 'rgba(56,214,245,.045)'; c.fill()
        c.lineWidth = 2 / k; c.strokeStyle = '#1f6f80'; c.beginPath(); c.arc(0, 0, s.r1, s.a0, s.a1); c.stroke()
      })
      c.lineWidth = 1 / k; c.strokeStyle = 'rgba(31,111,128,.45)'; c.setLineDash([3 / k, 6 / k])
      for (const b of geo.bands) { c.beginPath(); c.arc(0, 0, (b.r0 + b.r1) / 2, 0, 7); c.stroke() }
      c.setLineDash([])
    }
    if (geo.groups) {
      c.lineWidth = 1 / k; c.strokeStyle = 'rgba(31,111,128,.6)'
      for (const g of geo.groups) { shapePath(c, 6, g.x, g.y, g.r + 6); c.stroke() }
    }
    c.globalAlpha = 1
  }
  // department names (screen space): culled when they would overlap
  function drawNames(c) {
    famBoxes = []
    if (!geo || lay || !(geo.sectors || geo.groups || (geo.fams && geo.fams.length))) return
    c.font = '11px ui-monospace, Consolas, monospace'; c.textBaseline = 'middle'; c.lineJoin = 'round'
    const boxes = []
    const put = (text, x, y, align, fam) => {
      const w = c.measureText(text).width, x0 = align === 'left' ? x : align === 'right' ? x - w : x - w / 2, box = [x0 - 3, y - 8, x0 + w + 3, y + 8]
      if (x0 < 0 || x0 + w > W || y < (mode === 'home' ? 0 : hdr.offsetHeight) || y > H) return
      if (boxes.some(b => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3])) return
      boxes.push(box)
      if (fam) famBoxes.push([...box, fam])
      c.textAlign = align; c.lineWidth = 4; c.strokeStyle = BG; c.strokeText(text, x, y)
      c.fillStyle = fam && fam === famHover ? '#38d6f5' : '#9aa4ab'; c.fillText(text, x, y)
    }
    // globe: one name per family on the front half, above its outline, biggest first
    for (const f of geo.fams || []) {
      if (proj(...f.c)[2] < 0.2 || !f.top) continue
      const name = f.label.length > 24 ? f.label.slice(0, 23) + '…' : f.label
      put(name.toUpperCase() + ' · ' + f.n, cam.x + f.top[0] * cam.k, cam.y + f.top[1] * cam.k - 10, 'center', f.label)
    }
    const cut = s => s.length > 24 ? '…' + s.slice(-23) : s // the tail tells similar paths apart
    for (const s of geo.sectors || []) {
      const m = (s.a0 + s.a1) / 2, cx = Math.cos(m), cy = Math.sin(m), d = s.r1 * cam.k + 12
      if ((s.a1 - s.a0) * s.r1 * cam.k < 12) continue // sector narrower than a text line on screen
      put(cut(s.label), cam.x + cx * d, cam.y + cy * d, cx > 0.25 ? 'left' : cx < -0.25 ? 'right' : 'center')
    }
    for (const g of geo.groups || []) put(cut(g.label), cam.x + g.x * cam.k, cam.y + (g.y - g.r - 6) * cam.k - 10, 'center')
    c.textAlign = 'start'
  }

  // ---------- markdown preview: DOM nodes with textContent only, never innerHTML of file text ----------
  function inline(el, s) {
    for (const part of s.split(/(`[^`]+`|\*\*[^*]+\*\*)/)) {
      if (!part) continue
      const code = part.length > 2 && part[0] === '`', bold = part.length > 4 && part.startsWith('**')
      if (code || bold) { const e = document.createElement(code ? 'code' : 'b'); e.textContent = code ? part.slice(1, -1) : part.slice(2, -2); el.append(e) }
      else el.append(part)
    }
    return el
  }
  function md(src) {
    const out = []
    let ul = null, code = null
    const block = (tag, text) => inline(document.createElement(tag), text)
    for (const line of src.split(/\r?\n/)) {
      if (code) { if (/^\s*```/.test(line)) code = null; else code.textContent += line + '\n'; continue }
      let m
      if (/^\s*```/.test(line)) { ul = null; const pre = document.createElement('pre'); code = document.createElement('code'); pre.append(code); out.push(pre) }
      else if ((m = /^#{1,6}\s+(.*)/.exec(line))) { ul = null; out.push(block('h4', m[1])) }
      else if ((m = /^\s*(?:[-*+]|\d+[.)])\s+(.*)/.exec(line))) { if (!ul) out.push(ul = document.createElement('ul')); ul.append(block('li', m[1])) }
      else if (!line.trim()) ul = null
      else { ul = null; out.push(block('p', line)) }
    }
    return out
  }

  // ---------- file card ----------
  function hidePreview() { prev.hidden = true; prev.replaceChildren(); view.textContent = 'View here'; view.setAttribute('aria-expanded', 'false') }
  function card(n) {
    if (!n) { if (localOn && frozen) queueMicrotask(refit); return } // all files are back: re-lay them
    $('cTags').replaceChildren(...[TYPES[n.type].one, short(n.folder), ...(n.tags || [])].map(t => Object.assign(document.createElement('li'), { textContent: t })))
    if (localOn) { localSet = near(n); queueMicrotask(refit) }
    const links = adj.get(n) || [], kinds = {}
    for (const { kind } of links) kinds[kind] = (kinds[kind] || 0) + 1
    $('cLinkN').textContent = links.length ? `${links.length}: ` + Object.entries(kinds).map(([k, v]) => `${v} ${k}`).join(', ') : 'none'
    hidePreview(); say('')
  }
  view.onclick = async () => {
    const n = sel
    if (!n) return
    if (!prev.hidden) return hidePreview()
    say('Loading preview')
    try {
      const r = await fetch('/api/file?path=' + encodeURIComponent(n.id)), j = await r.json()
      if (!r.ok) throw new Error(j.error || r.status)
      if (sel !== n) return
      prev.replaceChildren(...md(j.text))
      prev.hidden = false; view.textContent = 'Hide preview'; view.setAttribute('aria-expanded', 'true')
      say(j.truncated ? `Showing the first 200 KB of ${Math.round(j.size / 1024)} KB` : '')
    } catch (e) { if (sel === n) say('Preview failed: ' + e.message) }
  }
  // ---------- local graph: only the files within `depth` links of the selected one ----------
  let localOn = false, depth = 1
  const localBtn = $('cLocal'), depthBtns = [...$('cDepth').querySelectorAll('[data-d]')]
  function near(n) {
    const seen = new Set([n])
    let front = [n]
    for (let d = 0; d < depth; d++) {
      const next = []
      for (const a of front) for (const { node } of adj.get(a)) if (!seen.has(node)) { seen.add(node); next.push(node) }
      front = next
    }
    return seen
  }
  function refit() {
    if (mode !== 'brain') return
    growStop()
    updateSearch()
    if (frozen) arrange(layout, false, true); else { touched = true; fit() }
  }
  function paintLocal() {
    localBtn.setAttribute('aria-pressed', String(localOn))
    depthBtns.forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.d === depth)))
  }
  localBtn.onclick = () => {
    localOn = !localOn
    localSet = localOn && sel ? near(sel) : null
    paintLocal(); refit()
  }
  depthBtns.forEach(b => b.onclick = () => {
    depth = +b.dataset.d
    if (localOn && sel) { localSet = near(sel); refit() }
    paintLocal()
  })

  $('cFly').onclick =() => { if (sel) { touched = true; goTo(sel.x, sel.y, Math.max(cam.k, 2)) } }
  $('cOpen').onclick = async () => {
    const n = sel
    if (!n) return
    try {
      const r = await fetch('/api/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: n.id }) }), j = await r.json()
      if (!r.ok) throw new Error(j.error || r.status)
      say('Opened on this device')
    } catch (e) { say('Open failed: ' + e.message) }
  }

  // ---------- hover tooltip: follows the cursor, stays in the viewport, hidden while dragging ----------
  const tip = $('bTip')
  let tipFor = null
  const tipHide = () => { if (!tip.hidden) tip.hidden = true; tipFor = null }
  cv.addEventListener('pointermove', e => {
    if (mode !== 'brain' || ptrs.size || !hover || e.pointerType !== 'mouse') return tipHide()
    if (tipFor !== hover) {
      const n = tipFor = hover
      $('tName').textContent = n.label; $('tDept').textContent = short(n.folder); $('tType').textContent = TYPES[n.type].one
      $('tSize').textContent = fmtSize(n.size); $('tAge').textContent = ago(n.mtime); $('tPath').textContent = n.id
      tip.hidden = false
    }
    const pad = 8, w = tip.offsetWidth, h = tip.offsetHeight
    let x = e.clientX + 16, y = e.clientY + 18
    if (x + w > innerWidth - pad) x = e.clientX - 16 - w
    if (y + h > innerHeight - pad) y = e.clientY - 18 - h
    tip.style.transform = `translate(${Math.max(pad, x)}px, ${Math.max(pad, y)}px)`
  })
  for (const ev of ['pointerdown', 'pointerleave', 'wheel']) cv.addEventListener(ev, tipHide, { passive: true })

  // ---------- top folder filter ----------
  function ready() {
    const counts = {}
    for (const n of N) counts[n.folder] = (counts[n.folder] || 0) + 1
    const fams = {}
    for (const n of N) fams['fam:' + n.fam] = (fams['fam:' + n.fam] || 0) + 1
    if (folder && !counts[folder] && !fams[folder]) folder = ''
    const names = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || short(a).localeCompare(short(b)))
    const group = (label, opts) => { const g = document.createElement('optgroup'); g.label = label; g.append(...opts); return g }
    // families (the globe groups) first, so the keyboard can reach what a family name click shows
    const famOpts = Object.keys(fams).sort((a, b) => fams[b] - fams[a]).map(f => new Option(`${f.slice(4)} (${fams[f]})`, f))
    fsel.replaceChildren(new Option(`All folders (${N.length})`, ''), ...(famOpts.length > 1 ? [group('Groups', famOpts)] : []), group('Folders', names.map(f => new Option(`${short(f)} (${counts[f]})`, f))))
    fsel.value = folder
    homeLay(true)
  }
  function allFolders() { folder = ''; fsel.value = '' }
  fsel.onchange = () => {
    folder = fsel.value
    if (sel && !shown(sel)) select(null)
    updateSearch(); refilter(); kick()
  }

  // ---------- Motion on/off: off stops the layout drift and camera flights ----------
  function paintMotion() {
    mot.setAttribute('aria-pressed', String(!reduce))
    mot.querySelector('b').textContent = reduce ? 'off' : 'on'
    if (prm) { mot.setAttribute('aria-disabled', 'true'); mot.title = 'Off: reduced motion is on (system or Display settings)' }
  }
  mot.onclick = () => {
    if (prm) return say('Motion stays off: reduced motion is on (system or Display settings)')
    reduce = !reduce
    try { localStorage.setItem('aos.motion', reduce ? 'off' : 'on') } catch {}
    if (reduce) { tween = null; settle() }
    paintMotion(); kick()
  }
  paintMotion()

  // ---------- index refresh: rebuilds cache/brain-index.json on the server ----------
  rb.onclick = async () => {
    if (rb.getAttribute('aria-busy') === 'true') return
    rb.setAttribute('aria-busy', 'true'); rb.textContent = 'Indexing'; growStop()
    try {
      const r = await fetch('/api/graph/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), g = await r.json()
      if (!r.ok) throw new Error(g.error || r.status)
      const old = new Map(N.map(n => [n.id, n])), selId = sel && sel.id
      const added = g.nodes.filter(n => !old.has(n.id)).length
      hover = null; pulses = []; sel = null
      if (added) alpha = Math.max(alpha, 0.3)
      init(g, old) // with motion off, init settles the layout itself
      if (mode === 'brain') arrange(layout, true, false)
      const again = selId && N.find(n => n.id === selId)
      if (again) select(again); else select(null)
      rb.title = 'Indexed ' + new Date(g.builtAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      $('qcount').textContent = `${N.length} files, ${added} new`
    } catch (e) { $('qcount').textContent = 'Refresh failed: ' + e.message }
    rb.removeAttribute('aria-busy'); rb.textContent = 'Refresh'
  }

  // ---------- Animate: the shown files appear in modified-time order, oldest first ----------
  const animBtn = $('bAnim'), speed = $('bSpeed'), animAt = $('bAnimAt')
  let grow = null // { order, i, acc, t, raf }
  function growStop() {
    if (!grow) return
    cancelAnimationFrame(grow.raf)
    for (const n of grow.order) n.unborn = false
    grow = null; animBtn.setAttribute('aria-pressed', 'false'); animBtn.textContent = 'Animate'; animAt.textContent = ''
    updateSearch(); kick()
  }
  function growStep(t) {
    const g = grow, i0 = g.i
    g.acc += Math.min(t - g.t, 100) * speed.value / 1000; g.t = t
    while (g.acc >= 1 && g.i < g.order.length) { g.order[g.i++].unborn = false; g.acc-- }
    if (g.i !== i0) { animAt.textContent = new Date(g.order[g.i - 1].mtime).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); kick() }
    if (g.i >= g.order.length) return growStop()
    g.raf = requestAnimationFrame(growStep)
  }
  animBtn.onclick = () => {
    if (grow) return growStop()
    if (!graphOk || mode !== 'brain') return
    select(null)
    queueMicrotask(growStart) // after the refit that card(null) may queue
  }
  function growStart() {
    const order = N.filter(shown).sort((a, b) => (a.mtime < b.mtime ? -1 : a.mtime > b.mtime ? 1 : 0))
    if (!order.length) return
    for (const n of order) n.unborn = true
    grow = { order, i: 0, acc: 1, t: performance.now(), raf: 0 }
    animBtn.setAttribute('aria-pressed', 'true'); animBtn.textContent = 'Stop'
    grow.raf = requestAnimationFrame(growStep)
  }

  // Home shows the force layout, or the sphere in the 3D HUD view
  function homeLay(jump) {
    if (!graphOk || mode !== 'home') return
    if (depthOn()) { if (sphereR()) return; settle(); arrange('sphere', jump, false) } else if (frozen) arrange('force', jump, false)
  }
  new MutationObserver(() => homeLay(false)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-view'] })

  window.brain = {
    ready, card, allFolders, refilter, drawMarks, drawNames, ringsK, sphereR, spin, turn, edgePath, edgeAt, famAt, famGo,
    arrive: () => {
      // from the home sphere (3D view) the globe unfolds: each file flies from its spot on the globe to the map,
      // front ones first, while size and fade ease from depth to flat; else the layout just applies
      if (!(depthOn() && sphereR())) { if (layout !== 'force') arrange(layout, true, false); return }
      if (layout === 'sphere') return // globe to globe: the camera zoom alone
      const R = geo.R
      for (const n of N) { n.zs0 = n.zs || 1; n.za0 = n.za || 1 }
      arrange(layout, false, false)
      if (!lay) return
      for (const n of N) n.dl = 0.35 * (1 - n.za0) / 0.75 // za0 runs 0.25 (back) to 1 (front)
      lay.pop = true; lay.dur = 1000; lay.ghost = R
    },
    leave: tween => { growStop(); arrange(depthOn() ? 'sphere' : 'force', !tween, false) },
  }
  if (graphOk) ready()
})()
