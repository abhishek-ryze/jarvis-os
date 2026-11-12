// Read-only git status. Only runs: rev-parse, status, rev-list, worktree list, branch.
const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

const run = (cwd, args, timeout = 8000) => new Promise(resolve =>
  execFile('git', args, { cwd, timeout, windowsHide: true, maxBuffer: 4 << 20 }, (err, stdout) =>
    resolve(err ? { ok: false, code: err.code, timedOut: !!err.killed } : { ok: true, out: stdout })))

const lines = s => s.split('\n').map(l => l.trim()).filter(Boolean)

async function gitStatus(dir) {
  const top = await run(dir, ['rev-parse', '--is-inside-work-tree'])
  if (!top.ok) return { path: dir, repo: false, error: top.code === 'ENOENT' ? 'git missing' : top.timedOut ? 'timeout' : null }
  const [st, up, bh, wt, br, cur] = await Promise.all([
    run(dir, ['status', '--porcelain']),
    run(dir, ['rev-list', '--count', '@{u}..HEAD']),
    run(dir, ['rev-list', '--count', 'HEAD..@{u}']),
    run(dir, ['worktree', 'list', '--porcelain']),
    run(dir, ['for-each-ref', '--merged=HEAD', '--format=%(refname:short)', 'refs/heads']),
    run(dir, ['branch', '--show-current']),
  ])
  const current = cur.ok ? cur.out.trim() : ''
  const upstream = up.ok // fails when no upstream is set
  return {
    path: dir, repo: true, branch: current || null,
    dirty: st.ok ? lines(st.out).length : null,
    upstream, ahead: upstream ? +up.out : null, behind: upstream && bh.ok ? +bh.out : null,
    // The first entry is the main checkout; the rest are leftover worktrees.
    worktrees: wt.ok ? Math.max(0, lines(wt.out).filter(l => l.startsWith('worktree ')).length - 1) : null,
    merged: br.ok ? lines(br.out).filter(b => b !== current && !['main', 'master', 'develop'].includes(b)).length : null,
  }
}

// The Claude config folder plus any extra repos listed in config.json gitRepos.
const claudeDirs = (extra = []) => [...[require('./scan').HOME].filter(d => fs.existsSync(path.join(d, '.git'))), ...(Array.isArray(extra) ? extra.filter(d => typeof d === 'string' && d).map(d => path.resolve(d)) : [])]

module.exports = { gitStatus, claudeDirs }
