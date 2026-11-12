// Self-check: node lib/apps.test.js
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { parseCalls, rollup, auditPrompt } = require('./apps')

;(async () => {
  const tmp = path.join(os.tmpdir(), `aos-apps-${process.pid}.jsonl`)
  const use = (id, name) => ({ type: 'assistant', timestamp: '2026-11-01T10:00:00Z', message: { content: [{ type: 'tool_use', id, name }] } })
  const lines = [use('a', 'mcp__figma__get_screenshot'), use('a', 'mcp__figma__get_screenshot'), use('b', 'mcp__figma__use_figma'),
    use('c', 'mcp__claude_ai_Gmail__search'), use('d', 'mcp__plugin_figma_figma__whoami'), use('e', 'Bash')]
  fs.writeFileSync(tmp, lines.map(l => JSON.stringify(l)).join('\n'))
  const calls = await parseCalls(tmp)
  fs.unlinkSync(tmp)
  assert.strictEqual(calls.length, 4, 'dedupe by tool_use id, skip non-mcp')
  const { items, unused30 } = rollup({ f: { calls } }, [{ name: 'figma', kind: 'mcp' }, { name: 'idle', kind: 'mcp' }], Date.parse('2026-11-02'))
  const g = n => items.find(i => i.name === n)
  assert.strictEqual(g('figma').kind, 'mcp')
  assert.strictEqual(g('figma').calls30, 2)
  assert.strictEqual(g('figma').estOverhead, 300)
  assert.strictEqual(items.filter(i => i.name === 'figma').length, 2, 'plugin figma kept apart from mcp figma')
  assert.strictEqual(g('claude_ai_Gmail').kind, 'connector')
  assert.deepStrictEqual(unused30.map(i => i.name), ['idle'])
  const p = auditPrompt(items)
  assert.ok(p.includes('claude_ai_Gmail') && !p.includes(String.fromCharCode(8212)))
  console.log('ok: apps')
})().catch(e => { console.error(e); process.exit(1) })
