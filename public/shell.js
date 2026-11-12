// data-go contract (click-through): any element with data-go="#View?key=val&..." navigates there on click and on
// Enter/Space. Views: Home Brain Timeline Routines Skills Sessions Apps Planner. Sessions reads project, days (7|30|90), q.
// Example: <b data-go="#Sessions?project=my-app&days=7">1.2M tok</b>. Elements get tabindex and role=link
// automatically when they are not already focusable. Add the attribute in markup or set el.dataset.go.
// Shell work package: command palette, view keys, key sheet, URL hash state, header live count and DATA stamp.
// Loaded after index.html's main script. Uses its globals ($, esc, getJ, go, mode, gsOpen, data, load) and parts.js.
(function () {
  const VIEWS = ['Home', 'Brain', 'Timeline', 'Routines', 'Skills', 'Sessions', 'Apps', 'Planner']
  const hm = d => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  // subsequence match: -1 for none, higher is better (runs and word starts score more)
  function fuzzy(q, s) {
    q = q.toLowerCase(); s = s.toLowerCase()
    let i = 0, sc = 0, prev = -2
    for (let j = 0; j < s.length && i < q.length; j++) {
      if (s[j] !== q[i]) continue
      sc += 1 + (j === prev + 1 ? 2 : 0) + (j === 0 || ' /-:._'.includes(s[j - 1]) ? 3 : 0)
      prev = j; i++
    }
    return i === q.length ? sc - s.length * .01 : -1
  }
  console.assert(fuzzy('gsk', 'Go to Skills') > 0 && fuzzy('xyz', 'Go to Skills') < 0, 'shell: fuzzy basic')
  console.assert(fuzzy('ski', 'Go to Skills') > fuzzy('ski', 'Open latest key info'), 'shell: fuzzy ranks runs higher')

  // ---------- toast ----------
  let toastT
  function toast(msg) {
    let t = $('shToast')
    if (!t) { t = document.createElement('div'); t.id = 'shToast'; t.setAttribute('role', 'status'); document.body.append(t) }
    t.textContent = msg; t.classList.add('on'); clearTimeout(toastT)
    toastT = setTimeout(() => t.classList.remove('on'), 2400)
  }

  // ---------- header: live count and DATA stamp ----------
  const live = window.shellLive = { n: 0, sessions: [] }
  async function pollLive() {
    try {
      live.sessions = (await getJ('/api/sessions/live')).sessions || []
      live.n = live.sessions.filter(s => s.idleMin <= 10).length
    } catch { return }
    const b = $('hdrLive'); if (!b) return
    b.querySelector('b').textContent = live.n; b.classList.toggle('on', live.n > 0)
  }
  let dataAt = 0
  function paintStamp() {
    const b = $('dstamp'); if (!b) return
    b.textContent = 'DATA ' + (dataAt ? hm(new Date(dataAt)) : '--:--')
    b.classList.toggle('stale', !!dataAt && Date.now() - dataAt > 5 * 60000)
  }
  window.shellStamp = () => { dataAt = Date.now(); paintStamp() }
  $('dstamp').addEventListener('click', () => { $('sync').textContent = 'refreshing'; load(true) })
  $('hdrLive').addEventListener('click', () => go('Sessions'))
  setInterval(paintStamp, 30000)

  // ---------- display settings: saved in localStorage 'jarvis.a11y', applied as <html> data attributes (a11y.css) ----------
  const A11Y = [
    ['motion', 'reduce', 'Reduce motion', 'No boot sequence, drift, flights or animated numbers. Reloads the page.'],
    ['contrast', 'high', 'High contrast', 'Brighter secondary text and borders.'],
    ['font', 'readable', 'Readable font', 'System sans font in place of the monospace UI font.'],
    ['fx', 'off', 'Background effects off', 'No particle background, grain or scan band. Reloads the page.'],
    ['cursor', 'system', 'System cursor', 'Normal mouse pointer in place of the targeting reticle.'],
    ['view', 'depth', '3D HUD view', 'Home tilts into depth layers with focus blur, and the graph becomes a globe. Hover or focus a panel to bring it into focus.'],
    // sub: shown inside the 3D row; inv: checked means the setting is unset (blur on)
    ['dof', 'off', 'Depth of field', 'Focus blur on the back layers. Off keeps every layer sharp.', { sub: 'view', inv: true }],
    ['sound', 'on', 'Interface sounds', 'Soft ticks on hover and click, a sweep on page change.']
  ]
  const RELOAD = ['motion', 'fx']
  function a11yDialog() {
    let a = {}
    try { a = JSON.parse(localStorage.getItem('jarvis.a11y')) || {} } catch {}
    const m = parts.modal({ title: 'Display settings', body: '<fieldset class="a11y-list"><legend class="sr">Display settings</legend>' +
      A11Y.map(([k, v, t, s, o = {}]) => `<label class="a11y-row${o.sub ? ' a11y-sub' : ''}"><input type="checkbox" data-k="${k}" data-v="${v}"${o.inv ? ' data-inv' : ''}${o.sub ? ` data-sub="${o.sub}"` : ''}${(a[k] === v) !== !!o.inv ? ' checked' : ''}><span><b>${t}</b><span>${s}</span></span></label>`).join('') +
      '</fieldset><p class="a11y-note">Text size: use your browser zoom (Ctrl and plus). Settings stay in this browser.</p>' })
    // a sub toggle only works while its parent setting is checked
    const subs = () => m.el.querySelectorAll('input[data-sub]').forEach(i => { i.disabled = !m.el.querySelector(`input[data-k=${i.dataset.sub}]`).checked })
    m.el.addEventListener('change', subs); subs()
    // nothing applies until Apply changes, so the reload settings do not close the dialog mid-choice
    const apply = () => {
      const next = {}
      m.el.querySelectorAll('input[data-k]').forEach(i => { if (i.checked !== i.hasAttribute('data-inv')) next[i.dataset.k] = i.dataset.v })
      try { localStorage.setItem('jarvis.a11y', JSON.stringify(next)) } catch {}
      if (RELOAD.some(k => next[k] !== a[k])) return location.reload()
      A11Y.forEach(([k]) => { if (next[k]) document.documentElement.dataset[k] = next[k]; else delete document.documentElement.dataset[k] })
      if (next.cursor) document.documentElement.classList.remove('fx-rc')
      // turning the 3D view on makes the Brain map a globe, turning it off makes it Force; the user can pick another layout after
      if (!next.view !== !a.view) document.querySelector(`#bLayout [data-lay=${next.view ? 'sphere' : 'force'}]`)?.click()
      m.close()
    }
    const row = document.createElement('div'); row.className = 'a11y-actions'
    row.append(parts.button('Cancel', { onClick: () => m.close() }), parts.button('Apply changes', { go: true, onClick: apply }))
    m.el.querySelector('.modal-box').append(row)
  }
  $('a11yBtn').addEventListener('click', a11yDialog)
  setInterval(pollLive, 60000); pollLive()

  // stretch: window.stamp(panelEl, time) adds "read 14 s ago" to a panel header; time is ms or ISO, default now
  const age = t => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 90 ? s + ' s' : s < 5400 ? Math.round(s / 60) + ' min' : Math.round(s / 3600) + ' h' }
  const paintAges = () => document.querySelectorAll('.rd[data-t]').forEach(e => { e.textContent = 'read ' + age(+e.dataset.t) + ' ago' })
  window.stamp = (el, time) => {
    const h = el.querySelector('h2') || el
    let s = h.querySelector('.rd')
    if (!s) { s = document.createElement('span'); s.className = 'rd'; h.append(s) }
    s.dataset.t = time == null ? Date.now() : +new Date(time); paintAges()
  }
  setInterval(paintAges, 5000)

  // ---------- URL hash state ----------
  // "#Sessions?days=7" has a query part after "?"; it is left in the hash for the view to read
  const parse = () => { const [v, ...r] = decodeURIComponent(location.hash.slice(1).split('?')[0]).split('/'); return { view: VIEWS.includes(v) ? v : 'Home', sub: r.join('/') } }
  window.shellHash = (name, sub) => {
    const want = name + (sub ? '/' + sub : ''), cur = parse()
    if (cur.view === name && (sub == null || cur.sub === sub)) return
    history.pushState(null, '', '#' + want)
  }
  function route() {
    const { view, sub } = parse()
    const run = () => {
      go(view)
      if (view === 'Sessions' && sub) setTimeout(() => window.openSession && openSession(sub), 0)
    }
    if (view !== 'Brain') return run()
    // the map needs its graph first
    let n = 0; (function wait() { if (typeof graphOk !== 'undefined' && graphOk || ++n > 50) run(); else setTimeout(wait, 200) })()
  }
  addEventListener('popstate', route)
  // ---------- data-go click-through ----------
  const goEl = e => e.target.closest?.('[data-go]')
  const jump = el => { const h = el.dataset.go; if (h && location.hash !== h) location.hash = h; else if (h) route() }
  document.addEventListener('click', e => { const el = goEl(e); if (el) jump(el) })
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    const el = goEl(e); if (!el || /^(BUTTON|A|INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
    e.preventDefault(); jump(el)
  })
  const focusable = root => root.querySelectorAll?.('[data-go]:not(button):not(a):not([tabindex])').forEach(el => { el.tabIndex = 0; el.setAttribute('role', 'link') })
  new MutationObserver(ms => { for (const m of ms) { if (m.type === 'attributes') focusable(m.target.parentNode || document); else m.addedNodes.forEach(n => n.nodeType === 1 && (n.matches('[data-go]') ? focusable(n.parentNode) : focusable(n))) } })
    .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-go'] })
  focusable(document)

  // ---------- plans list (GET /api/plans) on the Sessions page ----------
  const sessPage = document.querySelector('.page[data-page="Sessions"]')
  async function paintPlans() {
    if (!sessPage || sessPage.hidden) return
    let box = $('planBox')
    if (!box) { box = document.createElement('details'); box.id = 'planBox'; box.className = 'panel planbox'; sessPage.append(box) }
    try {
      const { plans } = await getJ('/api/plans')
      box.innerHTML = `<summary>Plans <small>${plans.length} in ~/.claude/plans. Click to copy the file path.</small></summary><ul class="scroll">${plans.map(p => `<li class="row"><button type="button" class="lnk" data-path="${esc(p.path)}"><span>${esc(p.heading || p.name)}</span></button><small>${esc(p.name)} · ${new Date(p.mtime).toLocaleDateString('en-GB')} · ${Math.max(1, Math.round(p.size / 1024))} KB</small></li>`).join('') || '<li class="row"><span class="ph">No plans yet.</span></li>'}</ul>`
    } catch { box.innerHTML = '<summary>Plans: read failed</summary>' }
  }
  if (sessPage) {
    new MutationObserver(paintPlans).observe(sessPage, { attributes: true, attributeFilter: ['hidden'] })
    sessPage.addEventListener('click', async e => {
      const b = e.target.closest('#planBox [data-path]'); if (!b) return
      try { await navigator.clipboard.writeText(b.dataset.path); toast('Plan path copied') } catch { toast('Copy failed') }
    })
    paintPlans()
  }

  // Esc, the back button and B collapse the map without go(): keep the hash in step
  new MutationObserver(() => {
    if (!document.body.classList.contains('brain') && parse().view === 'Brain' && mode !== 'in') history.replaceState(null, '', '#' + (typeof page === 'string' ? page : 'Home'))
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] })
  if (location.hash) route()

  // ---------- keys ----------
  const modalOpen = () => document.querySelector('dialog[open]') || ($('report') && !$('report').hidden)
  const typingIn = () => { const a = document.activeElement; return a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable) }
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); return palette() }
    if (e.ctrlKey || e.metaKey || e.altKey || typingIn() || modalOpen()) return
    if (/^[1-8]$/.test(e.key)) { e.preventDefault(); go(VIEWS[+e.key - 1]) }
    else if (e.key === '?') { e.preventDefault(); keySheet() }
    else if (e.key.toLowerCase() === 's') { e.preventDefault(); standby() }
  })

  const SHORTCUTS = [
    ['Ctrl+K', 'Command palette'], ['1 to 7', 'Home, Brain, Timeline, Routines, Skills, Sessions, Apps'],
    ['/', 'Focus file search'], ['Enter', 'In search: next match; on the dial: open'], ['B', 'Open or close the Brain map'],
    ['Esc', 'Close a panel, clear search, go back to Home'], ['Left, Right', 'Move around the dial'], ['Home, End', 'First or last dial item'], ['S', 'Standby screen'], ['?', 'This sheet'],
  ]
  function keySheet() {
    parts.modal({ title: 'Keyboard shortcuts', body: `<ul class="shk">${SHORTCUTS.map(([k, d]) => `<li><span>${esc(d)}</span><kbd>${esc(k)}</kbd></li>`).join('')}</ul>` })
  }

  // ---------- command palette ----------
  const RKEY = 'aos.palette.recent'
  const recent = () => { try { return JSON.parse(localStorage.getItem(RKEY)) || [] } catch { return [] } }
  const remember = id => { try { localStorage.setItem(RKEY, JSON.stringify([id, ...recent().filter(x => x !== id)].slice(0, 6))) } catch {} }

  async function resumeLatest() {
    if (!live.sessions.length) await pollLive()
    const s = live.sessions[0]
    if (!s) return toast('No live session found')
    const cmd = 'claude --resume ' + s.id
    try { await navigator.clipboard.writeText(cmd); toast('Copied: ' + cmd) } catch { toast(cmd) }
  }
  function openLatestReport() {
    go('Skills')
    const a = document.querySelector('#runs a[href^="/reports/"]')
    a ? a.click() : toast('No report yet')
  }
  function openSkill(id) {
    go('Skills')
    if (typeof openSk !== 'undefined') { openSk = id; renderDeck(); document.querySelector(`#deck .sk[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' }) }
  }
  // Same steps as the report link handler in index.html (that one only sees links inside #runs)
  async function openReport(name) {
    go('Skills')
    try {
      const r = await getJ('/api/report?file=' + encodeURIComponent(name))
      if (r.error) throw 0
      const m = r.meta
      $('repMeta').textContent = [m.skill, m.model, m.effort, m.mode, m.duration ? Math.round(m.duration / 1000) + ' s' : 'running', m.exit != null ? 'exit ' + m.exit : ''].filter(Boolean).join(' · ')
      $('repBody').textContent = r.body
      $('report').hidden = false
      $('repClose').focus()
    } catch { toast('Report not found') }
  }
  // Open a result from GET /api/search. r.target says where: { view, id | report } or { file }.
  function openResult(r) {
    const t = r.target || {}
    if (t.report) return openReport(t.report)
    if (r.kind === 'skill') return openSkill(t.id)
    if (r.kind === 'session') return window.openSession ? openSession(t.id) : go('Sessions')
    return gsOpen(r) // memory and project files open their card on the Brain map
  }
  function actions() {
    const A = VIEWS.map((v, i) => ({ id: 'go:' + v, kind: 'go', title: 'Go to ' + v, hint: String(i + 1), run: () => go(v) }))
    A.push(
      { id: 'refresh', kind: 'do', title: 'Refresh data', hint: '', run: () => load(true) },
      { id: 'graph', kind: 'do', title: 'Refresh graph', hint: '', run: async () => {
        toast('Refreshing graph')
        try { await fetch('/api/graph/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); toast('Graph refreshed') } catch { toast('Graph refresh failed') }
      } },
      { id: 'report', kind: 'do', title: 'Open latest report', hint: '', run: openLatestReport },
      { id: 'resume', kind: 'do', title: 'Copy claude --resume of latest live session', hint: '', run: resumeLatest },
      { id: 'motion', kind: 'do', title: 'Toggle motion', hint: '', run: () => $('bMotion') && $('bMotion').click() },
      { id: 'standby', kind: 'do', title: 'Standby screen', hint: 'S', run: () => standby() },
      { id: 'brief', kind: 'do', title: 'Speak the briefing', hint: '', run: () => briefSpeak() },
      { id: 'keys', kind: 'do', title: 'Show keyboard shortcuts', hint: '?', run: keySheet },
      { id: 'display', kind: 'do', title: 'Display and accessibility settings', hint: '', run: a11yDialog })
    for (const s of data.skills?.skills || []) A.push({ id: 'skill:' + s.id, kind: 'skill', title: 'Run skill /' + s.id, hint: '', run: () => openSkill(s.id) })
    return A
  }

  const KINDS = ['skill', 'memory', 'project', 'session', 'report'] // group order in the palette
  const PER_KIND = 6
  const IKEY = 'aos.palette.items'
  const recentItems = () => { try { return JSON.parse(localStorage.getItem(IKEY)) || [] } catch { return [] } }
  const rememberItem = r => { try { localStorage.setItem(IKEY, JSON.stringify([r, ...recentItems().filter(x => x.path !== r.path)].slice(0, 6))) } catch {} }

  function palette() {
    if (document.querySelector('dialog.palette')) return
    const all = actions()
    const m = parts.modal({ title: 'Search everything', body: `<input class="field pal-q" type="text" placeholder="Search skills, memory, projects, sessions, reports, or type a command" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="palList" aria-label="Search everything"><ul class="pal-list" id="palList" role="listbox" aria-label="Results"></ul><p class="pal-foot"><kbd>Up</kbd><kbd>Down</kbd> move <kbd>Enter</kbd> open <kbd>Esc</kbd> close</p>` })
    m.el.classList.add('palette'); m.el.setAttribute('aria-modal', 'true')
    const input = m.el.querySelector('.pal-q'), list = m.el.querySelector('.pal-list')
    let rows = [], idx = 0, found = [], seq = 0, timer
    const paint = () => {
      let last = null, html = ''
      rows.forEach((r, i) => {
        if (r.group !== last) { last = r.group; html += `<li class="pal-g" role="presentation">${esc(r.group)}</li>` }
        html += `<li role="option" id="pal${i}" data-i="${i}" aria-selected="${i === idx}"><span class="t">${esc(r.title)}</span>${r.sub ? `<span class="s">${esc(r.sub)}</span>` : ''}<kbd${r.hint ? '' : ' hidden'}>${esc(r.hint || '')}</kbd></li>`
      })
      list.innerHTML = html || '<li class="none" role="presentation"><span class="t">No matches</span></li>'
      if (rows.length) { input.setAttribute('aria-activedescendant', 'pal' + idx); list.querySelector('#pal' + idx).scrollIntoView({ block: 'nearest' }) }
      else input.removeAttribute('aria-activedescendant')
    }
    const asRow = (r, group) => ({ id: 'item', group, title: r.title, sub: r.sub || r.path, run: () => { rememberItem(r); openResult(r) } })
    const build = () => {
      const v = input.value.trim()
      if (!v) {
        const rec = recent().map(id => all.find(a => a.id === id)).filter(Boolean)
        rows = [...recentItems().map(r => asRow(r, 'recent')), ...rec.map(a => ({ ...a, group: 'recent' })), ...all.filter(a => a.kind !== 'skill' && !rec.includes(a)).map(a => ({ ...a, group: 'command' }))]
      } else {
        rows = all.map(a => [a, fuzzy(v, a.title)]).filter(x => x[1] >= 0).sort((a, b) => b[1] - a[1]).slice(0, 6).map(x => ({ ...x[0], group: 'command' }))
        for (const k of KINDS) rows.push(...found.filter(f => f.kind === k).slice(0, PER_KIND).map(f => asRow(f, k)))
      }
      idx = Math.min(idx, Math.max(rows.length - 1, 0)); paint()
    }
    const pick = i => {
      const r = rows[i]; if (!r) return
      if (r.id !== 'item') remember(r.id)
      m.close(); r.run()
    }
    input.addEventListener('input', () => {
      idx = 0; build(); clearTimeout(timer)
      const v = input.value.trim()
      if (v.length < 2) { found = []; return }
      timer = setTimeout(async () => {
        const my = ++seq
        const r = await getJ('/api/search?q=' + encodeURIComponent(v) + '&limit=60').catch(() => [])
        if (my === seq) { found = r; build() }
      }, 140)
    })
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (rows.length) { idx = (idx + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length; paint() } }
      else if (e.key === 'Enter') { e.preventDefault(); pick(idx) }
    })
    list.addEventListener('click', e => { const li = e.target.closest('[data-i]'); if (li) pick(+li.dataset.i) })
    build(); input.focus()
  }
  window.shellPalette = palette
})()

// Shared tooltip: every [title] and every cut-off line of text shows one styled tip, on hover (short delay) and on
// keyboard focus. Titles move to data-ttl so the native popup does not show too; aria-description keeps them for screen readers.
// The 24 px Sessions icon buttons keep their own CSS tip (data-tip). SVG <title> (ring segments) stays native.
;(() => {
  const tt = document.createElement('div'); tt.id = 'tt'; tt.setAttribute('role', 'tooltip'); tt.hidden = true; document.body.append(tt)
  let cur = null, timer = 0
  const cut = t => { for (let e = t, n = 0; e && n < 3; e = e.parentElement, n++) if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow === 'ellipsis') return e }
  const find = t => {
    if (!(t instanceof HTMLElement) || t.closest('.ss-ib, #tt')) return null
    const el = t.closest('[title], [data-ttl]'), c = cut(t), v = el?.getAttribute('title')
    if (v != null) { el.removeAttribute('title'); el.dataset.ttl = v; if (v && el.getAttribute('aria-label') !== v) el.setAttribute('aria-description', v) }
    if (c && (!el || el.contains(c))) return [c, c.textContent.trim()] // a cut-off line shows its own full text first
    if (el?.dataset.ttl) return [el, el.dataset.ttl]
    return c ? [c, c.textContent.trim()] : null
  }
  const hide = () => { clearTimeout(timer); tt.hidden = true; cur = null }
  const show = (hit, wait) => {
    clearTimeout(timer)
    if (!hit) return hide()
    if (hit[0] === cur && !tt.hidden) return
    timer = setTimeout(() => {
      const [el, text] = hit; cur = el
      ;(el.closest('dialog[open]') || document.body).append(tt) // a modal sits in the top layer, so the tip must live inside it
      tt.textContent = text; tt.hidden = false
      const r = el.getBoundingClientRect(), w = tt.offsetWidth, h = tt.offsetHeight
      const x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8)
      const y = r.bottom + 6 + h > innerHeight - 8 ? r.top - h - 6 : r.bottom + 6
      tt.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
    }, wait)
  }
  document.addEventListener('pointerover', e => { if (e.pointerType !== 'touch') show(find(e.target), 350) })
  document.addEventListener('pointerout', e => { if (cur && !cur.contains(e.relatedTarget)) hide(); else if (!cur) clearTimeout(timer) })
  document.addEventListener('focusin', e => { if (e.target.matches?.(':focus-visible')) show(find(e.target), 0) })
  document.addEventListener('focusout', hide)
  document.addEventListener('pointerdown', hide, true)
  document.addEventListener('scroll', hide, true)
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !tt.hidden) hide() })
})()
