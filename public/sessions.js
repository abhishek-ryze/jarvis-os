// sessions work package. Shares globals from index.html: $, esc, fmt, getJ, go, LAZY, ago, usd, sum, projName.
(function () {
  const S = { days: 7, project: '', q: '', sort: 'recent', data: null, seq: 0, all: false, allProj: false }
  const SHOW = 8 // rows shown before "N more"
  const IC = (d) => `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${d}</svg>`
  const ICON = { resume: IC('<rect x="5.5" y="5.5" width="8" height="8"/><path d="M10.5 3.5v-1h-8v8h1"/>'), folder: IC('<path d="M2 4.5h4l1.5 1.5H14v7H2z"/>') }
  const ib = (act, tip) => `<button type="button" class="ss-ib" data-act="${act}" data-tip="${tip}" aria-label="${tip}">${ICON[act]}</button>`
  const moreRow = (n, tag) => `<${tag} class="more-row"><${tag === 'tr' ? 'td colspan="4"' : 'span'}><button type="button" class="btn" data-more="1">${n} more</button></${tag === 'tr' ? 'td' : 'span'}></${tag}>`
  // Hash filters: #Sessions?project=<dir key or folder name>&days=<n>&q=<text>. Missing keys reset to default (project and q empty, days unchanged).
  function hashFilter() {
    const h = location.hash.slice(1), i = h.indexOf('?')
    if (i < 0 || h.slice(0, i) !== 'Sessions') return null
    const p = new URLSearchParams(h.slice(i + 1)), d = parseInt(p.get('days'), 10)
    return { project: p.get('project') || '', q: (p.get('q') || '').trim(), days: d > 0 && d <= 365 ? d : 0 }
  }
  function applyHash() {
    const f = hashFilter(); if (!f) return false
    S.project = f.project; S.q = f.q; if (f.days) S.days = f.days
    return true
  }
  function syncBar() {
    $('ssQ').value = S.q
    root().querySelectorAll('[data-days]').forEach(x => x.setAttribute('aria-pressed', +x.dataset.days === S.days))
  }
  const root = () => $('sessRoot')
  const agoMs = t => t ? ago(new Date(t).toISOString()) : ''
  const dur = ms => ms < 6e4 ? '<1 min' : ms < 36e5 ? Math.round(ms / 6e4) + ' min' : (ms / 36e5).toFixed(1) + ' h'
  const nameOf = (cwd, dir) => cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() : projName(dir || '')
  const clock = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const delta = (d, money) => {
    if (d == null) return '<small>no prior week</small>'
    const v = Math.round(d * 100)
    return `<small class="${d > .25 ? 'ss-up' : ''}" title="vs the 7 days before">${v > 0 ? '+' : ''}${v}% WoW</small>`
  }

  function shell() {
    root().innerHTML = `
<div class="ss-grid">
  <section class="panel ss-main">
    <h2>Sessions <span id="ssSpan"></span></h2>
    <div class="kpis ss-kpis" id="ssKpis"><span class="ph">reading session logs (the first build reads every log, about 20 s)</span></div>
    <div class="ss-bar">
      <label class="sr" for="ssProj">Project</label>
      <select id="ssProj"><option value="">All projects</option></select>
      <div class="ss-days" role="group" aria-label="Window">${[7, 30, 90].map(d => `<button type="button" class="chip" data-days="${d}" aria-pressed="${d === S.days}">${d} d</button>`).join('')}</div>
      <label class="sr" for="ssQ">Search prompts, tools and file paths</label>
      <input class="field" id="ssQ" type="search" placeholder="Search prompts, tools, file paths" autocomplete="off">
      <label class="sr" for="ssSort">Sort</label>
      <select id="ssSort"><option value="recent">Recent</option><option value="cost">Cost</option><option value="duration">Duration</option></select>
    </div>
    <div class="ss-head t-lab" aria-hidden="true"><span>Session</span><span>Time</span><span>Tokens</span><span>Est $</span><span>Err</span><span></span></div>
    <ul class="ss-list" id="ssList"></ul>
    <p class="status" id="ssNote" aria-live="polite"></p>
  </section>
  <div class="ss-side">
    <section class="panel"><h2>Top 5 expensive <span>this week</span></h2><ul id="ssTop"></ul></section>
    <section class="panel"><h2>Projects <span id="ssProjSpan"></span></h2>
      <table class="ss-tbl"><thead><tr class="t-lab"><th>Project</th><th>Sess</th><th>Tokens</th><th>Est $</th></tr></thead><tbody id="ssProjs"></tbody></table>
    </section>
  </div>
</div>`
    $('ssProj').addEventListener('change', e => { S.project = e.target.value; refresh() })
    $('ssSort').addEventListener('change', e => { S.sort = e.target.value; drawList() })
    root().querySelector('.ss-days').addEventListener('click', e => {
      const b = e.target.closest('[data-days]'); if (!b) return
      S.days = +b.dataset.days
      root().querySelectorAll('[data-days]').forEach(x => x.setAttribute('aria-pressed', x === b))
      refresh()
    })
    let t = 0
    $('ssQ').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { S.q = e.target.value.trim(); refresh() }, 250) })
    $('ssProjs').addEventListener('click', e => {
      if (e.target.closest('[data-more]')) { S.allProj = true; return drawProjects() }
      const b = e.target.closest('[data-proj]'); if (!b) return
      S.project = S.project === b.dataset.proj ? '' : b.dataset.proj
      refresh()
    })
    $('ssTop').addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b) openDrawer(b.dataset.open) })
    $('ssList').addEventListener('click', onRowClick)
    syncBar()
  }

  async function refresh() {
    const n = ++S.seq
    $('ssNote').textContent = 'loading'
    let d
    try {
      d = await getJ(`/api/sessions?days=${S.days}&project=${encodeURIComponent(S.project)}&q=${encodeURIComponent(S.q)}`)
      if (d.error) throw new Error(d.error)
    } catch (e) { if (n === S.seq) $('ssNote').textContent = 'Read failed: ' + e.message; return }
    if (n !== S.seq) return
    if (S.project && !d.projects.some(p => p.project === S.project)) { // hash may carry a folder name instead of the dir key
      const m = d.projects.find(p => nameOf(p.cwd, p.project).toLowerCase() === S.project.toLowerCase())
      if (m) { S.project = m.project; return refresh() }
    }
    S.data = d; S.all = false
    drawKpis(); drawTop(); drawProjects(); drawList()
  }

  function drawKpis() {
    const k = S.data.kpi
    $('ssKpis').innerHTML = [
      [k.sessions.week, k.sessions.delta, 'Sessions this week', `${k.sessions.prev} the week before`],
      [fmt(k.tokens.week), k.tokens.delta, 'Tokens this week', `${fmt(k.tokens.prev)} the week before`],
      [usd(k.usd.week), k.usd.delta, 'Est $ this week', `${usd(k.usd.prev)} the week before`],
    ].map(([v, d, l, p]) => `<div><div class="num">${v}${delta(d)}</div><div class="label">${l} <span class="ss-prev">${p}</span></div></div>`).join('')
  }

  function drawTop() {
    const t = S.data.top
    $('ssTop').innerHTML = t.length ? t.map(r => `<li class="row"><span class="t-body"><button type="button" class="ss-link" data-open="${esc(r.id)}" title="${esc(r.prompt || '')}">${esc(r.title || r.prompt || r.id)}</button></span><b class="t-num">${usd(r.weekUsd)}</b><small class="t-meta">${esc(nameOf(r.cwd, r.project))} · ${agoMs(r.end)}</small></li>`).join('') : none('No sessions this week.')
  }

  function drawProjects() {
    const ps = S.data.projects
    $('ssProjSpan').textContent = `last ${S.days} d, click filters`
    const sel = $('ssProj')
    sel.innerHTML = '<option value="">All projects</option>' + ps.map(p => `<option value="${esc(p.project)}">${esc(nameOf(p.cwd, p.project))}</option>`).join('')
    if (S.project && !ps.some(p => p.project === S.project)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(S.project)}">${esc(projName(S.project))}</option>`)
    sel.value = S.project
    const vis = S.allProj ? ps : ps.slice(0, SHOW)
    $('ssProjs').innerHTML = ps.length ? vis.map(p => `<tr${p.project === S.project ? ' class="on"' : ''}><td class="t-body"><button type="button" class="ss-link" data-proj="${esc(p.project)}" aria-pressed="${p.project === S.project}" title="${esc((p.cwd || p.project) + ' · last ' + agoMs(p.last))}">${esc(nameOf(p.cwd, p.project))}</button></td><td>${p.sessions}</td><td>${fmt(p.tokens)}</td><td>${usd(p.usd)}</td></tr>`).join('') + (ps.length > vis.length ? moreRow(ps.length - vis.length, 'tr') : '') : `<tr><td colspan="4" class="ph">No sessions in this window.</td></tr>`
  }

  const SORTS = { recent: (a, b) => b.end - a.end, cost: (a, b) => b.usd - a.usd, duration: (a, b) => b.duration - a.duration }
  function drawList() {
    const rows = [...S.data.sessions].sort(SORTS[S.sort])
    $('ssSpan').textContent = `${rows.length} in ${S.days} d${S.project ? ', ' + $('ssProj').selectedOptions[0].textContent : ''}${S.q ? `, "${S.q}"` : ''}`
    $('ssNote').textContent = rows.length > 200 ? `Showing 200 of ${rows.length}. Narrow with search or project.` : ''
    const cap = Math.min(rows.length, 200), lim = S.all ? cap : Math.min(SHOW, cap)
    $('ssList').innerHTML = rows.length ? rows.slice(0, lim).map(r => `<li class="ss-row" data-id="${esc(r.id)}">
  <button type="button" class="ss-open" data-act="open" title="${esc((r.title ? r.title + ': ' : '') + (r.prompt || '') + ' (' + r.turns + ' turns)')}">
    <span class="ss-p t-body">${esc(r.title ? r.title + ': ' : '')}${esc(r.prompt || '(no typed prompt)')}</span>
    <span class="ss-m t-meta">${esc(nameOf(r.cwd, r.project))} · ${agoMs(r.end)} · ${r.turns} turn${r.turns === 1 ? '' : 's'} ·${esc(r.models.map(m => m.replace(/^claude-/, '')).join(', '))}</span>
  </button>
  <span class="ss-n t-num">${dur(r.duration)}</span><span class="ss-n t-num">${fmt(sum(r.tokens))}</span><span class="ss-n t-num">${usd(r.usd)}</span>
  <span class="ss-n t-num${r.errors ? ' ss-err' : ''}">${r.errors || '-'}</span>
  <span class="ss-acts">${ib('resume', 'Copy resume command')}${r.cwd ? ib('folder', 'Open folder') : ''}</span>
</li>`).join('') + (cap > lim ? moreRow(cap - lim, 'li') : '') : none(S.q ? 'No session matches this search.' : 'No sessions in this window.')
  }

  // Icon buttons show a CSS tip from data-tip; text buttons (drawer) swap their label.
  function flash(b, msg) {
    const tip = 'tip' in b.dataset, was = tip ? b.dataset.tip : b.textContent
    if (tip) b.dataset.tip = msg; else b.textContent = msg
    $('ssNote').textContent = msg
    setTimeout(() => { if (tip) b.dataset.tip = was; else b.textContent = was; if ($('ssNote').textContent === msg) $('ssNote').textContent = '' }, 1500)
  }
  async function copyResume(b, id) {
    let ok = true
    try { await navigator.clipboard.writeText(`claude --resume ${id}`) } catch { ok = false }
    flash(b, ok ? 'Copied' : 'Blocked')
  }
  async function openFolder(b, cwd) {
    const r = await fetch('/api/sessions/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: cwd }) }).then(x => x.json()).catch(() => ({ error: 'failed' }))
    flash(b, r.error ? 'Missing' : 'Opened')
  }
  function onRowClick(e) {
    if (e.target.closest('[data-more]')) { S.all = true; return drawList() }
    const li = e.target.closest('.ss-row'); if (!li) return
    const r = S.data.sessions.find(x => x.id === li.dataset.id)
    const act = (e.target.closest('[data-act]') || {}).dataset?.act || 'open'
    if (act === 'resume') return copyResume(e.target.closest('button'), r.id)
    if (act === 'folder') return openFolder(e.target.closest('button'), r.cwd)
    openDrawer(r.id)
  }

  // ---------- transcript drawer ----------
  const PAGE = 150
  const tname = n => /^mcp__/.test(n) ? 'mcp ' + n.split('__').pop() : n
  function tokLine(t) { return t ? `${fmt(t.input + t.cacheWrite + t.cacheRead)} in · ${fmt(t.output)} out` : '' }
  function itemHtml(i) {
    const when = i.ts ? `<time>${clock(i.ts)}</time>` : ''
    if (i.k === 'user') return `<article class="ss-it ss-u"><div class="ss-tm"><b>You</b>${when}</div><div class="ss-tx">${esc(i.text)}</div></article>`
    return `<article class="ss-it ss-a${i.err ? ' ss-bad' : ''}"><div class="ss-tm"><b>Claude</b>${when}<span>${esc((i.model || '').replace(/^claude-/, ''))}</span><span class="ss-tk">${tokLine(i.tokens)}</span></div>
${i.texts.map(t => `<div class="ss-tx">${esc(t)}</div>`).join('')}
${i.tools.map(t => `<details class="ss-tool${t.err ? ' ss-bad' : ''}"><summary><b title="${esc(t.name)}">${esc(tname(t.name))}</b><span>${esc(t.brief)}</span>${t.err ? '<em>error</em>' : ''}</summary>
<div class="lbl">Input</div><pre>${esc(t.input)}</pre>
<div class="lbl">Result${t.lines > 14 ? ` <span>first 14 of ${t.lines} lines</span>` : ''}</div><pre>${t.result == null ? 'no result in the log' : esc(t.result)}</pre></details>`).join('')}</article>`
  }
  function laneHtml(d) {
    const subs = d.subagents
    if (!subs.length) return ''
    const s0 = Math.min(d.start || Infinity, ...subs.map(s => s.start)), s1 = Math.max(d.end || 0, ...subs.map(s => s.end)), span = Math.max(s1 - s0, 1)
    return `<section class="ss-lane"><h3 class="lbl">Subagents <span>${subs.length} runs · ${usd(subs.reduce((a, s) => a + s.usd, 0))}</span></h3><ul>${subs.map(s => `<li><span class="ss-sn" title="${esc(s.description || '')}"><b>${esc(s.type || 'agent')}</b> ${esc(s.description || s.agent)}</span>
<span class="ss-track"><i style="left:${((s.start - s0) / span * 100).toFixed(2)}%;width:${Math.max(.5, s.duration / span * 100).toFixed(2)}%"></i></span>
<span class="ss-n">${dur(s.duration)}</span><span class="ss-n">${fmt(sum(s.tokens))}</span><span class="ss-n">${usd(s.usd)}</span></li>`).join('')}</ul></section>`
  }

  let drawer = null
  async function openDrawer(id) {
    if (drawer) drawer.close()
    const opener = document.activeElement
    const d = document.createElement('dialog')
    d.className = 'ss-drawer'
    d.setAttribute('aria-label', 'Session transcript')
    d.innerHTML = `<div class="panel ss-dbox"><div class="ss-dhead"><h2>Transcript <span>${esc(id)}</span></h2><button type="button" class="modal-x" aria-label="Close">×</button></div><div class="ss-dbody"><p class="ph">loading transcript</p></div></div>`
    document.body.append(d)
    d.showModal()
    drawer = d
    d.querySelector('.modal-x').addEventListener('click', () => d.close())
    d.addEventListener('click', e => { if (e.target === d) d.close() })
    d.addEventListener('close', () => { d.remove(); if (drawer === d) drawer = null; if (opener && opener.focus) opener.focus() })
    const body = d.querySelector('.ss-dbody')
    let t
    try { t = await getJ(`/api/session?id=${encodeURIComponent(id)}&limit=${PAGE}`); if (t.error) throw new Error(t.error) } catch (e) { body.innerHTML = `<p class="ph">Read failed: ${esc(e.message)}</p>`; return }
    const row = S.data && S.data.sessions.find(x => x.id === id)
    body.innerHTML = `<div class="ss-meta">
  <div class="ss-ttl">${esc(t.title || (row && row.prompt) || nameOf(t.cwd, t.project))}</div>
  <div class="label">${esc(t.cwd || t.project)}${t.start ? ' · ' + clock(t.start) + ' to ' + clock(t.end) + ' · ' + dur(t.end - t.start) : ''}${row ? ' · ' + fmt(sum(row.tokens)) + ' tokens · ' + usd(row.usd) : ''}${row && row.errors ? ` · <span class="ss-err">${row.errors} tool errors</span>` : ''}</div>
  <div class="ss-dacts"><button type="button" class="btn go" data-act="resume">Copy resume</button>${t.cwd ? '<button type="button" class="btn" data-act="folder">Open folder</button>' : ''}<code>claude --resume ${esc(t.id)}</code></div>
</div>${laneHtml(t)}<div class="ss-items">${t.items.map(itemHtml).join('')}</div><div class="ss-more"></div>`
    const acts = body.querySelector('.ss-dacts')
    acts.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return
      if (b.dataset.act === 'resume') copyResume(b, t.id).then(() => setTimeout(() => { b.textContent = 'Copy resume' }, 1600))
      else openFolder(b, t.cwd).then(() => setTimeout(() => { b.textContent = 'Open folder' }, 1600))
    })
    let shown = t.items.length
    const more = body.querySelector('.ss-more')
    const drawMore = () => {
      more.innerHTML = shown < t.total ? `<button type="button" class="btn">Load more <span class="ss-prev">${shown} of ${t.total}</span></button>` : `<p class="status">End of transcript, ${t.total} items</p>`
    }
    drawMore()
    more.addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b) return
      b.disabled = true
      try {
        const n = await getJ(`/api/session?id=${encodeURIComponent(id)}&offset=${shown}&limit=${PAGE}`)
        body.querySelector('.ss-items').insertAdjacentHTML('beforeend', n.items.map(itemHtml).join(''))
        shown += n.items.length
      } catch { b.disabled = false; return }
      drawMore()
    })
  }

  async function loadSessions() {
    try { applyHash(); shell(); await refresh() } catch (e) { root().innerHTML = none('Read failed. Open the page again to retry.') }
  }
  // links on other pages set the hash while this page is already loaded
  addEventListener('hashchange', () => { if (S.data && applyHash()) { syncBar(); refresh() } })
  LAZY.Sessions = loadSessions
  window.openSession = id => { go('Sessions'); openDrawer(id) }
})()
