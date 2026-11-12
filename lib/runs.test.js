// Self-check: node lib/runs.test.js
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { loadPast, readReport, history } = require('./runs')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-runs-'))
const log = path.join(dir, 'runs.log')
assert.deepStrictEqual(loadPast(path.join(dir, 'nope.log')), [], 'missing log gives empty list')
fs.writeFileSync(log, ['2026-11-02T15:39:16.000Z\ta\thaiku\tlow\t0\tr1.md', '2026-11-02T16:00:00.000Z\tb\topus\thigh\t1\tr2.md', ''].join('\n'))
const past = loadPast(log)
assert.deepStrictEqual(past.map(r => [r.skill, r.status, r.exit]), [['b', 'failed', 1], ['a', 'done', 0]], 'newest first')
assert.strictEqual(past[1].id, 'r1')

const head = (s, m, t) => `# ${s}\n\nmodel: ${m}, effort: low, permission mode: acceptEdits\nstarted: ${t}\n\n---\n\nbody`
fs.writeFileSync(path.join(dir, 'r1.md'), head('a', 'haiku', '2026-11-02T15:38:59.000Z'))
const rep = readReport(dir, '../r1.md', past)
assert.strictEqual(rep.meta.duration, 17000)
assert.strictEqual(rep.meta.mode, 'acceptEdits')
assert.strictEqual(rep.meta.exit, 0)

const live = [{ id: 'x', skill: 'c', model: 'sonnet', effort: 'low', mode: 'plan', status: 'running', started: 5, report: 'x.md' }]
const h = history(dir, live, past)
assert.strictEqual(h[0].skill, 'c', 'live runs first')
assert.strictEqual(h[0].duration, null)
assert.strictEqual(h[2].duration, 17000, 'past run duration from report header')
assert.strictEqual(h[2].mode, 'acceptEdits')
assert.strictEqual(h[1].mode, null, 'missing report leaves mode blank')
assert.ok(!('cost' in h[2]), 'cost is never invented')
console.log('runs ok')
