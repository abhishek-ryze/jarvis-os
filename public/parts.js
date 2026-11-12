// Shared UI parts. Plain functions, no dependencies. Needs parts.css. Exposed as window.parts.
(function () {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const pct = v => (v < .1 ? (v * 100).toFixed(1) : Math.round(v * 100)) + '%'
  let uid = 0
  // body may be a string of trusted HTML or a Node; titles and labels are always escaped
  function fill(el, body) { if (body instanceof Node) el.append(body); else el.insertAdjacentHTML('beforeend', body ?? ''); return el }

  function panel(title, body) {
    const el = document.createElement('section')
    el.className = 'panel'
    const h = document.createElement('h2'); h.textContent = title
    el.append(h); fill(el, body)
    return el
  }
  // card({name, meta, body}): name and meta are plain text
  function card({ name, meta, body } = {}) {
    const el = document.createElement('div'); el.className = 'kcard'
    if (name) { const n = document.createElement('div'); n.className = 'nm'; n.textContent = name; n.title = name; el.append(n) }
    if (meta) { const m = document.createElement('div'); m.className = 'mt'; m.textContent = meta; el.append(m) }
    if (body != null) fill(el, body)
    return el
  }
  // fills an <svg viewBox="0 0 120 72" role="img" aria-label="..."> (copied from index.html)
  function gauge(el, v) {
    const p = a => [60 + 48 * Math.cos(Math.PI * (1 - a)), 64 - 48 * Math.sin(Math.PI * (1 - a))]
    const [x, y] = p(v), [x0, y0] = p(0), [x1, y1] = p(1)
    el.innerHTML = `<path d="M${x0} ${y0} A48 48 0 0 1 ${x1} ${y1}" fill="none" stroke="#12303a" stroke-width="8"/>
    <path d="M${x0} ${y0} A48 48 0 0 1 ${x} ${y}" fill="none" stroke="var(--cyan)" stroke-width="8"/>
    <text x="60" y="62" text-anchor="middle" fill="var(--text)" font-family="Consolas, monospace" font-size="18">${pct(v)}</text>`
    el.setAttribute('aria-label', el.getAttribute('aria-label') + ' ' + pct(v))
  }
  function button(label, { go, onClick } = {}) {
    const b = document.createElement('button')
    b.type = 'button'; b.className = go ? 'btn go' : 'btn'; b.textContent = label
    if (onClick) b.addEventListener('click', onClick)
    return b
  }
  // Native dialog: Escape closes, focus returns to the opener. Returns {el, close}.
  function modal({ title, body, onClose } = {}) {
    const opener = document.activeElement
    const d = document.createElement('dialog'); d.className = 'modal'
    const id = 'm' + ++uid
    d.setAttribute('aria-labelledby', id)
    const box = document.createElement('div'); box.className = 'modal-box'
    const head = document.createElement('div'); head.className = 'modal-head'
    const h = document.createElement('h2'); h.id = id; h.textContent = title || ''
    const x = document.createElement('button'); x.type = 'button'; x.className = 'modal-x'; x.textContent = '×'; x.setAttribute('aria-label', 'Close')
    head.append(h, x); box.append(head); fill(box, body); d.append(box)
    const close = () => d.open && d.close()
    x.addEventListener('click', close)
    d.addEventListener('click', e => { if (e.target === d) close() })
    d.addEventListener('close', () => { d.remove(); if (opener && opener.focus) opener.focus(); if (onClose) onClose() })
    document.body.append(d); d.showModal()
    return { el: d, close }
  }
  function copyButton(text) {
    const b = document.createElement('button')
    b.type = 'button'; b.className = 'cbtn'; b.textContent = 'Copy'
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); b.textContent = 'Copied' } catch { b.textContent = 'Blocked' }
      setTimeout(() => { b.textContent = 'Copy' }, 1500)
    })
    return b
  }
  function commentBox({ placeholder = '', onSubmit, label = 'Comment' } = {}) {
    const el = document.createElement('form'); el.className = 'comment'
    const id = 'c' + ++uid
    el.innerHTML = `<label class="lbl" for="${id}">${esc(label)}</label><textarea id="${id}" placeholder="${esc(placeholder)}"></textarea><div class="foot"></div>`
    const ta = el.querySelector('textarea')
    const send = button('Submit', { go: true }); send.type = 'submit'
    el.querySelector('.foot').append(send)
    el.addEventListener('submit', e => {
      e.preventDefault()
      const v = ta.value.trim()
      if (!v) return ta.focus()
      if (onSubmit) onSubmit(v)
      ta.value = ''
    })
    return el
  }
  window.parts = { panel, card, gauge, button, modal, copyButton, commentBox, esc }
})()
