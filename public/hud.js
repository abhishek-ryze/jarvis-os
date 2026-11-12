/* Home cockpit (S4, option A): hour ring, 5 h / 7 d gauges, compact widget values.
   Runs after the inline script in index.html and uses its globals (pt, arc, NS, data, fmt, usd, utcDay, sum, esc, reduce, dial, drawLeaders). */
(() => {
  const VIOLET = '#a98bff', TEAL = '#3ee8c0', TRACK = '#0e222a'
  const hm = t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const day = t => new Date(t).toLocaleDateString('en-GB', { weekday: 'short' }) + ' ' + hm(t)
  const still = () => document.documentElement.classList.toggle('still', !!reduce)
  const stroke = (d, c, w, extra = '') => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}"${extra}/>`

  // 120 fine ticks on the dial rim, every 10th longer
  $('hTicks').innerHTML = Array.from({ length: 120 }, (_, i) => {
    const [x1, y1] = pt(i % 10 ? 293 : 290, i * 3), [x2, y2] = pt(298, i * 3)
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke-width="${i % 10 ? .75 : 1.5}"/>`
  }).join('')

  // ring labels stay 12px on screen whatever the dial size (viewBox is 600 wide)
  const k = () => 600 / Math.max(1, dial.clientWidth)
  new ResizeObserver(() => {
    if (dial.classList.contains('mini')) return
    dial.style.setProperty('--segfs', (12 * k()).toFixed(2) + 'px')
    dial.style.setProperty('--hudfs', (11 * k()).toFixed(2) + 'px') // #hudRing: 720 units over 1.2 x the dial, same scale
  }).observe(dial)

  // tokens per UTC hour of today, around the dial: 00 at top, clockwise
  function hours(byHour) {
    const max = Math.max(...byHour, 1), now = new Date().getUTCHours()
    const out = byHour.map((v, h) => {
      const c = h === now ? 'var(--cyan)' : v ? VIOLET : TRACK, o = h === now || !v ? 1 : .25 + .75 * v / max
      return `<path class="hr" data-h="${h}" data-v="${v}" d="${arc(312, h * 15 + 1, h * 15 + 14)}" fill="none" stroke="${c}" stroke-width="10" opacity="${o.toFixed(2)}"><title>${String(h).padStart(2, '0')}:00 UTC: ${fmt(v)} tokens</title></path>`
    }).join('')
    const lab = (a, t) => { const [x, y] = pt(330, a); return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle">${t}</text>` }
    $('hHours').innerHTML = out + lab(0, '00 UTC') + lab(180, '12')
  }

  // one window gauge. side -1: left arc 200..340 deg; side 1: right arc 160..20 deg. Fills from the bottom.
  function gaugeArc(w, side, color) {
    const R = 340, A = v => side < 0 ? 200 + 140 * v : 160 - 140 * v
    const seg = (v0, v1) => side < 0 ? arc(R, A(v0), A(v1)) : arc(R, A(v1), A(v0))
    const pct = Math.min(1, w.pct || 0)
    const left = Math.max(0, (w.resetAt || 0) - Date.now()) / 6e4
    const proj = w.limit && w.hitAt ? Math.min(1, pct + (w.burn || 0) * left / w.limit) : pct
    const hot = w.warn
    let s = `<g class="gw" data-g="${side < 0 ? 'g5' : 'g7'}">` + stroke(seg(0, 1), TRACK, 12)
    for (let i = 0; i <= 10; i++) { const [x1, y1] = pt(R + 8, A(i / 10)), [x2, y2] = pt(R + (i % 5 ? 11 : 14), A(i / 10)); s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--cyan-dim)" stroke-width="1"/>` }
    if (proj > pct) s += stroke(seg(pct, proj), hot ? 'var(--orange)' : color, 6, ' stroke-dasharray="3 4" opacity=".8"')
    if (pct > 0) s += `<g class="glow">${stroke(seg(0, pct), color, 12)}</g>`
    const [lx, ly] = pt(R, side < 0 ? 346 : 14)
    s += `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle">${side < 0 ? '5 H' : '7 D'}</text>`
    s += stroke(seg(0, 1), 'transparent', 26, ' class="hit"') + '</g>'
    return { s, pct, hot }
  }

  // hover: an hour shows in the centre readout; a gauge arc and its readout below light each other
  let win0 = null
  const back = () => document.activeElement?.parentNode === ring ? preview(focusIdx) : homeReadout()
  const lit = (id, on) => { $(id).classList.toggle('lit', on); $('hGauges').querySelector(`[data-g="${id}"]`)?.classList.toggle('lit', on) }
  $('hHours').addEventListener('pointerover', e => {
    const p = e.target.closest('.hr'); if (!p) return
    const h = +p.dataset.h
    setReadout(String(h).padStart(2, '0') + ':00 UTC', fmt(+p.dataset.v), h === new Date().getUTCHours() ? 'tokens this hour so far' : 'tokens in this hour')
  })
  $('hHours').addEventListener('pointerout', e => { if (!e.relatedTarget?.closest?.('.hr')) back() })
  $('hGauges').addEventListener('pointerover', e => {
    const g = e.target.closest('.gw'); if (!g) return
    const id = g.dataset.g, w = win0?.[id === 'g5' ? 'fiveHour' : 'sevenDay']
    lit(id, true)
    if (!w) return
    const t = id === 'g5' ? hm : day
    setReadout(id === 'g5' ? '5 h window' : '7 d window', w.limit ? Math.round(Math.min(1, w.pct || 0) * 100) + '%' : fmt(w.total),
      fmt(w.total) + (w.limit ? ' of ' + fmt(w.limit) + (limitsSet ? '' : ' est.') : '') + (w.resetAt ? ', resets ' + t(w.resetAt) : ''))
  })
  $('hGauges').addEventListener('pointerout', e => { const g = e.target.closest('.gw'); if (g && !g.contains(e.relatedTarget)) { lit(g.dataset.g, false); back() } })
  for (const id of ['g5', 'g7']) { $(id).addEventListener('pointerenter', () => lit(id, true)); $(id).addEventListener('pointerleave', () => lit(id, false)) }

  function readout(el, name, w, g) {
    const t = name.startsWith('7') ? day : hm
    el.innerHTML = `<span class="gh"><b>${name}</b><span class="gv">${w.limit ? Math.round(g.pct * 100) + '%' : fmt(w.total)}</span></span>` +
      `<span>${fmt(w.total)}${w.limit ? ` of ${fmt(w.limit)}${limitsSet ? '' : ' est.'}` : ''}</span>` +
      (w.resetAt ? `<span>resets ${t(w.resetAt)}</span>` : '') +
      (g.hot && w.hitAt ? `<span class="alert">at this pace: limit ${t(w.hitAt)}, est.</span>` : '') +
      '<button type="button" class="chip limedit" data-lim="edit">Edit limits</button>'
  }

  // Limits editor: tokens in millions, saved to config.json by POST /api/config/limits
  let limitsSet = false
  const loadLimits = () => getJ('/api/config/limits').then(l => { limitsSet = !!l.limitsSet; if (win0) windows(win0) }).catch(() => {})
  loadLimits()
  function limForm(w) {
    const f = (id, lab, v) => `<span><label class="lbl" for="${id}">${lab}, M tokens</label><input class="field" id="${id}" type="number" min="1" max="1000000" step="1" value="${Math.round((v || 0) / 1e6)}"></span>`
    $('g5').innerHTML = '<span class="limgrid">' + f('lim5', '5 h', w.fiveHour.limit) + f('lim7', '7 d', w.sevenDay.limit) + '</span>' +
      '<span class="limrow"><button type="button" class="btn" data-lim="save">Save</button><button type="button" class="btn" data-lim="cancel">Cancel</button></span><span class="alert" id="limErr" role="alert"></span>'
    $('lim5').focus()
  }
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-lim]')
    if (!b || !win0) return
    if (b.dataset.lim === 'edit') return limForm(win0)
    if (b.dataset.lim === 'cancel') return $('g5').replaceChildren(), windows(win0)
    const r = await fetch('/api/config/limits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fiveHour: Math.round($('lim5').value * 1e6), sevenDay: Math.round($('lim7').value * 1e6) }) }).then(r => r.json()).catch(() => ({ error: 'server not reachable' }))
    if (r.error) return void ($('limErr').textContent = r.error)
    limitsSet = true
    try { win0 = await getJ('/api/windows') } catch {}
    $('g5').replaceChildren()
    windows(win0)
  })

  function windows(win) {
    if (!win) return
    win0 = win
    if (win.byHour) hours(win.byHour)
    const a = gaugeArc(win.fiveHour, -1, 'var(--cyan)'), b = gaugeArc(win.sevenDay, 1, TEAL)
    $('hGauges').innerHTML = a.s + b.s
    if (!$('lim5')) readout($('g5'), '5 h window', win.fiveHour, a) // an open editor stays put
    readout($('g7'), '7 d window', win.sevenDay, b)
  }

  function bars(el, vals, color) {
    const max = Math.max(...vals, 1), bw = 200 / vals.length
    el.innerHTML = `<line x1="0" y1="38.5" x2="200" y2="38.5" stroke="#12303a"/>` + vals.map((v, i) =>
      `<rect x="${(i * bw + 1).toFixed(1)}" y="${(38 - v / max * 34).toFixed(1)}" width="${(bw - 3).toFixed(1)}" height="${(v / max * 34).toFixed(1)}" fill="${color}"/>`).join('')
  }

  function widgets(p) {
    const u = data.usage, sk = data.skills
    if (!u) return
    const w = p && p.windows, c = u.cost.byDay, sumD = n => Array.from({ length: n }, (_, i) => c[utcDay(i)] || 0).reduce((a, b) => a + b, 0)
    if (w) $('hSpend').innerHTML = usd(w.fiveHour.usd) + '<small>last 5 h</small>'
    spark($('hSpendSpark'), Array.from({ length: 14 }, (_, i) => c[utcDay(13 - i)] || 0), TEAL)
    $('hSpendSub').textContent = `7 d ${usd(sumD(7))} · 30 d ${usd(sumD(30))}, API prices`
    if (sk) {
      const ids = new Set(sk.skills.map(s => s.id)), used = Object.entries(u.bySkill).filter(([n]) => ids.has(n)).sort((a, b) => b[1].runs - a[1].runs)
      $('hSkills').innerHTML = sk.skills.length + '<small>installed</small>'
      bars($('hSkillsSpark'), used.slice(0, 12).map(([, v]) => v.runs), VIOLET)
      $('hSkillsSub').textContent = used.length ? `${used.length} used · top /${used[0][0].split(':').pop()}` : 'none used yet'
    }
    const live = window.shellLive ? window.shellLive.n : (p && p.sessions || []).filter(s => s.idleMin < 10).length
    $('hLive').innerHTML = live ? `<i class="dot"></i>${live} live` : 'last 7 days'
    if (data.memory) $('memCount').innerHTML = data.memory.count + '<small>files</small>'
    $('needs').classList.toggle('hot', !!$('needList').querySelector('li.need'))
  }

  function render(p) {
    still()
    windows(p && p.windows)
    widgets(p)
    drawLeaders()
  }

  // live.js keeps its pulse poll private, so the gauges poll on their own (server caches windows 60 s)
  setInterval(async () => {
    if (document.hidden || !data.usage) return
    try { render(await getJ('/api/live/pulse')) } catch {}
  }, 60e3)
  document.addEventListener('click', () => setTimeout(still), true)
  still()

  window.hud = { render }
})()
