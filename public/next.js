// Next level layer: briefing line (click speaks it), standby screen (S), interface sounds, scan on page change.
// Uses the globals of the inline script (data, fmt, sum, utcDay, go) and shell.js (shellLive).
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  const doc = document.documentElement
  const $ = id => document.getElementById(id)

  // ---------- live numbers ----------
  function stats() {
    const u = data.usage
    const tokens = u && u.byDay ? fmt(sum(u.byDay[utcDay(0)])) : null
    const live = (window.shellLive || {}).n || 0
    const open = +(/(\d+) open/.exec($('plTodayN')?.textContent || '') || [])[1] || 0
    return { tokens, live, open }
  }
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

  // ---------- briefing line ----------
  const brief = document.createElement('button')
  brief.type = 'button'; brief.id = 'brief'; brief.className = 'brief'
  brief.title = 'Click to hear the briefing'
  document.querySelector('#hdr .stamp').before(brief)
  function briefText() {
    const s = stats(), h = new Date().getHours()
    if (!s.tokens) return ''
    const hi = h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
    return `${hi}. ${s.tokens} tokens today. ${plural(s.live, 'session')} live. ${plural(s.open, 'task')} open.`
  }
  let typing = 0
  function typeBrief() {
    const t = briefText()
    if (!t) return false
    brief.setAttribute('aria-label', t + ' Click to hear it.')
    clearInterval(typing)
    if (reduce) { brief.textContent = t; return true }
    let i = 0
    brief.classList.add('typing')
    typing = setInterval(() => {
      brief.textContent = t.slice(0, ++i)
      if (i >= t.length) { clearInterval(typing); brief.classList.remove('typing') }
    }, 22)
    return true
  }
  // wait for the boot sequence and the first data read, then type once; after that refresh in place
  const wait = setInterval(() => {
    if (doc.classList.contains('fx-booting') || !doc.classList.contains('fx-ready')) return
    if (typeBrief()) { clearInterval(wait); drawIn(); setInterval(() => { if (!brief.classList.contains('typing')) brief.textContent = briefText() || brief.textContent }, 60000) }
  }, 400)
  function speak() {
    const sp = window.speechSynthesis
    if (!sp) return
    if (sp.speaking) return sp.cancel()
    const t = briefText()
    if (!t) return
    brief.textContent = t
    // "2.8M" reads badly: say "2.8 million"
    const u = new SpeechSynthesisUtterance(t.replace(/([\d.]+)([KMB])\b/, (m, n, x) => `${n} ${{ K: 'thousand', M: 'million', B: 'billion' }[x]}`))
    u.rate = 1.05; u.pitch = .9
    u.onstart = () => brief.classList.add('say'); u.onend = u.onerror = () => brief.classList.remove('say')
    sp.speak(u)
  }
  brief.addEventListener('click', speak)
  window.briefSpeak = speak

  // ---------- standby screen ----------
  let sb = null, sbTimer = 0
  function standby() {
    if (sb || document.querySelector('dialog[open]')) return
    sb = document.createElement('dialog'); sb.className = 'standby'; sb.setAttribute('aria-label', 'Standby screen. Press any key to return.')
    sb.innerHTML = `<div class="sb-box" tabindex="-1">
      <div class="sb-dial">
        <svg viewBox="0 0 320 320" aria-hidden="true">
          <circle class="sb-r1" cx="160" cy="160" r="156" /><circle class="sb-r2" cx="160" cy="160" r="142" /><circle class="sb-r3" cx="160" cy="160" r="128" />
        </svg>
        <div class="sb-mid"><div class="sb-k">Standby</div><div class="sb-time" id="sbTime"></div><div class="sb-date" id="sbDate"></div></div>
      </div>
      <ul class="sb-stats">
        <li><b id="sbTok">--</b><span>Tokens today</span></li><li><b id="sbLive">0</b><span>Sessions live</span></li><li><b id="sbOpen">0</b><span>Tasks open</span></li>
      </ul>
      <p class="sb-hint">Press any key to return</p>
    </div>`
    document.body.append(sb); sb.showModal(); sb.firstElementChild.focus()
    const paint = () => {
      const d = new Date(), s = stats()
      $('sbTime').textContent = d.toLocaleTimeString([], { hour12: false })
      $('sbDate').textContent = d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
      $('sbTok').textContent = s.tokens || '--'; $('sbLive').textContent = s.live; $('sbOpen').textContent = s.open
      $('sbLive').classList.toggle('hot', s.live > 0)
    }
    paint(); sbTimer = setInterval(paint, 1000)
    const close = e => { e.preventDefault(); e.stopPropagation(); sb.close() }
    sb.addEventListener('keydown', close); sb.addEventListener('pointerdown', close)
    sb.addEventListener('close', () => { clearInterval(sbTimer); sb.remove(); sb = null })
    blip(330, 220, .25)
  }
  window.standby = standby

  // ---------- interface sounds (Display settings, off by default) ----------
  let ac = null
  const soundOn = () => doc.dataset.sound === 'on'
  // one short triangle blip that glides from f0 to f1
  function blip(f0, f1, dur, vol = .12) {
    // no context before the first press or key: the browser keeps it muted until then
    if (!soundOn() || !ac) return
    try {
      if (ac.state === 'suspended') ac.resume()
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime
      o.type = 'triangle'
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur)
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur)
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur)
    } catch {}
  }
  const unlock = () => { if (soundOn() && !ac) try { ac = new AudioContext() } catch {} }
  addEventListener('pointerdown', unlock, true); addEventListener('keydown', unlock, true)
  const HOT = 'button, a[href], [role=button], [role=option], [role=menuitem], summary'
  let lastHot = null
  document.addEventListener('pointerover', e => {
    const h = e.target.closest?.(HOT)
    if (h && h !== lastHot) blip(1800, 1500, .04, .05)
    lastHot = h
  })
  document.addEventListener('click', e => { if (e.target.closest?.(HOT)) blip(880, 520, .09, .14) })

  // ---------- page open: charts draw in (next.css, html.nx-in), big numbers count up ----------
  let inTimer = 0
  function drawIn() {
    if (reduce || doc.dataset.motion === 'reduce') return
    doc.classList.add('nx-in'); clearTimeout(inTimer); inTimer = setTimeout(() => doc.classList.remove('nx-in'), 900)
    document.querySelectorAll('.num').forEach(el => {
      const n = el.firstChild, m = n && n.nodeType === 3 && el.offsetParent && /^(\s*\$?)([\d,]*\.?\d+)(.*)$/s.exec(n.data)
      if (!m) return
      const end = n.data, to = parseFloat(m[2].replace(/,/g, '')), dec = (m[2].split('.')[1] || '').length, t0 = performance.now()
      const show = v => m[2].includes(',') ? v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : v.toFixed(dec)
      let last = end
      // timers, not rAF: a hidden tab must still land on the real value
      const step = () => {
        if (n.data !== last) return // the app wrote a new value: leave it
        const p = Math.min(1, (performance.now() - t0) / 600)
        last = n.data = p < 1 ? m[1] + show(to * (1 - Math.pow(1 - p, 3))) + m[3] : end
        if (p < 1) setTimeout(step, 16)
      }
      step()
    })
  }

  // ---------- nav underline slides to the current page ----------
  const nav = $('nav'), ink = document.createElement('i')
  ink.className = 'nav-ink'; ink.setAttribute('aria-hidden', 'true'); nav.append(ink)
  function placeInk() {
    const b = nav.querySelector('[aria-current=page]')
    ink.hidden = !b || !b.offsetWidth
    if (ink.hidden) return
    // starts 8px in: the button's bottom left corner is cut
    ink.style.setProperty('--x', b.offsetLeft + 8 + 'px'); ink.style.setProperty('--y', b.offsetTop + b.offsetHeight - 2 + 'px'); ink.style.setProperty('--w', b.offsetWidth - 8 + 'px')
  }
  placeInk(); void ink.offsetWidth; nav.classList.add('inked')
  addEventListener('resize', placeInk); document.fonts?.ready.then(placeInk)
  const setNav0 = window.setNav
  window.setNav = name => { setNav0(name); placeInk() }

  // ---------- page change: restart the scan band, play the sweep ----------
  const go0 = window.go
  window.go = name => {
    const was = page
    go0(name)
    if (page === was && name !== 'Brain') return
    drawIn()
    blip(300, 900, .2, .1)
    const s = document.querySelector('.fx-scan')
    if (s && !reduce) { s.classList.remove('go'); void s.offsetWidth; s.classList.add('go') }
  }
})()
