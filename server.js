// JARVIS local server. node server.js, then open http://127.0.0.1:4317
// node server.js --demo reads generated sample data (demo/) instead of your ~/.claude.
const http = require('http')
const fs = require('fs')
const path = require('path')
if (process.argv.includes('--demo')) {
  process.env.CLAUDE_CONFIG_DIR = path.join(__dirname, 'demo', 'claude-home')
  process.env.JARVIS_DATA = path.join(__dirname, 'demo', 'data')
  process.env.JARVIS_DEMO = '1'
  require('./scripts/make-demo').make()
}
const { spawn } = require('child_process')
const scan = require('./lib/scan')
const admin = require('./lib/skills-admin')
const artifacts = require('./lib/artifacts')
const cost = require('./lib/cost')
const sessions = require('./lib/sessions')
let coldCache = null // { at, report }, rebuilt after 10 min
const timeline = require('./lib/timeline')
const apps = require('./lib/apps')
const { families } = require('./lib/families')
const routines = require('./lib/routines')
const skillsStats = require('./lib/skills-stats')
const notes = require('./lib/notes')
const search = require('./lib/search')
const brainIndex = require('./lib/brain-index')
const runsLib = require('./lib/runs')
// Feature route modules: each exports async (req, res, url, ctx) => true when it handled the request.
const ROUTES = ['sessions', 'live', 'skills', 'routines', 'brain', 'shell', 'hub', 'runs', 'git', 'spend', 'planner'].map(n => require('./lib/routes-' + n))

const PORT = +process.env.PORT || +(process.argv.find(a => a.startsWith('--port=')) || '').slice(7) || 4317
const PUBLIC = path.join(__dirname, 'public')
const REPORTS = path.join(scan.DATA, 'reports')
const CONFIG = path.join(scan.DATA, 'config.json')
// Native installer path first, else `claude` on PATH.
const NATIVE = path.join(require('os').homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude')
const CLAUDE = process.env.CLAUDE_BIN || (fs.existsSync(NATIVE) ? NATIVE : 'claude')
const MODELS = ['haiku', 'sonnet', 'opus']
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const MODES = ['plan', 'acceptEdits', 'bypassPermissions']

const config = () => ({ permissionMode: 'plan', ...(() => { try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')) } catch { return {} } })() })

let skills = scan.scanSkills()
let usage = null
let usageFiles = null // per-file index, for lib/skills-stats
let indexing = null
function reindex() {
  if (indexing) return indexing
  indexing = scan.buildUsageIndex().then(files => {
    usageFiles = files
    skills = scan.scanSkills()
    usage = scan.summarize(files, skills.map(s => s.id))
  }).finally(() => { indexing = null })
  return indexing
}
reindex()

// Brain map: one cached index; /api/file and /api/open trust only its paths.
let graph = brainIndex.load()
let graphPaths = brainIndex.allowedSet(graph)
// the payload adds the trim prefixes and folder families (globe groups), both from config
function withFamilies(g) {
  const extra = config().trimPrefixes || [], counts = {}
  for (const n of g.nodes || []) counts[n.folder] = (counts[n.folder] || 0) + 1
  return { ...g, trim: [scan.HOME_PREFIX, ...extra], families: families(counts, f => scan.trimProject(f, extra)) }
}

const RUNS_LOG = path.join(scan.DATA, 'runs.log')
const runs = new Map() // id -> { skill, model, effort, status, started, ended, duration, exit, report }

const pastRuns = runsLib.loadPast(RUNS_LOG)

function startRun({ skill, model, effort, prompt, mode }) {
  const s = skills.find(x => x.id === skill)
  if (!s) throw new Error('unknown skill')
  return startRaw({ label: s.id, name: s.name, text: `/${s.id}${prompt ? ' ' + String(prompt).slice(0, 2000) : ''}`, model, effort, mode })
}

function startRaw({ label, name, text, model, effort, mode: asked }) {
  if (!MODELS.includes(model) || !EFFORTS.includes(effort)) throw new Error('bad model or effort')
  const mode = asked || config().permissionMode
  if (!MODES.includes(mode)) throw new Error('bad permissionMode in config.json')
  fs.mkdirSync(REPORTS, { recursive: true })
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}_${name}`
  const file = path.join(REPORTS, `${id}.md`)
  const out = fs.createWriteStream(file)
  out.write(`# ${label}\n\nmodel: ${model}, effort: ${effort}, permission mode: ${mode}\nstarted: ${new Date().toISOString()}\n\n---\n\n`)
  const child = spawn(CLAUDE, ['-p', text, '--model', model, '--effort', effort, '--permission-mode', mode], { cwd: __dirname, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const run = { id, skill: label, model, effort, mode, status: 'running', started: Date.now(), report: path.basename(file) }
  runs.set(id, run)
  const finish = (code, note) => {
    if (run.ended) return // 'error' and 'close' can both fire
    run.status = code === 0 ? 'done' : 'failed'
    run.ended = Date.now()
    run.duration = run.ended - run.started
    run.exit = code
    out.end(note || '')
    fs.appendFile(RUNS_LOG, [new Date(run.ended).toISOString(), label, model, effort, code, run.report].join('\t') + '\n', () => {})
  }
  child.stdout.pipe(out, { end: false })
  child.stderr.on('data', d => out.write(d))
  child.on('error', e => finish(-1, `\n\nerror: ${e.message}\n`))
  child.on('close', code => finish(code === null ? -1 : code))
  return run
}

const readReport = name => runsLib.readReport(REPORTS, name, [...runs.values(), ...pastRuns])

// Same-origin JSON only; returns the parsed body, or null after sending the error.
async function jsonBody(req, res, max = 1e4) {
  if (!/^application\/json/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'json only' }), null
  let body = ''
  for await (const c of req) { body += c; if (body.length > max) return send(res, 413, { error: 'too large' }), null }
  return JSON.parse(body)
}

const USER_SKILLS = path.join(scan.HOME, 'skills')
function skillFolder(id, archived) {
  const s = skills.find(x => x.id === id)
  if (archived) return id // archived skills are not in the list; the id is the folder name
  if (!s || s.source !== 'user') throw new Error('only user skills can be archived')
  return path.basename(path.dirname(s.file))
}

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(type === 'application/json' ? JSON.stringify(body) : body)
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }

const appName = () => String(config().name || 'Jarvis OS').slice(0, 40)
// header brand: the last word of a two-word name gets the accent ("Jarvis OS" -> JARVIS <b>OS</b>)
const brand = () => { const w = appName().replace(/[<>&"]/g, '').toUpperCase().split(/\s+/).filter(Boolean); return w.length > 1 ? w.slice(0, -1).join(' ') + ' <b>' + w.at(-1) + '</b>' : w.join('') }
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`])

http.createServer(async (req, res) => {
  // Blocks DNS rebinding: a page on another domain that resolves to 127.0.0.1 still sends its own Host.
  if (!HOSTS.has(req.headers.host)) return send(res, 403, { error: 'bad host' })
  const url = new URL(req.url, `http://${req.headers.host}`)
  try {
    const ctx = { send, jsonBody, config, startRaw, skills: () => skills, usage: () => usage, usageFiles: () => usageFiles, runs, pastRuns, graphPaths: () => graphPaths, artifacts, brainIndex, MODELS, EFFORTS, MODES }
    for (const r of ROUTES) if (await r(req, res, url, ctx)) return
    if (url.pathname === '/api/skills') return send(res, 200, { skills, permissionMode: config().permissionMode, models: MODELS, efforts: EFFORTS })
    if (url.pathname === '/api/usage') {
      if (url.searchParams.has('refresh')) await reindex()
      return send(res, 200, usage ? { ready: true, ...usage, cost: cost.costs(usage, config().prices) } : { ready: false })
    }
    if (url.pathname === '/api/windows') { const c = config(); return send(res, 200, await cost.windows({ prices: c.prices, limits: c.limits })) }
    if (url.pathname === '/api/sessions/live') return send(res, 200, { sessions: await sessions.liveSessions(config().prices) })
    if (url.pathname === '/api/cold-cache') {
      if (!coldCache || Date.now() - coldCache.at > 10 * 60000) coldCache = { at: Date.now(), report: await sessions.coldCacheReport(config().prices) }
      return send(res, 200, { cachedAt: new Date(coldCache.at).toISOString(), ...coldCache.report })
    }
    if (url.pathname === '/api/timeline') return send(res, 200, timeline.summarizeTimeline(await timeline.buildTimelineIndex(), Math.min(Math.max(+url.searchParams.get('days') || 30, 1), 3650)))
    if (url.pathname === '/api/apps') return send(res, 200, await apps.scanApps())
    if (url.pathname === '/api/search') return send(res, 200, search.search(url.searchParams.get('q') || '', Math.min(+url.searchParams.get('limit') || 20, 100)))
    if (url.pathname === '/api/memory') return send(res, 200, scan.scanMemory())
    if (url.pathname === '/api/graph') return send(res, 200, withFamilies(graph))
    if (req.method === 'POST' && url.pathname === '/api/graph/refresh') {
      if (!await jsonBody(req, res)) return
      graph = brainIndex.build(); graphPaths = brainIndex.allowedSet(graph)
      return send(res, 200, withFamilies(graph))
    }
    if (url.pathname === '/api/file') {
      try { return send(res, 200, brainIndex.readPreview(graphPaths, url.searchParams.get('path'))) }
      catch (e) { return send(res, e.code || 400, { error: e.message }) }
    }
    if (url.pathname === '/api/runs') return send(res, 200, [...[...runs.values()].reverse(), ...pastRuns].slice(0, 50))
    if (req.method === 'POST' && url.pathname === '/api/run') {
      const b = await jsonBody(req, res)
      return b && send(res, 200, startRun({ ...b, mode: skillsStats.pickMode(b.mode) }))
    }
    if (req.method === 'POST' && url.pathname === '/api/skill/add') {
      const b = await jsonBody(req, res)
      if (!b) return
      const prompt = String(b.prompt || '').trim().slice(0, 2000)
      if (!prompt) throw new Error('prompt required')
      return send(res, 200, startRaw({ label: 'skill-creator', name: 'skill-creator', text: `/skill-creator ${prompt}`, model: b.model || 'sonnet', effort: b.effort || 'medium' }))
    }
    if (req.method === 'POST' && (url.pathname === '/api/skill/archive' || url.pathname === '/api/skill/unarchive')) {
      const b = await jsonBody(req, res)
      if (!b) return
      const un = url.pathname.endsWith('/unarchive')
      const r = (un ? admin.unarchive : admin.archive)(USER_SKILLS, skillFolder(String(b.id), un))
      skills = scan.scanSkills()
      return send(res, 200, { ok: true, id: b.id, ...r })
    }
    if (url.pathname === '/api/report') return send(res, 200, readReport(url.searchParams.get('file') || ''))
    if (url.pathname === '/api/artifacts') return send(res, 200, artifacts.list(config(), url.searchParams.get('q'), url.searchParams.get('limit') || 50))
    if (url.pathname === '/api/open' && req.method === 'POST') {
      const b = await jsonBody(req, res)
      if (!b) return
      const p = b.path
      if (!(artifacts.isAllowed(config(), p) || brainIndex.isIndexed(graphPaths, p)) || !fs.existsSync(p)) return send(res, 403, { error: 'path not allowed' })
      // ponytail: explorer.exe is Windows only; use open or xdg-open if this ever runs elsewhere.
      spawn('explorer.exe', [path.resolve(p)], { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref()
      return send(res, 200, { opened: path.resolve(p) })
    }
    if (url.pathname === '/api/skills/stats') {
      const days = +url.searchParams.get('days') || 7
      if (days !== 7 && days !== 30) throw new Error('days must be 7 or 30')
      if (!usage) return send(res, 200, { ready: false })
      return send(res, 200, { ready: true, ...skillsStats.skillStats(usageFiles, usage, skills.map(s => s.id), { days, prices: config().prices }) })
    }
    if (url.pathname === '/api/notes') return send(res, 200, { notes: notes.readNotes(skills.map(s => s.id)) })
    if (req.method === 'POST' && url.pathname === '/api/notes/apply') {
      const b = await jsonBody(req, res)
      if (!b) return
      const s = skills.find(x => x.id === b.skill)
      if (!s) throw new Error('unknown skill')
      const n = notes.readNotes([s.id]).find(x => x.skill === s.id)
      if (!n) throw new Error('no notes for this skill')
      return send(res, 200, startRaw({ label: s.id, name: s.name, text: notes.applyPrompt(s.id, n.text), model: 'haiku', effort: 'low' }))
    }
    if (url.pathname === '/api/routines') return send(res, 200, await routines.scanRoutines(config()))
    if (url.pathname.startsWith('/reports/')) {
      const f = path.join(REPORTS, path.basename(url.pathname))
      return send(res, 200, fs.readFileSync(f, 'utf8'), 'text/plain; charset=utf-8')
    }
    const f = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^([\\/]|\.\.)+/, ''))
    if (!f.startsWith(PUBLIC) || !fs.existsSync(f)) return send(res, 404, { error: 'not found' })
    if (f.endsWith('.html')) return send(res, 200, fs.readFileSync(f, 'utf8').replace(/%APP_NAME%/g, appName().replace(/[<&"]/g, '')).replace(/%APP_BRAND%/g, brand()), TYPES['.html'])
    send(res, 200, fs.readFileSync(f), TYPES[path.extname(f)] || 'application/octet-stream')
  } catch (e) {
    send(res, 400, { error: e.message })
  }
}).listen(PORT, '127.0.0.1', () => console.log(`${appName()} on http://127.0.0.1:${PORT}${process.argv.includes('--demo') ? ' (demo data)' : ''}`))
