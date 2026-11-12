// Self-check: node lib/sessions.test.js
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { liveSessions, coldCacheReport } = require('./sessions')

;(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-ses-'))
  fs.mkdirSync(path.join(root, 'proj'))
  const now = Date.parse('2026-11-01T12:00:00Z')
  const u = (write, read) => ({ input_tokens: 1, cache_creation_input_tokens: write, cache_read_input_tokens: read, output_tokens: 1 })
  const a = (id, ts, usage) => ({ type: 'assistant', timestamp: ts, message: { id, model: 'claude-sonnet-x', usage, content: [] } })
  // m2 comes 2 h after m1 (one reload, cache write 100000); m3 comes 10 min after m2 (warm).
  const lines = [
    { type: 'custom-title', customTitle: 'T' },
    a('m1', '2026-11-01T08:00:00Z', u(1000, 0)),
    a('m2', '2026-11-01T10:00:00Z', u(100000, 0)),
    a('m3', '2026-11-01T10:10:00Z', { ...u(500, 100000), cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 500 } }),
  ]
  const file = path.join(root, 'proj', 's.jsonl')
  fs.writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n'))
  fs.utimesSync(file, new Date(now), new Date(now))

  const live = await liveSessions({}, now, root)
  assert.strictEqual(live.length, 1)
  assert.strictEqual(live[0].title, 'T')
  assert.strictEqual(live[0].idleMin, 110)
  assert.strictEqual(live[0].cache, 'cold')
  assert.strictEqual(live[0].context, 100501)

  assert.strictEqual(live[0].ctxWindow, 200000)
  assert.strictEqual(live[0].ctxPct, 0.5025)
  assert.strictEqual(live[0].waiting, true, 'last entry is assistant text with no tool_use')

  const warm = await liveSessions({}, Date.parse('2026-11-01T10:30:00Z'), root)
  assert.strictEqual(warm[0].cache, 'warm')
  assert.strictEqual(warm[0].ttlMin, 60, 'ephemeral_1h write')
  assert.strictEqual(warm[0].cacheLeftMin, 40)

  // tool_use in a later content line of the same message: not waiting. A user line after it: not waiting.
  const tu = { type: 'assistant', timestamp: '2026-11-01T10:10:00Z', message: { id: 'm3', model: 'claude-sonnet-x', usage: u(0, 0), content: [{ type: 'tool_use', name: 'Bash' }] } }
  fs.appendFileSync(file, '\n' + JSON.stringify(tu))
  assert.strictEqual((await liveSessions({}, now, root))[0].waiting, false)
  fs.appendFileSync(file, '\n' + JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }))
  assert.strictEqual((await liveSessions({}, now, root))[0].waiting, false)
  fs.utimesSync(file, new Date(now), new Date(now))

  const r = await coldCacheReport({}, 30, now, root)
  assert.strictEqual(r.reloads, 1)
  assert.strictEqual(r.reloadCost, 0.38, '100000 write tokens at $3.75/M')
  assert.strictEqual(r.pingableReloads, 1)
  assert.strictEqual(r.top[0].reloads, 1)
  console.log('ok: sessions')
})().catch(e => { console.error(e); process.exit(1) })
