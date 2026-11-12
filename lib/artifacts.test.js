// Self-check: node lib/artifacts.test.js
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { list, isAllowed, setHidden, readHidden } =require('./artifacts')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-art-'))
const dir = path.join(root, 'client')
const outside = path.join(root, 'elsewhere')
for (const d of [path.join(dir, 'sub'), path.join(dir, 'node_modules'), path.join(dir, '.git'), outside]) fs.mkdirSync(d, { recursive: true })
const put = (p, t) => { fs.writeFileSync(p, 'x'); fs.utimesSync(p, t, t) }
put(path.join(dir, 'acme-deck.pptx'), 1000)
put(path.join(dir, 'sub', 'brand.PNG'), 2000)
put(path.join(dir, 'notes.txt'), 3000) // wrong type
put(path.join(dir, 'node_modules', 'skip.html'), 3000)
put(path.join(dir, '.git', 'skip.pdf'), 3000)
put(path.join(outside, 'secret.pdf'), 3000)

try {
  const cfg = { artifactDirs: [dir] }
  const r = list(cfg)
  assert.strictEqual(r.count, 2, 'count matches indexable files on disk')
  assert.deepStrictEqual(r.items.map(i => i.name), ['brand.PNG', 'acme-deck.pptx'], 'newest first')
  assert.strictEqual(r.items[0].ext, 'png')
  assert.strictEqual(r.items[0].folder, dir)
  assert.strictEqual(r.hint, undefined)
  assert.strictEqual(list(cfg, 'ACME').count, 1, 'filter is case-insensitive')
  assert.strictEqual(list(cfg, '', 1).items.length, 1, 'limit applies')
  assert.ok(list({}).hint && list({}).count === 0, 'no dirs gives a hint')

  assert.ok(isAllowed(cfg, path.join(dir, 'sub', 'brand.PNG')))
  assert.ok(!isAllowed(cfg, path.join(outside, 'secret.pdf')), 'outside dirs refused')
  assert.ok(!isAllowed(cfg, path.join(dir, '..', 'elsewhere', 'secret.pdf')), 'dot-dot escape refused')
  assert.ok(!isAllowed(cfg, path.join(dir, 'run.exe')), 'unlisted type refused')
  assert.ok(!isAllowed(cfg, dir), 'the folder itself refused')
  assert.deepStrictEqual(r.items.map(i => i.type), ['image', 'deck'], 'type from extension')
  const hf = path.join(root, 'hub.json')
  const hid = setHidden(path.join(dir, 'sub', 'brand.PNG'), true, hf)
  assert.deepStrictEqual(list(cfg, '', 50, hid).items.map(i => i.name), ['acme-deck.pptx'], 'hidden item leaves the list')
  assert.ok(fs.existsSync(path.join(dir, 'sub', 'brand.PNG')), 'hide never deletes')
  assert.strictEqual(readHidden(hf).size, 1, 'hide list persists')
  assert.strictEqual(setHidden(path.join(dir, 'sub', 'brand.PNG'), false, hf).size, 0)
  console.log('ok: artifacts')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
