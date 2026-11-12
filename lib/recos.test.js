// Self-check: node lib/recos.test.js
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const r = require('./recos')
const EM = String.fromCharCode(0x2014)

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-reco-'))
try {
  fs.writeFileSync(path.join(dir, 'a.md'), '---\ntitle: Trim CLAUDE.md\narea: Memory\nbenefit: Fewer tokens\neffort: LOW\npriority: urgent\n---\nCut the file by half.')
  fs.writeFileSync(path.join(dir, 'nofm.md'), 'no frontmatter')
  fs.writeFileSync(path.join(dir, 'notitle.md'), '---\narea: X\n---\nbody')
  const files = r.fromFiles(dir)
  assert.strictEqual(files.length, 1)
  assert.deepStrictEqual([files[0].id, files[0].effort, files[0].priority, files[0].what], ['file-a', 'low', 'medium', 'Cut the file by half.'], 'levels normalised')

  const now = Date.parse('2026-11-04T00:00:00Z')
  const list = r.build({
    apps: { unused30: [{ name: 'figma', kind: 'plugin', estOverhead: 300 }] },
    usage: { bySkill: { used: { runs: 3, last: '2026-11-01T00:00:00Z' }, old: { runs: 1, last: '2026-08-01T00:00:00Z' } } },
    skills: [{ id: 'used', source: 'user' }, { id: 'old', source: 'user' }, { id: 'never', source: 'user' }, { id: 'plug:x', source: 'plugin' }],
    notes: [{ stem: 'old', skill: 'old', file: 'old.md', text: 'fix the intro' }],
    cold: { netSaving: 12.5, reloads: 4, reloadCost: 20, days: 30 }, files, now,
  })
  assert.deepStrictEqual(list.map(x => x.id), ['apps-unused', 'skills-retire', 'note-old', 'cold-cache', 'file-a'])
  assert.ok(list[1].what.includes('old') && list[1].what.includes('never') && !list[1].what.includes('used,') && !list[1].what.includes('plug:x'), 'only idle user skills')
  assert.strictEqual(r.build({ apps: { unused30: [] }, usage: null, cold: { netSaving: 0 } }).length, 0, 'no signal, no card')

  const p = r.applyPrompt(list, [{ id: 'note-old', comment: 'do it ' + EM + ' now' }, { id: 'nope', comment: 'x' }])
  assert.ok(p.includes('Fix note: old') && p.includes('do it , now') && !p.includes('nope'))
  assert.ok(!p.includes(EM), 'no em dash')
  console.log('ok: recos')
} finally { fs.rmSync(dir, { recursive: true, force: true }) }
