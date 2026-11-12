// Routes owned by the sessions work package. Return true when handled.
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const os = require('os')
const tr = require('./transcripts')

// Lists *.md plans: name, path, mtime (ms), size (bytes), heading (first "# " line within the first 4 KB). Newest first.
function listPlans(dir = path.join(require('./scan').HOME, 'plans')) {
  let names = []
  try { names = fs.readdirSync(dir).filter(n => n.toLowerCase().endsWith('.md')) } catch { return [] }
  return names.map(name => {
    const file = path.join(dir, name)
    try {
      const st = fs.statSync(file)
      const fd = fs.openSync(file, 'r'), buf = Buffer.alloc(Math.min(4096, st.size))
      fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd)
      const h = buf.toString('utf8').split(/\r?\n/).find(l => /^#{1,6}\s+\S/.test(l))
      return { name, path: file, mtime: st.mtimeMs, size: st.size, heading: h ? h.replace(/^#+\s+/, '').trim() : '' }
    } catch { return null }
  }).filter(Boolean).sort((a, b) => b.mtime - a.mtime)
}

module.exports = async function routes(req, res, url, ctx) {
  const p = url.pathname, q = url.searchParams
  if (p === '/api/plans' && req.method === 'GET') return ctx.send(res, 200, { plans: listPlans() }), true
  if (p === '/api/sessions' && req.method === 'GET') {
    const days = +q.get('days') || 7
    if (![7, 30, 90].includes(days)) throw new Error('days must be 7, 30 or 90')
    const rows = await tr.buildIndex()
    ctx.send(res, 200, tr.listSessions(rows, { days, project: String(q.get('project') || ''), q: String(q.get('q') || '').slice(0, 200), prices: ctx.config().prices }))
    return true
  }
  if (p === '/api/session' && req.method === 'GET') {
    const f = tr.fileOf(q.get('id'))
    if (!f) return ctx.send(res, 404, { error: 'unknown session' }), true
    const offset = Math.max(0, Math.floor(+q.get('offset') || 0)), limit = Math.min(Math.max(Math.floor(+q.get('limit') || 150), 1), 500)
    ctx.send(res, 200, await tr.transcript(f, { offset, limit, prices: ctx.config().prices }))
    return true
  }
  if (p === '/api/sessions/open' && req.method === 'POST') {
    const b = await ctx.jsonBody(req, res)
    if (!b) return true
    const dir = typeof b.path === 'string' && b.path ? path.resolve(b.path) : null
    let ok = false
    try { ok = !!dir && tr.cwdSet(await tr.buildIndex()).has(dir.toLowerCase()) && fs.statSync(dir).isDirectory() } catch {}
    if (!ok) return ctx.send(res, 403, { error: 'path not allowed' }), true
    // ponytail: explorer.exe is Windows only, same as server.js /api/open.
    spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref()
    ctx.send(res, 200, { opened: dir })
    return true
  }
  return false
}
module.exports.listPlans = listPlans
