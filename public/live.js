// live work package. Shares globals from index.html: $, esc, fmt, getJ, go, none, usd, idle, projName.
// Burn rate on Spend, live session rows, Needs you stack, tab badge, alerts, tool errors, routines mini list.
(function () {
  const POLL = 30e3, SEEN = 'aos.needSeen', RUNS = 'aos.runsSeen'
  const read = k => { try { return JSON.parse(localStorage.getItem(k)) } catch { return null } }
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }
  const hm = t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const when = t => (new Date(t).toDateString() === new Date().toDateString() ? '' : new Date(t).toLocaleDateString('en-GB', { weekday: 'short' }) + ' ') + hm(t)
  let pulse = null, timer = null
  const BASE_TITLE = document.title
  const notified = new Set()

  // ---------- burn rate (Spend panel) ----------
  const LIMITS_LINE = '"limits": { "fiveHour": 20000000, "sevenDay": 300000000 }'
  function renderBurn(w) {
    const row = (name, x) => {
      let line
      if (!x.limit) line = 'no limit set, pace only'
      else if (x.warn) { // orange: say why, in one line
        const pace = x.hitAt && x.resetAt && x.hitAt < x.resetAt
        line = `${name.split(' ')[0]} ${name.includes('day') ? 'd' : 'h'} at ${Math.round(x.pct * 100)}%${pace ? `, limit at ${when(x.hitAt)}` : x.resetAt ? `, resets ${when(x.resetAt)}` : ''}`
      } else {
        line = x.resetAt ? `safe until reset ${when(x.resetAt)}` : 'no use in this window'
        line += `, ${Math.round(x.pct * 100)}% used`
      }
      return `<li class="row${x.warn ? ' warn' : ''}" data-go="#Sessions?days=7" title="Open sessions from the last 7 days"><span>${name}</span><b>${fmt(Math.round(x.burn))} tok/min</b><small>${line} (est.)</small></li>`
    }
    $('burn').innerHTML = row('5 h window', w.fiveHour) + row('7 day window', w.sevenDay)
    $('burnTeach').innerHTML = w.fiveHour.limit == null
      ? `Pace is tokens per minute over the last 30 min. To see the time you hit a limit, add this line to config.json and change the numbers to your plan's token limits. Limits count all tokens, cache reads included: you used ${fmt(w.fiveHour.total)} in the last 5 h and ${fmt(w.sevenDay.total)} in 7 days.<code>${esc(LIMITS_LINE)}</code>`
      : 'Limits are est. (your numbers in config.json). Anthropic publishes no token limits, so correct them from /usage in Claude Code. Orange means past 80% or a limit before reset at this pace.'
  }

  // ---------- live sessions ----------
  function cacheText(s) {
    if (s.cache !== 'warm') return 'cold'
    return `warm, ${s.cacheLeftMin < 1 ? 'under 1' : Math.floor(s.cacheLeftMin)} min left`
  }
  function renderLive(list) {
    $('liveN').textContent = list.filter(x => x.cache === 'warm').length + ' warm'
    $('liveN').dataset.go = '#Sessions?days=7'
    $('live').innerHTML = list.map(x => {
      const pct = Math.min(1, x.ctxPct), hot = pct > 0.8, left = x.cache === 'warm' ? x.cacheLeftMin / x.ttlMin : 0
      const soon = x.cache === 'warm' && x.cacheLeftMin < 5
      const why = [hot && 'past 80% of context, compact soon', soon && `cache cold in ${Math.max(1, Math.ceil(x.cacheLeftMin))} min`].filter(Boolean).join(', ')
      return `<li class="row lv${hot || soon ? ' warn' : ''}" data-id="${esc(x.id)}" tabindex="0" role="button" title="${esc(x.title || x.id)}">
        <span>${esc(x.title || projName(x.project))}</span>
        <b class="${x.cache === 'warm' ? '' : 'st-done'}">${cacheText(x)}<em class="drain" style="--w:${(left * 100).toFixed(1)}%" aria-hidden="true"></em></b>
        <i style="--w:${(pct * 100).toFixed(1)}%" aria-hidden="true"></i>
        <small>context ${fmt(x.context)} of ${fmt(x.ctxWindow)} (${Math.round(pct * 100)}%)${why ? ', ' + why : ''} · idle ${idle(x.idleMin)} · recache est. ${usd(x.recacheCost)}</small>
      </li>`
    }).join('') || none('No sessions in the last 24 h.')
  }
  function openRow(e) {
    const li = e.target.closest('li.lv'); if (!li) return
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    window.openSession?.(li.dataset.id)
  }
  $('live').addEventListener('click', openRow)
  $('live').addEventListener('keydown', openRow)

  // ---------- needs you ----------
  function needs(p) {
    const seen = new Set(read(SEEN) || []), out = []
    let runsSeen = read(RUNS)
    const finished = p.runs.filter(r => r.status !== 'running')
    // First visit: older runs are not news.
    if (!runsSeen) { runsSeen = finished.map(r => r.id); write(RUNS, runsSeen) }
    const rs = new Set(runsSeen)
    for (const r of finished) if (!rs.has(r.id)) out.push({ key: 'run:' + r.id, run: r.id, warn: r.status === 'failed', title: `Run /${r.skill} ${r.status === 'failed' ? 'failed' : 'finished'}`, sub: r.status === 'failed' ? `failed with exit code ${r.exit ?? 'unknown'} at ${r.ended ? hm(r.ended) : '--'}` : `${r.model || ''} · ${r.ended ? hm(r.ended) : ''}${r.exit ? ' · exit ' + r.exit : ''}`, act: () => go('Skills') })
    for (const s of p.sessions) {
      const name = s.title || projName(s.project), lastMin = Math.round(p.now / 6e4) - s.idleMin
      if (s.waiting && s.idleMin >= 2 && s.idleMin < 180) out.push({ key: `wait:${s.id}:${lastMin}`, title: `${name} waits on you`, sub: `idle ${idle(s.idleMin)}, last turn ended with text`, act: () => window.openSession?.(s.id) })
      if (s.cache === 'warm' && s.cacheLeftMin < 5) out.push({ key: `cold:${s.id}:${lastMin}`, warn: true, title: `${name}: cache cold in ${Math.max(1, Math.ceil(s.cacheLeftMin))} min`, sub: `send a turn to keep it warm; recache est. ${usd(s.recacheCost)}`, act: () => window.openSession?.(s.id) })
    }
    const f = p.windows.fiveHour
    if (f.limit && f.hitAt && f.resetAt && f.hitAt < f.resetAt) out.push({ key: 'limit:' + Math.round(f.resetAt / 6e4), warn: true, title: `5 h limit at ${hm(f.hitAt)}, before reset ${hm(f.resetAt)}`, sub: `${fmt(Math.round(f.burn))} tok/min, ${Math.round(f.pct * 100)}% used (est.)`, act: () => $('spend').scrollIntoView({ block: 'center' }) })
    return out.filter(x => !seen.has(x.key))
  }
  let items = []
  function renderNeeds() {
    items = needs(pulse)
    $('needN').textContent = items.length ? items.length + ' open' : ''
    $('needList').innerHTML = items.map((x, i) => `<li class="row need${x.warn ? ' warn' : ''}"><button type="button" data-i="${i}"><span>${esc(x.title)}</span><small>${esc(x.sub)}</small></button><button type="button" class="x" data-x="${i}" aria-label="Dismiss: ${esc(x.title)}">&times;</button></li>`).join('') || '<li class="row"><span class="ph">Nothing needs you.</span></li>'
    document.title = items.length ? `(${items.length}) ${BASE_TITLE.toUpperCase()}` : BASE_TITLE
    if (window.Notification && Notification.permission === 'granted' && localStorage.getItem('aos.alerts') === 'on') {
      for (const x of items) if (!notified.has(x.key)) { notified.add(x.key); new Notification(BASE_TITLE, { body: x.title, tag: x.key }) }
    }
    alertBtn()
  }
  function dismiss(x) {
    if (x.run) { write(RUNS, [...(read(RUNS) || []), x.run].slice(-200)) }
    else write(SEEN, [...(read(SEEN) || []), x.key].slice(-200))
  }
  $('needList').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return
    const x = items[b.dataset.i ?? b.dataset.x]; if (!x) return
    dismiss(x)
    renderNeeds()
    if (b.dataset.i != null) x.act()
    else $('needList').querySelector('button')?.focus()
  })
  function alertBtn() {
    const b = $('alertBtn'), on = localStorage.getItem('aos.alerts') === 'on'
    if (!window.Notification) { b.hidden = true; return }
    b.textContent = on && Notification.permission === 'granted' ? 'Alerts on' : 'Enable alerts'
    b.setAttribute('aria-pressed', String(on && Notification.permission === 'granted'))
  }
  $('alertBtn').addEventListener('click', async () => {
    if (localStorage.getItem('aos.alerts') === 'on' && Notification.permission === 'granted') { localStorage.setItem('aos.alerts', 'off'); return alertBtn() }
    const p = await Notification.requestPermission()
    if (p === 'granted') { localStorage.setItem('aos.alerts', 'on'); items.forEach(x => notified.add(x.key)) } // only new items alert
    $('alertSt').textContent = p === 'granted' ? 'Alerts on. New items show a desktop notification.' : 'The browser blocked notifications. Allow them in site settings.'
    alertBtn()
  })

  // ---------- tool errors ----------
  let errs = null
  async function loadErrors() {
    errs = await getJ('/api/errors?days=7')
    const top = errs.todayByTool.slice(0, 2).map(t => `${t.tool} (${t.n})`).join(', ')
    $('errRow').innerHTML = `<span><b>${errs.today}</b> failed tool calls today${top ? ', top: ' + esc(top) : ''}</span><small>${errs.total} in 7 days · open list</small>`
  }
  $('errRow').addEventListener('click', () => {
    if (!errs) return
    const today = new Date().toISOString().slice(0, 10)
    const list = errs.recent.filter(x => x.at.slice(0, 10) === today)
    const body = `<p class="label">Today (UTC day): ${errs.today}. Last 7 days: ${errs.total}. User denials are not counted. Newest first, at most 100.</p>
      <ul class="scroll errlist">${(list.length ? list : errs.recent).map(x => `<li class="row"><span>${esc(x.tool)}</span><b>${hm(x.ts)}</b><small title="${esc(x.first)}">${esc(x.first)}</small><button type="button" class="sid" data-sid="${esc(x.session)}">session ${esc(x.session.slice(0, 8))}</button></li>`).join('') || none('No failed tool calls in 7 days.')}</ul>`
    const m = parts.modal({ title: 'Failed tool calls', body })
    m.el.addEventListener('click', e => { const s = e.target.closest('[data-sid]'); if (s && window.openSession) { m.close(); window.openSession(s.dataset.sid) } })
  })

  // ---------- routines mini list ----------
  async function loadRoutinesMini() {
    const r = await getJ('/api/routines')
    const next = r.routines.filter(x => x.active).sort((a, b) => (Date.parse(a.nextRun) || Infinity) - (Date.parse(b.nextRun) || Infinity)).slice(0, 3)
    $('rtMini').innerHTML = next.map(x => `<li class="row"><span>${esc(x.name)}</span><b>${x.nextRun ? when(Date.parse(x.nextRun)) : '--'}</b></li>`).join('')
      || `<li class="row"><span class="ph">No routines yet, see <button type="button" class="lnk" id="rtGo">Routines</button></span></li>`
    $('rtGo')?.addEventListener('click', () => go('Routines'))
  }

  // ---------- poll ----------
  async function refresh() {
    try { pulse = await getJ('/api/live/pulse') } catch { return null }
    renderBurn(pulse.windows)
    renderLive(pulse.sessions)
    renderNeeds()
    return pulse
  }
  // Called by loadHome. Returns the first pulse (windows, sessions, runs) or null.
  async function home() {
    const p = await refresh()
    loadErrors().catch(() => { $('errRow').innerHTML = '<span>Tool errors: read failed</span>' })
    loadRoutinesMini().catch(() => { $('rtMini').innerHTML = none('Routines: read failed') })
    if (!timer) timer = setInterval(refresh, POLL)
    return p
  }
  window.live = { home, refresh }
})()
