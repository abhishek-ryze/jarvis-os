// 3D HUD view: pointer parallax plus a slow idle drift, written as --rx/--ry on #main (depth.css reads them).
// Runs only while html[data-view=depth] is set, Home is showing and the tab is visible; never under reduced motion.
(function () {
  const main = document.getElementById('main'), root = document.documentElement
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!main || reduce) return
  const MAX = 3 // degrees; larger moves shift click targets under the cursor
  let tx = 0, ty = 0, x = 0, y = 0, raf = 0
  const on = () => root.dataset.view === 'depth' && !document.body.classList.contains('brain') && !document.hidden && innerWidth > 960
  addEventListener('pointermove', e => {
    tx = (e.clientY / innerHeight - .5) * -2 * MAX
    ty = (e.clientX / innerWidth - .5) * 2 * MAX
  }, { passive: true })
  function tick(t) {
    raf = 0
    if (!on()) { main.style.removeProperty('--rx'); main.style.removeProperty('--ry'); return }
    const s = t / 1000
    x += (tx + Math.sin(s * .31) * .8 - x) * .06
    y += (ty + Math.sin(s * .23 + 1) * 1.2 - y) * .06
    main.style.setProperty('--rx', x.toFixed(2) + 'deg')
    main.style.setProperty('--ry', y.toFixed(2) + 'deg')
    raf = requestAnimationFrame(tick)
  }
  const wake = () => { if (!raf && on()) raf = requestAnimationFrame(tick) }
  document.addEventListener('visibilitychange', wake)
  addEventListener('resize', wake)
  // Display settings apply, and Brain open/close, flip these attributes
  new MutationObserver(wake).observe(root, { attributes: true, attributeFilter: ['data-view'] })
  new MutationObserver(wake).observe(document.body, { attributes: true, attributeFilter: ['class'] })
  wake()
})()
