// Self-check: node lib/families.test.js
const assert = require('assert')
const { families } = require('./families')

const counts = {
  'Work-Client-Acme-Site': 6, 'Work-Client-Acme-Video': 4, 'Work-Client-Bolt': 5,
  'Code-Tools-alpha': 3, 'Code-Tools-beta': 4, 'Code-Experiments-gamma': 2,
  skills: 12, 'Acme Video': 2, design: 1, notes: 2,
}
const f = families(counts, s => s, 5)
assert.strictEqual(f['Work-Client-Bolt'], 'Work Client')
assert.strictEqual(f['Work-Client-Acme-Site'], f['Work-Client-Bolt'])
assert.strictEqual(f['Acme Video'], f['Work-Client-Acme-Video'], 'a short name joins the folder it ends')
assert.strictEqual(f['Code-Tools-alpha'], f['Code-Experiments-gamma'])
assert.strictEqual(f.skills, 'skills', 'a lone big folder keeps its own name')
assert.strictEqual(f.design, 'Other'); assert.strictEqual(f.notes, 'Other')
assert.ok(new Set(Object.values(f)).size <= 5)
assert.strictEqual(families({ a: 1 }).a, 'a')
assert.strictEqual(families({ a: 1, b: 1 }).a, 'All')
assert.deepStrictEqual(families({}), {})
console.log('families ok')
