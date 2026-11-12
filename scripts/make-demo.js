// Writes fake sample data for `node server.js --demo` (screenshots, trying the app without your own data).
// demo/claude-home stands in for ~/.claude and is rebuilt on every start, so dates stay recent.
// demo/data holds the app's own state; the planner sample is written only once, so your demo edits stay.
// Everything here is invented. No real names, paths or keys.
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', 'demo')
const HOME = path.join(ROOT, 'claude-home')
const DATA = path.join(ROOT, 'data')
const DAY = 864e5

// Seeded random: the same demo every run, so screenshots are stable.
let seed = 7
const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const pick = a => a[Math.floor(rnd() * a.length)]
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1))

const write = (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text) }
const md = (fm, body) => `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n${body}\n`

const SKILLS = {
  'code-review-lite': 'Quick review of the current diff for bugs and missing tests.',
  'write-tests': 'Add focused unit tests for the code you just changed.',
  'release-notes': 'Draft release notes from the commits since the last tag.',
  'ui-polish': 'Spacing, contrast and focus-state pass on a web page.',
  'sql-helper': 'Explain, write and tune SQL queries for Postgres.',
  'docs-writer': 'Write or update README and API docs in plain English.',
  'bug-hunt': 'Reproduce a bug, find the root cause, fix it once.',
  'deploy-check': 'Pre-deploy checklist: env vars, migrations, health checks.',
}
const PROJECTS = [
  { name: 'acme-storefront', title: ['Checkout flow refactor', 'Fix cart badge count', 'Product grid performance', 'Add order history page'] },
  { name: 'weather-cli', title: ['Add hourly forecast flag', 'Cache API responses', 'Release v1.4'] },
  { name: 'design-system', title: ['Button variants', 'Dark theme tokens', 'Docs site search', 'Focus ring audit'] },
  { name: 'blog-engine', title: ['RSS feed', 'Markdown footnotes', 'Draft previews'] },
  { name: 'data-pipeline', title: ['Nightly import job', 'Dedupe customers table', 'Retry failed batches'] },
]
const MODELS = ['claude-opus-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']
const PROMPTS = ['Look at the failing test and fix it', 'Add a loading state to this page', 'Why is this query slow?', 'Refactor this into smaller functions',
  'Write tests for the parser', 'Update the README for the new flag', 'Check the build output for warnings', 'Make the error message clearer']
const TOOLS = ['Read', 'Read', 'Grep', 'Edit', 'Edit', 'Bash', 'Glob', 'Write']

// One Claude Code style session log. Returns the last timestamp.
function session(file, { project, title, start, turns, model, live }) {
  const cwd = `D:\\${project}`, sid = path.basename(file, '.jsonl')
  const lines = [{ type: 'custom-title', customTitle: title, sessionId: sid }]
  let t = start, n = 0
  const base = { sessionId: sid, cwd, gitBranch: 'main', version: '2.1.0' }
  for (let i = 0; i < turns; i++) {
    const skill = rnd() < 0.18 ? pick(Object.keys(SKILLS)) : null
    lines.push({ ...base, type: 'user', timestamp: new Date(t).toISOString(), uuid: `u${i}`, message: { role: 'user', content: pick(PROMPTS) } })
    t += int(4, 40) * 1000
    for (let k = 0, steps = int(1, 4); k < steps; k++) {
      const tool = k === 0 && skill ? 'Skill' : pick(TOOLS), id = `m${sid.slice(0, 6)}${n++}`
      const usage = { input_tokens: int(2, 900), cache_creation_input_tokens: int(500, 9000), cache_read_input_tokens: int(20000, 140000), output_tokens: int(200, 3500) }
      lines.push({ ...base, type: 'assistant', timestamp: new Date(t).toISOString(), uuid: id, message: { id, role: 'assistant', model, usage,
        content: [{ type: 'text', text: 'Working on it.' }, { type: 'tool_use', id: 't' + id, name: tool, input: tool === 'Skill' ? { skill } : { file_path: `${cwd}\\src\\index.js` } }] } })
      t += int(2, 20) * 1000
      lines.push({ ...base, type: 'user', timestamp: new Date(t).toISOString(), uuid: 'r' + id, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't' + id, content: 'ok', is_error: rnd() < 0.06 }] } })
    }
    const id = `m${sid.slice(0, 6)}${n++}`
    lines.push({ ...base, type: 'assistant', timestamp: new Date(t).toISOString(), uuid: id, message: { id, role: 'assistant', model, content: [{ type: 'text', text: 'Done. The change is in place and the tests pass.' }],
      usage: { input_tokens: int(2, 300), cache_creation_input_tokens: int(200, 3000), cache_read_input_tokens: int(30000, 150000), output_tokens: int(100, 1500) } } })
    t += (live ? int(20, 90) : int(60, 900)) * 1000
  }
  write(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n')
  return t
}

function claudeHome(now) {
  fs.rmSync(HOME, { recursive: true, force: true })
  write(path.join(HOME, 'settings.json'), JSON.stringify({ enabledPlugins: {} }, null, 2))
  for (const [name, description] of Object.entries(SKILLS)) write(path.join(HOME, 'skills', name, 'SKILL.md'), md({ name, description }, `# ${name}\n\n${description}\n\nSteps:\n1. Read the files the task touches.\n2. Make the smallest change.\n3. Run the tests.`))

  write(path.join(HOME, 'CLAUDE.md'), '# Global instructions\n\n- Keep changes small. Run the tests before you say done.\n- Use `code-review-lite` before a commit and `deploy-check` before a release.\n- Skill choice: see skill-routing.md.\n')
  write(path.join(HOME, 'skill-routing.md'), '# Skill routing\n\n- UI work: `ui-polish`.\n- Bugs: `bug-hunt`, then `write-tests`.\n- Releases: `release-notes`, then `deploy-check`.\n- Databases: `sql-helper`.\n')
  write(path.join(HOME, 'design', 'learnings.md'), '# Design learnings\n\n- Body text 16px minimum. Line length 60 to 75 characters.\n- One accent colour. Muted text must still pass 4.5:1.\n- See principles.md for the long form.\n')
  write(path.join(HOME, 'design', 'principles.md'), '# Design principles\n\n- Hierarchy first, decoration last.\n- Every control has a visible focus state.\n')

  // Session logs: about four weeks, two sessions live right now.
  let k = 0
  for (const p of PROJECTS) {
    const dir = path.join(HOME, 'projects', `D--${p.name}`)
    for (let i = 0; i < int(4, 9); i++) {
      const live = k < 2 && i === 0
      const start = live ? now - int(20, 50) * 60e3 : now - int(1, 28) * DAY - int(0, 600) * 60e3
      const file = path.join(dir, `${(k++).toString(16).padStart(8, '0')}-0000-4000-8000-${String(i).padStart(12, '0')}.jsonl`)
      const end = session(file, { project: p.name, title: pick(p.title), start, turns: live ? int(6, 10) : int(3, 14), model: pick(MODELS), live })
      const at = new Date(Math.min(end, now - (live ? 30e3 : 0)))
      fs.utimesSync(file, at, at) // the live view reads file times
    }
  }

  // Memory for one project, with links between notes.
  const mem = path.join(HOME, 'projects', 'D--acme-storefront', 'memory')
  const notes = [
    ['user-role', 'user', 'Full-stack developer, prefers small PRs', 'Works across the storefront and the data pipeline. Likes short reviews. See [[deploy-steps]].'],
    ['test-first', 'feedback', 'Run the tests before saying done', 'Asked twice to run the suite first.\n\n**Why:** a broken build reached staging.\n**How to apply:** run `npm test` before every summary.'],
    ['deploy-steps', 'project', 'Staging deploy needs the migration flag', 'Deploy to staging with `--migrate`. Production deploys are manual. Related: [[test-first]].'],
    ['api-docs', 'reference', 'Payments API docs location', 'The payments API docs live in the team wiki under Payments.'],
    ['no-inline-styles', 'feedback', 'Use design tokens, not inline styles', 'Use tokens from design-system.\n\n**Why:** dark theme broke on inline colours.\n**How to apply:** grep for `style=` in review. See [[user-role]].'],
    ['release-day', 'project', 'Releases go out on Thursdays', 'Release window is Thursday morning. Freeze on Wednesday evening.'],
  ]
  for (const [name, type, description, body] of notes) write(path.join(mem, `${name}.md`), md({ name, description, type }, body))
  write(path.join(mem, 'MEMORY.md'), notes.map(([name, , d]) => `- [${d}](${name}.md): ${d.toLowerCase()}`).join('\n') + '\n')
  // Smaller memories for the other projects, so the globe has several groups.
  for (const p of PROJECTS.slice(1)) {
    const dir = path.join(HOME, 'projects', `D--${p.name}`, 'memory'), slug = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const ns = p.title.map((t, i) => [slug(t), i % 2 ? 'project' : 'feedback', t])
    for (const [name, type, d] of ns) write(path.join(dir, `${name}.md`), md({ name, description: d, type }, `${d}. Related: [[${ns[0][0]}]].`))
    write(path.join(dir, 'MEMORY.md'), ns.map(([name, , d]) => `- [${d}](${name}.md)`).join('\n') + '\n')
  }

  write(path.join(HOME, 'plans', 'checkout-refactor.md'), '# Checkout refactor\n\n1. Split the payment step into its own component.\n2. Move validation to the server.\n3. Add tests for the error states.\n')
  write(path.join(HOME, 'plans', 'hourly-forecast.md'), '# Hourly forecast flag\n\n1. Add `--hourly` to the CLI.\n2. Cache responses for 10 minutes.\n3. Update the README.\n')
  write(path.join(HOME, 'plans', 'dark-theme-tokens.md'), '# Dark theme tokens\n\n1. List every colour in use.\n2. Map each to a token.\n3. Check contrast for each pair.\n')

  write(path.join(HOME, 'scheduled-tasks', 'weekly-deps', 'SKILL.md'), md({ name: 'weekly-deps', title: 'Weekly dependency check', cronExpression: '0 9 * * 1', description: 'List outdated packages in each project and open one PR per project.' }, 'Check outdated dependencies and open PRs.'))
  write(path.join(HOME, 'scheduled-tasks', 'daily-standup', 'SKILL.md'), md({ name: 'daily-standup', title: 'Daily standup notes', cronExpression: '30 8 * * 1-5', description: 'Summarise yesterday\'s commits and open PRs into a short standup note.' }, 'Write standup notes from git log.'))
}

function plannerSample(now) {
  const file = path.join(DATA, 'data', 'planner.json')
  if (fs.existsSync(file)) return
  const d = n => { const x = new Date(now + n * DAY); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
  write(file, JSON.stringify({
    todos: [
      { id: 'd1', text: 'Review the checkout refactor PR', done: false },
      { id: 'd2', text: 'Write release notes for weather-cli v1.4', done: false },
      { id: 'd3', text: 'Fix the flaky import test', done: true },
      { id: 'd4', text: 'Book a design review for dark theme tokens', done: false },
    ],
    notes: 'Ideas\n- Cache forecast responses per city\n- Try the new focus ring in the docs site\n\nThursday release: freeze Wednesday evening.',
    events: [
      { id: 'e1', title: 'Team standup', date: d(0), time: '09:30' },
      { id: 'e2', title: 'Design review', date: d(1), time: '14:00' },
      { id: 'e3', title: 'Release window', date: d(3), time: '10:00' },
      { id: 'e4', title: 'Sprint planning', date: d(6), time: '' },
    ],
    calendarUrl: '',
  }, null, 2))
}

function make(now = Date.now()) {
  seed = 7
  claudeHome(now)
  plannerSample(now)
}

module.exports = { make, HOME, DATA }
if (require.main === module) { make(); console.log('demo data in ' + ROOT) }
