// Self-check: node lib/brain-index.test.js
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { build, load, allowedSet, isIndexed, readPreview, MAX_PREVIEW } = require('./brain-index')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-brain-'))
const home = path.join(root, '.claude'), out = path.join(root, 'cache', 'brain-index.json')
const put = (rel, text) => { const f = path.join(home, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f }
try {
  put('CLAUDE.md', '# Rules\nUse `reflect`.\n')
  put('skills/reflect/SKILL.md', '---\nname: reflect\ndescription: review\n---\nbody')
  const mem = put('projects/p1/memory/MEMORY.md', '- [[note]]\n')
  put('projects/p1/memory/note.md', '---\r\nname: note\r\ntags: [alpha, "beta"]\r\nmetadata:\r\n  type: feedback\r\n---\r\na note')
  put('design/d.md', '---\ntags:\n  - x\n  - y\n---\nbody')
  const big = put('projects/p1/memory/big.md', 'x'.repeat(MAX_PREVIEW + 10))

  const g = build(home, out)
  assert.ok(fs.existsSync(out), 'index written')
  assert.strictEqual(g.nodes.length, 6)
  assert.ok(g.builtAt && g.edges.length >= 2, 'rule->skill and memory->note links')
  assert.deepStrictEqual(load(home, out).nodes.map(n => n.id), g.nodes.map(n => n.id), 'load reads the cache')
  const tagsBy = name => g.nodes.find(n => path.basename(n.id) === name).tags
  assert.deepStrictEqual(tagsBy('note.md'), ['alpha', 'beta', 'memory: feedback'], 'inline tags + memory type')
  assert.deepStrictEqual(tagsBy('d.md'), ['x', 'y'], 'list tags')
  assert.strictEqual(tagsBy('MEMORY.md'), undefined, 'no tags field when none')

  // a cache without the current version is rebuilt
  fs.writeFileSync(out, JSON.stringify({ nodes: [], edges: [] }))
  assert.strictEqual(load(home, out).nodes.length, 6, 'old cache rebuilt')

  // a new file shows only after a rebuild
  put('projects/p1/memory/new.md', 'new')
  assert.strictEqual(load(home, out).nodes.length, 6)
  const g2 = build(home, out)
  assert.ok(g2.nodes.some(n => path.basename(n.id) === 'new.md'), 'new file after refresh')

  // preview: indexed files only, capped, text only
  const set = allowedSet(g2)
  assert.ok(isIndexed(set, mem))
  assert.strictEqual(readPreview(set, mem).text, '- [[note]]\n')
  const r = readPreview(set, big)
  assert.ok(r.truncated && r.text.length === MAX_PREVIEW, 'capped')
  for (const p of ['C:/Windows/win.ini', path.join(home, 'settings.json'), path.join(home, 'skills', '..', '..', 'x'), '', null, 42]) {
    assert.throws(() => readPreview(set, p), e => e.code === 403, `refused: ${p}`)
  }
  put('projects/p1/memory/bin.md', 'a\0b')
  const set3 = allowedSet(build(home, out))
  assert.throws(() => readPreview(set3, path.join(home, 'projects/p1/memory/bin.md')), e => e.code === 415, 'binary refused')
  console.log('ok: brain index build, refresh, preview guard')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
