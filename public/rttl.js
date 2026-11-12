// rttl (Routines + Timeline) work package. Shares globals from index.html: $, esc, fmt, getJ, usd, none, AREAS.
(function () {
  const pad = n => String(n).padStart(2, '0')
  const localDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const base = p => p.split(/[\\/]/).pop()
  const copy = async (b, text, label) => {
    try { await navigator.clipboard.writeText(text); b.textContent = 'Copied' } catch { b.textContent = 'Blocked' }
    setTimeout(() => { b.textContent = label }, 1500)
  }

  // ---------- Timeline ----------
  const TL = { data: null, days: 30, area: '', cell: null }

  async function loadTimeline() {
    if (!TL.data) TL.data = await getJ('/api/timeline?days=90')
    drawBar()
    drawGrid()
  }

  function drawBar() {
    $('tlBar').innerHTML = [14, 30, 90].map(n => `<button type="button" class="chip" data-n="${n}" aria-pressed="${TL.days === n}">${n} days</button>`).join('')
    $('tlSub').textContent = `files Claude edited, last ${TL.days} days`
  }

  function drawGrid() {
    const n = TL.days, t = TL.data
    const days = Array.from({ length: n }, (_, i) => localDay(new Date(Date.now() - (n - 1 - i) * 864e5)))
    const by = Object.fromEntries(t.days.map(d => [d.date, d.rows]))
    // Older = edits before the 90-day fetch window plus any days between the chosen range and that window.
    const older = k => (t.older?.[k] || 0) + new Set(t.days.filter(d => d.date < days[0]).flatMap(d => (d.rows[k] || []).map(f => f.path))).size
    const areas = AREAS.filter(([k]) => !TL.area || k === TL.area)
    const max = Math.max(1, ...days.flatMap(d => areas.map(([k]) => by[d]?.[k]?.length || 0)))
    const step = n <= 14 ? 1 : n <= 30 ? 2 : 5
    let h = '<span></span><span></span>' + days.map((d, i) => `<span class="tlm">${i === 0 || d.endsWith('-01') ? MON[+d.slice(5, 7) - 1] : ''}</span>`).join('')
    h += '<span></span><span class="tlo tlh">Older</span>' + days.map((d, i) => `<span class="d">${i % step === 0 || d.endsWith('-01') ? +d.slice(8) : ''}</span>`).join('')
    areas.forEach(([k, l], r) => {
      h += `<button type="button" class="tll" data-area="${k}" aria-pressed="${TL.area === k}" title="${TL.area === k ? 'Show all rows' : 'Show only ' + l}">${l}</button>`
      const o = older(k)
      h += `<span class="tlo" title="${o} files edited before ${days[0]}">${o || ''}</span>`
      h += days.map((d, c) => {
        const cnt = by[d]?.[k]?.length || 0
        return `<button type="button" class="tlc${cnt ? ' on' : ''}" style="--a:${(0.3 + 0.7 * cnt / max).toFixed(2)}" data-d="${d}" data-k="${k}" data-r="${r}" data-c="${c}" aria-pressed="${!!TL.cell && TL.cell.d === d && TL.cell.k === k}" aria-label="${l}, ${d}: ${cnt} files"${cnt ? '' : ' aria-disabled="true"'}></button>`
      }).join('')
    })
    const g = $('heat')
    g.style.gridTemplateColumns = `104px 52px repeat(${n}, minmax(${n > 30 ? 8 : 18}px, 1fr))`
    g.innerHTML = h
    if (TL.cell && !days.includes(TL.cell.d)) TL.cell = null
    TL.cell ? listFiles() : ($('heatSel').className = 'hnt', $('heatSel').textContent = 'Pick a cell to see its files.', $('heatList').innerHTML = '')
  }

  function listFiles() {
    const { d, k } = TL.cell
    const files = (TL.data.days.find(x => x.date === d)?.rows[k] || []).slice().sort((a, b) => b.count - a.count)
    $('heatSel').className = 'hsel'
    $('heatSel').innerHTML = `<span>${esc(AREAS.find(a => a[0] === k)[1])}, ${d}</span><b>${files.length}</b><span>files</span>`
    $('heatList').innerHTML = files.map((f, i) => `<li class="tlf" data-i="${i}"><div class="tlr"><button type="button" class="tlx" aria-expanded="false" title="Show the edits">${esc(base(f.path))}</button><b>${f.count}</b><span class="tla"><button type="button" class="cbtn sm" data-act="copy">Copy path</button><button type="button" class="btn sm" data-act="open">Open</button></span></div><small title="${esc(f.path)}">${esc(f.path)}${f.project ? ' · ' + esc(projName(f.project)) : ''}</small><div class="tld" hidden></div></li>`).join('')
    $('heatList').files = files
  }

  // Common leading and trailing lines are dropped, so only the changed lines show.
  function diffLines(o, n) {
    const a = o ? o.split('\n') : [], b = n ? n.split('\n') : []
    let s = 0
    while (s < a.length && s < b.length && a[s] === b[s]) s++
    let e = 0
    while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++
    return [...a.slice(s, a.length - e).map(t => ['-', t]), ...b.slice(s, b.length - e).map(t => ['+', t])]
  }

  const CAP = 24
  function diffHtml(d) {
    if (!d.events.length) return '<p class="ph">No edit text found in the logs for this file and day.</p>'
    return d.events.map(ev => {
      const rows = ev.kind === 'write' ? ev.new.split('\n').map(t => ['+', t]) : diffLines(ev.old, ev.new)
      const hh = new Date(ev.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      const line = ([s, t], i) => `<div class="dl ${s === '+' ? 'add' : 'del'}${i >= CAP ? ' more' : ''}"${i >= CAP ? ' hidden' : ''}><span class="g">${s === '+' ? '+' : '-'}</span><code>${esc(t) || ' '}</code></div>`
      return `<div class="dev"><div class="dh">${hh} · ${ev.kind === 'write' ? 'wrote the whole file' : 'edit'}</div>${rows.map(line).join('') || '<p class="ph">No visible change.</p>'}${rows.length > CAP ? `<button type="button" class="chip dmore" data-n="${rows.length - CAP}">Show ${rows.length - CAP} more lines</button>` : ''}</div>`
    }).join('')
  }

  async function toggleDiff(li) {
    const b = li.querySelector('.tlx'), box = li.querySelector('.tld'), open = b.getAttribute('aria-expanded') !== 'true'
    b.setAttribute('aria-expanded', open)
    box.hidden = !open
    if (!open || box.dataset.done) return
    box.innerHTML = '<p class="ph">reading the logs</p>'
    const f = $('heatList').files[li.dataset.i]
    try {
      const r = await fetch(`/api/timeline/diff?path=${encodeURIComponent(f.path)}&day=${TL.cell.d}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      box.innerHTML = diffHtml(d)
      box.dataset.done = 1
    } catch (e) { box.innerHTML = `<p class="ph">No diff: ${esc(e.message)}</p>` }
  }

  async function openFile(btn, p) {
    const r = await fetch('/api/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: p }) }).catch(() => null)
    if (r && r.ok) return
    // The server only opens indexed paths; for the rest Copy path stays.
    btn.replaceWith(Object.assign(document.createElement('span'), { className: 'ph', textContent: 'not indexed, copy the path' }))
  }

  document.addEventListener('click', e => {
    const chip = e.target.closest('#tlBar .chip')
    if (chip) { TL.days = +chip.dataset.n; drawBar(); return drawGrid() }
    const area = e.target.closest('#heat .tll')
    if (area) { TL.area = TL.area === area.dataset.area ? '' : area.dataset.area; if (TL.cell && TL.area && TL.cell.k !== TL.area) TL.cell = null; return drawGrid() }
    const c = e.target.closest('#heat .tlc')
    if (c) {
      if (c.getAttribute('aria-disabled')) return
      TL.cell = { d: c.dataset.d, k: c.dataset.k }
      $('heat').querySelectorAll('.tlc[aria-pressed="true"]').forEach(x => x.setAttribute('aria-pressed', 'false'))
      c.setAttribute('aria-pressed', 'true')
      return listFiles()
    }
    const li = e.target.closest('#heatList .tlf')
    if (!li) return
    const f = $('heatList').files[li.dataset.i], act = e.target.closest('[data-act]')
    if (!act) return e.target.closest('.tlx') && toggleDiff(li)
    if (act.dataset.act === 'copy') copy(act, f.path, 'Copy path')
    else openFile(act, f.path)
  })

  // Arrow keys move between cells; Home and End jump to the row ends.
  document.addEventListener('keydown', e => {
    const c = e.target.closest && e.target.closest('#heat .tlc')
    if (!c || e.altKey || e.ctrlKey || e.metaKey) return
    let r = +c.dataset.r, col = +c.dataset.c
    if (e.key === 'ArrowRight') col++
    else if (e.key === 'ArrowLeft') col--
    else if (e.key === 'ArrowDown') r++
    else if (e.key === 'ArrowUp') r--
    else if (e.key === 'Home') col = 0
    else if (e.key === 'End') col = TL.days - 1
    else return
    const next = $('heat').querySelector(`.tlc[data-r="${r}"][data-c="${col}"]`)
    if (next) { e.preventDefault(); next.focus() }
  })

  // ---------- Routines ----------
  const RT = { data: null, filter: 'all', sort: 'time' }
  const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'], DAYFULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const BANDS = [['Night', 0, 6], ['Morning', 6, 12], ['Afternoon', 12, 18], ['Evening', 18, 24]]
  const SORTS = [['time', 'Time'], ['name', 'Name'], ['days', 'Days'], ['tokens', 'Tokens'], ['usd', '$']]
  const hourOf = t => t ? +t.slice(0, 2) : -1
  const letters = x => `<span class="wd" role="img" aria-label="${x.weekdays.some(Boolean) ? 'Runs ' + DAYFULL.filter((_, i) => x.weekdays[i]).join(', ') : 'No weekly schedule'}">${DAYS.map((l, i) => `<i class="${x.weekdays[i] ? 'on' : ''}" aria-hidden="true">${l}</i>`).join('')}</span>`

  const sorters = {
    time: (a, b) => (a.time || '99').localeCompare(b.time || '99') || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
    days: (a, b) => b.weekdays.filter(Boolean).length - a.weekdays.filter(Boolean).length || a.name.localeCompare(b.name),
    tokens: (a, b) => (b.tokWk || 0) - (a.tokWk || 0),
    usd: (a, b) => (b.usdWk || 0) - (a.usdWk || 0),
  }

  // What a routine is, a copyable example and where files are read from. Shown while none exist.
  function teach() {
    const ex = '/schedule every weekday at 9am: summarize yesterday\'s git commits in this repo and list open TODOs'
    return `<div class="rtteach"><h3>No routines yet</h3>
      <p>A routine is a prompt that Claude runs on a schedule, such as every weekday at 9:00.</p>
      <details><summary>How routines work</summary><div>
      <p>This page lists each one with its days, time and token cost, and plots it on the week calendar.</p>
      <p class="lbl">Example, paste it into Claude Code</p>
      <div class="rtex"><code id="rtEx">${esc(ex)}</code><button type="button" class="cbtn sm" id="rtCopy">Copy</button></div>
      <p>Or open the Claude desktop app, choose Scheduled, and add a task. Both kinds appear here after the next refresh.</p>
      <p class="lbl">Where files are read from</p>
      <p>Desktop scheduled tasks (one SKILL.md per task) and Windows Task Scheduler jobs that run claude. The Sources panel on the right shows each path and whether it exists.</p></div></details></div>`
  }

  function drawRoutines() {
    const r = RT.data, t = r.totals, list = r.routines
    $('rtN').textContent = t.all
    const chips = [['active', 'Active', t.active], ['demand', 'On demand', t.demand], ['paused', 'Paused', t.paused], ['all', 'All', t.all]]
    $('rtKpis').innerHTML = `<div class="rtbar"><div class="rtchips" role="group" aria-label="Filter routines">${chips.map(([k, l, n]) => `<button type="button" class="chip" data-f="${k}" aria-pressed="${RT.filter === k}">${l} <b>${n}</b></button>`).join('')}</div>` +
      `<div class="rtweek"><span class="label">LAST 7 DAYS</span><span class="num">${fmt(t.tokens7d)}<small>tokens</small></span><span class="num">${usd(t.usd7d)}<small>est. $</small></span></div>` +
      `<label class="rtsort"><span class="label">Sort</span><select id="rtSort" aria-label="Sort routines">${SORTS.map(([k, l]) => `<option value="${k}"${RT.sort === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>`
    const shown = list.filter(x => RT.filter === 'all' || x.kind === RT.filter).sort(sorters[RT.sort])
    const li = x => `<li class="row rtrow"><span class="rtname t-body" title="${esc(x.does || x.name)}">${esc(x.name)}</span>${letters(x)}<b class="rttime">${x.time || '--:--'}</b><b>${fmt(x.tokWk || 0)}<small> tok/wk</small></b><b>${x.usdWk == null ? '--' : usd(x.usdWk)}<small> /wk</small></b><b class="${x.kind === 'paused' ? 'st-failed' : x.kind === 'demand' ? 'st-done' : ''}">${x.kind === 'demand' ? 'on demand' : x.kind}</b><small>${esc(x.schedule || 'no schedule')} · next ${x.nextRun ? new Date(x.nextRun).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '--'} · ${x.runs7d || 0} runs in 7 days</small></li>`
    $('rtList').innerHTML = shown.map(li).join('') || (list.length ? none('No routines in this filter.') : teach())
    if (RT.tb) RT.tb.el.remove()
    const tb = RT.tb = window.prompts.teachBox()
    $('rtList').querySelectorAll('li.row').forEach((el, i) => {
      const x = shown[i]
      if (!x) return
      const f = document.createElement('div'), id = 'cap' + i
      f.className = 'rtcap'
      f.innerHTML = `<label class="lbl" for="${id}" style="margin:0">Target $/wk</label><input class="field" id="${id}" inputmode="decimal" placeholder="e.g. 5" style="width:96px"><button class="cbtn" type="button">Cap</button><span class="status" aria-live="polite"></span>`
      const [inp, btn, st] = [f.querySelector('input'), f.querySelector('button'), f.querySelector('.status')]
      btn.onclick = async () => {
        const v = parseFloat(inp.value)
        if (!(v > 0)) { st.textContent = 'Enter a target above 0.'; return inp.focus() }
        try { await navigator.clipboard.writeText(tb.apply(window.prompts.capPrompt(x, v))); st.textContent = 'Copied. Paste into Claude.' } catch { st.textContent = 'The browser blocked the copy.' }
      }
      el.append(f)
    })
    if (shown.length) $('rtList').after(tb.el)
    const ex = $('rtCopy')
    if (ex) ex.onclick = () => copy(ex, $('rtEx').textContent, 'Copy')
    drawCalendar(list)
    $('rtSrc').innerHTML = r.sources.map(s => `<li class="row"><span class="t-body" title="${esc(s.kind)}${s.note ? ' · ' + esc(s.note) : ''}">${esc(s.kind)}</span><b class="${s.found ? '' : 'st-done'}">${s.found ? 'found' : 'none'}</b><small class="t-meta" title="${esc(s.where)}">${esc(s.where)}</small></li>`).join('')
  }

  // MON to SUN columns, rows are time-of-day bands; each chip sits in the band of its start time.
  function drawCalendar(list) {
    const el = $('rtCal')
    const sched = list.filter(x => x.kind === 'active')
    const bands = BANDS.map(([l, a, b]) => ({ l, a, b })).concat(sched.some(x => !x.time) ? [{ l: 'Any time', a: -1, b: 0 }] : [])
    const bandOf = x => bands.find(b => b.a === -1 ? !x.time : x.time && hourOf(x.time) >= b.a && hourOf(x.time) < b.b)
    let h = '<div class="rtcal" role="table" aria-label="Week calendar"><div class="rtcorner"></div>' + ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map(d => `<div class="rtdh" role="columnheader">${d}</div>`).join('')
    for (const b of bands) {
      h += `<div class="rtbl">${b.l}</div>`
      for (let d = 0; d < 7; d++) {
        const here = sched.filter(x => x.weekdays[d] && bandOf(x) === b).sort(sorters.time)
        h += `<div class="rtcell" role="cell">${here.map(x => `<span class="rtchip" title="${esc(x.name)}${x.time ? ', ' + x.time : ''}"><b>${x.time || '--'}</b> ${esc(x.name)}</span>`).join('')}</div>`
      }
    }
    el.innerHTML = h + '</div>' + (sched.length ? '' : `<p class="ph">${list.length ? 'No scheduled routines match. On demand and paused ones are not placed on the week.' : 'Nothing to place yet. Routines appear here by day and time once you add one.'}</p>`)
  }

  function routines(r) {
    RT.data = r
    drawRoutines()
  }

  document.addEventListener('click', e => {
    const c = e.target.closest('#rtKpis .chip')
    if (c) { RT.filter = c.dataset.f; drawRoutines() }
  })
  document.addEventListener('change', e => {
    if (e.target.id === 'rtSort') { RT.sort = e.target.value; drawRoutines(); $('rtSort').focus() }
  })
  document.addEventListener('click', e => {
    const m = e.target.closest('.dmore')
    if (!m) return
    m.parentElement.querySelectorAll('.dl.more').forEach(x => { x.hidden = false })
    m.remove()
  })

  window.rttl = { loadTimeline, routines }
  // loadRoutines may finish before this script runs; draw what it left behind.
  if (window.rtData) routines(window.rtData)
})()
