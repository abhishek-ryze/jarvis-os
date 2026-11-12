// Session list, transcripts and subagent lanes from ~/.claude/projects/<dir>/<id>.jsonl. No dependencies.
const fs = require('fs')
const path = require('path')
const readline = require('readline')
const { HOME } = require('./scan')
const { costOf } = require('./cost')

const ROOT = path.join(HOME, 'projects')
const CACHE = path.join(require('./scan').CACHE_DIR, 'sessions-index.json')
const DAY = 864e5
const KEEP_DAYS = 90 // the widest list window; WoW needs only 14
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HAY_MAX = 20000
const zero = () => ({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0 })
const tok = u => ({ input: u.input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, output: u.output_tokens || 0 })
const add = (a, b) => { for (const k in b) a[k] = (a[k] || 0) + b[k]; return a }
const total = t => t.input + t.cacheWrite + t.cacheRead + t.output
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return d } }

// Top-level session files only: <root>/<dir>/<id>.jsonl. Subagent files live one level deeper.
function topFiles(root = ROOT) {
  const out = []
  let dirs = []
  try { dirs = fs.readdirSync(root, { withFileTypes: true }) } catch { return out }
  for (const d of dirs) {
    if (!d.isDirectory()) continue
    let names = []
    try { names = fs.readdirSync(path.join(root, d.name)) } catch { continue }
    for (const n of names) if (n.endsWith('.jsonl') && UUID.test(n.slice(0, -6))) out.push({ file: path.join(root, d.name, n), dir: d.name, id: n.slice(0, -6) })
  }
  return out
}

// Typed prompt text, or null for tool_result echoes.
function userText(msg) {
  const c = msg && msg.content
  if (typeof c === 'string') return c
  if (Array.isArray(c) && !c.some(b => b.type === 'tool_result')) return c.map(b => b.text || '').join('')
  return null
}
// "<command-name>/x</command-name><command-args>y</command-args>" -> "/x y"
function commandText(text) {
  const n = /<command-name>\/?([^<]+)<\/command-name>/.exec(text)
  if (!n) return null
  const a = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)
  return ('/' + n[1].trim() + (a && a[1].trim() ? ' ' + a[1].trim() : ''))
}
const toolPath = i => i && (i.file_path || i.notebook_path || i.path) || null

async function lines(file, fn) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.includes('"type":"assistant"') && !line.includes('"type":"user"') && !line.includes('"custom-title"')) continue
    let e
    try { e = JSON.parse(line) } catch { continue }
    fn(e)
  }
}

// One pass over one session file. byDay[utcDay][model] holds tokens so $ is priced at request time.
async function parseSession(file) {
  const seen = new Set(), hay = new Set()
  const r = { cwd: null, title: null, prompt: null, cmd: null, start: null, end: null, turns: 0, errors: 0, tokens: zero(), byDay: {}, models: [] }
  await lines(file, e => {
    if (e.type === 'custom-title' && e.customTitle) { r.title = e.customTitle; hay.add(e.customTitle.toLowerCase()); return }
    if (e.isSidechain) return
    if (e.cwd && !r.cwd) r.cwd = e.cwd
    if (e.timestamp) { const t = Date.parse(e.timestamp); if (t) { r.start = r.start || t; r.end = t } }
    const m = e.message
    if (e.type === 'user') {
      if (Array.isArray(m && m.content)) for (const b of m.content) if (b.type === 'tool_result' && b.is_error) r.errors++
      if (e.isMeta || e.isCompactSummary) return
      const text = userText(m)
      if (text === null) return
      if (text.startsWith('<')) { const c = commandText(text); if (c) { r.cmd = r.cmd || c; hay.add(c.toLowerCase()) } return }
      r.turns++
      r.prompt = r.prompt || text.trim().replace(/\s+/g, ' ').slice(0, 160)
      hay.add(text.toLowerCase().slice(0, 4000))
      return
    }
    if (!m) return
    for (const b of Array.isArray(m.content) ? m.content : []) {
      if (b.type !== 'tool_use') continue
      hay.add(String(b.name).toLowerCase())
      const p = toolPath(b.input)
      if (p) hay.add(String(p).toLowerCase())
    }
    if (!m.usage || !m.id || seen.has(m.id)) return
    seen.add(m.id)
    const t = tok(m.usage), day = (e.timestamp || '').slice(0, 10), model = m.model || 'unknown'
    add(r.tokens, t)
    const d = r.byDay[day] = r.byDay[day] || {}
    add(d[model] = d[model] || zero(), t)
    if (!r.models.includes(model) && model !== '<synthetic>') r.models.push(model)
  })
  r.prompt = r.prompt || r.cmd
  delete r.cmd
  r.hay = [...hay].join('\n').slice(0, HAY_MAX)
  return r
}

let mem = null, building = null
// Rows for every session file touched in the last 90 days. Re-parses only files whose mtime or size changed.
function buildIndex({ root = ROOT, cacheFile = CACHE, now = Date.now() } = {}) {
  if (building) return building
  building = (async () => {
    if (!mem || mem.root !== root) mem = { root, files: readJson(cacheFile, { files: {} }).files || {} }
    const files = {}
    let changed = false
    for (const f of topFiles(root)) {
      let st
      try { st = fs.statSync(f.file) } catch { continue }
      if (st.mtimeMs < now - KEEP_DAYS * DAY) continue
      const key = path.relative(root, f.file), prev = mem.files[key]
      if (prev && prev.mtime === st.mtimeMs && prev.size === st.size) { files[key] = prev; continue }
      files[key] = { mtime: st.mtimeMs, size: st.size, id: f.id, dir: f.dir, ...(await parseSession(f.file)) }
      changed = true
    }
    if (changed || Object.keys(files).length !== Object.keys(mem.files).length) {
      try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify({ files })) } catch {}
    }
    mem.files = files
    return Object.values(files)
  })().finally(() => { building = null })
  return building
}

const utcDay = (now, back) => new Date(now - back * DAY).toISOString().slice(0, 10)
const costDays = (row, days, prices) => {
  let usd = 0, t = zero()
  for (const [d, byModel] of Object.entries(row.byDay)) {
    if (days && !days.has(d)) continue
    for (const [m, x] of Object.entries(byModel)) { usd += costOf(x, m, prices); add(t, x) }
  }
  return { usd, tokens: t }
}
const pct = (a, b) => b ? (a - b) / b : null

// List view: filtered rows plus KPIs (this week vs the 7 days before, by UTC day; sessions counted by start day), top 5 and per-project table.
function listSessions(rows, { days = 7, project = '', q = '', prices, now = Date.now() } = {}) {
  const wk = new Set(Array.from({ length: 7 }, (_, i) => utcDay(now, i)))
  const prev = new Set(Array.from({ length: 7 }, (_, i) => utcDay(now, i + 7)))
  const kpi = { sessions: [0, 0], tokens: [0, 0], usd: [0, 0] }
  const enriched = rows.map(r => {
    const all = costDays(r, null, prices), w = costDays(r, wk, prices), p = costDays(r, prev, prices)
    const sd = r.start ? new Date(r.start).toISOString().slice(0, 10) : ''
    if (wk.has(sd)) kpi.sessions[0]++
    if (prev.has(sd)) kpi.sessions[1]++
    kpi.tokens[0] += total(w.tokens); kpi.tokens[1] += total(p.tokens)
    kpi.usd[0] += w.usd; kpi.usd[1] += p.usd
    return { r, usd: all.usd, weekUsd: w.usd }
  })
  const out = r => ({ id: r.id, project: r.dir, cwd: r.cwd, title: r.title, prompt: r.prompt, start: r.start, end: r.end, duration: r.start && r.end ? r.end - r.start : 0, turns: r.turns, tokens: r.tokens, errors: r.errors, models: r.models })
  const since = now - days * DAY
  const inDays = enriched.filter(x => x.r.end >= since)
  const projects = {}
  for (const { r, usd } of inDays) {
    const p = projects[r.dir] = projects[r.dir] || { project: r.dir, cwd: r.cwd, sessions: 0, tokens: 0, usd: 0, last: 0 }
    p.sessions++; p.tokens += total(r.tokens); p.usd += usd; p.last = Math.max(p.last, r.end || 0)
    if (r.cwd) p.cwd = r.cwd
  }
  const terms = String(q).toLowerCase().split(/\s+/).filter(Boolean)
  const list = inDays.filter(x => (!project || x.r.dir === project) && terms.every(t => x.r.hay.includes(t)))
  return {
    days, now,
    kpi: Object.fromEntries(Object.entries(kpi).map(([k, [a, b]]) => [k, { week: a, prev: b, delta: pct(a, b) }])),
    top: enriched.filter(x => x.weekUsd > 0).sort((a, b) => b.weekUsd - a.weekUsd).slice(0, 5).map(x => ({ ...out(x.r), usd: x.usd, weekUsd: x.weekUsd })),
    projects: Object.values(projects).sort((a, b) => b.usd - a.usd),
    sessions: list.sort((a, b) => b.r.end - a.r.end).map(x => ({ ...out(x.r), usd: x.usd })),
  }
}

// Every cwd seen in an indexed session. POST /api/sessions/open accepts only these.
const cwdSet = rows => new Set(rows.filter(r => r.cwd).map(r => path.resolve(r.cwd).toLowerCase()))

// The session file for an id, found by listing (never built from the input).
function fileOf(id, root = ROOT) {
  if (!UUID.test(String(id))) return null
  const f = topFiles(root).find(x => x.id === id)
  return f || null
}

const clip = (s, n) => (s = String(s ?? '')).length > n ? s.slice(0, n) + ' ...' : s
const resultText = c => typeof c === 'string' ? c : Array.isArray(c) ? c.map(b => b.text || (b.type === 'image' ? '[image]' : '')).join('\n') : ''
function brief(name, i) {
  if (!i || typeof i !== 'object') return ''
  const v = i.file_path || i.notebook_path || i.command || i.pattern || i.url || i.query || i.skill || i.description || i.prompt || i.path
  return clip((v ? String(v) : JSON.stringify(i)).replace(/\s+/g, ' '), 140)
}

// Transcript items: user turns, assistant messages (text + tool cards + tokens), in file order.
async function parseTranscript(file) {
  const items = [], byMsg = new Map(), tools = new Map(), info = { cwd: null, title: null }
  await lines(file, e => {
    if (e.type === 'custom-title' && e.customTitle) info.title = e.customTitle
    if (e.isSidechain) return
    if (e.cwd && !info.cwd) info.cwd = e.cwd
    const m = e.message, ts = e.timestamp ? Date.parse(e.timestamp) : null
    if (e.type === 'user') {
      if (Array.isArray(m && m.content)) for (const b of m.content) {
        if (b.type !== 'tool_result') continue
        const t = tools.get(b.tool_use_id)
        if (!t) continue
        const text = resultText(b.content)
        t.result = clip(text.split('\n').slice(0, 14).join('\n'), 1600)
        t.lines = text.split('\n').length
        t.err = !!b.is_error
      }
      if (e.isMeta || e.isCompactSummary) return
      let text = userText(m)
      if (text === null) return
      if (text.startsWith('<')) text = commandText(text)
      if (text) items.push({ k: 'user', ts, text: clip(text, 8000) })
      return
    }
    if (!m || e.type !== 'assistant') return
    let it = m.id && byMsg.get(m.id)
    if (!it) {
      it = { k: 'ai', ts, model: m.model, texts: [], tools: [], tokens: m.usage ? tok(m.usage) : null, err: !!e.isApiErrorMessage }
      items.push(it)
      if (m.id) byMsg.set(m.id, it)
    }
    for (const b of Array.isArray(m.content) ? m.content : []) {
      // some logs repeat the blocks of a message (resumed or forked sessions)
      if (b.type === 'text' && b.text && !it.texts.includes(clip(b.text, 8000))) it.texts.push(clip(b.text, 8000))
      if (b.type === 'tool_use' && !tools.has(b.id)) {
        const t = { id: b.id, name: b.name, brief: brief(b.name, b.input), input: clip(JSON.stringify(b.input, null, 2), 3000), result: null, err: false }
        it.tools.push(t); tools.set(b.id, t)
      }
    }
  })
  return { ...info, items: items.filter(i => i.k === 'user' || i.texts.length || i.tools.length) }
}

// Subagent runs of a session: <dir>/<id>/subagents/agent-*.jsonl plus .meta.json.
async function subagents(file, prices) {
  const dir = path.join(file.slice(0, -6), 'subagents')
  let names = []
  try { names = fs.readdirSync(dir).filter(n => n.endsWith('.jsonl')) } catch { return [] }
  const out = []
  for (const n of names) {
    const meta = readJson(path.join(dir, n.slice(0, -6) + '.meta.json'), {})
    const seen = new Set(), t = zero()
    let start = null, end = null, usd = 0, model = null
    await lines(path.join(dir, n), e => {
      if (e.timestamp) { const x = Date.parse(e.timestamp); start = start || x; end = x }
      const m = e.message
      if (e.type !== 'assistant' || !m || !m.usage || !m.id || seen.has(m.id)) return
      seen.add(m.id); model = m.model || model
      const x = tok(m.usage); add(t, x); usd += costOf(x, m.model, prices)
    })
    out.push({ agent: n.slice(0, -6), type: meta.agentType || null, description: meta.description || null, toolUseId: meta.toolUseId || null, model, start, end, duration: start && end ? end - start : 0, tokens: t, usd })
  }
  return out.sort((a, b) => a.start - b.start)
}

const tcache = new Map() // file -> { key, items }, last few transcripts
async function transcript(f, { offset = 0, limit = 150, prices } = {}) {
  const st = fs.statSync(f.file), key = st.mtimeMs + ':' + st.size
  let c = tcache.get(f.file)
  if (!c || c.key !== key) {
    c = { key, ...await parseTranscript(f.file), subs: await subagents(f.file, prices) }
    tcache.set(f.file, c)
    if (tcache.size > 4) tcache.delete(tcache.keys().next().value)
  }
  const ts = c.items.map(i => i.ts).filter(Boolean)
  return { id: f.id, project: f.dir, cwd: c.cwd, title: c.title, start: ts[0] || null, end: ts[ts.length - 1] || null, total: c.items.length, offset, items: c.items.slice(offset, offset + limit), subagents: c.subs }
}

module.exports = { ROOT, UUID, topFiles, parseSession, buildIndex, listSessions, cwdSet, fileOf, parseTranscript, subagents, transcript }
