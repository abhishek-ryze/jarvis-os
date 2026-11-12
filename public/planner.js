// Planner page and the Home "Today" panel. Data: GET/POST /api/planner (lib/routes-planner.js).
;(() => {
  const $ = id => document.getElementById(id)
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const uid = () => Math.random().toString(36).slice(2, 10)
  let d = null, cal = null, timer = 0

  const ymd = t => { const x = new Date(t); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
  const dayLabel = t => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  const status = t => { const s = $('plStat'); if (s) s.textContent = t }

  // Local events and feed events in one list from today, sorted. Local ones carry an id so they can be removed.
  function upcoming(days = 14) {
    const from = new Date(); from.setHours(0, 0, 0, 0)
    const to = new Date(from); to.setDate(to.getDate() + days)
    const local = d.events.map(e => ({ id: e.id, title: e.title, start: new Date(`${e.date}T${e.time || '00:00'}`), allDay: !e.time }))
    const feed = (cal?.events || []).map(e => ({ title: e.title, start: new Date(e.start), allDay: e.allDay, feed: true }))
    return [...local, ...feed].filter(e => e.start >= from && e.start < to).sort((a, b) => a.start - b.start)
  }
  const when = e => e.allDay ? 'all day' : e.start.toTimeString().slice(0, 5)

  function save() {
    clearTimeout(timer)
    status('saving')
    timer = setTimeout(async () => {
      try {
        const r = await fetch('/api/planner', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ todos: d.todos, notes: d.notes, events: d.events }) })
        if (!r.ok) throw 0
        status('saved')
      } catch { status('Save failed. Your last change is not stored.') }
    }, 400)
  }

  function drawTodos() {
    const open = d.todos.filter(t => !t.done).length
    $('plTodoN').textContent = d.todos.length ? `${open} open` : ''
    $('plTodos').innerHTML = d.todos.length ? d.todos.map(t => `<li class="row pl-todo${t.done ? ' done' : ''}" data-id="${t.id}"><label><input type="checkbox"${t.done ? ' checked' : ''}><span>${esc(t.text)}</span></label><button type="button" class="x" aria-label="Remove task: ${esc(t.text)}">×</button></li>`).join('')
      : '<li class="row"><span class="ph">no tasks</span></li>'
  }
  function drawEvents() {
    const list = upcoming()
    let last = ''
    $('plEvents').innerHTML = list.length ? list.map(e => {
      const day = ymd(e.start), head = day !== last ? `<li class="pl-day">${esc(dayLabel(e.start))}</li>` : ''
      last = day
      return head + `<li class="row pl-ev-row"><span><b>${when(e)}</b> ${esc(e.title)}</span>${e.feed ? '<span class="ph">feed</span>' : `<button type="button" class="x" data-ev="${e.id}" aria-label="Remove event: ${esc(e.title)}">×</button>`}</li>`
    }).join('') : '<li class="row"><span class="ph">nothing in the next 14 days</span></li>'
    $('plCalSt').textContent = cal ? (cal.error ? `${cal.host}: ${cal.error}` : `${cal.host}, ${cal.events.length} ${cal.events.length === 1 ? 'event' : 'events'}`) : 'not connected'
    $('plCalBtn').textContent = cal ? 'Disconnect' : 'Connect'
    $('plCalIn').hidden = !!cal
    $('plCalIn').previousElementSibling.hidden = !!cal
  }
  function drawToday() {
    const today = ymd(Date.now()), ev = upcoming(1).filter(e => ymd(e.start) === today), todo = d.todos.filter(t => !t.done)
    $('plTodayN').textContent = `${ev.length} ${ev.length === 1 ? 'event' : 'events'}, ${todo.length} open`
    const rows = [...ev.slice(0, 4).map(e => `<li class="row"><span><b>${when(e)}</b> ${esc(e.title)}</span></li>`),
      ...todo.slice(0, 4).map(t => `<li class="row"><span>${esc(t.text)}</span><span class="ph">to do</span></li>`)]
    $('plTodayList').innerHTML = rows.join('') || '<li class="row"><span class="ph">nothing planned today</span></li>'
  }
  const draw = () => { drawTodos(); drawEvents(); drawToday(); if (document.activeElement !== $('plNotes')) $('plNotes').value = d.notes }

  async function load() {
    const r = await fetch('/api/planner').then(r => r.json())
    if (r.error) throw new Error(r.error)
    d = { todos: r.todos, notes: r.notes, events: r.events }; cal = r.calendar
    draw()
  }

  $('plTodoForm').addEventListener('submit', e => {
    e.preventDefault()
    const v = $('plTodoIn').value.trim(); if (!v || !d) return
    d.todos.push({ id: uid(), text: v, done: false }); $('plTodoIn').value = ''
    drawTodos(); drawToday(); save()
  })
  $('plTodos').addEventListener('change', e => {
    const li = e.target.closest('li[data-id]'), t = li && d.todos.find(x => x.id === li.dataset.id); if (!t) return
    t.done = e.target.checked; li.classList.toggle('done', t.done)
    $('plTodoN').textContent = `${d.todos.filter(t => !t.done).length} open`; drawToday(); save()
  })
  $('plTodos').addEventListener('click', e => {
    const b = e.target.closest('.x'), li = b?.closest('li[data-id]'); if (!li) return
    const i = d.todos.findIndex(x => x.id === li.dataset.id)
    d.todos.splice(i, 1); drawTodos(); drawToday(); save()
    ;($('plTodos').querySelectorAll('li')[i]?.querySelector('.x') || $('plTodoIn')).focus() // keep keyboard focus in the list
  })
  $('plClear').addEventListener('click', () => { if (!d) return; d.todos = d.todos.filter(t => !t.done); drawTodos(); drawToday(); save() })
  $('plNotes').addEventListener('input', e => { if (!d) return; d.notes = e.target.value; save() })

  $('plEvForm').addEventListener('submit', e => {
    e.preventDefault(); if (!d) return
    d.events.push({ id: uid(), title: $('plEvT').value.trim(), date: $('plEvD').value, time: $('plEvH').value })
    $('plEvT').value = ''; $('plEvH').value = ''
    drawEvents(); drawToday(); save()
  })
  $('plEvents').addEventListener('click', e => {
    const b = e.target.closest('[data-ev]'); if (!b) return
    d.events = d.events.filter(x => x.id !== b.dataset.ev); drawEvents(); drawToday(); save()
    $('plEvT').focus()
  })
  $('plCalForm').addEventListener('submit', async e => {
    e.preventDefault()
    const url = cal ? '' : $('plCalIn').value.trim(); if (!cal && !url) return
    $('plCalSt').textContent = url ? 'connecting' : 'disconnecting'
    try {
      const r = await fetch('/api/planner/calendar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) }).then(r => r.json())
      if (r.error) throw new Error(r.error)
      cal = r.calendar; $('plCalIn').value = ''
      drawEvents(); drawToday()
    } catch (err) { $('plCalSt').textContent = err.message || 'Connect failed' }
  })

  $('plEvD').value = ymd(Date.now())
  window.planner = { load }
  load().catch(() => { $('plTodayList').innerHTML = '<li class="row"><span class="ph">planner read failed</span></li>' })
})()
