// /api/git (project folders known from memory pointers) and /api/setup-sync (~/.claude repos).
const path = require('path')
const fs = require('fs')
const scan = require('./scan')
const git = require('./git')

const norm = p => path.resolve(p).toLowerCase()
function projectDirs() {
  const dirs = new Map()
  try { for (const e of scan.scanMemory().entries) if (e.state) dirs.set(norm(path.dirname(e.state.path)), path.dirname(e.state.path)) } catch {}
  return dirs
}

module.exports = async function routes(req, res, url, ctx) {
  if (req.method !== 'GET') return false
  if (url.pathname === '/api/git') {
    const known = projectDirs(), allowed = new Set([...known.keys(), ...git.claudeDirs(ctx.config().gitRepos).map(norm)])
    const want = url.searchParams.get('path')
    const dirs = want ? [want] : [...known.values()]
    const repos = await Promise.all(dirs.map(d => allowed.has(norm(d)) && fs.existsSync(d) ? git.gitStatus(path.resolve(d)) : { path: d, repo: false, error: 'unknown folder' }))
    ctx.send(res, 200, { repos })
    return true
  }
  if (url.pathname === '/api/setup-sync') {
    ctx.send(res, 200, { repos: await Promise.all(git.claudeDirs(ctx.config().gitRepos).map(d => git.gitStatus(d))) })
    return true
  }
  return false
}
