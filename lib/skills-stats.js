// Per-skill run stats over the last N UTC days, from the usage index (scan.buildUsageIndex). No dependencies.
const cost = require('./cost')

const sum = t => t.input + t.cacheWrite + t.cacheRead + t.output
const zero = () => ({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0 })
// Same window as the Tokens panel: today plus the N-1 UTC days before it (byDay keys are UTC dates).
const dayFrom = (now, days) => new Date(now - (days - 1) * 864e5).toISOString().slice(0, 10)

// files: index from buildUsageIndex. usage: summarize() result (its byModel gives the blended $ rate).
// prices: config.json `prices`; with none set, $ is null (the UI shows --). days may be Infinity (tests).
function skillStats(files, usage, skillIds, { days = 7, now = Date.now(), prices = null } = {}) {
  const known = new Set(skillIds)
  const never = new Set(skillIds)
  const from = days === Infinity ? '' : dayFrom(now, days)
  const from30 = dayFrom(now, 30)
  const win = {}, w30 = {}, fires7 = {}, fires30 = {}, lastAll = {}
  const from7 = dayFrom(now, 7)
  for (const f of Object.values(files)) {
    for (const s of f.skills) {
      if (!known.has(s.skill)) continue // same filter as scan.summarize
      const day = (s.ts || '').slice(0, 10)
      if (!lastAll[s.skill] || s.ts > lastAll[s.skill]) lastAll[s.skill] = s.ts
      if (day >= from30) {
        never.delete(s.skill)
        fires30[s.skill] = (fires30[s.skill] || 0) + 1
        if (day >= from7) fires7[s.skill] = (fires7[s.skill] || 0) + 1
        const q = w30[s.skill] = w30[s.skill] || { runs: 0, tokens: zero(), last: null }
        q.runs++
        for (const k in q.tokens) q.tokens[k] += s.tokens[k] || 0
      }
      if (day < from) continue
      const r = win[s.skill] = win[s.skill] || { runs: 0, tokens: zero(), last: null }
      r.runs++
      for (const k in r.tokens) r.tokens[k] += s.tokens[k] || 0
      r.last = !r.last || s.ts > r.last ? s.ts : r.last
    }
  }
  const usd = prices ? cost.costs({ byModel: usage.byModel, byDay: {}, byProject: {}, bySkill: win }, prices).bySkill : null
  // usd30 falls back to cost.js's default price table when config sets none, so the 30 d $ column always has a value
  const usd30 = cost.costs({ byModel: usage.byModel, byDay: {}, byProject: {}, bySkill: w30 }, prices || {}).bySkill
  const wk = days === Infinity ? 1 : days / 7
  const rows = skillIds.map(id => {
    const r = win[id] || { runs: 0, tokens: zero(), last: null }
    const tokens = sum(r.tokens), d = usd ? usd[id] || 0 : null
    return {
      id, runs: r.runs, tokens, last: r.last,
      // fixed 7 d and 30 d view, whatever the window: fires, est. tokens and $, all-time last use, unused flag
      fires7: fires7[id] || 0, fires30: fires30[id] || 0, tokens30: w30[id] ? sum(w30[id].tokens) : 0,
      usd30: usd30[id] || 0, lastUsed: lastAll[id] || null, unused30: never.has(id),
      tokensPerWeek: tokens / wk, tokensPerRun: r.runs ? tokens / r.runs : 0,
      usd: d, usdPerWeek: d === null ? null : d / wk, usdPerRun: d === null ? null : r.runs ? d / r.runs : 0,
    }
  })
  return {
    days, from, usdKnown: !!prices, rows,
    never: skillIds.filter(id => never.has(id)),
    total: { runs: rows.reduce((s, r) => s + r.runs, 0), tokens: rows.reduce((s, r) => s + r.tokens, 0), usd: usd ? rows.reduce((s, r) => s + r.usd, 0) : null },
  }
}

// A run request may ask only for these modes; bypassPermissions stays config-only. Absent means the config default.
const RUN_MODES = ['plan', 'acceptEdits']
function pickMode(m) {
  if (m === undefined || m === null) return undefined
  if (!RUN_MODES.includes(m)) throw new Error('mode must be plan or acceptEdits')
  return m
}

module.exports = { skillStats, dayFrom, pickMode }
