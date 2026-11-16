import { spawn } from 'node:child_process';
import fs from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ROOT = 'D:/Downloads/新建文件夹/火箭发射台3D';
const url = process.argv[2] || 'http://127.0.0.1:8777/?debug';
const outFile = process.argv[3] || (ROOT + '/out_shot.png');
const waitMs = Number(process.argv[4] || 9000);
const W = Number(process.argv[5] || 1440), H = Number(process.argv[6] || 810);
let evalJs = process.argv[7] || '';
if (evalJs.startsWith('@')) evalJs = fs.readFileSync(evalJs.slice(1), 'utf8');

// 端口每次随机：上一轮残留的 Edge 会继续占着 9333，新进程连上去就是旧页面，
// 表现为「改了代码复测没变化」或截图任务直接卡死。
const PORT = 9400 + Math.floor(Math.random() * 400);
const proc = spawn(EDGE, [
  '--headless=new', '--remote-debugging-port=' + PORT,
  // 每次用全新的临时 profile：复用固定目录会被上一轮残留的 Edge 锁住，进程直接启动失败
  '--user-data-dir=' + ROOT + '/.edgetmp_' + PORT,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-gpu', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
  '--hide-scrollbars', '--window-size=' + W + ',' + H,
  // 无头下让 AudioContext 无需手势即可 running，才能验证音频链路真的在出声
  '--autoplay-policy=no-user-gesture-required', 'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function targets() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const j = await r.json();
      const p = j.find(t => t.type === 'page');
      if (p) return p;
    } catch (e) {}
    await sleep(300);
  }
  throw new Error('devtools not ready');
}

const page = await targets();
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled') logs.push('LOG ' + m.params.args.map(a => a.value ?? a.description).join(' '));
  if (m.method === 'Runtime.exceptionThrown') logs.push('ERR ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
});
await new Promise(r => ws.addEventListener('open', r));
const send = (method, params) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });

await send('Runtime.enable');
await send('Page.enable');
// 必须禁缓存：否则改完 js 复测时拿到的还是上一版，会误判"改动没生效"
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await sleep(waitMs);

if (evalJs) {
  const r = await send('Runtime.evaluate', { expression: evalJs, awaitPromise: true, returnByValue: true });
  logs.push('EVAL ' + JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.text ?? null));
  await sleep(Number(process.argv[8] || 2500));
}

const shotRes = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
fs.writeFileSync(outFile, Buffer.from(shotRes.result.data, 'base64'));
console.log('SAVED ' + outFile);
console.log(logs.slice(0, 40).join('\n') || 'no-logs');
ws.close();
// Edge 会派生一堆子进程，只 kill 父进程会留下僵尸占着 profile 与端口
try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {}
proc.kill('SIGKILL');
await sleep(700);
try { fs.rmSync(ROOT + '/.edgetmp_' + PORT, { recursive: true, force: true }); } catch (e) {}
process.exit(0);
