// Routes owned by the spend work package. Return true when handled.
const fs = require('fs')
const path = require('path')
const cost = require('./cost')

const CONFIG = path.join(require('./scan').DATA, 'config.json')
let memo = null // { at, p }: the 30 day scan takes seconds, so overlapping polls share one

setTimeout(() => cost.spendByProject().catch(() => {}), 4000).unref() // warm the per-file cache so the first panel load is fast

module.exports = async function routes(req, res, url, ctx) {
  if (url.pathname === '/api/spend/projects') {
    if (!memo || Date.now() - memo.at > 60000) memo = { at: Date.now(), p: cost.spendByProject({ prices: ctx.config().prices }) }
    ctx.send(res, 200, await memo.p)
    return true
  }
  if (url.pathname === '/api/config/limits') {
    if (req.method === 'POST') {
      const b = await ctx.jsonBody(req, res)
      if (!b) return true
      let limits
      try { limits = cost.validLimits(b) } catch (e) { ctx.send(res, 400, { error: e.message }); return true }
      let cur = {}
      try { cur = JSON.parse(fs.readFileSync(CONFIG, 'utf8')) } catch {}
      const tmp = CONFIG + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify({ ...cur, limits, limitsSet: true }, null, 2) + '\n')
      fs.renameSync(tmp, CONFIG)
    }
    const c = ctx.config()
    ctx.send(res, 200, { ...c.limits, limitsSet: !!c.limitsSet })
    return true
  }
  return false
}
