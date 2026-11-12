// Routes owned by the run history panel. Return true when handled.
const path = require('path')
const runs = require('./runs')
const REPORTS = path.join(require('./scan').DATA, 'reports')

module.exports = async function routes(req, res, url, ctx) {
  if (url.pathname === '/api/runs/history') return ctx.send(res, 200, runs.history(REPORTS, ctx.runs.values(), ctx.pastRuns)), true
  return false
}
