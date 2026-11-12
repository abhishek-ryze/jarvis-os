// Global search over skills, memories, projects (state files), sessions and run reports. No dependencies.
const fs = require('fs')
const path = require('path')
const scan = require('./scan')

const TTL = 60000
const MAX_SESSIONS = 400 // newest session files read per rebuild; older ones are skipped to keep a cold search fast
const MAX_REPORTS = 100
let cache = null // { at, root, rows }

// Text of the first real typed prompt in a jsonl, read from the head of the file only.
function firstPrompt(file) {
  let text = ''
  try {
    const fd = fs.openSync(file, 'r'), buf = Buffer.alloc(262144)
    text = buf.toString('utf8', 0, fs.readSync(fd, buf, 0, buf.length, 0))
    fs.closeSync(fd)
  } catch { return null }
  const tm = /"type":"(?:custom-title|ai-title)","(?:customTitle|aiTitle)":"((?:[^"\\]|\\.)*)"/.exec(text)
  let title = ''
  if (tm) try { title = JSON.parse('"' + tm[1] + '"').trim().slice(0, 120) } catch {}
  for (const line of text.split('\n')) {
    if (!line.includes('"type":"user"')) continue
    let e
    try { e = JSON.parse(line) } catch { continue }
    if (e.type !== 'user' || e.isMeta || e.isCompactSummary) continue
    const c = e.message && e.message.content
    const t = typeof c === 'string' ? c : Array.isArray(c) && !c.some(b => b.type === 'tool_result') ? c.map(b => b.text || '').join('') : null
    if (t && t.trim() && !t.startsWith('<')) return { title, prompt: t.trim().replace(/\s+/g, ' ').slice(0, 120) }
  }
  return title ? { title, prompt: '' } : null
}

function sessionIndex(root) {
  if (cache && cache.root === root && Date.now() - cache.at < TTL) return cache.rows
  const rows = []
  try {
    const files = []
    for (const f of scan.listJsonl(root)) {
      if (f.includes(`${path.sep}subagents${path.sep}`)) continue
      try { files.push({ f, mtime: fs.statSync(f).mtime }) } catch {}
    }
    files.sort((a, b) => b.mtime - a.mtime)
    for (const { f, mtime } of files.slice(0, MAX_SESSIONS)) {
      const p = firstPrompt(f)
      if (!p) continue
      const project = path.relative(root, f).split(path.sep)[0]
      rows.push({ kind: 'session', title: p.title || p.prompt, sub: `${project} | ${mtime.toISOString().slice(0, 16).replace('T', ' ')}`, path: f, body: p.prompt, id: path.basename(f, '.jsonl') })
    }
  } catch {}
  cache = { at: Date.now(), root, rows }
  return rows
}

// Run reports: reports/<iso>_<name>.md, first line "# label". Newest MAX_REPORTS, head of file only.
function reportRows(dir) {
  const rows = []
  try {
    const list = fs.readdirSync(dir).filter(n => n.endsWith('.md')).map(n => ({ n, m: fs.statSync(path.join(dir, n)).mtime })).sort((a, b) => b.m - a.m).slice(0, MAX_REPORTS)
    for (const { n, m } of list) {
      let head = ''
      try { const fd = fs.openSync(path.join(dir, n), 'r'), buf = Buffer.alloc(600); head = buf.toString('utf8', 0, fs.readSync(fd, buf, 0, 600, 0)); fs.closeSync(fd) } catch {}
      const label = /^# (.+)/.exec(head)
      rows.push({ kind: 'report', title: label ? label[1] : n, sub: `report | ${m.toISOString().slice(0, 16).replace('T', ' ')}`, path: path.join(dir, n), body: head, id: n })
    }
  } catch {}
  return rows
}

// Where a result goes in the UI. The client in public/shell.js maps these to existing open functions.
function targetOf(r) {
  if (r.kind === 'skill') return { view: 'Skills', id: r.id }
  if (r.kind === 'session') return { view: 'Sessions', id: r.id }
  if (r.kind === 'report') return { view: 'Skills', report: r.id }
  return { file: r.path }
}

// Rank: title prefix 100, title word prefix 80, title substring 60, sub/path 30, body 10. 0 = no match.
function rank(row, q) {
  const t = row.title.toLowerCase()
  if (t.startsWith(q)) return 100
  if (t.split(/[^a-z0-9]+/).some(w => w.startsWith(q))) return 80
  if (t.includes(q)) return 60
  if ((row.sub + ' ' + row.path).toLowerCase().includes(q)) return 30
  return row.body.toLowerCase().includes(q) ? 10 : 0
}

// src is for tests: { skills, memory, root, reports }.
function search(q, limit = 20, src = {}) {
  q = String(q || '').trim().toLowerCase()
  if (!q) return []
  const rows = []
  for (const s of src.skills || scan.scanSkills()) rows.push({ kind: 'skill', title: s.id, sub: s.source, path: s.file, body: s.description, id: s.id })
  let mem = src.memory
  if (!mem) try { mem = scan.scanMemory() } catch { mem = { dir: '', entries: [] } }
  const seen = new Set()
  for (const e of mem.entries) {
    rows.push({ kind: 'memory', title: e.title, sub: e.type, path: path.join(mem.dir, e.file), body: e.hook })
    if (e.state && !seen.has(e.state.path)) {
      seen.add(e.state.path)
      rows.push({ kind: 'project', title: path.basename(path.dirname(e.state.path)), sub: e.state.kind, path: e.state.path, body: '' })
    }
  }
  rows.push(...sessionIndex(src.root || path.join(scan.HOME, 'projects')))
  rows.push(...reportRows(src.reports || path.join(require('./scan').DATA, 'reports')))
  return rows
    .map(r => ({ r, score: rank(r, q) }))
    .filter(x => x.score)
    .sort((a, b) => b.score - a.score || a.r.title.length - b.r.title.length)
    .slice(0, limit)
    .map(({ r, score }) => ({ kind: r.kind, title: r.title, sub: r.sub, path: r.path, target: targetOf(r), score }))
}

module.exports = { search }
