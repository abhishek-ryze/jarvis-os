// S4 FX: WebGL dust background, CSS post layer, reticle cursor, boot sequence, scan band, number decode.
// Everything is inserted from here. Under prefers-reduced-motion: no boot, no trail, no decode, one still frame.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
const doc = document.documentElement, body = document.body
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e }
const mouse = { x: innerWidth / 2, y: innerHeight / 2, nx: 0, ny: 0 }

// ---------- post layer + scan band ----------
body.append(el('div', 'fx-post'), el('div', 'fx-scan'))

// ---------- 2D overlay: cursor trail and pulses (idle when nothing moves) ----------
const ov = el('canvas', 'fx-ov'), g2 = ov.getContext('2d')
body.append(ov)
let ovDpr = 1
function sizeOv() { ovDpr = Math.min(devicePixelRatio || 1, 1.5); ov.width = innerWidth * ovDpr; ov.height = innerHeight * ovDpr }
sizeOv()
const trail = [], bursts = []
let ovRaf = 0
function ovKick() { if (!ovRaf && !reduce) ovRaf = requestAnimationFrame(ovDraw) }
function ovDraw(now) {
  ovRaf = 0
  g2.setTransform(ovDpr, 0, 0, ovDpr, 0, 0); g2.clearRect(0, 0, innerWidth, innerHeight)
  while (trail.length && now - trail[0].t > 260) trail.shift()
  g2.lineCap = 'round'
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1], b = trail[i], k = 1 - (now - b.t) / 260
    g2.strokeStyle = `rgba(56,214,245,${(k * .55).toFixed(3)})`; g2.lineWidth = .6 + k * 1.6
    g2.beginPath(); g2.moveTo(a.x, a.y); g2.lineTo(b.x, b.y); g2.stroke()
  }
  for (let i = bursts.length - 1; i >= 0; i--) {
    const p = bursts[i], k = (now - p.t) / p.life
    if (k >= 1) { bursts.splice(i, 1); continue }
    const e = 1 - (1 - k) ** 3, a = 1 - k
    g2.strokeStyle = `rgba(${p.c},${(a * .9).toFixed(3)})`; g2.lineWidth = 1.5
    g2.beginPath(); g2.arc(p.x, p.y, 4 + e * p.r, 0, 6.283); g2.stroke()
    g2.strokeStyle = `rgba(${p.c},${(a * .4).toFixed(3)})`; g2.lineWidth = 1
    g2.beginPath(); g2.arc(p.x, p.y, 2 + e * p.r * .55, .3 + k * 2, 2.4 + k * 2); g2.stroke()
    g2.fillStyle = `rgba(${p.c},${a.toFixed(3)})`
    for (const s of p.sparks) { const d = e * s.d; g2.fillRect(p.x + Math.cos(s.a) * d - 1, p.y + Math.sin(s.a) * d - 1, 2, 2) }
  }
  if (trail.length || bursts.length) ovKick()
}
function burst(x, y, r, c, n) {
  if (reduce) return
  bursts.push({ x, y, r, c, t: performance.now(), life: 520 + r * 3, sparks: Array.from({ length: n }, () => ({ a: Math.random() * 6.283, d: r * (.6 + Math.random() * .8) })) })
  ovKick()
}

// ---------- reticle cursor with lock-on ----------
const cur = el('div', 'fx-cur', '<svg viewBox="-20 -20 40 40" aria-hidden="true"><g class="fx-cur-spin"><path d="M-11 -4A12 12 0 0 1 -4 -11M4 -11A12 12 0 0 1 11 -4M11 4A12 12 0 0 1 4 11M-4 11A12 12 0 0 1 -11 4"/></g><path class="fx-cur-x" d="M-17 0h-4M17 0h4M0 -17v-4M0 17v4"/><circle r="1.6"/></svg>')
const lock = el('div', 'fx-lock', '<i></i><i></i><i></i><i></i>')
body.append(lock, cur)
const LOCK = 'a[href], button:not(:disabled), [role=button], [role=tab], [role=option], [role=menuitem], summary, select, input[type=range], input[type=checkbox], .sector, li.lv, li.need, #skRows li.row, .bub, .pal-list li, .chip, .dmore, .rc-pick, .hub-app, [data-go]'
const TEXT = 'input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, [contenteditable=""], [contenteditable=true]'
let target = null, curRaf = 0, lastLock = ''
function curFrame() {
  curRaf = 0
  cur.style.transform = `translate3d(${mouse.x}px,${mouse.y}px,0)`
  if (target && !target.isConnected) setTarget(null)
  if (target) {
    const r = target.getBoundingClientRect(), p = 4
    const key = `${r.left | 0},${r.top | 0},${r.width | 0},${r.height | 0}`
    if (key !== lastLock) {
      lastLock = key
      lock.style.transform = `translate3d(${r.left - p}px,${r.top - p}px,0)`
      lock.style.width = r.width + p * 2 + 'px'; lock.style.height = r.height + p * 2 + 'px'
    }
  }
}
function curKick() { if (!curRaf) curRaf = requestAnimationFrame(curFrame) }
function setTarget(t) {
  if (t === target) return
  target = t; lastLock = ''
  cur.classList.toggle('on', !!t); lock.classList.toggle('on', !!t)
  if (t) { lock.classList.remove('snap'); void lock.offsetWidth; lock.classList.add('snap') }
  curKick()
}
{ // pointerType mouse gates it, so touch and keyboard users never see it
  addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return
    if (!doc.classList.contains('fx-rc') && doc.dataset.cursor !== 'system') doc.classList.add('fx-rc')
    mouse.x = e.clientX; mouse.y = e.clientY
    mouse.nx = e.clientX / innerWidth * 2 - 1; mouse.ny = e.clientY / innerHeight * 2 - 1
    if (!reduce && !doc.classList.contains('fx-text')) { trail.push({ x: e.clientX, y: e.clientY, t: performance.now() }); if (trail.length > 24) trail.shift(); ovKick() }
    curKick()
  }, { passive: true })
  addEventListener('pointerover', e => {
    const t = e.target instanceof Element ? e.target : null
    doc.classList.toggle('fx-text', !!t?.closest(TEXT))
    setTarget(t?.closest(TEXT) ? null : t?.closest(LOCK) || null)
  }, { passive: true })
  // relatedTarget is also null on some layout changes, so check the pointer really left the window
  addEventListener('mouseout', e => { if (!e.relatedTarget && (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= innerWidth - 1 || e.clientY >= innerHeight - 1)) { doc.classList.remove('fx-rc'); setTarget(null) } })
  addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && !e.target.closest?.(TEXT)) burst(e.clientX, e.clientY, target ? 26 : 16, target ? '255,106,61' : '56,214,245', 6) }, { passive: true })
  addEventListener('scroll', curKick, { passive: true, capture: true })
}

// ---------- number decode on change ----------
if (!reduce) {
  const NUM = '.t-num, .num, .hero, .kcard b', GLY = '0123456789'
  const mine = new WeakMap(), runs = new WeakMap() // mine: last text we wrote (observer skips it); runs: newest run per node
  const decode = (node, to) => {
    const t0 = performance.now(), dur = 420
    runs.set(node, t0)
    const step = () => {
      if (runs.get(node) !== t0 || !node.isConnected) return // app wrote again or replaced the node
      const k = (performance.now() - t0) / dur
      const s = k >= 1 ? to : to.replace(/\d/g, (d, i) => i / to.length < k ? d : GLY[Math.random() * 10 | 0])
      mine.set(node, s); node.data = s
      if (k < 1) setTimeout(step, 40)
    }
    step()
  }
  new MutationObserver(list => {
    for (const m of list) {
      const host = m.type === 'characterData' ? m.target.parentElement : m.target
      if (!host || !host.matches?.(NUM)) continue
      const n = host.firstChild
      if (host.childNodes.length !== 1 || n.nodeType !== 3 || mine.get(n) === n.data) continue
      if (!/\d/.test(n.data) || n.data.length > 16 || host.closest('[aria-live]')) continue
      if (host.matches('.kcard b') && !/^[\d\s.,:%$+-]+[a-zA-Z%]{0,2}$/.test(n.data)) continue
      decode(n, n.data)
    }
  }).observe(body, { subtree: true, childList: true, characterData: true })
}

// ---------- boot sequence (every load, under 2 s, skip on click or key) ----------
function boot() {
  if (reduce) { doc.classList.add('fx-ready'); return }
  const lines = [document.title.toUpperCase() + '  //  COLD START', 'LINK   LOCAL NODE .......... OK', 'INDEX  BRAIN GRAPH ......... OK', 'SYNC   SESSION LOGS ........ OK', 'HUD    ONLINE']
  const b = el('div', 'fx-boot', `<svg class="fx-boot-g" viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true">
    <path d="M500 300H40M500 300H960" pathLength="1"/><path d="M500 300V30M500 300V570" pathLength="1"/>
    <path d="M40 70V30h60M960 70V30h-60M40 530v40h60M960 530v40h-60" pathLength="1"/></svg>
    <svg class="fx-boot-r" viewBox="-100 -100 200 200" aria-hidden="true"><circle r="90" pathLength="1"/><circle class="b" r="74" pathLength="1"/><circle class="c" r="58" pathLength="1"/></svg>
    <div class="fx-boot-t" aria-hidden="true"><b></b>${lines.slice(1).map(() => '<span></span>').join('')}</div>`)
  body.append(b)
  doc.classList.add('fx-booting', 'fx-ready')
  const outs = [...b.querySelectorAll('.fx-boot-t > *')], CH = 'ABCDEF0123456789#/<>_'
  const t0 = performance.now()
  let done = false, raf = 0
  const tick = () => {
    const t = performance.now() - t0
    outs.forEach((o, i) => {
      const s = lines[i], k = Math.min(1, Math.max(0, (t - 120 - i * 130) / 420))
      const n = Math.ceil(s.length * k)
      o.textContent = k <= 0 ? '' : s.slice(0, n).replace(/[^ ./]/g, (c, j) => j < n * k - 2 || k === 1 ? c : CH[Math.random() * CH.length | 0])
    })
    if (t > 1250) return finish()
    raf = requestAnimationFrame(tick)
  }
  const finish = fast => {
    if (done) return; done = true
    cancelAnimationFrame(raf)
    removeEventListener('keydown', skip, true); removeEventListener('pointerdown', skip, true)
    outs.forEach((o, i) => o.textContent = lines[i])
    b.classList.add(fast ? 'out fast' : 'out')
    doc.classList.remove('fx-booting'); doc.classList.add('fx-in')
    sweep()
    setTimeout(() => { b.remove(); doc.classList.remove('fx-in') }, fast ? 900 : 1200)
  }
  const skip = () => finish(true)
  addEventListener('keydown', skip, true); addEventListener('pointerdown', skip, true)
  raf = requestAnimationFrame(tick)
}
function sweep() { const s = document.querySelector('.fx-scan'); s.classList.remove('go'); void s.offsetWidth; s.classList.add('go') }
boot()

// ---------- WebGL background ----------
let gl = null
const probe = document.createElement('canvas')
if (doc.dataset.fx !== 'off' && probe.getContext('webgl2')) startGL().catch(() => { gl?.dispose?.(); document.querySelector('.fx-bg')?.remove() })

async function startGL() {
  const THREE = await import('three')
  const { EffectComposer } = await import('three/addons/postprocessing/EffectComposer.js')
  const { RenderPass } = await import('three/addons/postprocessing/RenderPass.js')
  const { UnrealBloomPass } = await import('three/addons/postprocessing/UnrealBloomPass.js')
  const { OutputPass } = await import('three/addons/postprocessing/OutputPass.js')
  const canvas = el('canvas', 'fx-bg')
  canvas.setAttribute('aria-hidden', 'true')
  const renderer = gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power', alpha: false })
  // the clear lands in the linear target as-is, then OutputPass encodes it, so pre-linearise once more to end at #05080b
  renderer.setClearColor(new THREE.Color('#05080b').convertSRGBToLinear(), 1)
  body.prepend(canvas)
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(55, 1, .1, 400)
  cam.position.set(0, 0, 32)

  // dust: drift, wobble, twinkle and the pulse shock all run in the vertex shader (no per-frame buffer writes)
  const N = 1500, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), seed = new Float32Array(N * 2)
  const tints = [[.22, .84, .96, 70], [.75, .95, 1, 14], [.12, .44, .5, 10], [.45, .38, 1, 4], [1, .42, .24, 2]]
  const pick = () => { let r = Math.random() * 100; for (const t of tints) if ((r -= t[3]) < 0) return t; return tints[0] }
  for (let i = 0; i < N; i++) {
    pos.set([(Math.random() - .5) * 140, (Math.random() - .5) * 80, -70 + Math.random() * 82], i * 3)
    const t = pick(); col.set([t[0], t[1], t[2]], i * 3)
    seed.set([Math.random(), .4 + Math.random() * 1.4], i * 2)
  }
  const dg = new THREE.BufferGeometry()
  dg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  dg.setAttribute('color', new THREE.BufferAttribute(col, 3))
  dg.setAttribute('seed', new THREE.BufferAttribute(seed, 2))
  const U = { uT: { value: 0 }, uPx: { value: 1 }, uPulse: { value: new THREE.Vector4(0, 0, -99, 0) } }
  const dust = new THREE.Points(dg, new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute vec3 color; attribute vec2 seed; uniform float uT, uPx; uniform vec4 uPulse; varying vec3 vC; varying float vA;
      void main() {
        vec3 p = position;
        p.y = mod(p.y + 40.0 + uT * .55 * seed.y, 80.0) - 40.0;
        p.x += sin(uT * .21 * seed.y + seed.x * 40.0) * 1.6;
        p.z += cos(uT * .17 + seed.x * 30.0) * 1.2;
        float age = uT - uPulse.z, d = distance(p.xy, uPulse.xy) - age * 26.0;
        float w = exp(-d * d * .08) * max(0.0, 1.0 - age * .9);
        p.xy += normalize(p.xy - uPulse.xy + 1e-4) * w * 2.2;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float tw = .55 + .45 * sin(uT * (.7 + seed.y) + seed.x * 60.0);
        vA = tw * smoothstep(-80.0, -40.0, mv.z) * (1.0 + w * 3.0);
        vC = color;
        gl_PointSize = uPx * min((.6 + seed.y * .8) * (60.0 / -mv.z), 3.0);
      }`,
    fragmentShader: `varying vec3 vC; varying float vA;
      void main() { float r = length(gl_PointCoord - .5); float a = smoothstep(.5, .0, r); a = a * a * .9 + smoothstep(.12, .0, r) * .6;
        gl_FragColor = vec4(vC * a * vA, 1.0); }`
  }))
  scene.add(dust)

  // grid floor: lines fade with distance, scroll slowly toward the viewer
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 260), new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec3 vW; void main() { vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }',
    fragmentShader: `uniform float uT; varying vec3 vW;
      void main() { vec2 q = vec2(vW.x, vW.z + uT * 1.4) / 6.0; vec2 fw = fwidth(q), g = abs(fract(q - .5) - .5) / fw;
        float l = 1.0 - min(min(g.x, g.y), 1.0); float f = smoothstep(-150.0, -30.0, vW.z) * smoothstep(10.0, -40.0, vW.z) * smoothstep(150.0, 40.0, abs(vW.x)) * (1.0 - smoothstep(.15, .5, max(fw.x, fw.y)));
        gl_FragColor = vec4(vec3(.13, .5, .6) * l * f * .11, 1.0); }`
  }))
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, -25, -60)
  scene.add(floor)

  // segmented rings behind the centre: arcs with gaps, counter-rotating, the tick ring slowest
  const ringGroup = new THREE.Group(), rings = []
  const arcRing = (R, segs, fill, color, opacity, ticks) => {
    const v = []
    for (let s = 0; s < segs; s++) {
      const a0 = s / segs * 6.283, a1 = a0 + fill / segs * 6.283
      for (let k = 0; k < 24; k++) { const u = a0 + (a1 - a0) * k / 24, w = a0 + (a1 - a0) * (k + 1) / 24; v.push(Math.cos(u) * R, Math.sin(u) * R, 0, Math.cos(w) * R, Math.sin(w) * R, 0) }
    }
    for (let i = 0; i < (ticks || 0); i++) { const u = i / ticks * 6.283, L = i % 6 ? 1 : 2.4; v.push(Math.cos(u) * R, Math.sin(u) * R, 0, Math.cos(u) * (R - L), Math.sin(u) * (R - L), 0) }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3))
    const m = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }))
    ringGroup.add(m); rings.push(m); return m
  }
  arcRing(30, 5, .72, '#38d6f5', .22)
  arcRing(26, 72, 0, '#1f6f80', .5, 72)
  arcRing(22, 3, .55, '#38d6f5', .3)
  arcRing(35, 9, .4, '#5b6cff', .14)
  ringGroup.position.set(0, 2, -34); ringGroup.rotation.x = -.35
  scene.add(ringGroup)

  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, cam))
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .7, .4, .18)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 1.5)
    renderer.setPixelRatio(dpr); composer.setPixelRatio(dpr)
    renderer.setSize(innerWidth, innerHeight, false); composer.setSize(innerWidth, innerHeight)
    cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix()
    U.uPx.value = dpr * Math.min(1.4, innerHeight / 900)
    if (reduce) render(0)
  }
  const look = new THREE.Vector3(0, 0, -30)
  function render(t) {
    U.uT.value = t
    cam.position.x += (mouse.nx * 2.4 - cam.position.x) * .04
    cam.position.y += (-mouse.ny * 1.4 - cam.position.y) * .04
    cam.lookAt(look)
    rings[0].rotation.z = t * .05; rings[1].rotation.z = t * .03; rings[2].rotation.z = -t * .11; rings[3].rotation.z = -t * .02
    // 3D HUD view: the rings take the dial's 32deg tilt (depth.css), so both share one perspective
    const tilt = document.documentElement.dataset.view === 'depth' && innerWidth >= 961 ? -.56 : -.35
    ringGroup.rotation.x += reduce ? tilt - ringGroup.rotation.x : (tilt - ringGroup.rotation.x) * .06
    composer.render()
  }
  addEventListener('resize', () => { sizeOv(); resize() })
  resize()

  // pulse shock: screen point projected onto the dust mid plane
  const ray = new THREE.Vector3()
  shock = (x, y) => {
    ray.set(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1, .5).unproject(cam).sub(cam.position).normalize()
    const k = (-20 - cam.position.z) / ray.z
    U.uPulse.value.set(cam.position.x + ray.x * k, cam.position.y + ray.y * k, U.uT.value, 1)
    if (!raf && !paused()) raf = requestAnimationFrame(loop)
  }

  // 30 fps cap; stops when hidden, on Brain (its canvas covers us) and on context loss
  let raf = 0, last = 0, t = 0, dead = false
  const paused = () => dead || document.hidden || body.classList.contains('brain')
  function loop(now) {
    raf = 0
    if (paused()) return
    raf = requestAnimationFrame(loop)
    if (now - last < 32) return
    t += Math.min(now - last, 100) / 1000; last = now
    render(t)
  }
  const wake = () => { if (!raf && !reduce && !paused()) { last = performance.now(); raf = requestAnimationFrame(loop) } }
  document.addEventListener('visibilitychange', wake)
  new MutationObserver(wake).observe(body, { attributes: true, attributeFilter: ['class'] })
  canvas.addEventListener('webglcontextlost', () => { dead = true; cancelAnimationFrame(raf); canvas.remove() })
  if (reduce) render(0); else wake()
  requestAnimationFrame(() => canvas.classList.add('on'))
}
let shock = null

window.FX = {
  pulse(x, y) { burst(x, y, 70, '56,214,245', 14); if (!reduce) shock?.(x, y) }
}
