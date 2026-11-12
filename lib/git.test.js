const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { gitStatus } = require('./git')

const g = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd, stdio: 'pipe' })
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gitt-'))
;(async () => {
  try {
    const plain = path.join(tmp, 'plain'); fs.mkdirSync(plain)
    assert.strictEqual((await gitStatus(plain)).repo, false)

    const bare = path.join(tmp, 'bare.git'), a = path.join(tmp, 'a'), b = path.join(tmp, 'b')
    g(tmp, 'init', '--bare', '-b', 'main', bare)
    g(tmp, 'init', '-b', 'main', a)
    fs.writeFileSync(path.join(a, 'f.txt'), '1'); g(a, 'add', '.'); g(a, 'commit', '-m', 'one')
    let s = await gitStatus(a)
    assert.strictEqual(s.repo, true); assert.strictEqual(s.upstream, false); assert.strictEqual(s.ahead, null)

    g(a, 'remote', 'add', 'origin', bare); g(a, 'push', '-u', 'origin', 'main')
    fs.writeFileSync(path.join(a, 'f.txt'), '2'); fs.writeFileSync(path.join(a, 'new.txt'), 'x')
    g(a, 'commit', '-am', 'two')
    fs.writeFileSync(path.join(a, 'dirty.txt'), 'x')
    g(a, 'branch', 'done'); g(a, 'worktree', 'add', path.join(tmp, 'wt'), '-b', 'wtb')
    s = await gitStatus(a)
    assert.deepStrictEqual([s.branch, s.dirty, s.upstream, s.ahead, s.behind, s.worktrees, s.merged], ['main', 2, true, 1, 0, 1, 2])

    g(a, 'push'); g(tmp, 'clone', bare, b)
    fs.writeFileSync(path.join(b, 'f.txt'), '3'); g(b, 'commit', '-am', 'three'); g(b, 'push')
    g(a, 'fetch') // test setup only; the module itself never fetches
    s = await gitStatus(a)
    assert.deepStrictEqual([s.ahead, s.behind], [0, 1])
    console.log('git ok')
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
})().catch(e => { console.error(e); process.exit(1) })
