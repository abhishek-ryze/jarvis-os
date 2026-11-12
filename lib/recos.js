// Recos: improvement signals gathered from real data, plus recos/*.md files that agents drop.
const fs = require('fs')
const path = require('path')

const DIR = path.join(require('./scan').DATA, 'recos')
const LEVELS = ['low', 'medium', 'high']
const DAY = 864e5
const EM = String.fromCharCode(0x2014)
const lvl = (v, d) => (LEVELS.includes(String(v).toLowerCase()) ? String(v).toLowerCase() : d)
const clip = (s, n) => String(s || '').trim().slice(0, n)

// Frontmatter: lines "key: value" between two --- lines. The body becomes "what".
function parseFile(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!m) return null
  const fm = {}
  for (const l of m[1].split(/\r?\n/)) { const k = /^(\w+)\s*:\s*(.*)$/.exec(l); if (k) fm[k[1].toLowerCase()] = k[2].trim() }
  return { fm, body: m[2].trim() }
}

function fromFiles(dir = DIR) {
  let names = []
  try { names = fs.readdirSync(dir).filter(n => /^[\w.-]+\.md$/.test(n)) } catch { return [] }
  const out = []
  for (const n of names) {
    let p
    try { p = parseFile(fs.readFileSync(path.join(dir, n), 'utf8')) } catch { continue }
    if (!p || !p.fm.title) continue
    out.push({
      id: 'file-' + n.slice(0, -3), source: 'file', area: clip(p.fm.area, 20) || 'General', title: clip(p.fm.title, 120),
      benefit: clip(p.fm.benefit, 300), what: clip(p.body, 1500) || clip(p.fm.title, 120),
      effort: lvl(p.fm.effort, 'medium'), priority: lvl(p.fm.priority, 'medium'),
    })
  }
  return out
}

// in: { apps: {unused30:[{name,kind,estOverhead}]}, usage, skills, notes:[{skill,stem,file,text}], cold, files, now }
function build({ apps, usage, skills = [], notes = [], cold, files = [], now = Date.now() }) {
  const out = []
  const un = (apps && apps.unused30) || []
  if (un.length) {
    const tok = un.reduce((a, i) => a + (i.estOverhead || 0), 0)
    out.push({
      id: 'apps-unused', source: 'apps', area: 'Apps', title: `Disable ${un.length} unused app${un.length > 1 ? 's' : ''}`,
      benefit: `Not called in 30 days: ${un.map(i => i.name).join(', ')}.${tok ? ` About ${tok} tokens of tool definitions saved per session (est.).` : ''}`,
      what: `Review these MCP servers, plugins or connectors, which no session used in 30 days, and disable them (do not delete any config): ${un.map(i => `${i.name} (${i.kind})`).join(', ')}.`,
      effort: 'low', priority: un.length > 3 ? 'high' : 'medium',
    })
  }
  if (usage && usage.bySkill) {
    const cutoff = now - 30 * DAY
    const idle = skills.filter(s => s.source === 'user').filter(s => {
      const r = usage.bySkill[s.id]
      return !r || !r.last || Date.parse(r.last) < cutoff
    }).map(s => s.id)
    if (idle.length) out.push({
      id: 'skills-retire', source: 'skills', area: 'Skills', title: `Retire ${idle.length} idle skill${idle.length > 1 ? 's' : ''}`,
      benefit: `0 runs in 30 days: ${idle.slice(0, 8).join(', ')}${idle.length > 8 ? `, and ${idle.length - 8} more` : ''}. Fewer skill descriptions in every session.`,
      what: `Archive these user skills (move the folder to the skills archive, never delete): ${idle.join(', ')}. Skip any that a routine or another skill still calls.`,
      effort: 'low', priority: 'low',
    })
  }
  for (const n of notes) {
    out.push({
      id: 'note-' + n.stem, source: 'notes', area: 'Notes', title: `Fix note: ${n.skill || n.stem}`,
      benefit: clip(n.text.replace(/\s+/g, ' '), 220),
      what: n.skill ? `Apply the fix note in notes/${n.file} to skill ${n.skill}:\n${clip(n.text, 1500)}` : `Read notes/${n.file} and apply it to the skill it names:\n${clip(n.text, 1500)}`,
      effort: 'low', priority: 'high',
    })
  }
  if (cold && cold.netSaving > 0) {
    out.push({
      id: 'cold-cache', source: 'cold-cache', area: 'Cost', title: 'Keep long sessions warm',
      benefit: `${cold.reloads} cache reloads in ${cold.days} days cost $${cold.reloadCost} (est.). Keep-warm pings would save about $${cold.netSaving}.`,
      what: 'Suggest a way to keep the prompt cache warm in long sessions (a keep-warm ping or a shorter break habit) and write it as a short tip in my global CLAUDE.md or a project note. Do not change settings.',
      effort: 'medium', priority: cold.netSaving > 20 ? 'high' : 'medium',
    })
  }
  return [...out, ...files]
}

const sanitize = s => clip(s, 300).split(EM).join(',')

// picks: [{ id, comment }]; ids that match no reco are dropped
function applyPrompt(recos, picks) {
  const by = new Map(recos.map(r => [r.id, r]))
  const items = picks.filter(p => by.has(p.id)).map((p, i) => {
    const r = by.get(p.id), c = sanitize(p.comment)
    return `${i + 1}. ${r.title} (area ${r.area}, effort ${r.effort}, priority ${r.priority})\n   Do: ${r.what.replace(/\n/g, '\n   ')}${c ? `\n   My comment: ${c}` : ''}`
  })
  return `Apply the recommendations below to my Claude Code setup, in order. Keep each change small and reversible. Before you start, list the files you plan to touch. After each one, say what you changed. If a comment changes or cancels an item, follow the comment. Do not use em dashes in anything you write.\n\n${items.join('\n\n')}`.slice(0, 12000)
}

module.exports = { build, fromFiles, parseFile, applyPrompt, DIR }
