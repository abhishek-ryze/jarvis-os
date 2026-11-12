// Self-check: node lib/timeline.test.js
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { parseEdits, summarizeTimeline, rowOf, diffEvents } = require('./timeline')

;(async () => {
  const tmp = path.join(os.tmpdir(), `aos-tl-${process.pid}.jsonl`)
  const use = (ts, name, input) => ({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'tool_use', name, input }] } })
  const lines = [
    use('2026-11-01T10:00:00', 'Edit', { file_path: 'C:\\u\\.claude\\skills\\reflect\\SKILL.md' }),
    use('2026-11-01T11:00:00', 'Edit', { file_path: 'C:\\u\\.claude\\skills\\reflect\\SKILL.md' }),
    use('2026-11-02T09:00:00', 'Write', { file_path: 'C:/u/.claude/projects/p/memory/note.md' }),
    use('2026-11-02T09:30:00', 'Read', { file_path: 'C:/u/x.md' }),
    use('2026-11-02T09:40:00', 'Write', { file_path: 'C:/u/CLAUDE.md' }),
  ]
  fs.writeFileSync(tmp, lines.map(l => JSON.stringify(l)).join('\n'))
  const edits = await parseEdits(tmp)
  fs.unlinkSync(tmp)
  assert.strictEqual(edits.length, 4, 'Read ignored')
  assert.deepStrictEqual(['a/skills/b.md', 'a/memory/b.md', 'a/MEMORY.md', 'a/CLAUDE.md'].map(rowOf), ['skills', 'memory', 'memory', 'claude'])

  const t = summarizeTimeline({ ['proj' + path.sep + 's1.jsonl']: { edits } }, 36500)
  assert.deepStrictEqual(t.days.map(d => d.date), ['2026-11-02', '2026-11-01'], 'newest first')
  assert.strictEqual(t.days[1].rows.skills.length, 1, 'same path deduped')
  assert.strictEqual(t.days[1].rows.skills[0].count, 2)
  assert.strictEqual(t.days[0].rows.memory[0].project, 'proj')
  assert.strictEqual(t.days[0].rows.claude.length, 1)
  assert.deepStrictEqual(['C:/u/AGENTS.md', 'C:/u/.claude/rules/a.md', 'C:/u/.mcp.json', 'C:/u/.claude/plugins/x/y.json', 'C:/u/.claude/scheduled-tasks/t/SKILL.md'].map(rowOf), ['claude', 'claude', 'apps', 'apps', 'routines'])
  const old = summarizeTimeline({ k: { edits: [['2020-01-01T10:00:00', 'C:/u/CLAUDE.md'], ['2020-01-02T10:00:00', 'C:/u/CLAUDE.md'], [new Date().toISOString(), 'C:/u/CLAUDE.md']] } }, 14)
  assert.strictEqual(old.older.claude, 1, 'older counts distinct files before the window')
  const ev = diffEvents([['b', 'p', { content: 'x' }, 'Write'], ['a', 'p', { old_string: 'o', new_string: 'n' }, 'Edit'], ['c', 'p', { edits: [{ old_string: '1', new_string: '2' }, { old_string: '3', new_string: '4' }] }, 'MultiEdit']])
  assert.deepStrictEqual(ev.map(e => e.kind + e.old + e.new), ['editon', 'writex', 'edit12', 'edit34'], 'sorted by time, MultiEdit expanded')
  console.log('ok: timeline')
})().catch(e => { console.error(e); process.exit(1) })
