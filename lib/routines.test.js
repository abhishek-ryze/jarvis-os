// Self-check: node lib/routines.test.js
const assert = require('assert')
const { parseDesktop, parseWindows, clockTime, cronTime, cronDays, schtasksDays, csvRows, weekCost, head, scanRoutines, PRICES } = require('./routines')
const fs = require('fs'), os = require('os'), path = require('path')

;(async () => {
  const days = a => a.map(Number).join('')
  assert.strictEqual(days(cronDays('0 9 * * 1-5')), '1111100', 'weekdays')
  assert.strictEqual(days(cronDays('0 9 * * *')), '1111111')
  assert.strictEqual(days(cronDays('0 9 * * 0,6')), '0000011', 'weekend')
  assert.strictEqual(days(cronDays('0 9 * * 7')), '0000001', '7 is Sunday')
  assert.strictEqual(days(cronDays('0 9 * * MON,FRI')), '1000100')
  assert.strictEqual(days(schtasksDays('MON, WED', 'Weekly')), '1010000')
  assert.strictEqual(days(schtasksDays('Every day', 'Daily')), '1111111')
  assert.deepStrictEqual(csvRows('"a","b, c","x.exe" -b"\r\n'), [['a', 'b, c', 'x.exe" -b']])

  // Only days inside the window count; $ scales the file's model mix to that share.
  const t = (n, o) => ({ input: n, cacheWrite: 0, cacheRead: 0, output: o })
  const file = { total: t(2e6, 0), byModel: { 'claude-opus-5-5': t(2e6, 0) }, byDay: { '2026-10-01': t(1e6, 0), '2026-11-01': t(1e6, 0) } }
  const w = weekCost([file, file], '2026-10-26', PRICES)
  assert.strictEqual(w.tokens, 2e6, 'tok/wk sums in-window days of both files')
  assert.strictEqual(w.usd, 8, 'two files x 1M opus input x $4')
  assert.strictEqual(weekCost([file], '2026-10-26', { ...PRICES, 'claude-opus-5-5': { input: 1, cacheWrite: 0, cacheRead: 0, output: 0 } }).usd, 1, 'config key beats family key (opus would give 4)')

  // Slash command runs are logged wrapped; local-command lines are skipped.
  const log = path.join(os.tmpdir(), 'routines-head-test.jsonl')
  const u = content => JSON.stringify({ type: 'user', cwd: 'G:\\x', message: { content } })
  fs.writeFileSync(log, [u('<local-command-caveat>x</local-command-caveat>'), u('<command-name>/daily-report</command-name>\n<command-message>daily-report</command-message>\n<command-args>fast</command-args>')].join('\n'))
  assert.deepStrictEqual(await head(log), { cwd: 'G:\\x', prompt: '/daily-report fast' })
  fs.unlinkSync(log)

  // Parser fixtures: a desktop task, a windows row, a paused and an on-demand one.
  const d = parseDesktop('daily', '---\ncron: 30 8 * * 1-5\ntitle: Daily report\nenabled: true\n---\nWrite the report')
  assert.deepStrictEqual([d.time, days(d.weekdays), d.kind, d.name], ['08:30', '1111100', 'active', 'Daily report'])
  const wx = parseWindows({ TaskName: '\\Nightly', 'Task To Run': 'claude -p "tidy"', Days: 'SAT, SUN', 'Schedule Type': 'Weekly', 'Start Time': '9:05:00 PM', 'Scheduled Task State': 'Enabled', 'Start In': 'N/A' })
  assert.deepStrictEqual([wx.time, days(wx.weekdays), wx.kind], ['21:05', '0000011', 'active'])
  assert.strictEqual(parseWindows({ TaskName: '\\Off', 'Task To Run': 'claude', 'Scheduled Task State': 'Disabled' }).kind, 'paused')
  assert.strictEqual(parseDesktop('manual', '---\ntitle: Manual\n---\nDo it').kind, 'demand', 'no schedule = on demand')
  assert.strictEqual(clockTime('12:00:00 AM'), '00:00')
  assert.strictEqual(cronTime('*/5 * * * *'), '', 'non-numeric cron time is empty')

  const r = await scanRoutines()
  assert.strictEqual(r.totals.all, r.routines.length)
  assert.ok(r.sources.length >= 3)
  console.log(`ok: ${r.totals.all} routines (${r.totals.active} active), ${r.totals.tokens7d} tok last 7d`)
})().catch(e => { console.error(e); process.exit(1) })
