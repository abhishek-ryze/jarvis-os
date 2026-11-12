// Run bookkeeping: runs.log parsing, report reading, run history. Used by server.js and routes-runs.js.
const fs = require('fs')
const path = require('path')

const HEAD = /^# (.+)\n\nmodel: (\w+), effort: (\w+), permission mode: (\w+)\nstarted: (\S+)/

// Runs from earlier server sessions, newest first. Fields the log does not hold stay absent.
function loadPast(logFile) {
  try {
    return fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map(l => {
      const [ended, skill, model, effort, exit, report] = l.split('\t')
      const e = Date.parse(ended)
      return { id: report.replace(/\.md$/, ''), skill, model, effort, status: exit === '0' ? 'done' : 'failed', ended: e, exit: Number(exit), report }
    }).reverse()
  } catch { return [] }
}

function readReport(dir, name, all) {
  const text = fs.readFileSync(path.join(dir, path.basename(name)), 'utf8')
  const h = HEAD.exec(text) || []
  const run = all.find(r => r.report === path.basename(name)) || {}
  const started = Date.parse(h[5])
  const ended = run.ended || null
  return {
    meta: { skill: h[1] || null, model: h[2] || null, effort: h[3] || null, mode: h[4] || null, started: started || null, ended, duration: ended && started ? ended - started : null, exit: run.exit ?? null },
    body: text,
  }
}

// Newest first, max 50. Adds started, duration and mode from the report header when the run lacks them.
// Cost is never known here (runs.log does not hold it), so no cost field is set.
function history(dir, live, past) {
  return [...[...live].reverse(), ...past].slice(0, 50).map(r => {
    let h = null
    if (r.report && (!r.started || !r.mode)) {
      try { h = HEAD.exec(fs.readFileSync(path.join(dir, path.basename(r.report)), 'utf8').slice(0, 600)) } catch {}
    }
    const started = r.started || (h && Date.parse(h[5])) || null
    const duration = r.duration ?? (r.ended && started ? r.ended - started : null)
    return { id: r.id, skill: r.skill, model: r.model, effort: r.effort, mode: r.mode || (h && h[4]) || null, status: r.status, started, ended: r.ended || null, duration, report: r.report }
  })
}

module.exports = { loadPast, readReport, history }
