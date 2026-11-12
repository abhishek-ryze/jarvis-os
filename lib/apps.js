// MCP servers, plugins and connectors: what is installed, what the session logs show was used. No dependencies.
const fs = require('fs')
const path = require('path')
const os = require('os')
const readline = require('readline')
const { HOME, listJsonl } = require('./scan')

const CACHE = path.join(require('./scan').CACHE_DIR, 'apps-index.json')
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return d } }
const DAY = 864e5
// est.: each tool definition costs about 150 tokens in the tool list. Counts only tools seen in logs, so it is a floor.
const TOKENS_PER_TOOL = 150

const isConnector = n => /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(n) || n.startsWith('claude_ai_')
// mcp__plugin_figma_figma__tool -> plugin "figma"; mcp__server__tool -> server
function owner(server) {
  const m = /^plugin_(.+?)_[^_]+$/.exec(server)
  return m ? { name: m[1], kind: 'plugin' } : { name: server, kind: isConnector(server) ? 'connector' : 'mcp' }
}

// Names only. Never read or return env, headers, args or urls.
function installed() {
  const out = new Map()
  const put = (name, kind, extra) => out.set(`${kind}:${name}`, { name, kind, ...extra })
  const cj = readJson(path.join(process.env.CLAUDE_CONFIG_DIR ? HOME : os.homedir(), '.claude.json'), {})
  const servers = [...Object.keys(cj.mcpServers || {}), ...Object.values(cj.projects || {}).flatMap(p => Object.keys((p && p.mcpServers) || {}))]
  for (const n of servers) put(n, isConnector(n) ? 'connector' : 'mcp')
  const enabled = readJson(path.join(HOME, 'settings.json'), {}).enabledPlugins || {}
  const folders = Object.keys(readJson(path.join(HOME, 'plugins', 'installed_plugins.json'), {}).plugins || {})
  for (const k of new Set([...Object.keys(enabled), ...folders])) put(k.split('@')[0], 'plugin', { enabled: !!enabled[k] })
  return [...out.values()]
}

// Only lines that mention mcp__ are parsed. Returns [[server, tool, ts], ...].
async function parseCalls(file) {
  const calls = [], seen = new Set()
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.includes('"name":"mcp__')) continue
    let e
    try { e = JSON.parse(line) } catch { continue }
    for (const b of (e.message && e.message.content) || []) {
      if (b.type !== 'tool_use' || !/^mcp__[^_]/.test(b.name || '') || seen.has(b.id)) continue
      seen.add(b.id)
      const [, server, ...tool] = b.name.split('__')
      calls.push([server, tool.join('__'), e.timestamp || ''])
    }
  }
  return calls
}

async function buildAppsIndex(root = path.join(HOME, 'projects'), cache = CACHE) {
  const old = readJson(cache, { files: {} }).files
  const files = {}
  for (const f of listJsonl(root)) {
    const st = fs.statSync(f), key = path.relative(root, f), prev = old[key]
    files[key] = prev && prev.mtime === st.mtimeMs && prev.size === st.size ? prev : { mtime: st.mtimeMs, size: st.size, calls: await parseCalls(f) }
  }
  fs.mkdirSync(path.dirname(cache), { recursive: true })
  fs.writeFileSync(cache, JSON.stringify({ files }))
  return files
}

function rollup(files, inst, now = Date.now()) {
  const cut = new Date(now - 30 * DAY).toISOString()
  const by = new Map()
  const row = (name, kind) => { const k = `${kind}:${name}`; if (!by.has(k)) by.set(k, { name, kind, calls30: 0, callsAll: 0, last: null, tools: {} }); return by.get(k) }
  for (const i of inst) row(i.name, i.kind)
  for (const f of Object.values(files)) for (const [server, tool, ts] of f.calls) {
    const o = owner(server), r = row(o.name, o.kind)
    r.callsAll++
    if (ts >= cut) r.calls30++
    if (ts && (!r.last || ts > r.last)) r.last = ts
    r.tools[tool] = (r.tools[tool] || 0) + 1
  }
  const items = [...by.values()].map(({ tools, ...r }) => {
    const names = Object.keys(tools)
    return { ...r, topTools: Object.entries(tools).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, calls]) => ({ name, calls })), estOverhead: names.length * TOKENS_PER_TOOL }
  }).sort((a, b) => b.calls30 - a.calls30 || b.callsAll - a.callsAll || a.name.localeCompare(b.name))
  const have = new Set(inst.map(i => `${i.kind}:${i.name}`))
  return { items, unused30: items.filter(i => have.has(`${i.kind}:${i.name}`) && !i.calls30) }
}

function auditPrompt(items) {
  const list = items.map(i => `- ${i.name} (${i.kind}): ${i.calls30} calls in 30 days`).join('\n') || '- none'
  return `Audit my Claude connectors and tools. Currently connected:\n${list}\n\nSuggest at most 3 connectors I should add. Rank them by how much manual work each one removes. For each give: what it unlocks for me, and the one setup step. Do not suggest anything already connected. Do not use em dashes.`
}

async function scanApps() {
  const { items, unused30 } = rollup(await buildAppsIndex(), installed())
  return { items, unused30, auditPrompt: auditPrompt(items) }
}

module.exports = { scanApps, parseCalls, rollup, auditPrompt, buildAppsIndex }
