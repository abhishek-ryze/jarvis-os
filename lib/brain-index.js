// Brain map index: builds the file graph and caches it in cache/brain-index.json.
// Rebuild by hand: node lib/brain-index.js
const fs = require('fs')
const path = require('path')
const { scanGraph, HOME } = require('./scan')

const OUT = path.join(require('./scan').CACHE_DIR, 'brain-index.json')
const MAX_PREVIEW = 200 * 1024
const VERSION = 2 // 2: node tags; load() rebuilds older caches

// Frontmatter tags of a file: `tags:` (inline [a, b] or a - list) plus a memory's metadata `type:` as "memory: x".
function tagsOf(file) {
  let head = ''
  try { const fd = fs.openSync(file, 'r'), b = Buffer.alloc(2048); try { head = b.toString('utf8', 0, fs.readSync(fd, b, 0, 2048, 0)) } finally { fs.closeSync(fd) } } catch { return [] }
  const lines = head.split(/\r?\n/)
  if (lines[0].trim() !== '---') return []
  const tags = []
  for (let i = 1; i < lines.length && lines[i].trim() !== '---'; i++) {
    const l = lines[i], m = /^tags:\s*(.*)$/.exec(l)
    if (m) {
      if (m[1].trim()) tags.push(...m[1].replace(/^\[|\]$/g, '').split(','))
      else while (/^\s*-\s+/.test(lines[i + 1] || '')) tags.push(lines[++i].replace(/^\s*-\s+/, ''))
    }
    const t = /^\s+type:\s*(\S.*)$/.exec(l)
    if (t) tags.push('memory: ' + t[1])
  }
  return [...new Set(tags.map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean))]
}

function build(home = HOME, out = OUT) {
  const g = { version: VERSION, builtAt: new Date().toISOString(), ...scanGraph(400, home) }
  for (const n of g.nodes) { const t = tagsOf(n.id); if (t.length) n.tags = t }
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, JSON.stringify(g))
  return g
}

// Cached index, or a fresh build when there is no usable cache.
function load(home = HOME, out = OUT) {
  try {
    const g = JSON.parse(fs.readFileSync(out, 'utf8'))
    if (g.version === VERSION && Array.isArray(g.nodes) && Array.isArray(g.edges)) return g
  } catch {}
  return build(home, out)
}

// Only files that are nodes of the index may be read or opened (exact match after path.resolve).
const allowedSet = g => new Set(g.nodes.map(n => path.resolve(n.id)))
const isIndexed = (set, p) => typeof p === 'string' && p.length > 0 && set.has(path.resolve(p))

// Text preview of an indexed file, at most MAX_PREVIEW bytes. Throws with .code for the HTTP status.
function readPreview(set, p) {
  const fail = (code, msg) => Object.assign(new Error(msg), { code })
  if (!isIndexed(set, p)) throw fail(403, 'path not in the brain index')
  const full = path.resolve(p)
  let st
  try { st = fs.statSync(full) } catch { throw fail(404, 'file not found') }
  if (!st.isFile()) throw fail(403, 'not a file')
  const fd = fs.openSync(full, 'r')
  const buf = Buffer.alloc(Math.min(st.size, MAX_PREVIEW))
  try { fs.readSync(fd, buf, 0, buf.length, 0) } finally { fs.closeSync(fd) }
  if (buf.includes(0)) throw fail(415, 'not a text file')
  return { path: full, size: st.size, truncated: st.size > MAX_PREVIEW, text: buf.toString('utf8') }
}

module.exports = { build, load, allowedSet, isIndexed, readPreview, tagsOf, OUT, MAX_PREVIEW }

if (require.main === module) {
  const g = build()
  console.log(`brain index: ${g.nodes.length} files, ${g.edges.length} links -> ${OUT}`)
}
