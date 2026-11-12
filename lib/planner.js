// Planner: todos, notes and local events in <data>/data/planner.json, plus an optional read-only calendar feed
// (any iCal address, for example Google Calendar "Secret address in iCal format"). No OAuth, no API key.
const fs = require('fs')
const path = require('path')

const LIMITS = { todos: 300, events: 500, text: 300, notes: 50000 }
const empty = () => ({ todos: [], notes: '', events: [], calendarUrl: '' })

function read(file) {
  try { return { ...empty(), ...JSON.parse(fs.readFileSync(file, 'utf8')) } } catch { return empty() }
}
function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2))
  fs.renameSync(file + '.tmp', file) // whole-file swap: a crash mid-write never leaves half a file
}

const str = (v, n) => String(v ?? '').slice(0, n)
const id = v => /^[a-z0-9]{1,24}$/i.test(v) ? v : Math.random().toString(36).slice(2, 10)
// Checks a client body and keeps only known fields. Throws on wrong shapes.
function clean(b) {
  if (!b || !Array.isArray(b.todos) || !Array.isArray(b.events) || typeof b.notes !== 'string') throw new Error('bad planner body')
  if (b.todos.length > LIMITS.todos || b.events.length > LIMITS.events) throw new Error('too many items')
  return {
    todos: b.todos.map(t => ({ id: id(t.id), text: str(t.text, LIMITS.text), done: !!t.done })).filter(t => t.text.trim()),
    notes: str(b.notes, LIMITS.notes),
    events: b.events.filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.date)).map(e => ({ id: id(e.id), title: str(e.title, LIMITS.text), date: e.date, time: /^\d{2}:\d{2}$/.test(e.time) ? e.time : '' }))
  }
}

// ---------- iCal ----------
// "20261106" is an all-day date; "20261106T090000Z" is UTC; without Z it is read as local time.
// ponytail: TZID is ignored (local time assumed). Fine when the feed and this PC share a time zone.
function icsDate(v) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v.trim())
  if (!m) return null
  const [, y, mo, d, h = '0', mi = '0', s = '0', z] = m
  const date = z ? new Date(Date.UTC(+y, mo - 1, +d, +h, +mi, +s)) : new Date(+y, mo - 1, +d, +h, +mi, +s)
  return { date, allDay: !m[4] }
}
const unescape = v => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

// Start times of one event inside [from, to). Expands FREQ DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT,
// UNTIL and weekly BYDAY; drops EXDATEs. ponytail: moved single instances (RECURRENCE-ID) are not applied.
function occurrences(start, rrule, from, to, exdates = new Set()) {
  if (!rrule) return start >= from && start < to ? [start] : []
  const r = Object.fromEntries(rrule.split(';').map(p => p.split('=')))
  const iv = Math.max(+r.INTERVAL || 1, 1), count = +r.COUNT || Infinity, until = r.UNTIL ? icsDate(r.UNTIL)?.date : null
  const byday = r.FREQ === 'WEEKLY' && r.BYDAY ? r.BYDAY.split(',').map(d => DAYS.indexOf(d.slice(-2))).filter(d => d >= 0).sort() : null
  const out = []
  let n = 0
  for (let i = 0; i < 5000; i++) {
    const base = new Date(start)
    if (r.FREQ === 'DAILY') base.setDate(base.getDate() + i * iv)
    else if (r.FREQ === 'WEEKLY') base.setDate(base.getDate() + i * iv * 7)
    else if (r.FREQ === 'MONTHLY') base.setMonth(base.getMonth() + i * iv)
    else if (r.FREQ === 'YEARLY') base.setFullYear(base.getFullYear() + i * iv)
    else return start >= from && start < to ? [start] : []
    const cands = byday ? byday.map(d => { const c = new Date(base); c.setDate(c.getDate() - c.getDay() + d); return c }).filter(c => c >= start) : [base]
    for (const c of cands) {
      if ((until && c > until) || n >= count || c >= to) return out
      n++
      if (c >= from && !exdates.has(+c)) out.push(c)
    }
  }
  return out
}

// Events from iCal text that start inside [from, to), sorted by start.
function parseICS(text, from, to) {
  const lines = String(text).replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
  const out = []
  let ev = null
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { ev = { ex: new Set() }; continue }
    if (line === 'END:VEVENT') {
      if (ev && ev.start && ev.status !== 'CANCELLED') for (const d of occurrences(ev.start.date, ev.rrule, from, to, ev.ex)) out.push({ title: ev.title || '(no title)', start: d.toISOString(), allDay: ev.start.allDay })
      ev = null; continue
    }
    if (!ev) continue
    const i = line.indexOf(':'); if (i < 0) continue
    const name = line.slice(0, i).split(';')[0].toUpperCase(), val = line.slice(i + 1)
    if (name === 'SUMMARY') ev.title = unescape(val).slice(0, LIMITS.text)
    else if (name === 'DTSTART') ev.start = icsDate(val)
    else if (name === 'RRULE') ev.rrule = val
    else if (name === 'STATUS') ev.status = val.trim().toUpperCase()
    else if (name === 'EXDATE') for (const v of val.split(',')) { const d = icsDate(v); if (d) ev.ex.add(+d.date) }
  }
  return out.sort((a, b) => a.start < b.start ? -1 : 1)
}

// Only https (webcal:// is the same address). Returns the normalised URL or throws.
function feedUrl(u) {
  const s = String(u || '').trim().replace(/^webcal:\/\//i, 'https://')
  const url = new URL(s)
  if (url.protocol !== 'https:') throw new Error('calendar address must start with https:// or webcal://')
  return url.href
}

const cache = new Map() // url -> { at, events, error }
async function feed(url, days = 14) {
  if (!url) return null
  const hit = cache.get(url)
  if (hit && Date.now() - hit.at < 10 * 60000) return hit
  const from = new Date(); from.setHours(0, 0, 0, 0)
  const to = new Date(from); to.setDate(to.getDate() + days)
  let r
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'follow' })
    if (!res.ok) throw new Error('calendar answered ' + res.status)
    const text = await res.text()
    if (text.length > 5e6) throw new Error('calendar file too large')
    r = { at: Date.now(), events: parseICS(text, from, to).slice(0, 200) }
  } catch (e) { r = { at: Date.now(), events: hit?.events || [], error: e.message } }
  cache.set(url, r)
  return r
}

module.exports = { read, write, clean, parseICS, occurrences, icsDate, feedUrl, feed, LIMITS }
