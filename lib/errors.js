// Failed tool calls (tool_result with is_error true) from ~/.claude/projects jsonl. No dependencies.
const fs = require('fs')
const path = require('path')
const readline = require('readline')
const { HOME, listJsonl } = require('./scan')

const DAY = 864e5
// The user said no or stopped the turn: not a tool failure.
const DENIED = /^(Permission for this action was denied|The user doesn't want to proceed|\[Request interrupted)/
const text = c => typeof c === 'string' ? c : Array.isArray(c) ? c.map(b => b && b.text || '').join('\n') : ''
// First useful line. Bash "Exit code N" alone says little, so the next line joins it.
function firstLine(c) {
  const lines = text(c).replace(/<\/?tool_use_error>/g, '').split('\n').map(l => l.trim()).filter(Boolean)
  const head = /^Exit code \d+$/.test(lines[0] || '') && lines[1] ? `${lines[0]}: ${lines[1]}` : lines[0] || ''
  return head.slice(0, 200)
}
// mcp__plugin_figma_figma__x -> "figma", mcp__server__x -> "server", others null.
// ponytail: copy of owner() in lib/apps.js (not exported there); keep both in step.
function app(tool) {
  const m = /^mcp__(.+?)__/.exec(tool)
  if (!m) return null
  const p = /^plugin_(.+?)_[^_]+$/.exec(m[1])
  return p ? p[1] : m[1]
}

async function scanErrors({ days = 7, now = Date.now(), root = path.join(HOME, 'projects') } = {}) {
  const since = now - days * DAY
  const all = []
  let files = []
  try { files = listJsonl(root).filter(f => fs.statSync(f).mtimeMs >= since) } catch { files = [] }
  for (const f of files) {
    const names = new Map() // tool_use_id -> tool name, from this file's assistant lines
    const rl = readline.createInterface({ input: fs.createReadStream(f), crlfDelay: Infinity })
    for await (const line of rl) {
      const use = line.includes('"type":"tool_use"'), err = line.includes('"is_error":true')
      if (!use && !err) continue
      let e
      try { e = JSON.parse(line) } catch { continue }
      const content = e.message && Array.isArray(e.message.content) ? e.message.content : []
      for (const b of content) {
        if (b.type === 'tool_use' && b.id) names.set(b.id, b.name)
        if (b.type !== 'tool_result' || b.is_error !== true) continue
        const ts = Date.parse(e.timestamp)
        const first = firstLine(b.content)
        if (!(ts >= since) || ts > now || DENIED.test(first)) continue
        all.push({ ts, tool: names.get(b.tool_use_id) || 'unknown', first, session: e.sessionId || path.basename(f, '.jsonl') })
      }
    }
  }
  all.sort((a, b) => b.ts - a.ts)
  const byTool = {}, byDay = {}, byApp = {}, todayTool = {}
  const today = new Date(now).toISOString().slice(0, 10) // UTC day, as in lib/scan.js
  for (const x of all) {
    byTool[x.tool] = (byTool[x.tool] || 0) + 1
    const d = new Date(x.ts).toISOString().slice(0, 10)
    byDay[d] = (byDay[d] || 0) + 1
    if (d === today) todayTool[x.tool] = (todayTool[x.tool] || 0) + 1
    const a = app(x.tool)
    if (a) byApp[a] = (byApp[a] || 0) + 1
  }
  const rank = o => Object.entries(o).map(([tool, n]) => ({ tool, n })).sort((a, b) => b.n - a.n)
  return {
    days, total: all.length, today: byDay[today] || 0, todayByTool: rank(todayTool),
    byTool: rank(byTool),
    byDay, byApp,
    recent: all.slice(0, 100).map(x => ({ ...x, at: new Date(x.ts).toISOString() })),
  }
}

module.exports = { scanErrors, firstLine, app }
