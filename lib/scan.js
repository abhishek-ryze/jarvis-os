// Reads skills, token usage and memory from ~/.claude. No dependencies.
const fs = require('fs')
const path = require('path')
const os = require('os')
const readline = require('readline')

// CLAUDE_CONFIG_DIR is Claude Code's own override; demo mode points it at demo/claude-home.
const HOME = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(os.homedir(), '.claude')
// Where this app keeps its own state (cache, reports, runs.log, config.json, data). Demo mode uses demo/data.
const DATA = process.env.JARVIS_DATA ? path.resolve(process.env.JARVIS_DATA) : path.join(__dirname, '..')
const CACHE_DIR = path.join(DATA, 'cache')
const CACHE = path.join(CACHE_DIR, 'usage-index.json')
// Claude names project folders by the full path with every non-alphanumeric char as '-'; this is the home part.
const HOME_PREFIX = os.homedir().replace(/[^a-zA-Z0-9]/g, '-') + '-'
// Drops the home folder (or else the drive), then any extra prefixes (config.json trimPrefixes).
const trimProject = (p, extra = []) => extra.reduce((s, x) => s.startsWith(x) ? s.slice(x.length) : s, p.startsWith(HOME_PREFIX) ? p.slice(HOME_PREFIX.length) : p.replace(/^[A-Za-z]--/, ''))
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return d } }

// Flat key: value pairs, plus `>` / `|` block scalars made of indented lines. Nested YAML is not needed.
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const out = {}
  if (!m) return out
  let block = null
  for (const line of m[1].split(/\r?\n/)) {
    if (block && /^\s+\S/.test(line)) { out[block] = (out[block] ? out[block] + ' ' : '') + line.trim(); continue }
    block = null
    const kv = /^([\w-]+):\s*(.*)$/.exec(line)
    if (!kv) continue
    if (/^[>|][-+]?$/.test(kv[2])) { block = kv[1]; out[block] = ''; continue }
    out[kv[1]] = kv[2].replace(/^["']|["']$/g, '')
  }
  return out
}

function skillsIn(dir, source, prefix) {
  let names = []
  try { names = fs.readdirSync(dir) } catch { return [] }
  return names.flatMap(n => {
    const file = path.join(dir, n, 'SKILL.md')
    if (!fs.existsSync(file)) return []
    const fm = frontmatter(fs.readFileSync(file, 'utf8'))
    return [{
      id: prefix ? `${prefix}:${fm.name || n}` : (fm.name || n),
      name: fm.name || n,
      description: fm.description || '',
      model: fm.model || null,
      source, file,
    }]
  })
}

function scanSkills() {
  const own = skillsIn(path.join(HOME, 'skills'), 'user', null)
  const installed = readJson(path.join(HOME, 'plugins', 'installed_plugins.json'), {}).plugins || {}
  const enabled = readJson(path.join(HOME, 'settings.json'), {}).enabledPlugins || {}
  const fromPlugins = Object.entries(installed)
    .filter(([key]) => enabled[key])
    .flatMap(([key, v]) => {
      const entry = Array.isArray(v) ? v[0] : v
      const plugin = key.split('@')[0]
      return skillsIn(path.join(entry.installPath, 'skills'), plugin, plugin)
    })
  return [...own, ...fromPlugins]
}

const tok = u => ({
  input: u.input_tokens || 0,
  cacheWrite: u.cache_creation_input_tokens || 0,
  cacheRead: u.cache_read_input_tokens || 0,
  output: u.output_tokens || 0,
})
const add = (a, b) => { for (const k in b) a[k] = (a[k] || 0) + b[k]; return a }
const zero = () => ({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0 })

// A real user turn is a typed prompt, not a tool_result echo.
function userText(msg) {
  const c = msg && msg.content
  if (typeof c === 'string') return c
  if (Array.isArray(c) && !c.some(b => b.type === 'tool_result')) return c.map(b => b.text || '').join('')
  return null
}

// One pass over one jsonl file. Usage is repeated on every content-block line, so dedupe on message id.
async function parseFile(file) {
  const seen = new Set()
  const r = { total: zero(), byDay: {}, byModel: {}, skills: [], first: null, last: null, turns: 0, title: null }
  let active = null // skill whose estimate is accruing until the next typed prompt
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.includes('"type":"assistant"') && !line.includes('"type":"user"') && !line.includes('"custom-title"')) continue
    let e
    try { e = JSON.parse(line) } catch { continue }
    if (e.type === 'custom-title' && e.customTitle) r.title = e.customTitle
    if (e.timestamp) { r.first = r.first || e.timestamp; r.last = e.timestamp }
    if (e.type === 'user') {
      if (e.isMeta || e.isCompactSummary) continue // injected skill bodies, image notes, summaries
      const text = userText(e.message)
      if (text === null) continue
      const cmd = /<command-name>\/?([^<]+)<\/command-name>/.exec(text)
      active = cmd ? { skill: cmd[1].trim(), ts: e.timestamp, via: 'slash', tokens: zero() } : null
      if (active) r.skills.push(active)
      if (!cmd && !text.startsWith('<')) r.turns++
      continue
    }
    const m = e.message
    if (!m) continue
    for (const b of m.content || []) {
      if (b.type === 'tool_use' && b.name === 'Skill' && b.input && b.input.skill) {
        active = { skill: b.input.skill, ts: e.timestamp, via: 'tool', tokens: zero() }
        r.skills.push(active)
      }
    }
    if (!m.usage || !m.id || seen.has(m.id)) continue
    seen.add(m.id)
    const t = tok(m.usage)
    add(r.total, t)
    const day = (e.timestamp || '').slice(0, 10)
    add(r.byDay[day] = r.byDay[day] || zero(), t)
    add(r.byModel[m.model] = r.byModel[m.model] || zero(), t)
    if (active) add(active.tokens, t)
  }
  return r
}

function listJsonl(dir, out = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) listJsonl(p, out)
    else if (d.name.endsWith('.jsonl')) out.push(p)
  }
  return out
}

// Re-parse only files whose mtime or size changed since the last run.
async function buildUsageIndex(onProgress) {
  const root = path.join(HOME, 'projects')
  const old = readJson(CACHE, { files: {} }).files
  const files = {}
  const all = listJsonl(root)
  let done = 0
  for (const f of all) {
    const st = fs.statSync(f)
    const key = path.relative(root, f)
    const prev = old[key]
    files[key] = prev && prev.mtime === st.mtimeMs && prev.size === st.size
      ? prev
      : { mtime: st.mtimeMs, size: st.size, sub: key.includes(`${path.sep}subagents${path.sep}`), ...(await parseFile(f)) }
    if (onProgress && ++done % 50 === 0) onProgress(done, all.length)
  }
  fs.mkdirSync(path.dirname(CACHE), { recursive: true })
  fs.writeFileSync(CACHE, JSON.stringify({ files }))
  return files
}

// Roll the per-file index up into what the panels show.
function summarize(files, skillIds) {
  const known = new Set(skillIds)
  const byDay = {}, byModel = {}, byProject = {}, bySkill = {}
  const sessions = []
  for (const [key, f] of Object.entries(files)) {
    const project = key.split(path.sep)[0]
    for (const [d, t] of Object.entries(f.byDay)) add(byDay[d] = byDay[d] || zero(), t)
    for (const [m, t] of Object.entries(f.byModel)) add(byModel[m] = byModel[m] || zero(), t)
    add(byProject[project] = byProject[project] || zero(), f.total)
    for (const s of f.skills) {
      if (!known.has(s.skill)) continue // drops built-ins such as /compact and /effort
      const row = bySkill[s.skill] = bySkill[s.skill] || { runs: 0, last: null, tokens: zero() }
      row.runs++
      row.last = !row.last || s.ts > row.last ? s.ts : row.last
      add(row.tokens, s.tokens)
    }
    if (!f.sub) sessions.push({ id: path.basename(key, '.jsonl'), project, title: f.title, first: f.first, last: f.last, turns: f.turns, tokens: f.total })
  }
  sessions.sort((a, b) => (b.last || '').localeCompare(a.last || ''))
  return { byDay, byModel, byProject, bySkill, sessions }
}

// The main memory: the project memory folder whose MEMORY.md has the most entries.
function mainMemoryDir(home = HOME) {
  let best = null, most = -1
  for (const p of (() => { try { return fs.readdirSync(path.join(home, 'projects')) } catch { return [] } })()) {
    const dir = path.join(home, 'projects', p, 'memory')
    let n = -1
    try { n = (fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf8').match(/^- \[/gm) || []).length } catch {}
    if (n > most) { most = n; best = dir }
  }
  return best
}

function scanMemory() {
  const dir = mainMemoryDir()
  if (!dir) return { dir: '', count: 0, entries: [] }
  const index = fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf8')
  const entries = [...index.matchAll(/^- \[([^\]]+)\]\(([^)]+)\)\s*[:\u2014-]?\s*(.*)$/gm)].map(([, title, file, hook]) => {
    const p = path.join(dir, file)
    let body = '', fm = {}, mtime = null
    try { body = fs.readFileSync(p, 'utf8'); fm = frontmatter(body); mtime = fs.statSync(p).mtime.toISOString() } catch {}
    // Find the project folder: the first path in the hook or body that holds a HANDOFF.md or DESIGN_STATE.md.
    let state = null
    const d = findStateDir(`${hook}\n${body}`)
    if (d) {
      const kind = ['DESIGN_STATE', 'HANDOFF'].find(k => fs.existsSync(path.join(d, `${k}.md`)))
      const sp = path.join(d, `${kind}.md`)
      state = { kind, path: sp, exists: true, mtime: fs.statSync(sp).mtime.toISOString() }
    }
    return { title, file, hook, type: (fm.type || (/^\s*type:\s*(\w+)/m.exec(body) || [])[1] || 'other'), mtime, links: (body.match(/\[\[[^\]]+\]\]/g) || []).length, state }
  })
  return { dir, count: entries.length, entries }
}

// First folder named in the text (or a parent of it) that holds a DESIGN_STATE.md or HANDOFF.md.
function findStateDir(text) {
  for (const [raw] of text.matchAll(/(?:[A-Z]:\\|Downloads\\|~\/|\/(?:Users|home)\/)[^;,()`\n]+/g)) {
    let dir = raw.startsWith('Downloads') ? path.join(os.homedir(), raw) : raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(2)) : raw
    dir = dir.replace(/\s+first\b.*$/, '').replace(/[.\s]+$/, '')
    // ponytail: tries the path and its parents; paths with words glued after them may still miss.
    for (let d = dir; d.length > 3; d = path.dirname(d)) {
      if (['DESIGN_STATE', 'HANDOFF'].some(k => fs.existsSync(path.join(d, `${k}.md`)))) return d
    }
  }
  return null
}

const lsMd = dir => { try { return fs.readdirSync(dir).filter(n => n.endsWith('.md')).map(n => path.join(dir, n)) } catch { return [] } }

// File graph for the Brain map: metadata only, never file bodies.
function scanGraph(cap = 400, home = HOME) {
  const nodes = new Map() // lowercased path -> node
  const text = new Map()
  const addNode = (file, type, label, folder) => {
    const key = file.toLowerCase()
    if (nodes.has(key)) return nodes.get(key)
    let st
    try { st = fs.statSync(file); text.set(key, fs.readFileSync(file, 'utf8')) } catch { return null }
    const n = { id: file, label, type, folder, mtime: st.mtime.toISOString(), size: st.size }
    nodes.set(key, n)
    return n
  }
  for (const f of ['CLAUDE.md', 'skill-routing.md']) addNode(path.join(home, f), 'rule', f, '~/.claude')
  for (const f of lsMd(path.join(home, 'design'))) addNode(f, 'design', path.basename(f), 'design')
  for (const s of skillsIn(path.join(home, 'skills'), 'user', null)) addNode(s.file, 'skill', s.name, 'skills')
  const memDirs = (() => { try { return fs.readdirSync(path.join(home, 'projects')) } catch { return [] } })()
  for (const p of memDirs) {
    for (const f of lsMd(path.join(home, 'projects', p, 'memory'))) {
      addNode(f, 'memory', path.basename(f) === 'MEMORY.md' ? `MEMORY (${trimProject(p)})` : path.basename(f, '.md'), p)
    }
  }

  const edges = new Map()
  const link = (a, b, kind) => {
    if (!a || !b || a === b) return
    const k = [a.id, b.id].sort().join('|')
    if (!edges.has(k)) edges.set(k, { source: a.id, target: b.id, kind })
  }
  // Memory points to project state files: add those files as nodes first.
  for (const n of [...nodes.values()].filter(n => n.type === 'memory')) {
    const d = findStateDir(text.get(n.id.toLowerCase()))
    if (!d) continue
    for (const k of ['HANDOFF', 'DESIGN_STATE', 'BRIEF']) {
      const p = addNode(path.join(d, `${k}.md`), 'project', `${path.basename(d)} / ${k}.md`, path.basename(d))
      link(n, p, 'state')
    }
  }

  const all = [...nodes.values()]
  const byName = new Map() // basename without .md, lowercased -> nodes
  for (const n of all) {
    const names = [path.basename(n.id, '.md').toLowerCase()]
    if (n.type === 'skill') names.push(n.label.toLowerCase())
    for (const nm of names) byName.set(nm, [...(byName.get(nm) || []), n])
  }
  const skillNodes = all.filter(n => n.type === 'skill')
  // CLAUDE.md is left out: most mentions mean a project's own CLAUDE.md.
  const mentionable = all.filter(n => (n.type === 'rule' || n.type === 'design') && path.basename(n.id) !== 'CLAUDE.md')
  for (const n of all) {
    const body = text.get(n.id.toLowerCase())
    const dir = path.dirname(n.id)
    for (const [, raw] of body.matchAll(/\[\[([^\]|#]+)/g)) {
      const hits = byName.get(raw.trim().replace(/\.md$/i, '').toLowerCase()) || []
      link(n, hits.find(h => path.dirname(h.id) === dir) || hits[0], 'wiki')
    }
    for (const [, raw] of body.matchAll(/\]\(([^)\s#]+\.md)\)/gi)) {
      link(n, nodes.get(path.resolve(dir, decodeURIComponent(raw)).toLowerCase()), 'link')
    }
    if (n.type === 'rule') {
      for (const s of skillNodes) if (body.includes('`' + s.label + '`') || body.includes(':' + s.label + '`')) link(n, s, 'skill')
    }
    // Plain mentions of rule and design files by name, e.g. "skill-routing.md".
    for (const m of mentionable) if (m !== n && body.includes(path.basename(m.id))) link(n, m, 'mention')
  }

  // ponytail: over the cap, keep rules, design and skills, then the newest files.
  const rank = { rule: 0, design: 1, skill: 2, project: 3, memory: 4 }
  const kept = all.sort((a, b) => rank[a.type] - rank[b.type] || b.mtime.localeCompare(a.mtime)).slice(0, cap)
  const ids = new Set(kept.map(n => n.id))
  return { nodes: kept, edges: [...edges.values()].filter(e => ids.has(e.source) && ids.has(e.target)) }
}

module.exports = { scanSkills, buildUsageIndex, summarize, scanMemory, mainMemoryDir, scanGraph, parseFile, frontmatter, HOME, DATA, CACHE_DIR, HOME_PREFIX, trimProject, listJsonl }
