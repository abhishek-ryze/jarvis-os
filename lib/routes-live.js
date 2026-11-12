// Routes owned by the live work package. Return true when handled.
const cost = require('./cost')
const sessions = require('./sessions')
const errors = require('./errors')

// Log scans take seconds, so results are kept for a short time and one scan serves overlapping polls.
const memo = new Map() // key -> { at, p }
function cached(key, ms, fn) {
  const m = memo.get(key)
  if (m && Date.now() - m.at < ms) return m.p
  const p = fn()
  memo.set(key, { at: Date.now(), p })
  p.catch(() => memo.delete(key))
  return p
}

module.exports = async function routes(req, res, url, ctx) {
  if (url.pathname === '/api/live/pulse') {
    const c = ctx.config()
    const [windows, live] = await Promise.all([
      cached('windows', 60e3, () => cost.windows({ prices: c.prices, limits: c.limits })),
      cached('live', 20e3, () => sessions.liveSessions(c.prices)),
    ])
    const runs = [...[...ctx.runs.values()].reverse(), ...ctx.pastRuns].slice(0, 50)
    ctx.send(res, 200, { now: Date.now(), windows, sessions: live, runs })
    return true
  }
  if (url.pathname === '/api/errors') {
    const days = Number(url.searchParams.get('days') || 7)
    if (!Number.isInteger(days) || days < 1 || days > 30) { ctx.send(res, 400, { error: 'days must be a whole number from 1 to 30' }); return true }
    ctx.send(res, 200, await cached('errors' + days, 5 * 60e3, () => errors.scanErrors({ days })))
    return true
  }
  return false
}
