// /api/planner: todos, notes, local events and the optional calendar feed. Return true when handled.
const path = require('path')
const planner = require('./planner')

const FILE = path.join(require('./scan').DATA, 'data', 'planner.json')
// The page sees only the feed's host: the full iCal address is a secret that gives read access to the calendar.
const host = u => { try { return new URL(u).host } catch { return '' } }

module.exports = async function routes(req, res, url, ctx) {
  if (url.pathname === '/api/planner' && req.method === 'GET') {
    const d = planner.read(FILE), f = await planner.feed(d.calendarUrl)
    ctx.send(res, 200, { todos: d.todos, notes: d.notes, events: d.events, calendar: d.calendarUrl ? { host: host(d.calendarUrl), events: f.events, error: f.error || '' } : null })
    return true
  }
  if (url.pathname === '/api/planner' && req.method === 'POST') {
    const b = await ctx.jsonBody(req, res, 2e5)
    if (!b) return true
    const d = planner.read(FILE)
    planner.write(FILE, { ...planner.clean(b), calendarUrl: d.calendarUrl })
    ctx.send(res, 200, { ok: true })
    return true
  }
  if (url.pathname === '/api/planner/calendar' && req.method === 'POST') {
    const b = await ctx.jsonBody(req, res)
    if (!b) return true
    const u = b.url ? planner.feedUrl(b.url) : ''
    const d = planner.read(FILE)
    planner.write(FILE, { ...d, calendarUrl: u })
    const f = await planner.feed(u)
    ctx.send(res, 200, { calendar: u ? { host: host(u), events: f.events, error: f.error || '' } : null })
    return true
  }
  return false
}
