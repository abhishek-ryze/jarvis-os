// Self-check: node lib/search.test.js
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { search } = require('./search')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-search-'))
const proj = path.join(root, 'C--demo')
fs.mkdirSync(path.join(proj, 'subagents'), { recursive: true })
const line = o => JSON.stringify(o)
fs.writeFileSync(path.join(proj, 'a.jsonl'), [
  line({ type: 'user', isMeta: true, message: { content: 'injected skill body zebra' } }),
  line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'zebra' }] } }),
  line({ type: 'user', message: { content: 'Fix the zebra crossing bug' } }),
].join('\n'))
fs.writeFileSync(path.join(proj, 'subagents', 'b.jsonl'), line({ type: 'user', message: { content: 'zebra sub' } }))

fs.writeFileSync(path.join(proj, 'c.jsonl'), [
  line({ type: 'ai-title', aiTitle: 'Quagga migration', sessionId: 'c' }),
  line({ type: 'user', message: { content: 'plan the giraffe move' } }),
].join('\n'))
const reports = path.join(root, 'reports')
fs.mkdirSync(reports)
fs.writeFileSync(path.join(reports, '2026-01-01T00-00-00-000Z_zebra-run.md'), '# zebra-run\n\nmodel: haiku, effort: low, permission mode: plan\nstarted: x\n')
const src = {
  root,
  reports,
  skills: [
    { id: 'zebra-sk', source: 'user', file: '/s/zebra/SKILL.md', description: 'x' },
    { id: 'other', source: 'user', file: '/s/o/SKILL.md', description: 'about a zebra herd' },
  ],
  memory: { dir: '/m', entries: [
    { title: 'Big zebra note', file: 'z.md', hook: '', type: 'feedback', state: { kind: 'HANDOFF', path: '/p/zebra-app/HANDOFF.md' } },
  ] },
}
const r = search('zebra', 20, src)
assert.strictEqual(r[0].title, 'zebra-sk', 'title prefix first')
assert.deepStrictEqual(r.map(x => x.kind).sort(), ['memory', 'project', 'report', 'session', 'skill', 'skill'])
assert.strictEqual(r[r.length - 1].title, 'other', 'body-only match ranks last')
const s = r.find(x => x.kind === 'session')
assert.strictEqual(s.title, 'Fix the zebra crossing bug', 'skips meta and tool_result lines')
assert.ok(s.sub.startsWith('C--demo | '))
assert.strictEqual(r.filter(x => x.kind === 'session').length, 1, 'subagent files skipped')
assert.strictEqual(search('zebra', 2, src).length, 2, 'limit')
const rp = r.find(x => x.kind === 'report')
assert.strictEqual(rp.title, 'zebra-run')
assert.deepStrictEqual(rp.target, { view: 'Skills', report: '2026-01-01T00-00-00-000Z_zebra-run.md' })
assert.deepStrictEqual(s.target, { view: 'Sessions', id: 'a' })
assert.deepStrictEqual(r.find(x => x.kind === 'skill').target, { view: 'Skills', id: 'zebra-sk' })
assert.deepStrictEqual(r.find(x => x.kind === 'memory').target, { file: path.join('/m', 'z.md') })
const qg = search('quagga', 5, src)[0], gf = search('giraffe', 5, src)[0]
assert.strictEqual(qg.title, 'Quagga migration', 'session title from ai-title')
assert.strictEqual(gf.title, 'Quagga migration', 'first prompt is searchable too')
assert.deepStrictEqual(search('  ', 20, src), [])
fs.rmSync(root, { recursive: true })
console.log('search.test.js ok')
