// Fix-backlog notes: notes/<skill>.md in the project folder. The folder may not exist.
const fs = require('fs')
const path = require('path')

const DIR = path.join(require('./scan').DATA, 'notes')
// Plugin ids hold ':', which Windows file names cannot, so notes/<plugin>_<skill>.md maps back by this stem.
const stem = id => id.replace(/[:/\\]/g, '_')

// Returns [{ stem, skill, file, text, mtime }], newest first; skill is the id when the stem matches one in skillIds, else null.
function readNotes(skillIds, dir = DIR) {
  let names = []
  try { names = fs.readdirSync(dir).filter(n => n.endsWith('.md')) } catch { return [] }
  return names.map(n => {
    const p = path.join(dir, n), s = n.slice(0, -3)
    return { stem: s, skill: skillIds.find(id => stem(id) === s) || null, file: n, text: fs.readFileSync(p, 'utf8').trim(), mtime: fs.statSync(p).mtime.toISOString() }
  }).filter(n => n.text).sort((a, b) => b.mtime.localeCompare(a.mtime))
}

const applyPrompt = (id, text) => `Apply these notes to skill ${id}\n\n${text}`.slice(0, 8000)

module.exports = { readNotes, applyPrompt, stem, DIR }
