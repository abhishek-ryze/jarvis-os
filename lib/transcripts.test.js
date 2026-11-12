// node lib/transcripts.test.js
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const tr = require('./transcripts')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-'))
const id = '11111111-2222-3333-4444-555555555555'
const dir = path.join(root, 'G--proj-demo')
fs.mkdirSync(path.join(dir, id, 'subagents'), { recursive: true })
const now = Date.parse('2026-11-04T12:00:00Z')
const ts = h => new Date(now - h * 36e5).toISOString()
const usage = { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 50 }
const L = [
  { type: 'user', cwd: root, timestamp: ts(3), isMeta: true, message: { role: 'user', content: 'Caveat: injected' } },
  { type: 'user', cwd: root, timestamp: ts(3), message: { role: 'user', content: '<command-name>/clear</command-name><command-args></command-args>' } },
  { type: 'user', cwd: root, timestamp: ts(2), message: { role: 'user', content: 'Fix the <b>bug</b> in server.js please' } },
  { type: 'assistant', timestamp: ts(2), message: { id: 'm1', model: 'claude-opus-5', content: [{ type: 'text', text: 'Looking.' }], usage } },
  { type: 'assistant', timestamp: ts(2), message: { id: 'm1', model: 'claude-opus-5', content: [{ type: 'text', text: 'Looking.' }], usage } },
  { type: 'assistant', timestamp: ts(2), message: { id: 'm1', model: 'claude-opus-5', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'C:/x/Server.js' } }], usage } },
  { type: 'assistant', timestamp: ts(2), message: { id: 'm1', model: 'claude-opus-5', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'C:/x/Server.js' } }], usage } },
  { type: 'user', timestamp: ts(1), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'File not found\nline2' }] } },
  { type: 'assistant', timestamp: ts(1), isSidechain: true, message: { id: 'side', model: 'claude-opus-5', content: [{ type: 'text', text: 'sidechain' }], usage } },
  { type: 'assistant', timestamp: ts(1), message: { id: 'm2', model: 'claude-sonnet-5', content: [{ type: 'tool_use', id: 't2', name: 'Agent', input: { description: 'Look around' } }], usage } },
  { type: 'user', timestamp: ts(1), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: 'done' }] }] } },
]
fs.writeFileSync(path.join(dir, id + '.jsonl'), L.map(e => JSON.stringify(e)).join('\n') + '\n')
// a subagent file must not become a row
fs.writeFileSync(path.join(dir, id, 'subagents', 'agent-a1.jsonl'), JSON.stringify({ type: 'assistant', timestamp: ts(1), message: { id: 's1', model: 'claude-haiku-5', content: [], usage } }) + '\n')
fs.writeFileSync(path.join(dir, id, 'subagents', 'agent-a1.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Look around', toolUseId: 't2' }))

;(async () => {
  const cacheFile = path.join(root, 'cache.json')
  const rows = await tr.buildIndex({ root, cacheFile, now })
  assert.strictEqual(rows.length, 1, 'top-level files only')
  const r = rows[0]
  assert.strictEqual(r.id, id)
  assert.strictEqual(r.cwd, root)
  assert.strictEqual(r.prompt, 'Fix the <b>bug</b> in server.js please', 'meta and command prompts skipped')
  assert.strictEqual(r.turns, 1)
  assert.strictEqual(r.errors, 1)
  assert.deepStrictEqual(r.tokens, { input: 20, cacheWrite: 200, cacheRead: 2000, output: 100 }, 'usage deduped on message id, sidechain skipped')
  assert.deepStrictEqual(r.models, ['claude-opus-5', 'claude-sonnet-5'])
  assert.ok(fs.existsSync(cacheFile))

  const l = tr.listSessions(rows, { days: 7, now })
  // opus m1: (10*5 + 100*6.25 + 1000*.5 + 50*25)/1e6, sonnet m2: (10*3 + 100*3.75 + 1000*.3 + 50*15)/1e6
  const usd = (50 + 625 + 500 + 1250 + 30 + 375 + 300 + 750) / 1e6
  assert.ok(Math.abs(l.sessions[0].usd - usd) < 1e-12, 'priced per message model')
  assert.strictEqual(l.kpi.sessions.week, 1)
  assert.strictEqual(l.kpi.sessions.delta, null, 'no previous week')
  assert.strictEqual(l.top.length, 1)
  assert.strictEqual(l.projects[0].sessions, 1)
  assert.strictEqual(tr.listSessions(rows, { q: 'server.js read', now }).sessions.length, 1, 'search over prompt, tool name, path')
  assert.strictEqual(tr.listSessions(rows, { q: 'nomatch', now }).sessions.length, 0)
  assert.strictEqual(tr.listSessions(rows, { project: 'other', now }).sessions.length, 0)
  assert.strictEqual(tr.listSessions(rows, { days: 7, now: now + 10 * 864e5 }).sessions.length, 0, 'days window')

  assert.ok(tr.cwdSet(rows).has(path.resolve(root).toLowerCase()))
  assert.strictEqual(tr.fileOf('../../etc', root), null)
  assert.strictEqual(tr.fileOf('aaaaaaaa-2222-3333-4444-555555555555', root), null)

  const f = tr.fileOf(id, root)
  const t = await tr.transcript(f, { offset: 0, limit: 10 })
  assert.deepStrictEqual(t.items.map(i => i.k), ['user', 'user', 'ai', 'ai'], 'command turn kept, meta and sidechain dropped')
  assert.strictEqual(t.items[0].text, '/clear')
  const ai = t.items[2]
  assert.deepStrictEqual(ai.texts, ['Looking.'])
  assert.strictEqual(ai.tools.length, 1, 'repeated text and tool_use blocks collapse')
  assert.strictEqual(ai.tools[0].name, 'Read')
  assert.strictEqual(ai.tools[0].brief, 'C:/x/Server.js')
  assert.strictEqual(ai.tools[0].err, true)
  assert.strictEqual(ai.tools[0].result, 'File not found\nline2')
  assert.strictEqual(ai.tokens.output, 50)
  assert.strictEqual(t.items[3].tools[0].result, 'done')
  assert.strictEqual((await tr.transcript(f, { offset: 3, limit: 10 })).items.length, 1, 'paging')
  assert.strictEqual(t.subagents.length, 1)
  assert.strictEqual(t.subagents[0].toolUseId, 't2')
  assert.strictEqual(t.subagents[0].tokens.output, 50)

  fs.rmSync(root, { recursive: true, force: true })
  console.log('transcripts ok')
})().catch(e => { console.error(e); process.exit(1) })
