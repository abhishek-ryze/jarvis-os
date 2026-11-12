// Artifact index: files of chosen types in the folders listed in config.json (artifactDirs).
const fs = require('fs')
const path = require('path')

const DEFAULT_EXTS = ['html', 'pdf', 'pptx', 'png', 'mp4', 'docx', 'jpg', 'jpeg', 'webp', 'gif', 'mov', 'webm']
const TYPE_EXTS = { deck: ['pptx', 'ppt', 'key', 'odp'], doc: ['pdf', 'docx', 'doc', 'md', 'txt'], image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'], video: ['mp4', 'mov', 'webm', 'mkv'], html: ['html', 'htm'] }
const typeOf = ext => Object.keys(TYPE_EXTS).find(t => TYPE_EXTS[t].includes(ext)) || 'other'
const MAX_DEPTH = 4
const TTL = 60000
const HINT = 'Set artifactDirs (array of absolute folder paths) in config.json.'

const exts = cfg => (Array.isArray(cfg.artifactExts) && cfg.artifactExts.length ? cfg.artifactExts : DEFAULT_EXTS).map(e => String(e).toLowerCase().replace(/^\./, ''))
const dirsOf = cfg => (Array.isArray(cfg.artifactDirs) ? cfg.artifactDirs.filter(d => typeof d === 'string' && d) : [])

function walk(dir, top, want, depth, out) {
  let ents
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    if (e.isDirectory()) {
      if (depth < MAX_DEPTH && e.name !== 'node_modules' && !e.name.startsWith('.')) walk(path.join(dir, e.name), top, want, depth + 1, out)
    } else if (e.isFile()) {
      const ext = path.extname(e.name).slice(1).toLowerCase()
      if (!want.includes(ext)) continue
      const p = path.join(dir, e.name)
      try {
        const st = fs.statSync(p)
        out.push({ name: e.name, path: p, ext, type: typeOf(ext), size: st.size, mtime: st.mtimeMs, folder: top })
      } catch { /* file vanished */ }
    }
  }
}

let cache = null // { key, at, items }
function index(cfg) {
  const dirs = dirsOf(cfg), want = exts(cfg)
  const key = JSON.stringify([dirs, want])
  if (cache && cache.key === key && Date.now() - cache.at < TTL) return cache.items
  const items = []
  for (const d of dirs) walk(d, d, want, 0, items)
  items.sort((a, b) => b.mtime - a.mtime)
  cache = { key, at: Date.now(), items }
  return items
}

// hidden: optional Set of paths the user hid from the dashboard (never deleted).
function list(cfg, q = '', limit = 50, hidden) {
  const dirs = dirsOf(cfg)
  const s = String(q || '').toLowerCase()
  const all = index(cfg).filter(i => !(hidden && hidden.has(i.path)) && (!s || i.path.toLowerCase().includes(s) || i.name.toLowerCase().includes(s)))
  const n = Math.max(1, Math.min(Number(limit) || 50, 500))
  const res = { dirs, count: all.length, items: all.slice(0, n) }
  if (!dirs.length) res.hint = HINT
  return res
}

// True only for an existing-style path inside a listed folder with an indexed extension (never opens .exe or .bat).
function isAllowed(cfg, p) {
  if (typeof p !== 'string' || !p) return false
  const full = path.resolve(p)
  if (!exts(cfg).includes(path.extname(full).slice(1).toLowerCase())) return false
  return dirsOf(cfg).some(d => {
    const rel = path.relative(path.resolve(d), full)
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel)
  })
}

// Hide list lives in cache/hub.json. Hiding never touches the file itself.
const HUB = path.join(require('./scan').CACHE_DIR, 'hub.json')
function readHidden(file = HUB) {
  try { return new Set(JSON.parse(fs.readFileSync(file, 'utf8')).hidden.filter(p => typeof p === 'string')) } catch { return new Set() }
}
function setHidden(p, hide, file = HUB) {
  const set = readHidden(file)
  hide ? set.add(path.resolve(p)) : set.delete(path.resolve(p))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ hidden: [...set] }))
  return set
}

module.exports = { list, index, isAllowed, typeOf, readHidden, setHidden }
