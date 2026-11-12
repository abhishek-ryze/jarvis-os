// Live sessions and cold-cache cost report, read from ~/.claude/projects. No dependencies.
const fs = require('fs')
const path = require('path')
const readline = require('readline')
const { HOME, listJsonl } = require('./scan')

// $ per million tokens. An ESTIMATE, not a bill. Override per family with config.json `prices`, e.g. { "opus": { "write": 6.25, "read": 0.5 } }.
const PRICES = {
  opus: { write: 6.25, read: 0.5 },
  sonnet: { write: 3.75, read: 0.3 },
  haiku: { write: 1.25, read: 0.1 },
}
const priceOf = (model, over = {}) => {
  const fam = ['opus', 'sonnet', 'haiku'].find(f => (model || '').includes(f)) || 'sonnet'
  return { ...PRICES[fam], ...(over[fam] || {}) }
}
const MIN = 60000, WARM = 60, PING_EVERY = 50, PING_MAX = 240
const ROOT = path.join(HOME, 'projects')
const ctxOf = u => (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)

// Assistant messages in file order (deduped on message id), plus the custom title,
// the last user or assistant entry (last), and the cache TTL in minutes of the last cache write (ttl).
async function readFile(file) {
  const seen = new Set(), msgs = []
  let title = null, last = null, ttl = null
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })
  for await (const line of rl) {
    if (line.includes('"isSidechain":true')) continue
    if (line.includes('"type":"user"') && !line.includes('"type":"assistant"')) { if (!line.includes('"isMeta":true')) last = { kind: 'user' }; continue }
    if (!line.includes('"type":"assistant"') && !line.includes('"custom-title"')) continue
    let e
    try { e = JSON.parse(line) } catch { continue }
    if (e.type === 'custom-title' && e.customTitle) title = e.customTitle
    const m = e.message
    if (e.type !== 'assistant' || !m || !m.id) continue
    // content blocks of one message come as separate lines with the same id
    const tool = Array.isArray(m.content) && m.content.some(b => b.type === 'tool_use')
    last = last && last.id === m.id ? { ...last, tool: last.tool || tool } : { kind: 'assistant', id: m.id, tool }
    if (!m.usage || seen.has(m.id) || !e.timestamp) continue
    seen.add(m.id)
    const cc = m.usage.cache_creation || {}
    if (cc.ephemeral_1h_input_tokens > 0) ttl = 60
    else if (cc.ephemeral_5m_input_tokens > 0) ttl = 5
    msgs.push({ ts: Date.parse(e.timestamp), model: m.model, usage: m.usage })
  }
  return { msgs, title, last, ttl }
}

const files = (root, since) => {
  let all = []
  try { all = listJsonl(root) } catch { return [] }
  return all.filter(f => !f.includes(`${path.sep}subagents${path.sep}`) && fs.statSync(f).mtimeMs >= since)
    .map(f => ({ file: f, project: path.relative(root, f).split(path.sep)[0] }))
}

async function liveSessions(prices, now = Date.now(), root = ROOT) {
  const out = []
  for (const { file, project } of files(root, now - 24 * 60 * MIN)) {
    const { msgs, title, last: entry, ttl } = await readFile(file)
    const last = msgs[msgs.length - 1]
    if (!last || last.ts < now - 24 * 60 * MIN) continue
    const idleMin = Math.max(0, Math.round((now - last.ts) / MIN))
    const context = ctxOf(last.usage)
    const ctxWindow = /\[1m\]/i.test(last.model || '') || context > 200000 ? 1e6 : 200000
    // TTL from the last cache write tier; logs without cache_creation fall back to 5 min
    const ttlMin = ttl || 5, cacheLeftMin = Math.max(0, +(ttlMin - (now - last.ts) / MIN).toFixed(1))
    out.push({
      id: path.basename(file, '.jsonl'), project, title, model: last.model, idleMin, context,
      ctxWindow, ctxPct: +(context / ctxWindow).toFixed(4),
      cache: cacheLeftMin > 0 ? 'warm' : 'cold', ttlMin, cacheLeftMin,
      waiting: !!entry && entry.kind === 'assistant' && !entry.tool,
      recacheCost: +(context * priceOf(last.model, prices).write / 1e6).toFixed(4),
    })
  }
  return out.sort((a, b) => a.idleMin - b.idleMin)
}

// A reload is an assistant message more than 1 h after the previous one in the same file.
// Ping model: one ping per 50 min of gap (cache read of the context), only for gaps up to 4 h.
async function coldCacheReport(prices, days = 30, now = Date.now(), root = ROOT) {
  const since = now - days * 24 * 60 * MIN
  const t = { sessionsScanned: 0, reloads: 0, reloadCost: 0, pingableReloads: 0, pingCost: 0, netSaving: 0 }
  const rows = []
  for (const { file, project } of files(root, since)) {
    const { msgs, title } = await readFile(file)
    t.sessionsScanned++
    const row = { id: path.basename(file, '.jsonl'), project, title, reloads: 0, wasteCost: 0 }
    for (let i = 1; i < msgs.length; i++) {
      const prev = msgs[i - 1], m = msgs[i], gap = (m.ts - prev.ts) / MIN
      if (gap <= WARM || m.ts < since) continue
      const cost = (m.usage.cache_creation_input_tokens || 0) * priceOf(m.model, prices).write / 1e6
      row.reloads++; row.wasteCost += cost; t.reloads++; t.reloadCost += cost
      if (gap <= PING_MAX) {
        const ping = Math.floor(gap / PING_EVERY) * ctxOf(prev.usage) * priceOf(prev.model, prices).read / 1e6
        t.pingableReloads++; t.pingCost += ping; t.netSaving += cost - ping
      }
    }
    if (row.reloads) rows.push(row)
  }
  for (const k of ['reloadCost', 'pingCost', 'netSaving']) t[k] = +t[k].toFixed(2)
  const top = rows.sort((a, b) => b.wasteCost - a.wasteCost).slice(0, 10).map(r => ({ ...r, wasteCost: +r.wasteCost.toFixed(2) }))
  return { days, estimate: true, ...t, top }
}

module.exports = { liveSessions, coldCacheReport }
