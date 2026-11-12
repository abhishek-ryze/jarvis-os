// Headless Chrome check: node scripts/shot.js <url> <out.png> ["js to run before shot"] [--w=1920 --h=1080]
// Prints console errors and the value of the JS expression. No window opens (headless only, by user rule).
const { spawn } = require('child_process')
const fs = require('fs'), os = require('os'), path = require('path')
const args = process.argv.slice(2).filter(a => !a.startsWith('--'))
const opt = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => a.slice(2).split('=')))
const [url, out, js] = args
if (!url || !out) { console.error('usage: node scripts/shot.js <url> <out.png> ["js"]'); process.exit(2) }
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const port = 9300 + Math.floor(Math.random() * 600)
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-'))
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`,
  `--window-size=${opt.w || 1920},${opt.h || 1080}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' })
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function main() {
  let tabs
  for (let i = 0; i < 50 && !tabs; i++) { await sleep(200); tabs = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json()).catch(() => null) }
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl)
  await new Promise(r => ws.onopen = r)
  let id = 0; const wait = {}
  ws.onmessage = e => { const m = JSON.parse(e.data)
    if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id] }
    if (m.method === 'Runtime.exceptionThrown') console.log('PAGE ERROR:', m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text)
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') console.log('CONSOLE ERROR:', m.params.args.map(a => a.value ?? a.description).join(' '))
  }
  const send = (method, params = {}) => new Promise(r => { wait[++id] = r; ws.send(JSON.stringify({ id, method, params })) })
  await send('Runtime.enable'); await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: +(opt.w || 1920), height: +(opt.h || 1080), deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url }); await sleep(+(opt.wait || 2500))
  if (js) { const r = await send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true }); console.log('JS:', JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description)); await sleep(+(opt.after || 1500)) }
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!opt.full })
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64')); console.log('saved', out)
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => { chrome.kill(); setTimeout(() => fs.rmSync(prof, { recursive: true, force: true }), 500) })
