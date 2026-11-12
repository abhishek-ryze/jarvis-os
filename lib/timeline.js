// What changed when: file edits made by Claude, grouped per local day and row.
const fs = require('fs')
const path = require('path')
const readline = require('readline')
const { HOME } = require('./scan')

const CACHE = path.join(require('./scan').CACHE_DIR, 'timeline-index.json')
const TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const MARKERS = ['DESIGN_STATE.md', 'HANDOFF.md', 'PLAN.md', '.git']
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return d } }
const pad = n => String(n).padStart(2, '0')
const localDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function listJsonl(dir, out = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) listJsonl(p, out)
    else if (d.name.endsWith('.jsonl')) out.push(p)
  }
  return out
}

// One entry per edit tool_use: [timestamp, file path]. With wantInputs: [timestamp, path, input, tool] (for diffs).
async function parseEdits(file, wantInputs) {
  const edits = []
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.includes('"tool_use"')) continue
    let e
    try { e = JSON.parse(line) } catch { continue }
    const content = e.type === 'assistant' && e.message && e.message.content
    if (!Array.isArray(content)) continue
    for (const b of content) {
      if (b.type !== 'tool_use' || !TOOLS.has(b.name) || !b.input) continue
      const p = b.input.file_path || b.input.notebook_path
      if (p && e.timestamp) edits.push(wantInputs ? [e.timestamp, p, b.input, b.name] : [e.timestamp, p])
    }
  }
  return edits
}

const inRepo = new Map()
// ponytail: checks the disk, so a project deleted later falls into "other".
function insideProject(dir) {
  if (inRepo.has(dir)) return inRepo.get(dir)
  const up = path.dirname(dir)
  const r = MARKERS.some(m => fs.existsSync(path.join(dir, m))) || (up !== dir && insideProject(up))
  inRepo.set(dir, r)
  return r
}

// Row rule, first match wins: scheduled tasks, skills folder, memory, CLAUDE.md / AGENTS.md / rules,
// plugin or MCP config, any path with a DESIGN_STATE.md / HANDOFF.md / PLAN.md / .git in a parent
// folder, else other.
function rowOf(p) {
  const n = p.replace(/\\/g, '/')
  const base = n.split('/').pop()
  if (/\/scheduled(-tasks)?\//i.test(n)) return 'routines'
  if (n.includes('/skills/')) return 'skills'
  if (n.includes('/memory/') || base === 'MEMORY.md') return 'memory'
  if (base === 'CLAUDE.md' || base === 'AGENTS.md' || /\/\.claude\/rules\//.test(n)) return 'claude'
  if (base === '.mcp.json' || base === 'claude_desktop_config.json' || base === '.claude.json' || /\/\.claude\/plugins\//.test(n)) return 'apps'
  return insideProject(path.dirname(p)) ? 'projects' : 'other'
}
const ROWS = ['skills', 'memory', 'claude', 'projects', 'routines', 'apps', 'other']
const emptyRows = () => Object.fromEntries(ROWS.map(r => [r, {}]))

// Re-parse only files whose mtime or size changed since the last run.
async function buildTimelineIndex() {
  const root = path.join(HOME, 'projects')
  const old = readJson(CACHE, { files: {} }).files
  const files = {}
  for (const f of listJsonl(root)) {
    const st = fs.statSync(f)
    const key = path.relative(root, f)
    const prev = old[key]
    files[key] = prev && prev.mtime === st.mtimeMs && prev.size === st.size
      ? prev
      : { mtime: st.mtimeMs, size: st.size, edits: await parseEdits(f) }
  }
  fs.mkdirSync(path.dirname(CACHE), { recursive: true })
  fs.writeFileSync(CACHE, JSON.stringify({ files }))
  return files
}

// -> { days: [{ date, rows: { skills: [{ path, count, last, session, project }], ... } }], older: { skills: n, ... } }
// days newest first; older = distinct files edited before the window, per row.
function summarizeTimeline(files, days = 30) {
  const min = localDay(new Date(Date.now() - (days - 1) * 864e5))
  const byDay = {}, olderSets = Object.fromEntries(ROWS.map(r => [r, new Set()]))
  for (const [key, f] of Object.entries(files)) {
    const project = key.split(path.sep)[0]
    const session = path.basename(key, '.jsonl')
    for (const [ts, p] of f.edits) {
      const date = localDay(new Date(ts))
      if (date < min) { olderSets[rowOf(p)].add(p); continue }
      const rows = byDay[date] = byDay[date] || emptyRows()
      const row = rows[rowOf(p)]
      const x = row[p] = row[p] || { path: p, count: 0, last: ts, session, project }
      x.count++
      if (ts > x.last) Object.assign(x, { last: ts, session, project })
    }
  }
  return {
    older: Object.fromEntries(ROWS.map(r => [r, olderSets[r].size])),
    days: Object.keys(byDay).sort().reverse().map(date => ({
      date,
      rows: Object.fromEntries(Object.entries(byDay[date]).map(([r, m]) => [r, Object.values(m).sort((a, b) => b.last.localeCompare(a.last))])),
    })),
  }
}

const CAP = 20000
const clip = v => String(v == null ? '' : v).slice(0, CAP)

// Edit / MultiEdit / Write inputs -> [{ ts, kind: 'edit' | 'write', old, new }].
function diffEvents(entries) {
  const out = []
  for (const [ts, , input, tool] of entries) {
    if (tool === 'Write') out.push({ ts, kind: 'write', old: '', new: clip(input.content) })
    else if (tool === 'Edit') out.push({ ts, kind: 'edit', old: clip(input.old_string), new: clip(input.new_string) })
    else if (tool === 'MultiEdit' && Array.isArray(input.edits)) for (const x of input.edits) out.push({ ts, kind: 'edit', old: clip(x.old_string), new: clip(x.new_string) })
  }
  return out.sort((a, b) => a.ts.localeCompare(b.ts))
}

// Diffs for one file on one local day. Only paths present in the index qualify (null otherwise).
async function fileDiff(files, p, day) {
  const hits = Object.entries(files).filter(([, f]) => f.edits.some(([ts, fp]) => fp === p && localDay(new Date(ts)) === day))
  if (!hits.length) return null
  const root = path.join(HOME, 'projects')
  const entries = []
  for (const [key] of hits) for (const x of await parseEdits(path.join(root, key), true)) if (x[1] === p && localDay(new Date(x[0])) === day) entries.push(x)
  return { path: p, day, events: diffEvents(entries) }
}

module.exports = { buildTimelineIndex, summarizeTimeline, parseEdits, rowOf, ROWS, diffEvents, fileDiff }
