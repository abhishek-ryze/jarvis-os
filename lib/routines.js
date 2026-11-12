// Routines: desktop scheduled tasks (SKILL.md files) and Windows Task Scheduler jobs that run claude.
// Read-only. Token use comes from session logs whose cwd or first prompt matches the routine.
const fs = require('fs')
const os = require('os')
const path = require('path')
const readline = require('readline')
const { execFile } = require('child_process')
const { parseFile, frontmatter, listJsonl, HOME } = require('./scan')

// Est. $ per million tokens. config.json `prices` overrides, same shape, keyed by a model-name substring.
const PRICES = {
  opus: { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 },
  sonnet: { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 },
  haiku: { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 },
}
const DAY = 864e5
// ponytail: candidate paths, not verified (no desktop routine was available to test against).
// Demo mode (JARVIS_DEMO) reads only the sample folder: no Documents folder, no Task Scheduler.
const DEMO = !!process.env.JARVIS_DEMO
const TASK_DIRS = [path.join(HOME, 'scheduled-tasks'), ...(DEMO ? [] : [path.join(os.homedir(), 'Documents', 'Claude', 'Scheduled')])]

// Cron day-of-week field -> [M,T,W,T,F,S,S]. Cron 0 and 7 are Sunday.
function cronDays(cron) {
  const f = (String(cron || '').trim().split(/\s+/)[4] || '').toUpperCase().replace(/SUN|MON|TUE|WED|THU|FRI|SAT/g, d => 'SUNMONTUEWEDTHUFRISAT'.indexOf(d) / 3)
  const out = Array(7).fill(false)
  if (!f) return out
  for (const part of f.split(',')) {
    const [range, step] = part.split('/')
    const [a, b] = range === '*' ? [0, 6] : range.split('-').map(Number)
    for (let d = a; d <= (b === undefined ? (step ? 6 : a) : b); d += Number(step) || 1) out[(d + 6) % 7] = true
  }
  return out
}

// schtasks "Days" column ("MON, WED", "Every day") plus Schedule Type -> [M..S].
function schtasksDays(days, type) {
  if (/daily|every day/i.test(`${days} ${type}`)) return Array(7).fill(true)
  return ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map(d => new RegExp(d, 'i').test(days || ''))
}

// Cron "m h" -> "HH:MM" when both are plain numbers, else ''.
function cronTime(cron) {
  const [m, h] = String(cron || '').trim().split(/\s+/)
  return /^\d+$/.test(m) && /^\d+$/.test(h) && +m < 60 && +h < 24 ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` : ''
}

// schtasks "Start Time" ("9:00:00 AM", "21:30:00", "N/A") -> "HH:MM" or ''.
function clockTime(s) {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i.exec(String(s || '').trim())
  if (!m) return ''
  let h = +m[1]
  if (m[3]) h = h % 12 + (/pm/i.test(m[3]) ? 12 : 0)
  return h < 24 ? `${String(h).padStart(2, '0')}:${m[2]}` : ''
}

// active + at least one weekday = scheduled; active with none = on demand; else paused.
const kindOf = r => !r.active ? 'paused' : r.weekdays.some(Boolean) ? 'active' : 'demand'

// schtasks CSV: every field is quoted, but inner quotes are not escaped, so split on "," only.
const csvRows = text => text.split(/\r?\n/).filter(Boolean).map(line => line.replace(/^"|"$/g, '').split('","'))

let schtasksCache = null
function schtasks() {
  if (process.platform !== 'win32' || DEMO) return Promise.resolve([])
  if (schtasksCache && Date.now() - schtasksCache.at < 5 * 60e3) return Promise.resolve(schtasksCache.rows)
  return new Promise(resolve => execFile('schtasks', ['/query', '/fo', 'csv', '/v'], { timeout: 30e3, windowsHide: true, maxBuffer: 32e6 }, (err, out) => {
    if (err) return resolve([])
    const [head, ...rest] = csvRows(out)
    const rows = rest.filter(r => r[1] !== 'TaskName').map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])))
    schtasksCache = { at: Date.now(), rows }
    resolve(rows)
  }))
}

// ponytail: schtasks dates follow the system locale; this reads DD-MM-YYYY as local time.
function date(s) {
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}) (\d+):(\d+):(\d+)$/.exec(s || '')
  const t = m ? new Date(m[3], m[2] - 1, m[1], m[4], m[5], m[6]).getTime() : /^\d{4}-/.test(s || '') ? Date.parse(s) : NaN
  // schtasks writes 30-11-1999 for never run.
  return isNaN(t) || new Date(t).getFullYear() < 2000 ? null : new Date(t).toISOString()
}

// One SKILL.md of a desktop scheduled task -> routine.
function parseDesktop(n, text) {
  const fm = frontmatter(text)
  const cron = fm.cronExpression || fm.cron || ''
  const r = {
    id: n, name: fm.title || fm.name || n, source: 'desktop', schedule: fm.schedule || cron || fm.fireAt || '',
    weekdays: cronDays(cron), time: cronTime(cron), active: !/^(false|no|0)$/i.test(fm.enabled || ''),
    nextRun: date(fm.nextRunAt), lastRun: date(fm.lastRunAt),
    does: (fm.description || text.replace(/^---[\s\S]*?---\s*/, '').trim()).slice(0, 300),
    match: { prompt: text.replace(/^---[\s\S]*?---\s*/, '').trim().slice(0, 80) },
  }
  r.kind = kindOf(r)
  return r
}

function desktopRoutines() {
  return TASK_DIRS.flatMap(dir => {
    let names = []
    try { names = fs.readdirSync(dir) } catch { return [] }
    return names.flatMap(n => {
      const file = path.join(dir, n, 'SKILL.md')
      return fs.existsSync(file) ? [parseDesktop(n, fs.readFileSync(file, 'utf8'))] : []
    })
  })
}

// One schtasks /v row (object keyed by CSV header) -> routine.
function parseWindows(r) {
  const p = /-p\s+"([^"]+)"/.exec(r['Task To Run'])
  const x = {
    id: r.TaskName, name: r.TaskName.replace(/^\\/, ''), source: 'windows', schedule: r.Schedule || r['Schedule Type'] || '',
    weekdays: schtasksDays(r.Days, r['Schedule Type']), time: clockTime(r['Start Time']), active: !/disabled/i.test(r['Scheduled Task State'] || ''),
    nextRun: date(r['Next Run Time']), lastRun: date(r['Last Run Time']),
    does: p ? p[1].slice(0, 300) : (r['Task To Run'] || '').slice(0, 300),
    match: { cwd: r['Start In'] && r['Start In'] !== 'N/A' ? path.resolve(r['Start In']) : null, prompt: p ? p[1].slice(0, 80) : null },
  }
  x.kind = kindOf(x)
  return x
}

async function windowsRoutines() {
  return (await schtasks()).filter(r => /claude/i.test(r['Task To Run'] || '')).map(parseWindows)
}

// cwd and first typed prompt from the head of a session log.
async function head(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })
  let cwd = null, n = 0
  for await (const line of rl) {
    if (++n > 50) break
    let e
    try { e = JSON.parse(line) } catch { continue }
    cwd = cwd || e.cwd || null
    const c = e.type === 'user' && !e.isMeta && e.message && e.message.content
    const text = typeof c === 'string' ? c : Array.isArray(c) && !c.some(b => b.type === 'tool_result') ? c.map(b => b.text || '').join('') : null
    // Slash commands are logged as <command-name>/x</command-name>...<command-args>a</command-args>; local-command lines are not prompts.
    if (!text || /^<local-command/.test(text)) continue
    const cmd = /<command-name>\/?([^<]+)<\/command-name>(?:[\s\S]*?<command-args>([^<]*)<\/command-args>)?/.exec(text)
    rl.close()
    return { cwd, prompt: cmd ? `/${cmd[1]} ${cmd[2] || ''}`.trim() : text.trim() }
  }
  rl.close()
  return { cwd, prompt: '' }
}

// Longest key first, so a config key like claude-opus-4-8 beats the family key opus.
const priceFor = (model, prices) => prices[Object.keys(prices).sort((a, b) => b.length - a.length).find(k => String(model).includes(k))] || null
// tok/wk counts all four fields: input, cacheWrite, cacheRead, output.
const sumTok = t => t.input + t.cacheWrite + t.cacheRead + t.output

// Tokens and est. $ of parsed session files inside [since, now]. byModel is per file, so $ is
// the file's model mix scaled to the share of its tokens that fall in the window.
function weekCost(parsed, since, prices) {
  let tokens = 0, usd = 0
  for (const r of parsed) {
    const inWin = Object.entries(r.byDay).filter(([d]) => d >= since).reduce((s, [, t]) => s + sumTok(t), 0)
    const all = sumTok(r.total)
    if (!inWin || !all) continue
    tokens += inWin
    const fileUsd = Object.entries(r.byModel).reduce((s, [m, t]) => {
      const p = priceFor(m, prices)
      return p ? s + (t.input * p.input + t.cacheWrite * p.cacheWrite + t.cacheRead * p.cacheRead + t.output * p.output) / 1e6 : s
    }, 0)
    usd += fileUsd * inWin / all
  }
  return { tokens, usd: Math.round(usd * 100) / 100 }
}

async function scanRoutines(config = {}) {
  const prices = { ...PRICES, ...(config.prices || {}) }
  const win = await windowsRoutines()
  const list = [...desktopRoutines(), ...win]
  const since = new Date(Date.now() - 7 * DAY).toISOString().slice(0, 10)
  if (list.length) {
    // ponytail: main session files only; subagent logs of a routine run are not counted.
    const recent = listJsonl(path.join(HOME, 'projects')).filter(f => !f.includes(`${path.sep}subagents${path.sep}`) && fs.statSync(f).mtimeMs > Date.now() - 7 * DAY)
    const heads = await Promise.all(recent.map(async f => ({ f, ...await head(f) })))
    for (const r of list) {
      const same = (a, b) => process.platform === 'win32' ? String(a).toLowerCase() === String(b).toLowerCase() : a === b
      const hits = heads.filter(h => r.match.prompt ? h.prompt.startsWith(r.match.prompt) && (!r.match.cwd || same(h.cwd, r.match.cwd)) : r.match.cwd && same(h.cwd, r.match.cwd))
      const parsed = await Promise.all(hits.map(h => parseFile(h.f)))
      const w = weekCost(parsed, since, prices)
      r.tokWk = w.tokens
      r.usdWk = w.usd
      r.runs7d = hits.length
      const last = parsed.map(p => p.last).filter(Boolean).sort().pop()
      if (last && (!r.lastRun || last > r.lastRun)) r.lastRun = last
      delete r.match
    }
  }
  const active = list.filter(r => r.kind === 'active').length
  const demand = list.filter(r => r.kind === 'demand').length
  return {
    routines: list,
    totals: { active, demand, paused: list.filter(r => r.kind === 'paused').length, all: list.length, tokens7d: list.reduce((s, r) => s + r.tokWk, 0), usd7d: Math.round(list.reduce((s, r) => s + r.usdWk, 0) * 100) / 100, estimate: true },
    sources: [
      ...TASK_DIRS.map(d => ({ where: d, kind: 'desktop scheduled tasks (SKILL.md per task)', found: fs.existsSync(d) })),
      { where: 'schtasks /query (Task To Run contains claude)', kind: 'windows task scheduler', found: win.length > 0 },
      { where: 'Claude Code cloud routines', kind: 'cloud', found: false, note: 'not stored on disk' },
    ],
  }
}

module.exports = { scanRoutines, parseDesktop, parseWindows, cronTime, clockTime, kindOf, cronDays, schtasksDays, csvRows, weekCost, head, PRICES }
