// Self-check: node lib/scan.test.js
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { scanSkills, parseFile, summarize, scanMemory, scanGraph, frontmatter } = require('./scan')

;(async () => {
  assert.deepStrictEqual(frontmatter('---\nname: x\nmodel: haiku\n---\nbody'), { name: 'x', model: 'haiku' })
  assert.strictEqual(frontmatter('---\ndescription: >\n  one\n  two\nname: y\n---').description, 'one two')

  // Same message id on two lines must count once; tool_result user lines are not turns.
  const tmp = path.join(os.tmpdir(), `aos-${process.pid}.jsonl`)
  const usage = { input_tokens: 1, cache_creation_input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 5 }
  const lines = [
    { type: 'user', timestamp: '2026-11-01T10:00:00Z', message: { content: 'hello' } },
    { type: 'assistant', timestamp: '2026-11-01T10:00:01Z', message: { id: 'm1', model: 'x', usage, content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'reflect' } }] } },
    { type: 'assistant', timestamp: '2026-11-01T10:00:01Z', message: { id: 'm1', model: 'x', usage, content: [{ type: 'text', text: 'hi' }] } },
    { type: 'user', timestamp: '2026-11-01T10:00:02Z', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'user', isMeta: true, timestamp: '2026-11-01T10:00:02Z', message: { content: [{ type: 'text', text: 'skill body' }] } },
    { type: 'assistant', timestamp: '2026-11-01T10:00:03Z', message: { id: 'm2', model: 'x', usage, content: [] } },
    { type: 'user', timestamp: '2026-11-01T10:01:00Z', message: { content: 'next' } },
    { type: 'assistant', timestamp: '2026-11-01T10:01:01Z', message: { id: 'm3', model: 'x', usage, content: [] } },
  ]
  fs.writeFileSync(tmp, lines.map(l => JSON.stringify(l)).join('\n'))
  const r = await parseFile(tmp)
  fs.unlinkSync(tmp)
  assert.strictEqual(r.total.output, 15, 'three unique messages')
  assert.strictEqual(r.turns, 2)
  assert.strictEqual(r.skills.length, 1)
  assert.strictEqual(r.skills[0].tokens.output, 10, 'skill accrues m1 + m2, stops at next prompt')

  const sum = summarize({ ['p' + path.sep + 's.jsonl']: { ...r, sub: false } }, ['reflect'])
  assert.strictEqual(sum.bySkill.reflect.runs, 1)
  assert.strictEqual(sum.sessions.length, 1)

  const skills = scanSkills()
  assert.ok(skills.some(s => s.id === 'reflect'), 'user skill found')
  assert.ok(skills.some(s => s.id.startsWith('figma:')), 'enabled plugin skill found')
  assert.ok(!skills.some(s => s.id.startsWith('remotion:')), 'disabled plugin skipped')
  assert.strictEqual(new Set(skills.map(s => s.id)).size, skills.length, 'no duplicate ids')

  const mem = scanMemory()
  assert.ok(mem.count >= 30, `memory entries: ${mem.count}`)
  assert.ok(mem.entries.some(e => e.state && e.state.exists), 'at least one project state file resolves')
  const g = scanGraph()
  const ids = new Set(g.nodes.map(n => n.id))
  assert.ok(g.nodes.length > 0 && g.nodes.length <= 400 && g.edges.length > 0 && g.edges.every(e => ids.has(e.source) && ids.has(e.target)), 'graph edges join known nodes')
  console.log(`graph: ${g.nodes.length} nodes, ${g.edges.length} edges`)
  console.log(`ok: ${skills.length} skills, ${mem.count} memories, ${mem.entries.filter(e => e.state).length} state refs`)
})().catch(e => { console.error(e); process.exit(1) })
