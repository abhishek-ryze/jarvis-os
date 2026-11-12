// Est. API cost and rolling 5h / 7d usage windows. No dependencies.
const fs = require('fs')
const path = require('path')
const readline = require('readline')
const { HOME } = require('./scan')

// ESTIMATES in USD per million tokens, by model family. Public list prices drift; override in config.json under `prices`.
const PRICES = {
  opus: { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  sonnet: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  haiku: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
}
const family = model => (/opus|sonnet|haiku/.exec(String(model).toLowerCase()) || [])[0]
const priceOf = (model, prices) => { const f = family(model); return f && { ...PRICES[f], ...(prices || {})[f] } }
const KEYS = ['input', 'output', 'cacheWrite', 'cacheRead']

// tokens: { input, output, cacheWrite, cacheRead } as in scan.js. Unknown models cost 0.
function costOf(tokens, model, prices) {
  const p = priceOf(model, prices)
  return p ? KEYS.reduce((s, k) => s + (tokens[k] || 0) * p[k], 0) / 1e6 : 0
}

// est. USD for the usage summary. byModel is exact; the other groups carry no model split, so they use the blended rate of the byModel mix.
function costs(usage, prices) {
  const byModel = {}
  let total = 0
  const mix = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }
  for (const [m, t] of Object.entries(usage.byModel)) {
    total += byModel[m] = costOf(t, m, prices)
    for (const k of KEYS) mix[k] += t[k]
  }
  // Blended $ per token class, weighted by each model's share of that class.
  const rate = {}
  for (const k of KEYS) rate[k] = mix[k] ? Object.entries(usage.byModel).reduce((s, [m, t]) => s + costOf({ [k]: t[k] }, m, prices), 0) / mix[k] : 0
  const blend = t => KEYS.reduce((s, k) => s + (t[k] || 0) * rate[k], 0)
  const map = o => Object.fromEntries(Object.entries(o).map(([k, t]) => [k, blend(t)]))
  const bySkill = Object.fromEntries(Object.entries(usage.bySkill).map(([k, r]) => [k, blend(r.tokens)]))
  return { total, byModel, byDay: map(usage.byDay), byProject: map(usage.byProject), bySkill, blended: true }
}

const DAY = 864e5, BURN = 30 * 6e4
function listJsonl(dir, since, out = []) {
  let ents = []
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const d of ents) {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) listJsonl(p, since, out)
    else if (d.name.endsWith('.jsonl') && fs.statSync(p).mtimeMs >= since) out.push(p)
  }
  return out
}

// Sums tokens and est. USD of the last 5h and 7d. limits: { fiveHour, sevenDay } in tokens (all four classes), null when unset.
async function windows({ now = Date.now(), prices, limits = {}, root = path.join(HOME, 'projects') } = {}) {
  const spans = { fiveHour: 5 * 36e5, sevenDay: 7 * DAY }
  const out = {}
  for (const k in spans) out[k] = { tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }, usd: 0, oldest: Infinity }
  let recent = 0 // tokens in the last 30 min, for the burn rate
  const day0 = now - now % DAY // UTC midnight today
  out.byHour = Array(24).fill(0) // all tokens per UTC hour of today, for the Home hour ring
  for (const f of listJsonl(root, now - spans.sevenDay)) {
    const seen = new Set() // usage repeats on every content-block line
    const rl = readline.createInterface({ input: fs.createReadStream(f), crlfDelay: Infinity })
    for await (const line of rl) {
      if (!line.includes('"usage"')) continue
      let e
      try { e = JSON.parse(line) } catch { continue }
      const m = e.message
      if (e.type !== 'assistant' || !m || !m.usage || !m.id || seen.has(m.id)) continue
      const ts = Date.parse(e.timestamp)
      if (!(ts >= now - spans.sevenDay) || ts > now) continue
      seen.add(m.id)
      const u = m.usage
      const t = { input: u.input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, output: u.output_tokens || 0 }
      const usd = costOf(t, m.model, prices)
      for (const k in spans) if (ts >= now - spans[k]) { for (const c of KEYS) out[k].tokens[c] += t[c]; out[k].usd += usd; out[k].oldest = Math.min(out[k].oldest, ts) }
      if (ts >= day0) out.byHour[new Date(ts).getUTCHours()] += KEYS.reduce((s, c) => s + t[c], 0)
      if (ts >= now - BURN) recent += KEYS.reduce((s, c) => s + t[c], 0)
    }
  }
  const burn = recent / (BURN / 6e4)
  for (const k in spans) {
    const w = out[k]
    w.total = KEYS.reduce((s, c) => s + w.tokens[c], 0)
    w.limit = Number(limits[k]) > 0 ? Number(limits[k]) : null
    w.pct = w.limit ? w.total / w.limit : null
    // est., linear. 5 h: reset is when the oldest tokens drop out. 7 d: with daily use that is always about now, so the horizon is now + 7 d.
    w.burn = burn
    w.resetAt = w.oldest === Infinity ? null : k === 'sevenDay' ? now + spans[k] : w.oldest + spans[k]
    delete w.oldest
    // 7 d is rolling with no real reset; a 30 min pace over 7 days overstates use, so no projection there
    w.hitAt = w.limit && burn > 0 && k !== 'sevenDay' ? now + Math.max(0, w.limit - w.total) / burn * 6e4 : null
    w.warn = !!w.limit && (w.pct > 0.8 || (w.hitAt != null && w.resetAt != null && w.hitAt < w.resetAt))
  }
  return out
}

// Per-file parse cache: a 30 day scan reads GBs, so only files whose mtime or size changed are re-read. Rows: [ts, tokens, usd].
const rowCache = new Map()
async function fileRows(f, st, prices) {
  const key = JSON.stringify(prices || null), c = rowCache.get(f)
  if (c && c.mtime === st.mtimeMs && c.size === st.size && c.key === key) return c.rows
  const rows = [], seen = new Set()
  const rl = readline.createInterface({ input: fs.createReadStream(f), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.includes('"usage"')) continue
    let e
    try { e = JSON.parse(line) } catch { continue }
    const m = e.message
    if (e.type !== 'assistant' || !m || !m.usage || !m.id || seen.has(m.id)) continue
    const ts = Date.parse(e.timestamp)
    if (!(ts > 0)) continue
    seen.add(m.id)
    const u = m.usage
    const t = { input: u.input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, output: u.output_tokens || 0 }
    rows.push([ts, KEYS.reduce((n, k) => n + t[k], 0), costOf(t, m.model, prices)])
  }
  rowCache.set(f, { mtime: st.mtimeMs, size: st.size, key, rows })
  return rows
}

// Tokens and est. USD per project folder for the last 1 d / 7 d / 30 d, top `n` each by USD. Same dedupe and pricing as windows().
async function spendByProject({ now = Date.now(), prices, root = path.join(HOME, 'projects'), n = 8 } = {}) {
  const spans = { '1d': DAY, '7d': 7 * DAY, '30d': 30 * DAY }
  const acc = { '1d': {}, '7d': {}, '30d': {} }
  for (const f of listJsonl(root, now - spans['30d'])) {
    const project = path.relative(root, f).split(path.sep)[0]
    for (const [ts, tokens, usd] of await fileRows(f, fs.statSync(f), prices)) {
      if (ts > now) continue
      for (const k in spans) if (ts >= now - spans[k]) { const r = acc[k][project] = acc[k][project] || { project, tokens: 0, usd: 0 }; r.tokens += tokens; r.usd += usd }
    }
  }
  const out = {}
  for (const k in acc) out[k] = Object.values(acc[k]).sort((a, b) => b.usd - a.usd || b.tokens - a.tokens).slice(0, n)
  return out
}

const MAX_LIMIT = 1e12
// Checks a limits body: both fields positive integers up to MAX_LIMIT. Returns { fiveHour, sevenDay } or throws.
function validLimits(b) {
  const out = {}
  for (const k of ['fiveHour', 'sevenDay']) {
    const v = b && b[k]
    if (!Number.isSafeInteger(v) || v <= 0 || v > MAX_LIMIT) throw new Error(k + ' must be a positive whole number up to ' + MAX_LIMIT)
    out[k] = v
  }
  return out
}

module.exports = { PRICES, costOf, costs, windows, spendByProject, validLimits }
