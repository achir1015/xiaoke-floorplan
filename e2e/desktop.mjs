// 桌面版冒煙測試：啟動 Electron（或 XK_EXE 指定的打包版），透過 CDP 操作畫面：
// 範例辨識、2D 疊圖、指令、漫遊、匯出 GLB／USDZ／OBJ／STL／PNG／專案檔、重新開啟專案。
// 用法：node e2e/desktop.mjs [--guide]   --guide 會再快速跑一次語音教學（靜音）
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9377;
const exe = process.env.XK_EXE;
const MAC = process.platform === 'darwin';
const WANT_GUIDE = process.argv.includes('--guide');
const electron = MAC
  ? join(process.cwd(), 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
  : join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe');
const work = mkdtempSync(join(tmpdir(), 'xkf-e2e-'));
const shots = process.env.XK_SHOTS || work;
const saveDir = join(work, '匯出');
mkdirSync(shots, { recursive: true });
const env = { ...process.env, XK_USER_DATA: join(work, 'userdata'), XK_SAVE_DIR: saveDir, XK_QUERY: WANT_GUIDE ? 'noguide&fastguide&mute' : 'noguide&mute' };

const child = exe
  ? spawn(exe, [`--remote-debugging-port=${PORT}`], { stdio: 'ignore', env })
  : spawn(electron, ['.', `--remote-debugging-port=${PORT}`], { stdio: 'ignore', env });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0;
let fail = 0;
const check = (name, cond, info = '') => {
  if (cond) ok++;
  else fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${info ? ` — ${info}` : ''}`);
};

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.url.startsWith('xkfloor://'));
      if (page) return page;
    } catch {
      // 還沒啟動
    }
    await sleep(500);
  }
  throw new Error('找不到視窗');
}

const page = await target();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) => new Promise((r) => {
  const id = ++seq;
  pending.set(id, r);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
const waitFor = async (expr, ms = 60000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await evaluate(`return !!(${expr})`)) return true;
    await sleep(300);
  }
  return false;
};
const shot = async (name) => {
  // 截圖偶爾不回應（畫面忙著重繪），最多等 10 秒
  const r = await Promise.race([send('Page.captureScreenshot', { format: 'png' }), sleep(10000).then(() => ({}))]);
  if (r.result?.data) writeFileSync(join(shots, name), Buffer.from(r.result.data, 'base64'));
};
const size = (f) => (existsSync(f) ? statSync(f).size : 0);

try {
  check('畫面載入', await waitFor(`document.querySelector('#view3d canvas') && window.xkApp`, 30000));
  check('標題', (await evaluate(`return document.querySelector('h1').textContent`)) === '小柯機器人建築平面圖轉3D工具');
  check('版本號', /^v\d+\.\d+\.\d+$/.test(await evaluate(`return document.querySelector('#ver').textContent`)));
  check('桌面橋接', await evaluate(`return !!window.xk && typeof window.xk.saveFile === 'function'`));
  check('WebGL 3D', await evaluate(`const c = document.querySelector('#view3d canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl'))`));

  // 範例一：實心牆
  await evaluate(`await xkApp.loadSample(1)`);
  const s1 = await evaluate(`const n = (t) => xkApp.elements(t).length; return { w: n('wall'), d: n('door'), win: n('window'), r: n('room'), width: xkApp.plan().width }`);
  check('範例一辨識', s1.w >= 8 && s1.d === 5 && s1.win === 4 && s1.r === 5, JSON.stringify(s1));
  check('範例一比例（約 12 公尺寬）', Math.abs(s1.width - 12.2) < 1.5, `${s1.width} m`);
  check('3D 有建出模型', await evaluate(`return xkApp.scene().model.children.length > 20`));
  await sleep(600);
  await shot('01-sample1.png');

  // 範例二：空心牆線＋柱
  await evaluate(`await xkApp.loadSample(2)`);
  const s2 = await evaluate(`const n = (t) => xkApp.elements(t).length; return { w: n('wall'), d: n('door'), win: n('window'), c: n('column'), r: n('room') }`);
  check('範例二（空心牆）辨識', s2.w >= 10 && s2.d === 5 && s2.win === 5 && s2.c === 1 && s2.r === 5, JSON.stringify(s2));

  // 自然語言指令
  await evaluate(`await xkApp.runCmd('把所有牆壁的高度改成 3.5 公尺')`);
  check('指令：牆高 3.5', await evaluate(`return xkApp.elements('wall').every(w => w.height === 3.5)`));
  await evaluate(`await xkApp.runCmd('把空間 A 改名為客餐廳')`);
  check('指令：房間改名', await evaluate(`return xkApp.elements('room').some(r => r.name === '客餐廳')`));
  await evaluate(`await xkApp.runCmd('加上屋頂')`);
  check('指令：加屋頂', await evaluate(`return xkApp.plan().showRoof === true`));
  await evaluate(`xkApp.undo()`);
  check('復原', await evaluate(`return xkApp.plan().showRoof === false`));
  await evaluate(`await xkApp.runCmd('晚上開燈')`);
  check('夜晚模式', await evaluate(`return xkApp.scene().night === true`));
  await sleep(500);
  await shot('02-night.png');
  await evaluate(`await xkApp.night(false)`);

  // 漫遊
  await evaluate(`await xkApp.setMode('walk')`);
  check('漫遊模式（眼睛高度 1.6 m）', await evaluate(`const s = xkApp.scene(); return s.mode === 'walk' && Math.abs(s.camera.position.y - 1.6) < 0.01`));
  await sleep(500);
  await shot('03-walk.png');
  await evaluate(`await xkApp.setMode('orbit')`);

  // 匯出
  for (const [k, ext] of [['glb', '.glb'], ['usdz', '.usdz'], ['obj', '.obj'], ['stl', '-1比100.stl'], ['png', '-3D.png'], ['json', '.xkplan']]) {
    await evaluate(`await xkApp.exportAs('${k}')`);
    const f = join(saveDir, `範例 三房兩廳${ext}`);
    check(`匯出 ${k.toUpperCase()}`, size(f) > 1000, `${(size(f) / 1024).toFixed(0)} KB`);
  }
  const glb = readFileSync(join(saveDir, '範例 三房兩廳.glb'));
  check('GLB 檔頭正確（glTF 2.0）', glb.toString('ascii', 0, 4) === 'glTF' && glb.readUInt32LE(4) === 2);
  const usdz = readFileSync(join(saveDir, '範例 三房兩廳.usdz'));
  check('USDZ 是 zip 封裝', usdz.readUInt32LE(0) === 0x04034b50);

  // 重新開啟專案
  const proj = readFileSync(join(saveDir, '範例 三房兩廳.xkplan'), 'utf8');
  await evaluate(`xkApp.reset()`);
  await evaluate(`await xkApp.openProjectText(${JSON.stringify(proj)})`);
  check('開啟專案檔', await evaluate(`return xkApp.elements('room').some(r => r.name === '客餐廳') && xkApp.elements('wall').every(w => w.height === 3.5)`));
  check('歷史紀錄', await waitFor(`document.querySelectorAll('#history li[data-id]').length >= 1`, 8000));

  if (WANT_GUIDE) {
    await evaluate(`xkApp.reset(); localStorage.removeItem('xiaoke-floorplan:guided'); document.querySelector('#guide-btn').click()`);
    check('教學開始', await waitFor(`document.querySelector('.xk-guide')`, 5000));
    let sawWalk = false;
    const end = Date.now() + 180000;
    while (Date.now() < end && (await evaluate(`return !!document.querySelector('.xk-guide')`))) {
      if (!sawWalk && (await evaluate(`return xkApp.scene().mode === 'walk'`))) {
        sawWalk = true;
        await shot('04-guide-walk.png');
      }
      await sleep(150);
    }
    check('教學示範了漫遊', sawWalk);
    check('教學結束', !(await evaluate(`return !!document.querySelector('.xk-guide')`)));
    check('教學載入範例、示範修改已復原', await evaluate(`const p = xkApp.plan(); return !!p && !p.showRoof && p.wallColor === '#f2efe9' && xkApp.scene().mode === 'orbit'`));
  }
} catch (e) {
  fail++;
  console.log('✘ 例外', e.message);
} finally {
  console.log(`\n${ok} 項通過，${fail} 項失敗${shots === work ? '' : `（截圖：${shots}）`}`);
  ws.close();
  child.kill();
  await sleep(800);
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // 檔案還被鎖住就算了
  }
  process.exit(fail ? 1 : 0);
}
