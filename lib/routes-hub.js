// Routes owned by the hub work package: artifacts (thumb, hide), micro apps, Recos. Return true when handled.
const fs = require('fs')
const path = require('path')
const microapps = require('./microapps')
const recos = require('./recos')
const notes = require('./notes')
const apps = require('./apps')
const sessions = require('./sessions')
const tools = require('./tools')
const transcripts = require('./transcripts')

// Tools from launch.json in every session cwd, newest session first.
async function toolList() {
  const last = {}, dirs = []
  for (const r of await transcripts.buildIndex()) if (r.cwd) { const k = r.cwd.toLowerCase(); if (!(k in last)) dirs.push(r.cwd); last[k] = Math.max(last[k] || 0, r.end || 0) }
  return tools.list(dirs).map(t => ({ ...t, last: last[t.dir.toLowerCase()] || 0 })).sort((a, b) => b.last - a.last)
}

const IMG = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' } // no svg: it can carry script
const MAX_THUMB = 8e6
const MAX_PICKS = 20

let cold = null // { at, report } cold-cache report, rebuilt after 10 min
let recoCache = null // { at, list }

async function recoList(ctx) {
  if (recoCache && Date.now() - recoCache.at < 60000) return recoCache.list
  const cfg = ctx.config()
  if (!cold || Date.now() - cold.at > 10 * 60000) cold = { at: Date.now(), report: await sessions.coldCacheReport(cfg.prices).catch(() => null) }
  const skills = ctx.skills()
  const list = recos.build({
    apps: await apps.scanApps().catch(() => null), usage: ctx.usage(), skills,
    notes: notes.readNotes(skills.map(s => s.id)), cold: cold.report, files: recos.fromFiles(),
  })
  recoCache = { at: Date.now(), list }
  return list
}

module.exports = async function routes(req, res, url, ctx) {
  const { send, jsonBody } = ctx
  const p = url.pathname

  if (req.method === 'GET' && p === '/api/artifacts') {
    const cfg = ctx.config(), hidden = ctx.artifacts.readHidden()
    const out = ctx.artifacts.list(cfg, url.searchParams.get('q'), url.searchParams.get('limit') || 50, hidden)
    return send(res, 200, { ...out, hiddenCount: hidden.size }), true
  }
  if (req.method === 'GET' && p === '/api/artifacts/thumb') {
    const f = url.searchParams.get('path')
    const type = IMG[path.extname(String(f)).toLowerCase()]
    if (!type || !ctx.artifacts.isAllowed(ctx.config(), f)) return send(res, 403, { error: 'path not allowed' }), true
    let st
    try { st = fs.statSync(f) } catch { return send(res, 404, { error: 'not found' }), true }
    if (!st.isFile() || st.size > MAX_THUMB) return send(res, 413, { error: 'too large' }), true
    return send(res, 200, fs.readFileSync(f), type), true
  }
  if (req.method === 'POST' && p === '/api/artifacts/hide') {
    const b = await jsonBody(req, res)
    if (!b) return true
    if (!ctx.artifacts.isAllowed(ctx.config(), b.path)) return send(res, 403, { error: 'path not allowed' }), true
    const set = ctx.artifacts.setHidden(b.path, b.hidden !== false)
    return send(res, 200, { ok: true, hiddenCount: set.size }), true
  }

  if (req.method === 'GET' && p === '/api/microapps') {
    const cfg = ctx.config()
    return send(res, 200, { apps: microapps.list(cfg), dirs: microapps.dirsOf(cfg) }), true
  }
  if (req.method === 'GET' && p.startsWith('/apps/')) {
    let name = ''
    try { name = decodeURIComponent(p.slice(6)) } catch { /* bad escape stays empty */ }
    const f = microapps.resolve(ctx.config(), name)
    if (!f) return send(res, 404, { error: 'not found' }), true
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': 'sandbox allow-scripts' })
    res.end(fs.readFileSync(f))
    return true
  }
  if (req.method === 'POST' && p === '/api/microapps/add') {
    const b = await jsonBody(req, res)
    if (!b) return true
    const text = String(b.text || '').trim()
    if (!text || text.length > 2000) return send(res, 400, { error: 'describe the app in 1 to 2000 characters' }), true
    return send(res, 200, ctx.startRaw({ label: 'micro-app', name: 'micro-app', text: microapps.addPrompt(text), model: 'sonnet', effort: 'medium', mode: 'acceptEdits' })), true
  }

  if (req.method === 'GET' && p === '/api/tools') {
    const list = await toolList()
    const ports = [...new Set(list.map(t => t.port))], up = new Set()
    await Promise.all(ports.map(async p => { if (await tools.probe(p)) up.add(p) }))
    const shared = p => list.filter(t => t.port === p).length > 1
    // a port check cannot tell which of several tools on one port is up, so those say "busy"
    return send(res, 200, { tools: list.map(({ exe, args, ...t }) => ({ ...t, state: !up.has(t.port) ? 'off' : shared(t.port) ? 'busy' : 'on', startable: exe === 'node' })) }), true
  }
  if (req.method === 'POST' && p === '/api/tools/start') {
    const b = await jsonBody(req, res)
    if (!b) return true
    const t = (await toolList()).find(x => x.id === b.id) // only entries read from disk, never a command from the body
    if (!t) return send(res, 404, { error: 'unknown tool' }), true
    return send(res, 200, await tools.start(t)), true
  }

  if (req.method === 'GET' && p === '/api/recos')return send(res, 200, { recos: await recoList(ctx) }), true
  if (req.method === 'POST' && p === '/api/recos/apply') {
    const b = await jsonBody(req, res)
    if (!b) return true
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > MAX_PICKS) return send(res, 400, { error: `pick 1 to ${MAX_PICKS} recommendations` }), true
    const list = await recoList(ctx)
    const known = new Set(list.map(r => r.id))
    const picks = b.items.filter(i => i && typeof i.id === 'string' && known.has(i.id)).map(i => ({ id: i.id, comment: typeof i.comment === 'string' ? i.comment : '' }))
    if (!picks.length) return send(res, 400, { error: 'no known recommendation selected' }), true
    return send(res, 200, ctx.startRaw({ label: 'recos', name: 'recos', text: recos.applyPrompt(list, picks), model: 'sonnet', effort: 'medium' })), true
  }
  return false
}
