// Self-check: node lib/tools.test.js
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const t = require('./tools')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-tools-'))
const write = (dir, cfg) => { fs.mkdirSync(path.join(dir, '.claude'), { recursive: true }); fs.writeFileSync(path.join(dir, '.claude', 'launch.json'), JSON.stringify(cfg)) }
const proj = path.join(root, 'proj'), wt = path.join(root, 'proj', '.claude', 'worktrees', 'x'), bad = path.join(root, 'bad')
write(proj, { configurations: [
  { name: 'srv', runtimeExecutable: 'node', runtimeArgs: ['srv.js'], port: 45871 },
  { name: 'web', runtimeExecutable: 'npm', runtimeArgs: ['run', 'dev'], port: 45872 },
  { name: 'noport', runtimeExecutable: 'node' },
] })
write(wt, { configurations: [{ name: 'copy', runtimeExecutable: 'node', port: 45873 }] })
fs.mkdirSync(path.join(bad, '.claude'), { recursive: true }); fs.writeFileSync(path.join(bad, '.claude', 'launch.json'), '{ broken')
fs.writeFileSync(path.join(proj, 'srv.js'), "require('http').createServer((q, s) => s.end('hi')).listen(45871, '127.0.0.1'); setTimeout(() => process.exit(), 3000)")

;(async () => {
  try {
    const list = t.list([proj, proj.toUpperCase(), wt, bad, path.join(root, 'missing')])
    assert.deepStrictEqual(list.map(x => x.name), ['srv', 'web'], 'dedupe, skip worktrees, broken json and entries with no port')
    assert.strictEqual(list[0].dir, proj)
    assert.strictEqual(list[0].url, 'http://localhost:45871/')
    assert.strictEqual(await t.probe(45871), false)
    const r = await t.start(list.find(x => x.name === 'web'))
    assert.ok(!r.ok && r.error.includes('npm run dev'), 'non-node entries are not spawned')
    assert.deepStrictEqual(await t.start(list[0]), { ok: true })
    assert.deepStrictEqual(await t.start(list[0]), { ok: true, already: true }, 'second start does not spawn again')
    await new Promise((res, rej) => http.get('http://127.0.0.1:45871/', s => { s.resume(); s.statusCode === 200 ? res() : rej(new Error('bad status')) }).on('error', rej))
    console.log('ok: tools')
  } finally {
    // the test server exits by itself after 3 s; then the temp folder can go
    setTimeout(() => { try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10 }); fs.rmSync(path.join(__dirname, '..', 'cache', 'tools', 'proj-srv.log'), { force: true }) } catch {} }, 3500)
  }
})().catch(e => { console.error(e); process.exitCode = 1 })
