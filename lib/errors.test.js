// Self-check: node lib/errors.test.js
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { scanErrors, firstLine, app } = require('./errors')

;(async () => {
  assert.strictEqual(firstLine('Exit code 1\nnpm ERR! missing script'), 'Exit code 1: npm ERR! missing script')
  assert.strictEqual(firstLine([{ type: 'text', text: '<tool_use_error>File has not been read yet</tool_use_error>' }]), 'File has not been read yet')
  assert.strictEqual(app('mcp__plugin_figma_figma__use_figma'), 'figma')
  assert.strictEqual(app('mcp__github__create_issue'), 'github')
  assert.strictEqual(app('Bash'), null)

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-err-'))
  fs.mkdirSync(path.join(root, 'p'))
  const now = Date.parse('2026-11-04T12:00:00Z')
  const use = (id, name) => ({ type: 'assistant', timestamp: '2026-11-04T09:00:00Z', message: { id: 'm' + id, content: [{ type: 'tool_use', id, name }] } })
  const res = (id, ts, content, is_error = true) => ({ type: 'user', sessionId: 'S1', timestamp: ts, message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] } })
  const lines = [
    use('t1', 'Bash'), res('t1', '2026-11-04T09:00:01Z', 'Exit code 2\nboom'),
    use('t2', 'mcp__plugin_figma_figma__use_figma'), res('t2', '2026-11-03T09:00:01Z', [{ type: 'text', text: 'bad node' }]),
    use('t3', 'Bash'), res('t3', '2026-11-04T09:00:02Z', 'fine', false), // not an error
    use('t4', 'Edit'), res('t4', '2026-11-04T09:00:03Z', 'Permission for this action was denied by the user'), // denial: skipped
    use('t5', 'Bash'), res('t5', '2026-10-20T09:00:00Z', 'old'), // outside 7 days
  ]
  fs.writeFileSync(path.join(root, 'p', 's.jsonl'), lines.map(l => JSON.stringify(l)).join('\n'))
  const r = await scanErrors({ days: 7, now, root })
  fs.rmSync(root, { recursive: true })
  assert.strictEqual(r.total, 2)
  assert.strictEqual(r.today, 1)
  assert.deepStrictEqual(r.todayByTool, [{ tool: 'Bash', n: 1 }])
  assert.deepStrictEqual(r.byApp, { figma: 1 })
  assert.deepStrictEqual(r.byDay, { '2026-11-04': 1, '2026-11-03': 1 })
  assert.strictEqual(r.recent[0].first, 'Exit code 2: boom')
  assert.strictEqual(r.recent[0].session, 'S1')
  console.log('ok: errors')
})().catch(e => { console.error(e); process.exit(1) })
