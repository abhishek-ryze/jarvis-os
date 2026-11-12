// Copy-to-Claude prompt text. Pure functions, usable in the browser (window.prompts) and in Node tests.
// teachBox is the one browser-only part: the Teach toggle and skill field, persisted in localStorage.
(function () {
  const num = n => Number(n).toLocaleString('en-GB')
  const usd = n => n == null || !isFinite(n) ? '$ unknown (no price table)' : '$' + Number(n).toFixed(2)

  // r: a routine from GET /api/routines ({name, schedule, tokWk, usdWk, does}). target: $/wk.
  function capPrompt(r, target) {
    return [
      `Trim my Claude routine "${r.name}" to at most ${usd(Number(target))} per week.`,
      '',
      'Current numbers (last 7 days, estimated):',
      `- Schedule: ${r.schedule || 'unknown'}`,
      `- Tokens per week: ${num(r.tokWk || 0)}`,
      `- Est. cost per week: ${usd(r.usdWk)}`,
      `- What it does: ${r.does || 'unknown, read the routine to find out'}`,
      '',
      'Find the routine and read its prompt and settings. Then cut the cost with the smallest change that works: a cheaper model, lower effort, a shorter prompt, less context, or fewer runs.',
      'Tell me the est. cost per week before and after, and what the routine still does after the change.',
      'Show the change first. Wait for a yes before you edit anything.',
      'Do not use em dashes.',
    ].join('\n')
  }

  function appendTeach(text, on, skill) {
    if (!on) return text
    const x = String(skill || '').trim() || 'the skill that fits best (name it first)'
    return `${text}\n\nAlso update skill ${x} with the principle behind this feedback; show the diff first.`
  }

  const KEY = 'jarvis.teach'
  const load = () => { try { return { on: false, skill: '', ...JSON.parse(localStorage.getItem(KEY)) } } catch { return { on: false, skill: '' } } }
  const save = s => { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch {} }

  // Teach toggle + skill field. All boxes share one saved state. Returns {el, apply(text)}.
  let n = 0
  function teachBox() {
    const id = 'teach' + ++n, st = load()
    const el = document.createElement('div')
    el.className = 'teach'
    el.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px'
    el.innerHTML = `<label style="display:flex;align-items:center;gap:8px;min-height:44px;font:12px var(--mono);color:var(--muted);cursor:pointer"><input type="checkbox" style="width:20px;height:20px;accent-color:var(--cyan);color-scheme:dark"> Teach a skill</label>` +
      `<label class="lbl" for="${id}" style="margin:0">Skill id</label><input class="field" id="${id}" placeholder="skill id, or leave empty" autocomplete="off" style="flex:1 1 160px;min-width:0;max-width:260px">`
    const [box, field] = el.querySelectorAll('input')
    box.checked = st.on; field.value = st.skill
    const sync = () => {
      save({ on: box.checked, skill: field.value })
      document.querySelectorAll('.teach').forEach(o => { if (o !== el) { o.querySelector('input').checked = box.checked; o.querySelector('.field').value = field.value } })
    }
    box.addEventListener('change', sync); field.addEventListener('input', sync)
    return { el, apply: text => appendTeach(text, box.checked, field.value) }
  }

  const api = { capPrompt, appendTeach, teachBox, usd }
  if (typeof module !== 'undefined') module.exports = api
  if (typeof window !== 'undefined') window.prompts = api
})()
