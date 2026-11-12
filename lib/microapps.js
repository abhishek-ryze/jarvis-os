// Micro apps: single-file HTML apps in the repo apps/ folder (plus config.json microAppDirs).
const fs = require('fs')
const path = require('path')

const BUILTIN = path.join(__dirname, '..', 'apps')
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.html$/

const dirsOf = cfg => [BUILTIN, ...(Array.isArray(cfg && cfg.microAppDirs) ? cfg.microAppDirs.filter(d => typeof d === 'string' && d).map(d => path.resolve(d)) : [])]

const metaDesc = h => {
  const tag = /<meta\b[^>]*\bname\s*=\s*["']description["'][^>]*>/i.exec(h)
  const c = tag && /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag[0])
  return c ? (c[1] ?? c[2]).trim() : ''
}

function list(cfg) {
  const seen = new Set(), apps = []
  for (const dir of dirsOf(cfg)) {
    let names = []
    try { names = fs.readdirSync(dir) } catch { continue }
    for (const file of names.sort()) {
      if (!NAME_RE.test(file) || seen.has(file)) continue
      let head
      try {
        const p = path.join(dir, file)
        if (!fs.statSync(p).isFile()) continue
        head = fs.readFileSync(p, 'utf8').slice(0, 8000)
      } catch { continue }
      seen.add(file)
      const title = (/<title>([^<]*)<\/title>/i.exec(head) || [])[1]
      const name = (title || file.replace(/\.html$/, '')).trim()
      apps.push({ file, name, desc: metaDesc(head), glyph: name[0].toUpperCase(), url: '/apps/' + encodeURIComponent(file) })
    }
  }
  return apps
}

// Absolute path of an app file, or null. Only .html files directly inside a listed folder.
function resolve(cfg, name) {
  if (typeof name !== 'string' || !NAME_RE.test(name) || name !== path.basename(name)) return null
  for (const dir of dirsOf(cfg)) {
    const p = path.join(dir, name)
    if (path.dirname(path.resolve(p)) !== path.resolve(dir)) continue
    try { if (fs.statSync(p).isFile()) return p } catch { /* next dir */ }
  }
  return null
}

const addPrompt = text => `Write ONE self-contained HTML file into the apps/ folder of this project (${BUILTIN}). It is a small micro app for my JARVIS dashboard.
Rules:
- One file, name it in kebab-case, ending in .html. Inline CSS and JS only. No external requests, no CDN, no frameworks.
- The app runs in a sandboxed iframe (scripts allowed, no network, no storage, no same-origin access). Do not rely on localStorage or fetch.
- Dashboard palette: background #05080b, panel #081017, line #12303a, cyan #38d6f5 for data, orange #ff6a3d only for the main action, text #e6e9eb, muted #9aa4ab. Monospace type, sharp corners.
- Add <title> and <meta name="description" content="one short line saying what it does"> in the head.
- Do not use em dashes anywhere in the file or in your reply.
Write only that file, then reply with its name.

What the app should do:
${String(text).slice(0, 2000)}`

module.exports = { list, resolve, addPrompt, dirsOf, BUILTIN }
