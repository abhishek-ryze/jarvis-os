// Routes owned by the routines work package. Return true when handled.
const timeline = require('./timeline')

let cache = null
// The index only re-parses changed logs, but still stats every one; reuse it for 60 s.
async function index() {
  if (!cache || Date.now() - cache.at > 60e3) cache = { at: Date.now(), files: await timeline.buildTimelineIndex() }
  return cache.files
}

module.exports = async function routes(req, res, url, ctx) {
  // GET /api/timeline/diff?path=&day=YYYY-MM-DD: Edit / MultiEdit / Write inputs for one logged file and day.
  if (req.method === 'GET' && url.pathname === '/api/timeline/diff') {
    const p = url.searchParams.get('path') || '', day = url.searchParams.get('day') || ''
    if (!p || p.length > 1000 || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return ctx.send(res, 400, { error: 'path and day (YYYY-MM-DD) required' }), true
    const d = await timeline.fileDiff(await index(), p, day)
    return ctx.send(res, d ? 200 : 404, d || { error: 'path not in the edit logs for that day' }), true
  }
  return false
}
