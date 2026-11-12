// Self-check: node lib/prompts.test.js
const assert = require('assert')
const { capPrompt, appendTeach } = require('../public/prompts')
const DASH = String.fromCharCode(8212)

const r = { name: 'Morning digest', schedule: '0 9 * * 1-5', tokWk: 1234567, usdWk: 12.5, does: 'Summarises my inbox and calendar' }
const p = capPrompt(r, 5)
for (const s of ['Morning digest', '0 9 * * 1-5', '1,234,567', '$12.50', 'Summarises my inbox and calendar', '$5.00', 'before and after', 'what the routine still does', 'Show the change first', 'Wait for a yes'])
  assert(p.includes(s), 'missing: ' + s)
assert(!p.includes(DASH), 'em dash in cap prompt')

assert(capPrompt({ ...r, usdWk: null }, 5).includes('$ unknown (no price table)'))

const t = appendTeach(p, true, ' brain ')
assert(t.endsWith('Also update skill brain with the principle behind this feedback; show the diff first.'))
assert.strictEqual(appendTeach(p, false, 'brain'), p)
assert(appendTeach(p, true, '').includes('Also update skill the skill that fits best'))
assert(!t.includes(DASH))
console.log('prompts ok')
