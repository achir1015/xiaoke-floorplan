import './style.css';
import { detect, rescalePlan, roomArea } from './detect';
import { type Plan, type El, TYPE_NAME, clone, normalizePlan, updateBounds, wallLen } from './plan';
import { PlanScene, type ViewMode } from './scene';
import { Editor2D, type Tool } from './editor2d';
import { runCommand, EXAMPLES } from './command';
import { aiAnalyze, aiAssist, aiCommand, loadAi, saveAi, transcribe, MODELS } from './ai';
import { ROBOT_SVG, desktop, startGuide, guideOnFirstRun, initUpdateButton, checkUpdate } from './xiaoke';
import * as store from './store';

declare const __APP_VERSION__: string;
const VERSION = __APP_VERSION__;
const WEB = !desktop();

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const $$ = <T extends HTMLElement = HTMLElement>(s: string) => [...document.querySelectorAll<T>(s)];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

document.body.classList.toggle('web', WEB);
$('#ver').textContent = `v${VERSION}`;
$$('.mini-robot, .empty-robot').forEach((e) => (e.innerHTML = ROBOT_SVG));

// ---------------- 狀態 ----------------
let plan: Plan | null = null;
let img: HTMLImageElement | null = null;
let imgUrl = '';
let imgName = '';
let selected: string | null = null;
let busyCount = 0;
let projectId: string | null = null;
const undo: Plan[] = [];
const redo: Plan[] = [];

const scene = new PlanScene($('#view3d'), {
  onSelect: (id) => select(id, '3d'),
  onMode: (m) => setModeUI(m),
});
const editor = new Editor2D($('#view2d'), {
  onSelect: (id) => select(id, '2d'),
  onChange: (p, msg) => {
    setPlan(p);
    say(msg, 'ok');
  },
});

function busy(on: boolean, text = '處理中…') {
  busyCount = Math.max(0, busyCount + (on ? 1 : -1));
  $('#busy').hidden = busyCount === 0;
  $('#busy-text').textContent = text;
}

// ---------------- 對話紀錄 ----------------
function say(text: string, kind: 'me' | 'ok' | 'err' | 'bot' = 'bot') {
  if (!text) return;
  const chat = $('#chat');
  const d = document.createElement('div');
  d.className = `msg ${kind}`;
  d.innerHTML = kind === 'me' ? esc(text) : `<span class="who">${ROBOT_SVG}</span><span>${esc(text)}</span>`;
  chat.append(d);
  while (chat.children.length > 80) chat.firstChild!.remove();
  chat.scrollTop = chat.scrollHeight;
}

// ---------------- 模型 ----------------
function setPlan(p: Plan, opts: { history?: boolean; refit?: boolean; keepView?: boolean } = {}) {
  if (plan && opts.history !== false) {
    undo.push(plan);
    if (undo.length > 60) undo.shift();
    redo.length = 0;
  }
  plan = p;
  if (selected && !p.elements.some((e) => e.id === selected)) selected = null;
  scene.build(p, opts.keepView !== false);
  scene.highlight(selected);
  editor.selected = selected;
  editor.set(p, img, opts.refit);
  $('#empty2d').hidden = !!(img || p.elements.length);
  renderStats();
  renderProps();
  $('#t-roof').classList.toggle('on', p.showRoof);
  ($('#calib-w') as HTMLInputElement).value = p.width ? p.width.toFixed(2) : '';
  autosave();
}

function renderStats() {
  const p = plan;
  const box = $('#stats');
  if (!p) {
    box.innerHTML = '';
    return;
  }
  const n = (t: string) => p.elements.filter((e) => e.type === t).length;
  const area = p.elements.reduce((a, e) => a + (e.type === 'room' ? roomArea(e).m2 : 0), 0);
  box.innerHTML = [
    `🧱 牆 ${n('wall')}`,
    `🚪 門 ${n('door')}`,
    `🪟 窗 ${n('window')}`,
    `▪ 柱 ${n('column')}`,
    `🏠 房間 ${n('room')}`,
    `📐 ${p.width.toFixed(1)} × ${p.depth.toFixed(1)} m`,
    area ? `室內 ${area.toFixed(1)} m²（${(area / 3.3058).toFixed(1)} 坪）` : '',
  ]
    .filter(Boolean)
    .map((t) => `<span class="chip">${t}</span>`)
    .join('');
}

function select(id: string | null, from: '2d' | '3d' | 'cmd' = 'cmd') {
  selected = id;
  if (from !== '3d') scene.highlight(id);
  if (from !== '2d') {
    editor.selected = id;
    editor.draw();
  }
  renderProps();
  if (id && from !== 'cmd') setTab('prop');
}

// ---------------- 屬性面板 ----------------
function field(label: string, key: string, value: number | string, opt: { step?: number; min?: number; type?: string; unit?: string } = {}) {
  const t = opt.type ?? 'number';
  return `<label class="pf"><span>${label}</span><input data-k="${key}" type="${t}" value="${esc(String(value))}" ${t === 'number' ? `step="${opt.step ?? 0.01}" min="${opt.min ?? -1000}"` : ''} />${opt.unit ? `<em>${opt.unit}</em>` : ''}</label>`;
}

function renderProps() {
  const box = $('#props');
  const e = plan?.elements.find((x) => x.id === selected);
  if (!plan || !e) {
    box.innerHTML = `<p class="muted">在 3D 或 2D 畫面點一下牆、門、窗、柱或房間地板，就能在這裡修改尺寸、顏色與名稱。</p>
      ${plan ? `<h3>整體</h3>${field('牆高', 'p.wallHeight', plan.wallHeight, { unit: '公尺', min: 1.8 })}${field('牆顏色', 'p.wallColor', plan.wallColor, { type: 'color' })}${field('地板顏色', 'p.floorColor', plan.floorColor, { type: 'color' })}${field('專案名稱', 'p.name', plan.name, { type: 'text' })}` : ''}`;
  } else {
    let html = `<h3>${TYPE_NAME[e.type]} <small class="muted">${e.id}</small></h3>`;
    const c = (e as { color?: string }).color;
    if (e.type === 'wall') {
      html += `<p class="muted small">長度 ${wallLen(e).toFixed(2)} 公尺</p>${field('高度', 'height', e.height, { unit: '公尺' })}${field('厚度', 'thickness', e.thickness, { unit: '公尺' })}${field('起點 X', 'x1', e.x1)}${field('起點 Z', 'z1', e.z1)}${field('終點 X', 'x2', e.x2)}${field('終點 Z', 'z2', e.z2)}`;
    } else if (e.type === 'door' || e.type === 'window') {
      html += `${field('寬度', 'width', e.width, { unit: '公尺' })}${field('高度', 'height', e.height, { unit: '公尺' })}${field('離地高度', 'sill', e.sill, { unit: '公尺', min: 0 })}${field('位置 X', 'x', e.x)}${field('位置 Z', 'z', e.z)}`;
    } else if (e.type === 'column') {
      html += `${field('寬', 'w', e.w, { unit: '公尺' })}${field('深', 'd', e.d, { unit: '公尺' })}${field('高度', 'height', e.height, { unit: '公尺' })}${field('位置 X', 'x', e.x)}${field('位置 Z', 'z', e.z)}<label class="pf"><span>形狀</span><select data-k="shape"><option value="box" ${e.shape === 'box' ? 'selected' : ''}>方柱</option><option value="round" ${e.shape === 'round' ? 'selected' : ''}>圓柱</option></select></label>`;
    } else if (e.type === 'room') {
      const a = roomArea(e);
      html += `<p class="muted small">面積 ${a.m2.toFixed(2)} m²（${a.ping.toFixed(2)} 坪）</p>${field('名稱', 'name', e.name, { type: 'text' })}`;
    }
    html += field('顏色', 'color', c ?? (e.type === 'wall' ? plan.wallColor : e.type === 'room' ? '#f1e3cc' : e.type === 'door' ? '#a8784f' : e.type === 'window' ? '#a9d8ff' : '#e6e1d8'), { type: 'color' });
    html += `<div class="row"><button type="button" id="p-del" class="danger small">刪除</button><button type="button" id="p-none" class="ghost small">取消選取</button></div>`;
    box.innerHTML = html;
    $('#p-del').addEventListener('click', () => {
      const p = clone(plan!);
      p.elements = p.elements.filter((x) => x.id !== e.id);
      updateBounds(p);
      select(null);
      setPlan(p);
      say(`已刪除${TYPE_NAME[e.type]}`, 'ok');
    });
    $('#p-none').addEventListener('click', () => select(null));
  }
  box.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((inp) => {
    inp.addEventListener('change', () => {
      if (!plan) return;
      const p = clone(plan);
      const k = inp.dataset.k!;
      const v = inp.type === 'number' ? parseFloat(inp.value) : inp.value;
      if (inp.type === 'number' && !Number.isFinite(v as number)) return;
      if (k.startsWith('p.')) (p as unknown as Record<string, unknown>)[k.slice(2)] = v;
      else {
        const el = p.elements.find((x) => x.id === selected) as unknown as Record<string, unknown>;
        if (!el) return;
        el[k] = v;
      }
      if (k === 'p.wallHeight') for (const w of p.elements) if (w.type === 'wall') w.height = v as number;
      updateBounds(p);
      setPlan(p);
    });
  });
}

// ---------------- 載入圖片與辨識 ----------------
function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('無法讀取這張圖片'));
    im.src = src;
  });
}

async function openImage(file: Blob, name: string) {
  const url = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
  await setImage(url, name);
  await analyze();
}

async function setImage(url: string, name: string) {
  img = await loadImg(url);
  imgUrl = url;
  imgName = name.replace(/\.[^.]+$/, '') || '平面圖';
  projectId = null;
  $('#empty2d').hidden = true;
  editor.set(plan, img, true);
}

async function loadSample(n: 1 | 2) {
  const file = n === 1 ? 'samples/sample-2room.png' : 'samples/sample-3room.png';
  const blob = await (await fetch(file)).blob();
  await openImage(blob, n === 1 ? '範例 兩房一廳' : '範例 三房兩廳');
}

/** 圖片縮到長邊 1600 以內再辨識（太大很慢；太小辨識不準） */
function imageData(im: HTMLImageElement) {
  const k = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight));
  const up = Math.max(1, 900 / Math.max(im.naturalWidth, im.naturalHeight));
  const s = k < 1 ? k : Math.min(2, up);
  const c = document.createElement('canvas');
  c.width = Math.round(im.naturalWidth * s);
  c.height = Math.round(im.naturalHeight * s);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(im, 0, 0, c.width, c.height);
  return { data: g.getImageData(0, 0, c.width, c.height), scale: s };
}

let analyzing = false;
async function analyze() {
  if (!img || analyzing) return;
  analyzing = true;
  const method = ($('#method') as HTMLSelectElement).value;
  const scaleBy = ($('#scale-by') as HTMLSelectElement).value as 'door' | 'wall';
  const scaleM = parseFloat(($('#scale-m') as HTMLInputElement).value) || (scaleBy === 'door' ? 0.9 : 0.15);
  const wh = parseFloat(($('#wall-h') as HTMLInputElement).value) || 3;
  const ai = loadAi();
  const msg = $('#analyze-msg');
  try {
    if (method !== 'local' && !ai.key) {
      say('AI 辨識需要 OpenAI 金鑰，請按右上「⚙ 設定」輸入；這次先用本機辨識。', 'err');
    }
    let p: Plan;
    if (method === 'ai' && ai.key) {
      busy(true, 'AI 正在看圖（約 10～40 秒）…');
      p = await aiAnalyze(ai, img, wh).finally(() => busy(false));
      msg.textContent = 'AI 辨識完成';
    } else {
      busy(true, '小柯正在辨識牆、門、窗…');
      await sleep(30);
      const { data, scale } = imageData(img);
      const t0 = performance.now();
      const r = detect(data, { scaleBy, doorWidthM: scaleBy === 'door' ? scaleM : 0.9, wallThicknessM: scaleBy === 'wall' ? scaleM : 0.15, wallHeight: wh });
      busy(false);
      p = r.plan;
      // 換回原圖像素座標，2D 疊圖才對得上
      if (p.image) p.image = { w: img.naturalWidth, h: img.naturalHeight, mPerPx: p.image.mPerPx * scale, ox: p.image.ox / scale, oz: p.image.oz / scale };
      msg.textContent = `本機辨識 ${Math.round(performance.now() - t0)} 毫秒${r.hollowFilled ? '・空心牆線' : ''}・比例依${r.scaleSource === 'door' ? '門寬' : '牆厚'}`;
      if (scaleBy === 'door' && r.scaleSource !== 'door') say('門太少，沒辦法用門寬推算比例，改用牆厚推算；尺寸不對請在左下「實際總寬」校正。', 'bot');
      if (!r.stats.walls) say('沒有找到牆。請確認圖片是黑線平面圖，或改用「AI 讀整張圖」。', 'err');
      if (method === 'assist' && ai.key && r.stats.walls) {
        busy(true, 'AI 正在判讀房間名稱與比例…');
        try {
          const a = await aiAssist(ai, img, p);
          p = a.plan;
          if (Math.abs(a.scale - 1) > 0.03) rescalePlan(p, a.scale);
          msg.textContent += `・AI 命名 ${a.names} 間${Math.abs(a.scale - 1) > 0.03 ? '・已依尺寸標註校正比例' : ''}`;
        } catch (e) {
          say(`AI 判讀失敗：${(e as Error).message}（保留本機結果）`, 'err');
        } finally {
          busy(false);
        }
      }
    }
    p.name = imgName || p.name;
    selected = null;
    setPlan(p, { history: !!plan, refit: true, keepView: false });
    const n = (t: string) => p.elements.filter((e) => e.type === t).length;
    say(`辨識完成：${n('wall')} 道牆、${n('door')} 扇門、${n('window')} 扇窗、${n('column')} 根柱子、${n('room')} 個房間，建築約 ${p.width.toFixed(1)} × ${p.depth.toFixed(1)} 公尺。比例不對的話，在左下輸入「實際總寬」校正。`, 'ok');
    await saveProject();
  } catch (e) {
    say(`辨識失敗：${(e as Error).message}`, 'err');
    msg.textContent = '';
  } finally {
    analyzing = false;
  }
}

// ---------------- 指令 ----------------
async function runCmd(text: string) {
  text = text.trim();
  if (!text) return;
  say(text, 'me');
  if (!plan) {
    say('請先上傳平面圖或開啟範例。', 'err');
    return;
  }
  const r = runCommand(text, plan, { selected });
  if (r.ok) {
    if (r.plan) setPlan(r.plan);
    if (r.select !== undefined) select(r.select);
    if (r.view) await doView(r.view);
    say(r.message, 'ok');
    return;
  }
  const ai = loadAi();
  if (!ai.key) {
    say(r.message || '這句我還聽不懂。可以試試下面的範例說法；設定 OpenAI 金鑰後，更複雜的指令也能交給 AI。', 'err');
    return;
  }
  busy(true, 'AI 正在修改模型…');
  try {
    const a = await aiCommand(ai, text, plan, selected);
    setPlan(a.plan);
    say(a.message, 'ok');
  } catch (e) {
    say(`AI 指令失敗：${(e as Error).message}`, 'err');
  } finally {
    busy(false);
  }
}

async function doView(v: string) {
  if (v === 'undo') return doUndo();
  if (v === 'redo') return doRedo();
  if (v === 'walk') return setMode('walk');
  if (v === 'top') return setMode('top');
  if (v === 'reset') return setMode('orbit');
  if (v === 'vr') return setMode('vr');
  if (v === 'night' || v === 'day') {
    scene.setNight(v === 'night');
    $('#t-night').classList.toggle('on', v === 'night');
  }
  if (v === 'labels-on' || v === 'labels-off') {
    scene.setLabels(v === 'labels-on');
    $('#t-labels').classList.toggle('on', v === 'labels-on');
  }
  if (v === 'screenshot') await exportAs('png');
}

function doUndo() {
  const p = undo.pop();
  if (!p || !plan) return;
  redo.push(plan);
  setPlan(p, { history: false });
}
function doRedo() {
  const p = redo.pop();
  if (!p || !plan) return;
  undo.push(plan);
  setPlan(p, { history: false });
}

// ---------------- 視角 ----------------
function setModeUI(m: ViewMode | 'vr') {
  $$('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  $('#walk-help').hidden = m !== 'walk';
  $('#joystick').hidden = m !== 'walk' || !matchMedia('(pointer: coarse)').matches;
}

async function setMode(m: string) {
  if (m === 'vr') {
    if (await scene.vrSupported()) {
      try {
        await scene.enterVR();
        say('已進入 VR：用左手搖桿移動、右手搖桿轉向，扣板機瞬移到指著的地板。', 'ok');
      } catch (e) {
        say(`無法進入 VR：${(e as Error).message}`, 'err');
      }
    } else vrHelp();
    return;
  }
  if (m === 'top') {
    scene.topView();
    setModeUI('orbit');
    $$('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === 'top'));
    return;
  }
  if (m === 'orbit') scene.resetView();
  else scene.setMode(m as ViewMode);
  setModeUI(m as ViewMode);
}

function vrHelp() {
  const url = 'https://achir1015.github.io/xiaoke-floorplan/';
  dialog(`<h2>🥽 用 VR 眼鏡觀看</h2>
    <p>這台裝置沒有連接 VR 眼鏡。有三種方式可以用 VR 看你的 3D 平面圖：</p>
    <ol class="vr-list">
      <li><b>Meta Quest 等一體機</b>：在眼鏡的瀏覽器打開線上版 <code>${url}</code>，用「開啟專案檔」載入匯出的 <b>.xkplan</b>，再按「🥽 VR」就能走進去。</li>
      <li><b>匯出 GLB</b>：放進 Quest 的「檔案」或 SteamVR、Unity、Unreal、Blender 使用（單位是公尺，實際比例）。</li>
      <li><b>匯出 USDZ</b>：Apple Vision Pro、iPhone／iPad 點開就能用 AR 擺在桌上或原尺寸走進去。</li>
    </ol>
    <div class="xk-row"><button type="button" class="ghost" data-ex="glb">匯出 GLB</button><button type="button" class="ghost" data-ex="usdz">匯出 USDZ</button><button type="button" class="ghost" data-ex="json">匯出專案檔</button><button>關閉</button></div>`);
}

function dialog(html: string) {
  const d = document.createElement('dialog');
  d.className = 'xk-dialog';
  d.innerHTML = `<form method="dialog">${html}</form>`;
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.querySelectorAll<HTMLButtonElement>('[data-ex]').forEach((b) => b.addEventListener('click', () => void exportAs(b.dataset.ex!)));
  d.showModal();
  return d;
}

// ---------------- 匯出 ----------------
function fileBase() {
  return (plan?.name || '平面圖').replace(/[\\/:*?"<>|]/g, '_');
}

async function saveBlob(blob: Blob, name: string) {
  const xk = desktop();
  if (xk) {
    const path = await xk.saveFile(name, new Uint8Array(await blob.arrayBuffer()));
    if (path) say(`已存檔：${path}`, 'ok');
    return path;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
  say(`已下載 ${name}`, 'ok');
  return name;
}

function projectJson() {
  return JSON.stringify({ app: 'xiaoke-floorplan', version: VERSION, plan, image: imgUrl, imageName: imgName });
}

async function exportAs(kind: string) {
  $('#export-menu').classList.remove('open');
  if (!plan && kind !== 'png') {
    say('還沒有模型可以匯出。', 'err');
    return;
  }
  busy(true, '正在匯出…');
  try {
    const n = fileBase();
    if (kind === 'glb') await saveBlob(await scene.exportGLB(), `${n}.glb`);
    else if (kind === 'usdz') await saveBlob(await scene.exportUSDZ(), `${n}.usdz`);
    else if (kind === 'obj') await saveBlob(scene.exportOBJ(), `${n}.obj`);
    else if (kind === 'stl') await saveBlob(scene.exportSTL(), `${n}-1比100.stl`);
    else if (kind === 'png') await saveBlob(await (await fetch(scene.screenshot())).blob(), `${n}-3D.png`);
    else if (kind === 'json') await saveBlob(new Blob([projectJson()], { type: 'application/json' }), `${n}.xkplan`);
  } catch (e) {
    say(`匯出失敗：${(e as Error).message}`, 'err');
  } finally {
    busy(false);
  }
}

async function openProject(file: Blob) {
  try {
    const j = JSON.parse(await file.text());
    const p = normalizePlan(j.plan ?? j);
    if (j.plan?.image) p.image = j.plan.image;
    if (j.image) {
      img = await loadImg(j.image);
      imgUrl = j.image;
    } else {
      img = null;
      imgUrl = '';
    }
    imgName = j.imageName || p.name;
    projectId = null;
    undo.length = redo.length = 0;
    plan = null;
    selected = null;
    setPlan(p, { refit: true, keepView: false });
    say(`已開啟專案「${p.name}」`, 'ok');
    await saveProject();
  } catch (e) {
    say(`無法開啟專案檔：${(e as Error).message}`, 'err');
  }
}

// ---------------- 歷史（IndexedDB） ----------------
let saveTimer = 0;
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveProject(false), 1500);
}

async function saveProject(refresh = true) {
  if (!plan) return;
  try {
    const thumb = await thumbnail();
    projectId = await store.put({ id: projectId ?? undefined, name: plan.name, time: Date.now(), thumb, plan, image: imgUrl, imageName: imgName });
    if (refresh || !$('#history').children.length) await renderHistory();
    else await renderHistory();
  } catch {
    // 儲存空間不足或無痕模式：不影響使用
  }
}

async function thumbnail() {
  const src = scene.screenshot();
  const im = await loadImg(src);
  const c = document.createElement('canvas');
  c.width = 240;
  c.height = Math.round((240 * im.height) / Math.max(1, im.width));
  c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}

async function renderHistory() {
  const list = await store.list().catch(() => []);
  const ul = $('#history');
  ul.innerHTML = list.length
    ? list
        .map(
          (h) => `<li data-id="${h.id}" class="${h.id === projectId ? 'cur' : ''}"><img src="${h.thumb}" alt="" /><div><b>${esc(h.name)}</b><span class="muted small">${new Date(h.time).toLocaleString('zh-TW', { hour12: false })}</span></div><button type="button" class="ghost small del" title="刪除這筆紀錄">✕</button></li>`,
        )
        .join('')
    : '<li class="muted">還沒有紀錄</li>';
}

$('#history').addEventListener('click', async (e) => {
  const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-id]');
  if (!li) return;
  const id = li.dataset.id!;
  if ((e.target as HTMLElement).closest('.del')) {
    if (!confirm('要刪除這筆紀錄嗎？（只刪除這台裝置的歷史紀錄）')) return;
    await store.remove(id);
    if (projectId === id) projectId = null;
    await renderHistory();
    return;
  }
  const h = await store.get(id);
  if (!h) return;
  img = h.image ? await loadImg(h.image) : null;
  imgUrl = h.image;
  imgName = h.imageName;
  projectId = h.id;
  undo.length = redo.length = 0;
  plan = null;
  selected = null;
  setPlan(normalizeWithImage(h.plan), { refit: true, keepView: false, history: false });
  say(`已載入「${h.name}」`, 'ok');
  await renderHistory();
});

function normalizeWithImage(p: Plan) {
  const n = normalizePlan(p);
  n.image = p.image;
  return n;
}

// ---------------- 介面事件 ----------------
function setTab(t: string) {
  $$('#rtabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  $$('.tab-body').forEach((b) => (b.hidden = b.dataset.body !== t));
  if (t === 'hist') void renderHistory();
}
$$('#rtabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab!)));

$('#pick').addEventListener('click', () => $<HTMLInputElement>('#file').click());
$('#open-proj').addEventListener('click', () => $<HTMLInputElement>('#proj-file').click());
$('#sample1').addEventListener('click', () => void loadSample(1));
$('#sample2').addEventListener('click', () => void loadSample(2));
$<HTMLInputElement>('#file').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (f) await handleFile(f);
});
$<HTMLInputElement>('#proj-file').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (f) await openProject(f);
});

async function handleFile(f: File) {
  if (/\.(xkplan|json)$/i.test(f.name)) return openProject(f);
  if (!f.type.startsWith('image/') && !/\.(png|jpe?g|webp|bmp|gif)$/i.test(f.name)) {
    say('請選擇圖片檔（JPG、PNG…）。PDF 平面圖請先截圖或另存成圖片。', 'err');
    return;
  }
  await openImage(f, f.name);
}

const drop = $('#drop');
for (const t of [document.body]) {
  t.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  t.addEventListener('dragleave', (e) => {
    if (!(e as DragEvent).relatedTarget) drop.classList.remove('over');
  });
  t.addEventListener('drop', async (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = (e as DragEvent).dataTransfer?.files?.[0];
    if (f) await handleFile(f);
  });
}
// 貼上截圖
document.addEventListener('paste', async (e) => {
  const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
  if (f) await openImage(f, '貼上的平面圖');
});

$('#analyze').addEventListener('click', () => {
  if (!img) {
    say('請先上傳平面圖或按「範例」。', 'err');
    return;
  }
  void analyze();
});
$('#scale-by').addEventListener('change', () => {
  ($('#scale-m') as HTMLInputElement).value = ($('#scale-by') as HTMLSelectElement).value === 'door' ? '0.9' : '0.15';
});
$('#calib-go').addEventListener('click', () => {
  const v = parseFloat(($('#calib-w') as HTMLInputElement).value);
  if (!plan || !(v > 0.5) || !plan.width) return;
  const p = clone(plan);
  const f = v / p.width;
  rescalePlan(p, f);
  setPlan(p);
  say(`已校正比例：建築寬 ${p.width.toFixed(2)} 公尺、深 ${p.depth.toFixed(2)} 公尺`, 'ok');
});

$$<HTMLButtonElement>('#tools button').forEach((b) =>
  b.addEventListener('click', () => {
    editor.tool = b.dataset.tool as Tool;
    $$('#tools button').forEach((x) => x.classList.toggle('on', x === b));
  }),
);
$<HTMLInputElement>('#overlay').addEventListener('change', (e) => {
  editor.overlay = (e.target as HTMLInputElement).checked;
  editor.draw();
});

$$<HTMLButtonElement>('#modes button').forEach((b) => b.addEventListener('click', () => void setMode(b.dataset.mode!)));
$('#walk-exit').addEventListener('click', () => void setMode('orbit'));
$('#t-roof').addEventListener('click', () => {
  if (!plan) return;
  const p = clone(plan);
  p.showRoof = !p.showRoof;
  setPlan(p);
});
$('#t-night').addEventListener('click', () => void doView(scene.night ? 'day' : 'night'));
$('#t-labels').addEventListener('click', () => void doView(scene.showLabels ? 'labels-off' : 'labels-on'));
$('#undo').addEventListener('click', doUndo);
$('#redo').addEventListener('click', doRedo);
document.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('input, textarea, select')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) doRedo();
    else doUndo();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    doRedo();
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected && plan) {
    const p = clone(plan);
    p.elements = p.elements.filter((x) => x.id !== selected);
    select(null);
    setPlan(p);
  } else if (e.key === 'Escape' && scene.mode === 'walk') void setMode('orbit');
});

$('#export-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#export-menu').classList.toggle('open');
});
document.addEventListener('click', () => $('#export-menu').classList.remove('open'));
$$<HTMLButtonElement>('#export-menu button').forEach((b) => b.addEventListener('click', () => void exportAs(b.dataset.ex!)));

// 指令
$('#examples').innerHTML = EXAMPLES.map((t) => `<button type="button" class="chip">${esc(t)}</button>`).join('');
$('#examples').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (b) void runCmd(b.textContent ?? '');
});
$('#cmd-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const inp = $<HTMLInputElement>('#cmd');
  const t = inp.value;
  inp.value = '';
  void runCmd(t);
});

// 語音輸入：有金鑰用 OpenAI 轉文字；沒有就用瀏覽器內建（Chrome／Safari）
let rec: MediaRecorder | null = null;
$('#mic').addEventListener('click', async () => {
  const mic = $('#mic');
  const ai = loadAi();
  type SR = { lang: string; interimResults: boolean; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onerror: () => void; onend: () => void; start(): void };
  const SRC = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition;
  if (rec) {
    rec.stop();
    return;
  }
  if (!ai.key && SRC && WEB) {
    const r = new SRC();
    r.lang = 'zh-TW';
    r.interimResults = false;
    mic.classList.add('rec');
    r.onresult = (e) => void runCmd(e.results[0][0].transcript);
    r.onerror = () => say('沒有聽到聲音，請再試一次。', 'err');
    r.onend = () => mic.classList.remove('rec');
    r.start();
    return;
  }
  if (!ai.key) {
    say('語音輸入需要在「⚙ 設定」輸入 OpenAI 金鑰（線上版的 Chrome 不需要）。', 'err');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks: Blob[] = [];
    rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      mic.classList.remove('rec');
      const blob = new Blob(chunks, { type: rec?.mimeType || 'audio/webm' });
      rec = null;
      busy(true, '語音辨識中…');
      try {
        const text = await transcribe(ai, blob);
        if (text) await runCmd(text);
      } catch (e) {
        say((e as Error).message, 'err');
      } finally {
        busy(false);
      }
    };
    rec.start();
    mic.classList.add('rec');
    say('🎤 正在聽…說完再按一次麥克風。', 'bot');
    setTimeout(() => rec?.state === 'recording' && rec.stop(), 15000);
  } catch {
    say('無法使用麥克風，請確認權限。', 'err');
  }
});

// 設定
$('#settings-btn').addEventListener('click', () => {
  const c = loadAi();
  const d = dialog(`<h2>⚙ AI 設定</h2>
    <p class="muted small">本機辨識不需要金鑰。輸入 OpenAI 金鑰後，可以用 AI 判讀房間名稱、讀整張圖、聽懂更複雜的指令與語音輸入。金鑰只存在這台${WEB ? '瀏覽器' : '電腦'}，直接傳給 OpenAI。</p>
    <label class="pf wide"><span>OpenAI 金鑰</span><input type="password" id="s-key" placeholder="sk-..." value="${esc(c.key)}" autocomplete="off" /></label>
    <label class="pf wide"><span>模型</span><select id="s-model">${MODELS.map((m) => `<option value="${m.id}" ${m.id === c.model ? 'selected' : ''}>${m.name}</option>`).join('')}</select></label>
    <div class="xk-row"><button type="button" id="s-save">儲存</button><button class="ghost">取消</button></div>`);
  d.querySelector('#s-save')!.addEventListener('click', () => {
    saveAi({ key: (d.querySelector('#s-key') as HTMLInputElement).value.trim(), model: (d.querySelector('#s-model') as HTMLSelectElement).value });
    d.close();
    say('AI 設定已儲存。', 'ok');
  });
});

// 手機漫遊搖桿
{
  const joy = $('#joystick');
  const knob = joy.querySelector<HTMLElement>('.knob')!;
  let active = false;
  const move = (e: PointerEvent) => {
    const r = joy.getBoundingClientRect();
    let x = (e.clientX - r.left - r.width / 2) / (r.width / 2);
    let y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
    const L = Math.hypot(x, y);
    if (L > 1) {
      x /= L;
      y /= L;
    }
    knob.style.transform = `translate(${x * 35}px, ${y * 35}px)`;
    scene.setJoystick(x, y);
  };
  joy.addEventListener('pointerdown', (e) => {
    active = true;
    joy.setPointerCapture(e.pointerId);
    move(e);
  });
  joy.addEventListener('pointermove', (e) => active && move(e));
  const end = () => {
    active = false;
    knob.style.transform = '';
    scene.setJoystick(0, 0);
  };
  joy.addEventListener('pointerup', end);
  joy.addEventListener('pointercancel', end);
}

// VR 按鈕：支援時亮起
void scene.vrSupported().then((ok) => $('#vr-btn').classList.toggle('vr-ready', ok));

// ---------------- 教學與測試用掛鉤 ----------------
window.xkApp = {
  web: () => WEB,
  loadSample: (n) => loadSample(n),
  analyze: () => analyze(),
  setMethod: (m) => (($('#method') as HTMLSelectElement).value = m),
  setMode: (m) => setMode(m),
  runCmd: (t) => runCmd(t),
  select: (id) => select(id),
  setTab: (t) => setTab(t),
  setTool: (t) => $<HTMLButtonElement>(`#tools [data-tool="${t}"]`).click(),
  openExport: (open) => $('#export-menu').classList.toggle('open', open),
  plan: () => plan,
  elements: (t) => (plan?.elements ?? []).filter((e: El) => !t || e.type === t),
  undo: () => doUndo(),
  exportAs: (k) => exportAs(k),
  night: (on) => doView(on ? 'night' : 'day'),
  busy: () => busyCount > 0 || analyzing,
  scene: () => scene,
  reset: () => {
    plan = null;
    img = null;
    imgUrl = '';
    selected = null;
    undo.length = redo.length = 0;
    scene.setNight(false);
    $('#t-night').classList.remove('on');
    editor.set(null, null, true);
    $('#empty2d').hidden = false;
    renderStats();
    renderProps();
  },
  hasPlan: () => !!plan,
  openProjectText: (t) => openProject(new Blob([t], { type: 'application/json' })),
};

$('#guide-btn').addEventListener('click', () => void startGuide());
initUpdateButton(VERSION);
void renderHistory();
say('你好，我是小柯！上傳一張建築平面圖，我會把它變成可以走進去的 3D 空間。也可以先按「範例：兩房一廳」試試看。', 'bot');
guideOnFirstRun();
if (!WEB) setTimeout(() => void checkUpdate(VERSION, true), 4000);
