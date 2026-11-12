// Self-check: node lib/cost.test.js
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { costOf, costs, windows, spendByProject, validLimits } = require('./cost')

;(async () => {
  const t = { input: 1e6, output: 1e6, cacheWrite: 1e6, cacheRead: 1e6 }
  assert.strictEqual(costOf(t, 'claude-sonnet-4-5'), 3 + 15 + 3.75 + 0.3)
  assert.strictEqual(costOf(t, '<synthetic>'), 0)
  assert.strictEqual(costOf(t, 'claude-haiku-x', { haiku: { output: 10 } }), 1 + 10 + 1.25 + 0.1, 'config override merges per field')
  assert.strictEqual(costs({ byModel: { 'claude-opus-4': t }, byDay: { d: t }, byProject: {}, bySkill: { s: { tokens: t } } }).byDay.d, 5 + 25 + 6.25 + 0.5)

  const now = Date.parse('2026-11-02T12:00:00Z')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-cost-'))
  const u = { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  const msg = (id, ts) => ({ type: 'assistant', timestamp: ts, message: { id, model: 'claude-sonnet-4-5', usage: u, content: [] } })
  const lines = [
    msg('a', '2026-11-02T10:00:00Z'), msg('a', '2026-11-02T10:00:00Z'), // 2h ago, repeated id counts once
    msg('b', '2026-11-02T05:00:00Z'), // 7h ago: 7d only
    msg('c', '2026-10-20T00:00:00Z'), // outside 7d
    msg('e', '2026-11-02T11:45:00Z'), // 15 min ago: counts toward the 30 min burn rate
  ]
  fs.mkdirSync(path.join(root, 'p'))
  fs.writeFileSync(path.join(root, 'p', 's.jsonl'), lines.map(l => JSON.stringify(l)).join('\n'))
  const old = path.join(root, 'p', 'old.jsonl')
  fs.writeFileSync(old, JSON.stringify(msg('d', '2026-11-02T11:00:00Z')))
  fs.utimesSync(old, new Date('2026-10-01'), new Date('2026-10-01')) // mtime outside 7d: skipped
  const w = await windows({ now, root, limits: { fiveHour: 11000 } })
  const w7 = await windows({ now, root, limits: { sevenDay: 10000 } })
  fs.mkdirSync(path.join(root, 'q'))
  fs.writeFileSync(path.join(root, 'q', 's.jsonl'), JSON.stringify(msg('a', '2026-11-02T10:00:00Z'))) // second project, same message id: dedupe is per file
  const sp = await spendByProject({ now, root })
  fs.rmSync(root, { recursive: true })
  assert.deepStrictEqual(sp['1d'].map(r => [r.project, r.tokens]), [['p', 3300], ['q', 1100]], '1 d: p has a, b, e')
  assert.deepStrictEqual(sp['30d'].map(r => [r.project, r.tokens]), [['p', 4400], ['q', 1100]], '30 d adds c from Oct 20')
  assert.ok(Math.abs(sp['1d'][1].usd - (1000 * 3 + 100 * 15) / 1e6) < 1e-12)
  assert.deepStrictEqual(validLimits({ fiveHour: 5, sevenDay: 10 }), { fiveHour: 5, sevenDay: 10 })
  for (const bad of [null, {}, { fiveHour: 5 }, { fiveHour: 0, sevenDay: 1 }, { fiveHour: -1, sevenDay: 1 }, { fiveHour: 1.5, sevenDay: 1 }, { fiveHour: '5', sevenDay: 1 }, { fiveHour: 1, sevenDay: 1e13 }]) assert.throws(() => validLimits(bad))
  assert.deepStrictEqual([w7.sevenDay.hitAt, w7.sevenDay.warn], [null, false], '7 d: 33% used, no pace projection, no warn')
  assert.strictEqual(w.fiveHour.total, 2200)
  assert.strictEqual(w.sevenDay.total, 3300)
  assert.strictEqual(w.fiveHour.pct, 0.2)
  assert.strictEqual(w.fiveHour.burn, 1100 / 30)
  assert.strictEqual(w.fiveHour.resetAt, Date.parse('2026-11-02T15:00:00Z'), 'oldest in-window msg (10:00) + 5 h')
  assert.strictEqual(w.fiveHour.hitAt, Date.parse('2026-11-02T16:00:00Z'), '8800 left at 1100/30 per min = 240 min')
  assert.strictEqual(w.fiveHour.warn, false, 'hits after reset and under 80%')
  assert.strictEqual(w.sevenDay.hitAt, null, 'no limit, no projection')
  assert.strictEqual(w.sevenDay.resetAt, now + 7 * 864e5, '7 d horizon, not oldest + 7 d')
  assert.strictEqual(w.sevenDay.limit, null)
  assert.deepStrictEqual([w.byHour[5], w.byHour[10], w.byHour[11]], [1100, 1100, 1100], 'per UTC hour today; old-mtime file d stays skipped')
  assert.strictEqual(w.byHour.reduce((a, b) => a + b, 0), 3300)
  assert.ok(Math.abs(w.fiveHour.usd - 2 * (1000 * 3 + 100 * 15) / 1e6) < 1e-12)
  console.log('ok: cost')
})().catch(e => { console.error(e); process.exit(1) })
