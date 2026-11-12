// hub work package: Home artifacts, micro apps, Recos. Shares globals from index.html ($, esc, getJ, ago, none, parts).
(() => {
  const post = (u, b) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
    .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'request failed'); return j })
  const bytes = n => n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n >= 1e3 ? Math.round(n / 1e3) + ' KB' : n + ' B'
  const day = ms => new Date(ms).toISOString().slice(0, 10)

  // ---- Artifacts ----
  const G = (d) => `<svg class="ai" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${d}</svg>`
  const ICON = {
    deck: G('<rect x="2" y="3" width="12" height="8"/><path d="M8 11v3M5 14h6"/>'),
    doc: G('<path d="M4 1.5h5.5L12 4v10.5H4z"/><path d="M6 8h4M6 11h4"/>'),
    image: G('<rect x="2" y="3" width="12" height="10"/><path d="M2 11l3.5-3.5L8 10l2-2 4 4"/>'),
    video: G('<rect x="2" y="3" width="12" height="10"/><path d="M7 6l3 2-3 2z"/>'),
    html: G('<path d="M6 4L2 8l4 4M10 4l4 4-4 4"/>'),
    other: G('<rect x="3" y="3" width="10" height="10"/>'),
  }
  const TYPES = ['deck', 'doc', 'image', 'video', 'html', 'other']
  const THUMB = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])
  let items = [], type = '', q = '', shown = [], artAll = false
  const SHOW = 8 // rows before "N more"
  const lastSeg = p => String(p || '').split(/[\\/]/).filter(Boolean).pop() || ''

  const artEmpty = () => `<li class="row"><span class="ph">No artifact folders yet. Add this line to config.json, then reload:</span></li><li class="hub-code"><code>"artifactDirs": ["C:\\\\Users\\\\you\\\\Documents\\\\decks"],</code></li>`

  function renderArts(hint) {
    const counts = Object.fromEntries(TYPES.map(t => [t, items.filter(i => i.type === t).length]))
    $('artChips').innerHTML = items.length ? [['', 'All', items.length], ...TYPES.filter(t => counts[t]).map(t => [t, t, counts[t]])]
      .map(([t, l, n]) => `<button type="button" class="chip" data-type="${t}" aria-pressed="${t === type}">${l} <b>${n}</b></button>`).join('') : ''
    const s = q.trim().toLowerCase()
    shown = items.filter(i => (!type || i.type === type) && (!s || i.name.toLowerCase().includes(s) || i.path.toLowerCase().includes(s)))
    $('artN').textContent = items.length || ''
    $('artStat').textContent = !items.length ? '' : s ? `${shown.length} match${shown.length === 1 ? '' : 'es'}, Enter opens` : `${shown.length} shown`
    const cap = Math.min(shown.length, 60), lim = artAll ? cap : Math.min(SHOW, cap)
    $('arts').innerHTML = hint ? artEmpty()
      : shown.slice(0, lim).map((x, i) => `<li class="row" data-i="${i}"><span class="hub-nm t-body">${ICON[x.type] || ICON.other}<a href="#" data-art="${i}">${esc(x.name)}</a></span><b class="t-meta">${ago(new Date(x.mtime).toISOString())}</b><small class="t-meta">${esc(x.type)} · ${esc(bytes(x.size))} · ${esc(lastSeg(x.folder))}</small></li>`).join('')
        + (cap > lim ? `<li class="more-row"><button type="button" class="btn" data-more="1">${cap - lim} more</button></li>` : '')
        || none(items.length ? 'No artifact matches.' : 'No artifacts found in those folders.')
  }

  async function loadArtifacts() {
    const art = await getJ('/api/artifacts?limit=500').catch(() => null)
    if (!art) { $('arts').innerHTML = none('Read failed. Reload to retry.'); return }
    items = art.items
    renderArts(!art.dirs.length)
  }

  function artCard(x) {
    const root = document.createElement('div'); root.className = 'hub-card'
    root.innerHTML = `<p class="hub-tag-row"><span class="hub-tag">${esc(x.type)}</span><span class="hub-tag">${esc(day(x.mtime))}</span></p>
      <h3>${esc(x.name)}</h3><p class="hub-path">${esc(x.path)}</p><p class="label">${esc(bytes(x.size))}, .${esc(x.ext)}</p>
      ${THUMB.has(x.ext) ? `<img class="hub-img" alt="" src="/api/artifacts/thumb?path=${encodeURIComponent(x.path)}">` : ''}
      <p class="status" id="artMsg" role="status"></p><div class="hub-actions"></div>`
    const say = t => { root.querySelector('#artMsg').textContent = t }
    const bar = root.querySelector('.hub-actions')
    let m
    bar.append(
      parts.button('Open file', { go: true, onClick: () => post('/api/open', { path: x.path }).then(() => say('Opened in Explorer.')).catch(e => say(e.message)) }),
      parts.button('Hide', { onClick: () => post('/api/artifacts/hide', { path: x.path }).then(() => { items = items.filter(i => i !== x); renderArts(); m.close() }).catch(e => say(e.message)) }),
      parts.button('Close', { onClick: () => m.close() }))
    root.insertAdjacentHTML('beforeend', '<p class="label">Hide removes it from this dashboard only. The file stays on disk.</p>')
    m = parts.modal({ title: 'Artifact', body: root })
  }

  // hover preview: images show a thumbnail, other types show size and folder
  let prev = null
  function showPrev(li) {
    const x = shown[li.dataset.i]; if (!x) return
    if (!prev) { prev = document.createElement('div'); prev.className = 'hub-prev'; prev.setAttribute('aria-hidden', 'true'); document.body.append(prev) }
    prev.innerHTML = THUMB.has(x.ext) ? `<img alt="" src="/api/artifacts/thumb?path=${encodeURIComponent(x.path)}">` : ''
    prev.insertAdjacentHTML('beforeend', `<p>${esc(x.type)}, ${esc(bytes(x.size))}</p><p class="label">${esc(x.folder)}</p>`)
    const r = li.getBoundingClientRect()
    prev.style.display = 'block'
    prev.style.left = Math.max(8, r.left - prev.offsetWidth - 12) + 'px'
    prev.style.top = Math.min(innerHeight - prev.offsetHeight - 8, Math.max(8, r.top)) + 'px'
  }
  const hidePrev = () => { if (prev) prev.style.display = 'none' }

  $('arts').addEventListener('click', e => { if (e.target.closest('[data-more]')) { artAll = true; return renderArts() } const a = e.target.closest('[data-art]'); if (!a) return; e.preventDefault(); hidePrev(); artCard(shown[a.dataset.art]) })
  $('arts').addEventListener('mouseover', e => { const li = e.target.closest('li[data-i]'); li ? showPrev(li) : hidePrev() })
  $('arts').addEventListener('mouseleave', hidePrev)
  $('arts').addEventListener('scroll', hidePrev)
  $('artChips').addEventListener('click', e => { const b = e.target.closest('[data-type]'); if (!b) return; type = b.dataset.type; artAll = false; renderArts() })
  $('artQ').addEventListener('input', e => { q = e.target.value; artAll = false; renderArts() })
  $('artQ').addEventListener('keydown', e => { if (e.key === 'Enter' && shown[0]) { e.preventDefault(); artCard(shown[0]) } })

  // ---- Micro apps ----
  let appList = []
  const say = t => { const el = $('appStat'); if (el) el.textContent = t }
  const runNote = r => `Running${r.mode ? ' (' + r.mode + ' mode)' : ''}, see Skills > Runs.`

  function renderApps(dirs) {
    $('hubApps').innerHTML = `<h2>Micro apps <span>${appList.length || ''}</span></h2>
      <div class="hub-apps">${appList.map((a, i) => `<button type="button" class="kcard hub-app" data-app="${i}"><span class="gl" aria-hidden="true">${esc(a.glyph)}</span><span class="tx"><b>${esc(a.name)}</b><i title="${esc(a.desc || '')}">${esc(a.desc || 'No description.')}</i></span></button>`).join('')
        || `<p class="ph">No apps yet. Drop a single-file .html app into the apps folder, or click Add app. Extra folders: "microAppDirs": [...] in config.json.</p>`}</div>
      <div class="hub-actions"><button type="button" class="btn go" id="appAdd">+ Add app</button><button type="button" class="btn" id="recosBtn">Recos</button></div>
      <p class="status" id="appStat" role="status"></p>`
  }

  function openApp(a) {
    const m = parts.modal({ title: a.name, body: `<iframe class="hub-frame" sandbox="allow-scripts" src="${esc(a.url)}" title="${esc(a.name)}"></iframe>` })
    m.el.classList.add('hubwide')
  }

  function addApp() {
    const f = parts.commentBox({ label: 'What should the app do?', placeholder: 'A small tool that ...' })
    f.querySelector('button').textContent = 'Build app'
    const m = parts.modal({ title: 'Add micro app', body: f })
    f.insertAdjacentHTML('beforeend', '<p class="label">Claude writes one self-contained HTML file into the apps folder (Sonnet, medium effort). Check the result under Skills > Runs.</p>')
    f.addEventListener('submit', async e => {
      e.preventDefault()
      const text = f.querySelector('textarea').value.trim()
      if (!text) return f.querySelector('textarea').focus()
      e.stopImmediatePropagation() // commentBox clears the field in its own handler; keep the text until the call returns
      try { say(runNote(await post('/api/microapps/add', { text }))); m.close() } catch (err) { say(err.message); m.close() }
    }, true)
  }

  async function loadApps() {
    const r = await getJ('/api/microapps').catch(() => null)
    appList = r ? r.apps : []
    renderApps()
    if (!r) say('Read failed. Reload to retry.')
  }

  $('hubApps').addEventListener('click', e => {
    const a = e.target.closest('[data-app]')
    if (a) return openApp(appList[a.dataset.app])
    if (e.target.closest('#appAdd')) return addApp()
    if (e.target.closest('#recosBtn')) return openRecos()
  })

  // ---- Tools (local servers from launch.json) ----
  let toolList = [], toolQ = ''
  const all = c => document.querySelectorAll('.' + c) // the Tools panel is on Home and Apps
  const STATE = { on: 'running', busy: 'port busy', off: 'off' }
  function renderTools() {
    const q = toolQ.toLowerCase()
    const shown = toolList.map((t, i) => ({ t, i })).filter(({ t }) => !q || `${t.project} ${t.name} ${t.port}`.toLowerCase().includes(q))
    all('tools-n').forEach(e => { e.textContent = toolList.length || '' })
    const html = shown.map(({ t, i }) => `<li class="row tool-row" title="${esc(t.dir)}">
      <span class="tool-nm"><span class="tool-dot s-${t.state}" aria-hidden="true"></span>${esc(t.project)} / ${esc(t.name)}</span>
      <b>${STATE[t.state]} :${t.port}</b>
      <small>${esc(t.cmd)}${t.last ? ' · ' + ago(new Date(t.last).toISOString()) : ''}</small>
      <span class="tool-act">${t.state === 'off' ? `<button type="button" class="btn sm go" data-start="${i}">Start</button>` : ''}<a class="btn sm" href="${esc(t.url)}" target="_blank" rel="noopener">Open</a></span>
    </li>`).join('') || `<li class="row"><span class="ph">${toolList.length ? 'No match.' : 'No .claude/launch.json found in your session folders.'}</span></li>`
    all('tools-list').forEach(e => { e.innerHTML = html })
  }
  async function loadTools() {
    const r = await getJ('/api/tools').catch(() => null)
    toolList = r ? r.tools : []
    renderTools()
    if (!r) toolSay('Read failed. Reload to retry.')
  }
  const toolSay = m => all('tools-stat').forEach(e => { e.textContent = m })
  all('tools-q').forEach(i => i.addEventListener('input', e => { toolQ = e.target.value; all('tools-q').forEach(o => { o.value = toolQ }); renderTools() }))
  all('tools-list').forEach(l => l.addEventListener('click', async e => {
    const b = e.target.closest('[data-start]')
    if (!b) return
    const t = toolList[b.dataset.start]
    b.disabled = true
    toolSay(`Starting ${t.name}.`)
    try {
      const r = await post('/api/tools/start', { id: t.id })
      toolSay(r.ok ? `${t.name} is running on port ${t.port}.` : r.error)
    } catch (err) { toolSay(err.message) }
    loadTools()
  }))

  // ---- Recos ----
  const LV = { high: 0, medium: 1, low: 2 }
  function openRecos() {
    const root = document.createElement('div'); root.className = 'rc'
    root.innerHTML = '<aside class="rc-side" aria-label="Areas"></aside><div class="rc-main"><div class="rc-bar"></div><div class="rc-body"><p class="ph">Reading apps, skills, notes and logs.</p></div><p class="status" role="status"></p></div>'
    const m = parts.modal({ title: 'Recos', body: root })
    m.el.classList.add('hubxl')
    const side = root.querySelector('.rc-side'), bar = root.querySelector('.rc-bar'), body = root.querySelector('.rc-body'), stat = root.querySelector('.status')
    let list = [], area = '', view = 'cards'
    const cart = new Set(), comments = {}

    const apply = async () => {
      if (!cart.size) return
      stat.textContent = 'Sending.'
      try {
        const r = await post('/api/recos/apply', { items: [...cart].map(id => ({ id, comment: (comments[id] || '').slice(0, 300) })) })
        cart.clear(); renderBar(); body.querySelectorAll('.rc-card').forEach(c => { c.classList.remove('in'); c.querySelector('input[type=checkbox]').checked = false })
        stat.textContent = runNote(r)
      } catch (e) { stat.textContent = e.message }
    }
    function renderBar() {
      bar.innerHTML = `<span class="chips-inline"><button type="button" class="chip" data-view="cards" aria-pressed="${view === 'cards'}">Cards</button><button type="button" class="chip" data-view="list" aria-pressed="${view === 'list'}">List</button></span>
        <span class="num">${cart.size}<small>in cart</small></span>`
      bar.append(parts.button('Apply selected', { go: true, onClick: apply }))
      bar.lastChild.disabled = !cart.size
    }
    function renderSide() {
      const areas = [...new Set(list.map(r => r.area))].sort()
      side.innerHTML = [['', 'All', list.length], ...areas.map(a => [a, a, list.filter(r => r.area === a).length])]
        .map(([a, l, n]) => `<button type="button" class="chip" data-area="${esc(a)}" aria-pressed="${a === area}">${esc(l)} <b>${n}</b></button>`).join('')
    }
    function renderBody() {
      const rows = list.filter(r => !area || r.area === area)
      body.className = 'rc-body ' + view
      body.innerHTML = rows.map(r => `<article class="kcard rc-card${cart.has(r.id) ? ' in' : ''}" data-id="${esc(r.id)}">
        <h3>${esc(r.title)}</h3>
        <p class="rc-ben">${esc(r.benefit)}</p>
        <p class="rc-do"><span class="label">Claude would</span> ${esc(r.what.length > 240 ? r.what.slice(0, 240) + '...' : r.what)}</p>
        <p class="hub-tag-row"><span class="hub-tag">${esc(r.area)}</span><span class="hub-tag l-${esc(r.effort)}">Effort ${esc(r.effort)}</span><span class="hub-tag l-${esc(r.priority)}">Priority ${esc(r.priority)}</span></p>
        <label class="rc-pick"><input type="checkbox"${cart.has(r.id) ? ' checked' : ''}> Add to cart</label>
        <textarea aria-label="Comment on ${esc(r.title)}" placeholder="Comment for Claude" maxlength="300">${esc(comments[r.id] || '')}</textarea></article>`).join('')
        || `<p class="ph">No recommendations right now. Agents can drop files in the recos folder, each starting with a front-matter block: title, area, benefit, effort, priority.</p>`
    }
    root.addEventListener('click', e => {
      const a = e.target.closest('[data-area]'), v = e.target.closest('[data-view]')
      if (a) { area = a.dataset.area; renderSide(); renderBody() }
      if (v) { view = v.dataset.view; renderBar(); renderBody() }
    })
    body.addEventListener('change', e => {
      const c = e.target.closest('.rc-card'); if (!c || e.target.type !== 'checkbox') return
      e.target.checked ? cart.add(c.dataset.id) : cart.delete(c.dataset.id)
      c.classList.toggle('in', e.target.checked); renderBar()
    })
    body.addEventListener('input', e => { const c = e.target.closest('.rc-card'); if (c && e.target.tagName === 'TEXTAREA') comments[c.dataset.id] = e.target.value })

    getJ('/api/recos').then(r => {
      list = r.recos.sort((a, b) => LV[a.priority] - LV[b.priority] || LV[b.effort] - LV[a.effort])
      renderSide(); renderBar(); renderBody()
    }).catch(() => { body.innerHTML = '<p class="ph">Read failed. Close and open Recos again.</p>' })
  }

  // ---- Run history ----
  const dur = ms => ms == null ? '' : ms < 60000 ? Math.round(ms / 1000) + ' s' : Math.floor(ms / 60000) + ' m ' + Math.round(ms % 60000 / 1000) + ' s'
  const ST = { done: 'ok', failed: 'failed', running: 'running' }
  let hist = [], histPoll = 0
  const runSec = document.createElement('section')
  runSec.className = 'panel'; runSec.id = 'runHist'
  $('hubApps').after(runSec)

  function renderHist() {
    runSec.innerHTML = `<h2>Run history <span>${hist.length || ''}</span></h2>
      <ul class="scroll" id="rhList">${hist.map((r, i) => {
        const t = r.started || r.ended
        return `<li class="row rh-row" data-i="${i}"><span class="t-body">/${esc(r.skill)}</span><b class="t-meta st-${esc(r.status)}">${esc(ST[r.status] || r.status)}</b>
          <small class="t-meta">${[r.model, r.effort, r.mode, dur(r.duration), t ? ago(new Date(t).toISOString()) : ''].filter(Boolean).map(esc).join(' · ')}</small>
          <span class="hub-actions rh-act"><button type="button" class="btn" data-open="${i}">Open report</button><button type="button" class="btn go" data-again="${i}">Run again</button></span></li>`
      }).join('') || none('No runs yet.')}</ul>
      <p class="status" id="rhStat" role="status"></p>`
  }

  async function loadHist() {
    hist = await getJ('/api/runs/history').catch(() => null)
    if (!hist) { hist = []; renderHist(); $('rhStat').textContent = 'Read failed. Reload to retry.'; return }
    const stat = $('rhStat') ? $('rhStat').textContent : ''
    renderHist(); $('rhStat').textContent = stat
    clearTimeout(histPoll)
    if (hist.some(r => r.status === 'running')) histPoll = setTimeout(loadHist, 3000)
  }

  // Same viewer as the Skills page: fills #report and unhides it.
  async function openReport(r) {
    try {
      const j = await getJ('/api/report?file=' + encodeURIComponent(r.report))
      if (j.error) throw 0
      const m = j.meta
      $('repMeta').textContent = [m.skill, m.model, m.effort, m.mode, m.duration ? Math.round(m.duration / 1000) + ' s' : 'running', m.exit != null ? 'exit ' + m.exit : ''].filter(Boolean).join(' · ')
      $('repBody').textContent = j.body
      $('report').hidden = false
      $('repClose').focus()
    } catch { $('rhStat').textContent = 'Report not found.' }
  }

  // bypassPermissions is not accepted by POST /api/run, so such a run falls back to the config default.
  const again = r => post('/api/run', { skill: r.skill, model: r.model, effort: r.effort, mode: ['plan', 'acceptEdits'].includes(r.mode) ? r.mode : undefined })
    .then(j => { $('rhStat').textContent = `Running /${r.skill}. Report: ${j.report}`; loadHist() })
    .catch(e => { $('rhStat').textContent = e.message })

  runSec.addEventListener('click', e => {
    const o = e.target.closest('[data-open]'), a = e.target.closest('[data-again]')
    if (o) openReport(hist[o.dataset.open])
    if (a) again(hist[a.dataset.again])
  })

  loadArtifacts()
  loadApps()
  loadTools()
  loadHist()
})()
