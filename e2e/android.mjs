// Android 實機測試：先用除錯版 APK（python android/build.py debug install），
// adb forward tcp:9336 localabstract:webview_devtools_remote_<pid>，再執行 node e2e/android.mjs
const PORT = process.env.CDP_PORT || 9336;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0;
let fail = 0;
const check = (name, cond, info = '') => {
  if (cond) ok++;
  else fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${info ? ` — ${info}` : ''}`);
};
const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page');
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
const evaluate = (expr) => new Promise((r) => {
  const id = ++seq;
  pending.set(id, (m) => r(m.result?.result?.value ?? m.result?.exceptionDetails?.exception?.description));
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true } }));
});
const waitFor = async (expr, ms = 60000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await evaluate(`return !!(${expr})`)) return true;
    await sleep(400);
  }
  return false;
};
const lastMsg = () => evaluate("return [...document.querySelectorAll('#chat .msg')].at(-1)?.textContent.trim() ?? ''");

try {
  check('畫面載入', await waitFor('window.xkApp && document.querySelector("#view3d canvas")', 20000));
  // 第一次開啟會自動播教學：用返回鍵的處理關掉
  if (await waitFor("document.querySelector('.xk-guide')", 5000)) {
    check('返回鍵關閉教學', await evaluate('return window.__xkBack()'));
    await waitFor("!document.querySelector('.xk-guide')", 15000);
  }
  check('Android 橋接', await evaluate('return typeof window.XiaokeAndroid?.beginSave === "function"'));
  check('系統語音可用（語音教學）', await evaluate('return window.XiaokeAndroid.ttsAvailable()'));
  check('版本號', /^v1\.\d+\.\d+$/.test(await evaluate("return document.querySelector('#ver').textContent")), await evaluate("return document.querySelector('#ver').textContent"));
  check('WebGL', await evaluate("const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl'))"));

  await evaluate('await window.xkApp.loadSample(1); return 1');
  const s1 = await evaluate("const n = (t) => xkApp.elements(t).length; return { w: n('wall'), d: n('door'), win: n('window'), r: n('room'), width: xkApp.plan().width }");
  check('範例辨識（手機上）', s1.w >= 8 && s1.d === 5 && s1.win === 4 && s1.r === 5, JSON.stringify(s1));
  check('3D 建出模型', await evaluate('return xkApp.scene().model.children.length > 20'));

  await evaluate("await xkApp.runCmd('把牆漆成淺藍色'); return 1");
  check('自然語言指令', (await evaluate('return xkApp.plan().wallColor')) === '#a9d4f5', await lastMsg());
  await evaluate('xkApp.undo(); return 1');

  await evaluate("await xkApp.setMode('walk'); return 1");
  check('漫遊模式＋搖桿', await evaluate("return xkApp.scene().mode === 'walk' && !document.querySelector('#joystick').hidden"));
  check('返回鍵回到鳥瞰', await evaluate("return window.__xkBack() && xkApp.scene().mode === 'orbit'"));

  for (const k of ['glb', 'usdz', 'json']) {
    await evaluate(`await xkApp.exportAs('${k}'); return 1`);
    const m = await lastMsg();
    check(`匯出 ${k.toUpperCase()} 到下載資料夾`, /已存到 下載\/小柯平面圖3D\//.test(m), m);
  }

  const upd = JSON.parse(await evaluate('return window.XiaokeAndroid.checkUpdate()'));
  check('檢查更新（GitHub）', upd.status === 'ok' && !!upd.latest, `目前 ${upd.current}、最新 ${upd.latest}、APK ${upd.url ? '有' : '沒有'}`);
  check('返回鍵在首頁交給 App（按兩次離開）', (await evaluate('return window.__xkBack()')) === false);
} catch (e) {
  fail++;
  console.log('✘ 例外', e.message);
} finally {
  console.log(`\n${ok} 項通過，${fail} 項失敗`);
  ws.close();
  process.exit(fail ? 1 : 0);
}
