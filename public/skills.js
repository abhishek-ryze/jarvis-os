// Skills page: usage stats (P3.1, S3 upgrade), model x effort matrix, and fix-backlog notes (P8.1).
// Loaded after index.html's main script; uses its globals ($, esc, fmt, ago, usd, getJ, none, utcDay, sum,
// data, LAZY, loadRuns, archive, kpi) and parts.js.
(function () {
  const SORTS = [['runs', 'Most used'], ['tokensPerWeek', 'Tokens/week'], ['tokensPerRun', 'Tokens/run'], ['usdPerWeek', '$/week'], ['usdPerRun', '$/run'], ['fires7', 'Fires 7 d'], ['fires30', 'Fires 30 d'], ['usd30', '$ 30 d'], ['lastUsed', 'Last used']]
  const st = { days: 7, show: 'used', sort: 'runs', sel: null, res: null, open: false, rowsAll: false, neverAll: false, notesAll: false }
  const LIM = 8 // list panels show 8 rows, then a "N more" control
  // sort value; lastUsed is an ISO time, never used sorts last
  const val = x => st.sort === 'lastUsed' ? (x.lastUsed ? Date.parse(x.lastUsed) : -1) : x[st.sort] ?? -1
  const dollars = v => v === null ? '--' : usd(v)

  const chip = (k, v, label) => `<button type="button" class="chip" aria-pressed="${st[k] === v}" data-k="${k}" data-v="${v}">${label}</button>`

  // ---------- model x effort matrix (opened from the deck settings panel) ----------
  // cur = { model, effort }; pick(model, effort) is called on a cell click or Enter.
  window.skMatrix = function (cur, pick) {
    const { models, efforts } = data.skills
    const body = `<table class="mx" role="grid"><thead><tr><td></td>${efforts.map(e => `<th scope="col">${esc(e)}</th>`).join('')}</tr></thead><tbody>${models.map(m =>
      `<tr><th scope="row" class="m-${esc(m)}">${esc(m)}</th>${efforts.map(e => `<td><button type="button" class="mxc m-${esc(m)}" data-m="${esc(m)}" data-e="${esc(e)}" aria-pressed="${cur.model === m && cur.effort === e}">${esc(m)}<br>${esc(e)}</button></td>`).join('')}</tr>`).join('')}</tbody></table>
      <p class="label">Click a cell to set both model and effort. Arrow keys move, Esc closes.</p>`
    const mod = parts.modal({ title: 'Model x effort', body })
    const cells = [...mod.el.querySelectorAll('.mxc')], cols = efforts.length
    mod.el.addEventListener('click', e => { const c = e.target.closest('.mxc'); if (!c) return; mod.close(); pick(c.dataset.m, c.dataset.e) })
    mod.el.addEventListener('keydown', e => {
      const i = cells.indexOf(document.activeElement); if (i < 0) return
      const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key]
      if (!d) return
      e.preventDefault(); cells[Math.max(0, Math.min(cells.length - 1, i + d))].focus()
    })
    ;(cells.find(c => c.getAttribute('aria-pressed') === 'true') || cells[0]).focus()
  }

  // ---------- stats ----------
  const sizeOf = (r, usdKnown) => usdKnown ? r.usdPerWeek : r.tokensPerWeek

  function bubbles(rows, usdKnown) {
    const W = 640, H = 260, L = 48, B = 28, T = 12
    const pts = rows.filter(r => r.runs && r.tokensPerRun > 0)
    if (!pts.length) return '<p class="ph">No runs in this window, so no chart.</p>'
    const size = r => sizeOf(r, usdKnown)
    const maxS = Math.max(...pts.map(size), 1e-9)
    const maxR = Math.max(...pts.map(r => r.runs)), ys = pts.map(r => Math.log10(r.tokensPerRun))
    const y0 = Math.min(...ys) - .2, y1 = Math.max(...ys) + .2
    const X = r => L + 18 + Math.sqrt(r.runs / maxR) * (W - L - 54)
    const Y = r => H - B - (Math.log10(r.tokensPerRun) - y0) / (y1 - y0) * (H - B - T)
    const R = r => 5 + Math.sqrt(size(r) / maxS) * 26
    const big = [...pts].sort((a, b) => size(b) - size(a))
    const short = r => r.id.split(':').pop()
    const CH = 7.2 // mono 12px glyph width
    const dots = big.map(r => {
      const sel = st.sel === r.id, inside = short(r).length * CH <= 2 * R(r) - 6
      return `<g class="bub${sel ? ' sel' : ''}" data-sel="${esc(r.id)}" tabindex="0" role="button" aria-label="${esc(r.id)}, ${r.runs} runs">
        <circle cx="${X(r).toFixed(1)}" cy="${Y(r).toFixed(1)}" r="${R(r).toFixed(1)}"><title>${esc(r.id)}: ${r.runs} runs, ${fmt(Math.round(r.tokens))} tokens, ${usdKnown ? dollars(r.usdPerWeek) + '/wk' : 'no $'}</title></circle>
        ${inside ? `<text x="${X(r).toFixed(1)}" y="${(Y(r) + 4).toFixed(1)}" text-anchor="middle">${esc(short(r))}</text>` : ''}</g>`
    }).join('')
    // bubbles too small for a label inside: name the biggest few beside them
    const outside = big.filter(r => short(r).length * CH > 2 * R(r) - 6).slice(0, 4)
    const names = outside.map(r => { const left = X(r) > W - 150; return `<text class="out" x="${(left ? X(r) - R(r) - 4 : X(r) + R(r) + 4).toFixed(1)}" y="${(Y(r) + 4).toFixed(1)}" text-anchor="${left ? 'end' : 'start'}">${esc(short(r))}</text>` }).join('')
    return `<svg class="bubsvg" viewBox="0 0 ${W} ${H}" width="100%" role="group" aria-label="Bubble chart of used skills. Across: runs. Up: tokens per run. Bubble area: ${usdKnown ? 'est. $ per week' : 'tokens per week'}. The list below has the same numbers.">
      <line x1="${L}" y1="${H - B}" x2="${W - 8}" y2="${H - B}" stroke="#1f6f80"/><line x1="${L}" y1="${T}" x2="${L}" y2="${H - B}" stroke="#1f6f80"/>
      <text class="ax" x="${W - 8}" y="${H - 8}" text-anchor="end">runs, up to ${maxR}</text>
      <text class="ax" x="${L + 6}" y="${T + 10}">tokens per run (log)</text>
      ${dots}${names}</svg>`
  }

  const canArchive = id => data.skills?.skills.find(s => s.id === id)?.source === 'user'

  const more = (key, n, all, what) => n > 0 || all ? `<button type="button" class="btn sm sk-moreb" data-tog="${key}" aria-expanded="${all}">${all ? 'Show fewer' : n + ' more ' + what}</button>` : ''

  function render() {
    const r = st.res, root = $('skStats')
    if (!r) return
    const rows = r.rows.filter(x => st.show === 'unused' ? x.unused30 : st.show === 'all' || x.runs).sort((a, b) => val(b) - val(a) || b.runs - a.runs)
    const win = Array.from({ length: st.days }, (_, i) => data.usage?.byDay?.[utcDay(i)]).filter(Boolean).reduce((s, t) => s + sum(t), 0)
    const note = r.usdKnown ? 'Bubble area = est. $ per week (blended model rate).' : 'Bubble area = tokens per week, because no prices are set in config.json, so $ shows --.'
    const top = Math.max(...rows.map(x => Math.max(val(x), 0)), 1)
    const shown = st.rowsAll ? rows : rows.slice(0, LIM), never = st.neverAll ? r.never : r.never.slice(0, LIM)
    const body = `${bubbles(r.rows, r.usdKnown)}
      <p class="t-meta">${note} Click a bubble to find its row.</p>
      <ul id="skRows">${shown.map(x => `<li class="row${st.sel === x.id ? ' sel' : ''}" data-sel="${esc(x.id)}"><span class="t-body" title="${esc(x.id)}">/${esc(x.id)}</span><b class="t-num">${st.sort === 'runs' || st.sort.startsWith('fires') ? x[st.sort] : st.sort === 'lastUsed' ? (x.lastUsed ? ago(x.lastUsed) : 'never') : st.sort.startsWith('usd') ? dollars(x[st.sort]) : fmt(Math.round(x[st.sort]))}</b>
        <small class="t-meta">${fmt(Math.round(x.tokens))} tokens · ${dollars(x.usdPerWeek)}/wk · ${fmt(Math.round(x.tokensPerRun))} tok/run · fires ${x.fires7} (7 d) ${x.fires30} (30 d) · ${dollars(x.usd30)} (30 d) · ${x.lastUsed ? 'last ' + ago(x.lastUsed) : 'never used'}${x.unused30 ? ' · <em class="sk-unused">unused 30 d</em>' : ''}</small>
        <i style="--w:${((x[st.sort] ?? 0) / top * 100).toFixed(1)}%"></i></li>`).join('') || none('No skills match.')}</ul>
      ${more('rowsAll', rows.length - LIM, st.rowsAll && rows.length > LIM, 'skills')}
      <h2 class="sub">Retire candidates <span>installed, 0 runs in 30 days, ${r.never.length} skills</span></h2>
      <ul id="skNever">${never.map(id => `<li class="row"><span title="${esc(id)}">/${esc(id)}</span>${canArchive(id) ? `<button type="button" class="btn" data-retire="${esc(id)}" aria-label="Archive /${esc(id)}">Archive</button>` : '<small>plugin skill, not archivable here</small>'}</li>`).join('') || none('Every skill ran in the last 30 days.')}</ul>
      ${more('neverAll', r.never.length - LIM, st.neverAll && r.never.length > LIM, 'candidates')}`
    root.innerHTML = `<h2>Skill stats <span>last ${st.days} days, from your logs</span></h2>
      <div class="kpis">${kpi([[r.total.runs, 'skill runs'], [fmt(Math.round(r.total.tokens)), 'tokens, est.'], [dollars(r.total.usd), 'est. $ API'], [win ? Math.round(r.total.tokens / win * 100) + '%' : '--', `of ${fmt(win)} tokens in Tokens panel`]])}</div>
      <div class="skbar"><div class="opts" role="group" aria-label="Window">${chip('days', 7, '7 days')}${chip('days', 30, '30 days')}</div>
        <div class="opts" role="group" aria-label="Show">${chip('show', 'used', 'Used')}${chip('show', 'all', 'All')}${chip('show', 'unused', 'Unused 30 d')}
        <label class="sr" for="skSort">Sort by</label><select id="skSort">${SORTS.map(([k, l]) => `<option value="${k}"${k === st.sort ? ' selected' : ''}>Sort: ${l}</option>`).join('')}</select></div>
        <button type="button" class="btn sm" data-tog="open" aria-expanded="${st.open}">${st.open ? 'Hide chart and table' : 'Show chart and table'}</button></div>
      ${st.open ? body : ''}`
  }

  async function loadStats() {
    try {
      const r = await getJ('/api/skills/stats?days=' + st.days)
      if (!r.ready) { $('skStats').innerHTML = '<h2>Skill stats</h2><p class="ph">Indexing session logs.</p>'; setTimeout(loadStats, 3000); return false }
      st.res = r; render(); return true
    } catch { $('skStats').innerHTML = '<h2>Skill stats</h2><p class="ph">Read failed. Reopen the page to retry.</p>'; return false }
  }

  function select(id) {
    st.sel = st.sel === id ? null : id; st.open = true; st.rowsAll = true; render()
    document.querySelector(`#skRows [data-sel="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  $('skStats').addEventListener('click', async e => {
    const rt = e.target.closest('[data-retire]')
    if (rt) { rt.disabled = true; await archive(rt.dataset.retire); return loadStats() }
    const t = e.target.closest('[data-tog]')
    if (t) { st[t.dataset.tog] = !st[t.dataset.tog]; render(); return document.querySelector(`#skStats [data-tog="${t.dataset.tog}"]`)?.focus() }
    const s = e.target.closest('[data-sel]'); if (s) return select(s.dataset.sel)
    const b = e.target.closest('[data-k]'); if (!b) return
    st[b.dataset.k] = b.dataset.k === 'days' ? +b.dataset.v : b.dataset.v
    if (b.dataset.v === 'unused') st.open = true
    const f = b.dataset.k === 'days' ? loadStats() : (render(), Promise.resolve())
    f.then(() => document.querySelector(`#skStats [data-k="${b.dataset.k}"][data-v="${b.dataset.v}"]`)?.focus())
  })
  $('skStats').addEventListener('keydown', e => {
    const g = e.target.closest?.('g[data-sel]')
    if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(g.dataset.sel); document.querySelector(`#skStats g[data-sel="${CSS.escape(g.dataset.sel)}"]`)?.focus() }
  })
  $('skNotes').addEventListener('click', e => { if (e.target.closest('[data-tog="notesAll"]')) { st.notesAll = !st.notesAll; loadNotes() } })
  $('skStats').addEventListener('change', e => {
    if (e.target.id !== 'skSort') return
    st.sort = e.target.value; render(); $('skSort').focus()
  })


  // ---------- deck: used skills first, the rest behind a "N more" control (renderDeck in index.html reads renderDeck.all) ----------
  $('deck').addEventListener('click', e => { if (!e.target.closest('[data-more]')) return; renderDeck.all = !renderDeck.all; renderDeck(); document.querySelector('#deck [data-more]')?.focus() })

  // ---------- notes (P8.1) ----------
  function renderNotes(list) {
    const root = $('skNotes')
    root.innerHTML = `<h2>Fix notes <span>${list.length}</span></h2><p class="status" id="noteStatus" aria-live="polite"></p><div class="deck" id="noteDeck"></div>`
    const deck = $('noteDeck')
    if (!list.length) { deck.innerHTML = '<p class="ph">No notes yet. Notes are files named notes/&lt;skill&gt;.md in this project folder.</p>'; return }
    for (const n of st.notesAll ? list : list.slice(0, 4)) {
      const body = document.createElement('div')
      body.className = 'mt'; body.style.whiteSpace = 'pre-wrap'; body.textContent = n.text.length > 600 ? n.text.slice(0, 600) + '...' : n.text
      const apply = parts.button('Apply', { go: true })
      if (!n.skill) { apply.disabled = true; apply.title = 'No installed skill matches this file name' }
      apply.addEventListener('click', async () => {
        apply.disabled = true
        try {
          const res = await fetch('/api/notes/apply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ skill: n.skill }) }).then(r => r.json())
          if (res.error) throw new Error(res.error)
          $('noteStatus').textContent = `Started /${n.skill} on haiku, effort low. Report: ${res.report}`
          loadRuns()
        } catch (e) { $('noteStatus').textContent = 'Could not start: ' + e.message }
        apply.disabled = false
      })
      const c = parts.card({ name: n.skill ? '/' + n.skill : n.file, meta: n.skill ? `updated ${ago(n.mtime)}` : `no matching skill, ${ago(n.mtime)}`, body })
      c.append(apply)
      deck.append(c)
    }
    if (list.length > 4) { const m = document.createElement('div'); m.className = 'sk-moreb-wrap'; m.innerHTML = more('notesAll', list.length - 4, st.notesAll, 'notes'); root.append(m) }
  }

  async function loadNotes() {
    try { renderNotes((await getJ('/api/notes')).notes) } catch { $('skNotes').innerHTML = '<h2>Fix notes</h2><p class="ph">Read failed. Reopen the page to retry.</p>' }
  }

  // Own errors are handled here, so index.html's lazy() fallback never touches another page's list.
  LAZY.Skills = async () => { await Promise.all([loadStats(), loadNotes()]) }
  // Notes change while the app is open (a /note run), so re-read them on every later visit.
  $('nav').addEventListener('click', e => { if (e.target.closest('[data-go="Skills"]') && $('noteDeck')) loadNotes() })
})()
