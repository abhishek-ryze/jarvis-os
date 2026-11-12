// Self-check: node lib/skills-stats.test.js
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { skillStats, dayFrom } = require('./skills-stats')
const { summarize } = require('./scan')
const { readNotes, applyPrompt } = require('./notes')

const now = Date.parse('2026-11-04T12:00:00Z')
const t = (input, output = 0) => ({ input, cacheWrite: 0, cacheRead: 0, output })
const run = (skill, ts, tokens) => ({ skill, ts, via: 'tool', tokens })
const files = {
  'p/a.jsonl': { sub: false, total: t(0), byDay: {}, byModel: {}, first: null, last: null, turns: 0, title: null, skills: [
    run('a', '2026-11-03T10:00:00Z', t(1e6)),
    run('a', '2026-11-04T09:00:00Z', t(1e6, 1e6)),
    run('a', '2026-10-20T10:00:00Z', t(1e6)), // inside 30 days, outside 7
    run('b', '2026-09-01T10:00:00Z', t(5)), // outside 30 days
    run('/compact', '2026-11-04T09:00:00Z', t(9)), // not a known skill
  ] },
}
const usage = { byModel: { 'claude-opus-5-5': t(3e6, 1e6) } }
const ids = ['a', 'b', 'c']

assert.strictEqual(dayFrom(now, 7), '2026-10-29', 'today plus 6 UTC days')
const s7 = skillStats(files, usage, ids, { days: 7, now })
const a7 = s7.rows.find(r => r.id === 'a')
assert.strictEqual(a7.runs, 2)
assert.strictEqual(a7.tokens, 3e6)
assert.strictEqual(a7.tokensPerWeek, 3e6, '7 days is one week')
assert.strictEqual(a7.tokensPerRun, 1.5e6)
assert.strictEqual(a7.usd, null, 'no prices: $ unknown')
assert.strictEqual(s7.usdKnown, false)
assert.deepStrictEqual(s7.never, ['b', 'c'], 'never used in 30 days')
assert.strictEqual(s7.total.runs, 2)

const s30 = skillStats(files, usage, ids, { days: 30, now, prices: {} })
const a30 = s30.rows.find(r => r.id === 'a')
assert.strictEqual(a30.runs, 3)
assert.ok(Math.abs(a30.tokensPerWeek - 4e6 / (30 / 7)) < 1)
// blend: 3M input at $5 + 1M output at $25 over 4M tokens; a's 4M tokens hold 3M input and 1M output
assert.ok(Math.abs(a30.usd - 40) < 1e-9, `a30.usd ${a30.usd}`)
assert.ok(Math.abs(a30.usdPerRun - 40 / 3) < 1e-9)
assert.ok(Math.abs(a30.usdPerWeek - 40 / (30 / 7)) < 1e-9)
assert.strictEqual(s30.rows.find(r => r.id === 'c').usdPerRun, 0)

// Analytics fields are the same whatever the window: fires 7 d / 30 d, $ 30 d, last use, unused flag.
for (const w of [s7, s30]) {
  const ra = w.rows.find(r => r.id === 'a'), rb = w.rows.find(r => r.id === 'b'), rc = w.rows.find(r => r.id === 'c')
  assert.strictEqual(ra.fires7, 2); assert.strictEqual(ra.fires30, 3); assert.strictEqual(ra.tokens30, 4e6)
  assert.strictEqual(ra.unused30, false); assert.strictEqual(ra.lastUsed, '2026-11-04T09:00:00Z')
  assert.strictEqual(rb.fires30, 0); assert.strictEqual(rb.unused30, true); assert.strictEqual(rb.lastUsed, '2026-09-01T10:00:00Z', 'last use survives outside the window')
  assert.strictEqual(rc.unused30, true); assert.strictEqual(rc.lastUsed, null)
}
assert.ok(s7.rows.find(r => r.id === 'a').usd30 > 0, 'no config prices: default table')
assert.ok(Math.abs(s30.rows.find(r => r.id === 'a').usd30 - 40) < 1e-9, 'usd30 uses the price table')
assert.ok(Math.abs(skillStats(files, usage, ids, { days: 7, now, prices: {} }).rows.find(r => r.id === 'a').usd30 - 40) < 1e-9, 'usd30 independent of window')

// All-time window equals scan.summarize bySkill, which is what the Tokens panel ranks.
const all = skillStats(files, usage, ids, { days: Infinity, now })
const sm = summarize(files, ids)
for (const r of all.rows) {
  const b = sm.bySkill[r.id]
  assert.strictEqual(r.runs, b ? b.runs : 0, r.id + ' runs')
  assert.strictEqual(r.tokens, b ? b.tokens.input + b.tokens.output + b.tokens.cacheRead + b.tokens.cacheWrite : 0, r.id + ' tokens')
}

// Notes: missing folder is empty, plugin stems map back to ids, empty files are skipped.
assert.deepStrictEqual(readNotes(ids, path.join(os.tmpdir(), 'aos-no-such-notes')), [])
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-notes-'))
fs.writeFileSync(path.join(dir, 'a.md'), '- fix x\n')
fs.writeFileSync(path.join(dir, 'figma_use.md'), 'note two')
fs.writeFileSync(path.join(dir, 'gone.md'), 'orphan')
fs.writeFileSync(path.join(dir, 'empty.md'), '  \n')
const n = readNotes(['a', 'figma:use'], dir)
fs.rmSync(dir, { recursive: true })
assert.deepStrictEqual(n.map(x => x.skill).sort(), ['a', 'figma:use', null])
assert.strictEqual(n.length, 3)
assert.ok(applyPrompt('a', '- fix x').startsWith('Apply these notes to skill a\n\n- fix x'))
const { pickMode } = require('./skills-stats')
assert.strictEqual(pickMode(undefined), undefined)
assert.strictEqual(pickMode('plan'), 'plan')
assert.strictEqual(pickMode('acceptEdits'), 'acceptEdits')
for (const bad of ['bypassPermissions', '', 'default', 5]) assert.throws(() => pickMode(bad), /mode must be/)
console.log('ok: skills-stats')
