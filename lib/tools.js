// Tools: local server apps found in <project>/.claude/launch.json, for every folder a Claude session ran in.
const fs = require('fs')
const path = require('path')
const net = require('net')
const { spawn } = require('child_process')

const SELF = path.resolve(__dirname, '..')
const LOGS = path.join(require('./scan').CACHE_DIR, 'tools')
const isWorktree = d => /[\\/]\.claude[\\/]worktrees[\\/]/i.test(d)

function list(cwds) {
  const seen = new Set(), out = []
  for (const raw of cwds) {
    const dir = path.resolve(raw)
    if (isWorktree(dir) || seen.has(dir.toLowerCase())) continue
    seen.add(dir.toLowerCase())
    let cfg
    try { cfg = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'launch.json'), 'utf8')) } catch { continue }
    for (const c of Array.isArray(cfg.configurations) ? cfg.configurations : []) {
      const port = +c.port
      if (!c || typeof c.name !== 'string' || !c.name || !(port > 0 && port < 65536)) continue
      const args = Array.isArray(c.runtimeArgs) ? c.runtimeArgs.map(String) : []
      out.push({
        id: `${dir.toLowerCase()}|${c.name}`, name: c.name, project: path.basename(dir), dir, port,
        exe: String(c.runtimeExecutable || ''), args, cmd: [c.runtimeExecutable, ...args].join(' '),
        url: `http://localhost:${port}/`, self: dir.toLowerCase() === SELF.toLowerCase(),
      })
    }
  }
  return out.sort((a, b) => a.project.localeCompare(b.project) || a.name.localeCompare(b.name))
}

// true when something listens on the port, whoever started it.
const probe = (port, ms = 400) => new Promise(resolve => {
  const s = net.connect({ host: '127.0.0.1', port })
  const done = ok => { s.destroy(); resolve(ok) }
  s.setTimeout(ms, () => done(false))
  s.once('connect', () => done(true)).once('error', () => done(false))
})

// The entry must come from list(), never from the request body.
async function start(t) {
  if (await probe(t.port)) return { ok: true, already: true }
  // ponytail: node entries only; npm/npx are .cmd files that need shell: true and arg quoting. Add when a tool needs it.
  if (t.exe !== 'node') return { ok: false, error: `Start it by hand in ${t.dir}: ${t.cmd}` }
  fs.mkdirSync(LOGS, { recursive: true })
  const log = path.join(LOGS, `${t.project}-${t.name}.log`.replace(/[^\w.-]+/g, '_'))
  const fd = fs.openSync(log, 'a')
  const child = spawn(process.execPath, t.args, { cwd: t.dir, detached: true, windowsHide: true, stdio: ['ignore', fd, fd] })
  child.on('error', () => {})
  child.unref()
  fs.closeSync(fd)
  for (let i = 0; i < 20; i++) { // up to 4 s for the port to open
    await new Promise(r => setTimeout(r, 200))
    if (await probe(t.port)) return { ok: true }
  }
  return { ok: false, error: `No answer on port ${t.port}. Log: ${log}` }
}

module.exports = { list, probe, start, isWorktree }
