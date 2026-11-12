// Folder families for the globe: many small top folders merge into a few groups by shared name prefix.
// counts: { folder: node count }; short: folder -> display name. Returns { folder: family label }.
const words = s => s.split(/[-\s_]+/).filter(Boolean)
const common = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i].toLowerCase() === b[i].toLowerCase()) i++; return i }

function families(counts, short = s => s, max = 8, min = 3) {
  const names = Object.keys(counts)
  // a folder whose name ends another folder's name joins it ("Investor Video" -> "Client-Acme-Investor-Video")
  const host = {}
  for (const f of names) {
    const w = words(short(f)).join('-').toLowerCase()
    const big = names.find(g => g !== f && words(short(g)).join('-').toLowerCase().endsWith('-' + w))
    if (big) host[f] = big
  }
  const root = f => { let r = f; for (let i = 0; host[r] && i < 9; i++) r = host[r]; return r }
  let cl = []
  for (const f of names) {
    if (host[f]) continue
    cl.push({ key: words(short(f)), label: null, size: 0, folders: [] })
    const c = cl[cl.length - 1]
    for (const g of names) if (root(g) === f) { c.folders.push(g); c.size += counts[g] }
  }
  // merge the pair with the longest shared prefix (smallest pair on ties) until max groups are left
  const merge = () => {
    let best = null
    for (let i = 0; i < cl.length; i++) for (let j = i + 1; j < cl.length; j++) {
      const p = common(cl[i].key, cl[j].key), s = cl[i].size + cl[j].size
      if (p && (!best || p > best.p || (p === best.p && s < best.s))) best = { i, j, p, s }
    }
    if (!best) return false
    const a = cl[best.i], b = cl[best.j]
    cl[best.i] = { key: a.key.slice(0, best.p), size: best.s, folders: [...a.folders, ...b.folders] }
    cl.splice(best.j, 1)
    return true
  }
  while (cl.length > max && merge());
  // the rest: groups too small to name, plus the smallest ones past max, fold into Other
  cl.sort((a, b) => b.size - a.size)
  const other = { key: ['Other'], size: 0, folders: [] }
  cl = cl.filter((c, i) => { const keep = c.size >= min && i < max - 1; if (!keep) { other.folders.push(...c.folders); other.size += c.size } return keep })
  if (other.size) cl.push(other)
  if (cl.length === 1 && other.size) other.key = ['All']
  const out = {}
  for (const c of cl) { const label = c.folders.length === 1 ? short(c.folders[0]) : c.key.join(' '); for (const f of c.folders) out[f] = label }
  return out
}

module.exports = { families }
