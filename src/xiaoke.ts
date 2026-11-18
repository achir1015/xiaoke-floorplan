// 小柯機器人建築平面圖轉3D工具：桌面版橋接、語音動態教學、版本更新。
import type { Plan, El } from './plan';
import type { PlanScene } from './scene';

export const APP_NAME = '小柯機器人建築平面圖轉3D工具';

export interface UpdateInfo {
  current: string;
  latest: string;
  newer: boolean;
  notes: string;
  page: string;
  canInstall: boolean;
  flavor: string;
}

/** Electron preload 提供的介面；線上版沒有。 */
export interface DesktopBridge {
  info(): Promise<{ version: string; platform: string; arch: string }>;
  /** 存檔對話框；回傳存檔路徑（取消回傳 null） */
  saveFile(name: string, data: Uint8Array): Promise<string | null>;
  update: {
    check(): Promise<UpdateInfo>;
    download(): Promise<string>;
    install(file: string): Promise<{ quitting?: boolean; manual?: boolean; path?: string }>;
    openPage(): Promise<void>;
    onProgress(fn: (d: { got: number; total: number }) => void): () => void;
  };
  platform: string;
}

export interface AppHook {
  web(): boolean;
  loadSample(n: 1 | 2): Promise<void>;
  analyze(): Promise<void>;
  setMethod(m: string): void;
  setMode(m: string): Promise<void>;
  runCmd(t: string): Promise<void>;
  select(id: string | null): void;
  setTab(t: string): void;
  setTool(t: string): void;
  openExport(open: boolean): void;
  plan(): Plan | null;
  elements(t?: string): El[];
  undo(): void;
  exportAs(k: string): Promise<void>;
  night(on: boolean): Promise<void>;
  busy(): boolean;
  scene(): PlanScene;
  reset(): void;
  hasPlan(): boolean;
  openProjectText(t: string): Promise<void>;
}

declare global {
  interface Window {
    xk?: DesktopBridge;
    xkApp: AppHook;
  }
}

export const desktop = (): DesktopBridge | undefined => window.xk;

// --- iPhone／iPad App（WKWebView）：存檔改用分享選單、USDZ 直接 AR 快速查看 ----------------

interface IOSBridge {
  postMessage(msg: { cmd: string; args?: unknown[] }): Promise<{ status?: string; token?: string; message?: string; path?: string; ar?: boolean } | boolean | null>;
}
/** 在 iPhone／iPad App 裡執行時，App 注入 window.XiaokeIOS = true 與 xkq 訊息通道。 */
export const iosApp = (): IOSBridge | undefined => {
  const w = window as unknown as { XiaokeIOS?: boolean; webkit?: { messageHandlers?: { xkq?: IOSBridge } } };
  return w.XiaokeIOS ? w.webkit?.messageHandlers?.xkq : undefined;
};

export const PAGES = 'https://achir1015.github.io/xiaoke-floorplan';

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** iOS App 存檔：分段傳給 App，結束時 App 打開分享選單（USDZ 則打開 AR 快速查看）。回傳 null＝使用者取消 */
export async function iosSave(name: string, data: Uint8Array): Promise<{ path: string; ar: boolean } | null> {
  const ios = iosApp()!;
  const begin = (await ios.postMessage({ cmd: 'begin_save', args: [name] })) as { status?: string; token?: string };
  if (begin?.status !== 'ok' || !begin.token) throw new Error('無法建立檔案');
  const CHUNK = 512 * 1024;
  for (let i = 0; i < data.length; i += CHUNK) await ios.postMessage({ cmd: 'write_chunk', args: [begin.token, toBase64(data.subarray(i, i + CHUNK))] });
  const end = (await ios.postMessage({ cmd: 'end_save', args: [begin.token] })) as { status?: string; path?: string; ar?: boolean };
  return end?.status === 'ok' ? { path: end.path ?? name, ar: !!end.ar } : null;
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fast = () => /[?&]fastguide/.test(location.search);
/** 教學中的等待：快速測試模式縮短 */
const wait = (ms: number) => sleep(fast() ? Math.min(ms, 150) : ms);

export const ROBOT_SVG = `<svg viewBox="0 0 120 120" aria-hidden="true">
  <line x1="60" y1="8" x2="60" y2="22" stroke="#5a6478" stroke-width="4"/>
  <circle cx="60" cy="8" r="7" fill="#ffc428"/>
  <rect x="6" y="50" width="12" height="32" rx="5" fill="#2878dc"/>
  <rect x="102" y="50" width="12" height="32" rx="5" fill="#2878dc"/>
  <circle cx="60" cy="66" r="48" fill="#4696f0"/>
  <circle cx="60" cy="66" r="44" fill="#f0f6ff"/>
  <rect x="25" y="44" width="70" height="42" rx="20" fill="#182440"/>
  <path class="eye" d="M36 62 q9 -10 18 0" stroke="#5ae6ff" stroke-width="5" fill="none" stroke-linecap="round"/>
  <path class="eye" d="M66 62 q9 -10 18 0" stroke="#5ae6ff" stroke-width="5" fill="none" stroke-linecap="round"/>
  <ellipse class="mouth" cx="60" cy="75" rx="9" ry="3" fill="#5ae6ff"/>
  <circle cx="32" cy="80" r="5" fill="#ff8ca0" opacity=".8"/>
  <circle cx="88" cy="80" r="5" fill="#ff8ca0" opacity=".8"/>
</svg>`;

// --- 語音動態教學 ----------------------------------------------------------------

interface Step {
  /** 要框起來的元素（找不到就置中顯示）。 */
  target?: () => HTMLElement | null;
  text: string;
  /** 線上版改用的說明。 */
  web?: string;
  /** iPhone／iPad App 改用的說明。 */
  ios?: string;
  /** 說話前先做的示範動作。 */
  before?: () => void | Promise<void>;
  /** 說話途中的動畫示範。 */
  demo?: () => Promise<void>;
}

const app = () => window.xkApp;
/** 點一下按鈕的動畫（讓使用者看得出來小柯按了哪裡） */
async function press(el: HTMLElement | null) {
  if (!el) return;
  el.animate([{ transform: 'scale(1)' }, { transform: 'scale(.92)', boxShadow: '0 0 0 4px #ffc428' }, { transform: 'scale(1)' }], { duration: 420 });
  await sleep(300);
}
const btn = (sel: string) => $<HTMLElement>(sel);
/** 教學示範改過幾次模型，結束時一次復原 */
let demoEdits = 0;

const STEPS: Step[] = [
  {
    text: '你好，我是小柯機器人！歡迎使用建築平面圖轉 3D 工具。只要一張平面圖，我就能辨識出牆、門、窗、柱子和房間，蓋成可以走進去參觀的 3D 空間，還能戴上 VR 眼鏡觀看。我們一步一步來！',
  },
  {
    target: () => $('#drop'),
    text: '第一步，上傳平面圖。把圖片拖曳到這個框框，或按「選擇圖片」，掃描圖、手機拍照、CAD 截圖都可以，也能直接貼上截圖。現在我先按「範例：兩房一廳」，用範例示範給你看。',
    ios: '第一步，上傳平面圖。按「選擇圖片」，可以直接拍照、從照片選，或從「檔案」選，掃描圖、CAD 截圖都可以。現在我先按「範例：兩房一廳」，用範例示範給你看。',
    demo: async () => {
      await wait(6500);
      if (app().hasPlan()) return;
      await press(btn('#sample1'));
      await app().loadSample(1);
    },
  },
  {
    target: () => $('#analyze-box'),
    text: '上傳後小柯會自動辨識。「辨識方式」有三種：本機辨識完全免費、不用網路；有 OpenAI 金鑰的話，選「本機加 AI」最準，AI 會讀出圖上寫的房間名稱和尺寸。比例預設用一般門寬九十公分推算，也可以改成用牆厚；牆高可以依實際情況調整，再按「開始辨識」重來一次。',
  },
  {
    target: () => $('#view2d'),
    text: '這裡是 2D 疊圖：紅色是牆、橘色是門、藍色是窗、紫色是柱子，彩色區塊是房間。辨識不完整的地方，可以用上面的工具修正：「畫牆」按住拖曳就能補一道牆，「門」和「窗」點在牆上就會加上去，「刪除」點一下就拿掉。滾輪可以放大縮小。',
    ios: '這裡是 2D 疊圖：紅色是牆、橘色是門、藍色是窗、紫色是柱子，彩色區塊是房間。辨識不完整的地方，可以用上面的工具修正：「畫牆」用手指拖曳就能補一道牆，「門」和「窗」點在牆上就會加上去，「刪除」點一下就拿掉。兩根手指可以放大縮小。',
    demo: async () => {
      await wait(9000);
      app().setTool('wall');
      await wait(2500);
      app().setTool('door');
      await wait(2000);
      app().setTool('select');
    },
  },
  {
    target: () => $('#calib'),
    text: '下面是統計：有幾道牆、幾扇門窗、幾個房間，以及總面積和坪數。如果尺寸不對，在「實際總寬」輸入建築真正的寬度，按「校正比例」，整個模型就會等比例換算。',
  },
  {
    target: () => $('#center'),
    text: '中間是 3D 模型。用滑鼠左鍵拖曳可以旋轉，滾輪放大縮小，右鍵拖曳可以平移；手機用手指操作。點一下牆、門或房間地板，就能選取它。',
    ios: '這是 3D 模型。一根手指拖曳可以旋轉，兩根手指捏合可以放大縮小，兩指一起拖曳可以平移。點一下牆、門或房間地板，就能選取它。',
    demo: async () => {
      const s = app().scene();
      const c = s.controls;
      const start = c.getAzimuthalAngle();
      for (let i = 0; i <= 40; i++) {
        const a = start + (i / 40) * 0.9;
        const r = Math.hypot(s.camera.position.x - c.target.x, s.camera.position.z - c.target.z);
        s.camera.position.x = c.target.x + r * Math.sin(a);
        s.camera.position.z = c.target.z + r * Math.cos(a);
        c.update();
        await wait(70);
      }
    },
  },
  {
    target: () => $('#modes'),
    text: '上面可以切換視角：「鳥瞰」從外面看、「俯視」從正上方看，「漫遊」會讓你站在房子裡，用 W A S D 或方向鍵走動、拖曳畫面轉頭，手機會出現搖桿。我帶你進去走走看！',
    ios: '上面可以切換視角：「鳥瞰」從外面看、「俯視」從正上方看，「漫遊」會讓你站在房子裡，左下會出現搖桿可以走動，拖曳畫面就能轉頭。我帶你進去走走看！',
    demo: async () => {
      await wait(7500);
      await press(btn('#modes [data-mode="walk"]'));
      await app().setMode('walk');
      const s = app().scene();
      for (let i = 0; i < 30; i++) {
        s.camera.rotation.y += 0.035;
        await wait(60);
      }
      await wait(1200);
      await press(btn('#modes [data-mode="orbit"]'));
      await app().setMode('orbit');
    },
  },
  {
    target: () => $('#cmd-form'),
    text: '右邊可以用中文或英文下指令修改模型，例如「把牆漆成淺藍色」、「牆壁高度增加五十公分」、「刪除所有柱子」。我試一下，把牆漆成淺藍色，再加上屋頂。',
    demo: async () => {
      await wait(7000);
      app().setTab('cmd');
      await app().runCmd('把牆漆成淺藍色');
      demoEdits++;
      await wait(1800);
      await app().runCmd('加上屋頂');
      demoEdits++;
      await wait(1500);
    },
  },
  {
    target: () => $('#mic'),
    text: '按麥克風可以用說的下指令。常用的說法本機就聽得懂；設定 OpenAI 金鑰後，像「把客廳改成現代風格」這種比較複雜的要求，也能交給 AI 處理。改錯了按上面的復原鍵就好，我現在就把剛剛的示範復原。',
    demo: async () => {
      await wait(6000);
      while (demoEdits > 0) {
        app().undo();
        demoEdits--;
        await wait(600);
      }
    },
  },
  {
    before: async () => {
      app().setTab('cmd');
      await app().night(true);
    },
    target: () => $('#t-night'),
    text: '這個按鈕可以切換白天和夜晚，晚上每個房間都會亮燈。旁邊還可以開關屋頂和房間名稱。',
    demo: async () => {
      await wait(4500);
      await app().night(false);
    },
  },
  {
    before: () => {
      const room = app().elements('room')[0];
      if (room) app().select(room.id);
    },
    target: () => $('#right'),
    text: '選取物件後，「屬性」頁可以精確修改尺寸、位置、顏色，房間可以改名字，也會算出面積和坪數。「歷史」頁會自動保存每次的結果，點一下就能回到當時的模型。',
    demo: async () => {
      await wait(8000);
      app().select(null);
      app().setTab('cmd');
    },
  },
  {
    before: () => app().openExport(true),
    target: () => $('#export-menu'),
    ios: '做好的 3D 模型可以匯出。選 USDZ 會直接打開 AR 快速查看，可以把房子放到桌上，或切到 AR 用原尺寸走進去；GLB 給 VR 眼鏡，另外還有 OBJ、3D 列印用的 STL、截圖和專案檔，都會跳出分享選單，可以存到「檔案」或用 AirDrop 傳出去。',
    web: '做好的 3D 模型可以下載。VR 眼鏡請選 GLB，Meta Quest、SteamVR、Unity 都能用；Apple Vision Pro 和 iPhone、iPad 的擴增實境請選 USDZ；另外還有 OBJ、3D 列印用的 STL、截圖，以及可以再開啟修改的專案檔。所有處理都在你的瀏覽器裡，平面圖不會上傳到網路。',
    text: '做好的 3D 模型可以匯出。VR 眼鏡請選 GLB，Meta Quest、SteamVR、Unity 都能用；Apple Vision Pro 和 iPhone、iPad 的擴增實境請選 USDZ；另外還有 OBJ、3D 列印用的 STL、截圖，以及可以再開啟修改的專案檔。',
    demo: async () => {
      await wait(9000);
      app().openExport(false);
    },
  },
  {
    target: () => $('#vr-btn'),
    text: '如果你有 VR 眼鏡，在眼鏡的瀏覽器打開線上版，按「VR」就能用真實比例走進房子裡：左手搖桿移動、右手搖桿轉向，扣板機可以瞬間移動到指著的地方。',
    ios: '想用 VR 眼鏡看，可以匯出專案檔或 GLB，用 AirDrop 傳到 Apple Vision Pro，或在 Meta Quest 的瀏覽器打開線上版開啟。iPhone 和 iPad 則推薦匯出 USDZ，用擴增實境直接走進房子。',
    web: '如果你戴著 Meta Quest 或 Apple Vision Pro，用眼鏡的瀏覽器打開這個網頁，按「VR」就能用真實比例走進房子裡：左手搖桿移動、右手搖桿轉向，扣板機可以瞬間移動到指著的地方。在電腦上做好的模型，可以匯出專案檔，再到眼鏡上開啟。',
  },
  {
    target: () => $('.xk-update'),
    text: '最後，這顆按鈕會檢查新版本，有更新就能直接下載安裝。教學到這裡結束，想再聽一次，按上面的「語音教學」就可以了。祝你設計愉快！',
    ios: '最後，這顆按鈕會檢查新版本，有更新會帶你到安裝頁重新安裝，歷史紀錄都會保留。教學到這裡結束，想再聽一次，按上面的「語音教學」就可以了。祝你設計愉快！',
    web: '最後，這顆按鈕會檢查新版本，有更新會自動重新整理。旁邊的「桌面版」可以下載 Windows 和 Mac 版。教學到這裡結束，想再聽一次，按上面的「語音教學」就可以了。祝你設計愉快！',
  },
];

let running = false;
/** 立刻結束目前這句話（有些語音引擎 cancel 後不會觸發 onend）。 */
let cutSpeech: (() => void) | null = null;
let stopRequested = false;

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices();
  for (const re of [/zh[-_]TW/i, /Hanhan|Yating|Zhiwei|HsiaoChen|HsiaoYu|Mei-Jia/i, /zh[-_]HK/i, /zh/i]) {
    const v = voices.find((x) => re.test(x.lang) || re.test(x.name));
    if (v) return v;
  }
  return undefined;
}

function speak(text: string, mouth: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window) || /[?&]mute/.test(location.search)) {
      mouth.classList.add('talk');
      setTimeout(() => {
        mouth.classList.remove('talk');
        resolve();
      }, fast() ? 300 : Math.max(2500, text.length * 180));
      return;
    }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = v?.lang ?? 'zh-TW';
    u.rate = 1.05;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      cutSpeech = null;
      mouth.classList.remove('talk');
      resolve();
    };
    cutSpeech = finish;
    u.onstart = () => mouth.classList.add('talk');
    u.onend = finish;
    u.onerror = finish;
    // 有些環境沒有語音，或不會觸發 onend：依字數估一個保底時間
    setTimeout(finish, Math.max(4000, text.length * 260) + 1500);
    speechSynthesis.speak(u);
  });
}

export async function startGuide() {
  if (running || app().busy()) return;
  demoEdits = 0;
  running = true;
  stopRequested = false;
  let index = 0;
  let jump: number | null = null;
  let paused = false;

  const layer = document.createElement('div');
  layer.className = 'xk-guide';
  layer.innerHTML = `
    <div class="xk-spot"></div>
    <div class="xk-bubble" role="dialog" aria-live="polite">
      <div class="xk-robot">${ROBOT_SVG}</div>
      <div class="xk-body">
        <p class="xk-text"></p>
        <div class="xk-bar"><span class="xk-count"></span>
          <button type="button" class="ghost xk-prev" title="上一步">◀</button>
          <button type="button" class="ghost xk-pause" title="暫停">⏸</button>
          <button type="button" class="ghost xk-next" title="下一步">▶</button>
          <button type="button" class="ghost xk-close" title="結束教學">✕</button>
        </div>
      </div>
    </div>`;
  document.body.append(layer);
  const spot = layer.querySelector<HTMLElement>('.xk-spot')!;
  const bubble = layer.querySelector<HTMLElement>('.xk-bubble')!;
  const text = layer.querySelector<HTMLElement>('.xk-text')!;
  const count = layer.querySelector<HTMLElement>('.xk-count')!;
  const robot = layer.querySelector<HTMLElement>('.xk-robot')!;
  const pauseBtn = layer.querySelector<HTMLButtonElement>('.xk-pause')!;
  let wake: (() => void) | null = null;
  const interrupt = () => {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    cutSpeech?.();
    wake?.();
  };
  layer.querySelector('.xk-prev')!.addEventListener('click', () => {
    jump = Math.max(0, index - 1);
    interrupt();
  });
  layer.querySelector('.xk-next')!.addEventListener('click', () => {
    jump = index + 1;
    interrupt();
  });
  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    pauseBtn.textContent = paused ? '▶︎ 繼續' : '⏸';
    if (paused && 'speechSynthesis' in window) speechSynthesis.pause();
    else {
      if ('speechSynthesis' in window) speechSynthesis.resume();
      wake?.();
    }
  });
  layer.querySelector('.xk-close')!.addEventListener('click', () => {
    stopRequested = true;
    interrupt();
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      stopRequested = true;
      interrupt();
    }
  };
  document.addEventListener('keydown', onKey);

  const place = (target: HTMLElement | null) => {
    if (!target || target.offsetParent === null) {
      spot.classList.add('none');
      bubble.style.left = '50%';
      bubble.style.top = '50%';
      bubble.style.transform = 'translate(-50%, -50%)';
      return;
    }
    target.scrollIntoView({ block: 'nearest' });
    const r = target.getBoundingClientRect();
    const pad = 6;
    spot.classList.remove('none');
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px` });
    const bw = Math.min(460, window.innerWidth - 24);
    const bh = bubble.offsetHeight || 160;
    let left = r.left - bw - 18;
    let top = r.top;
    if (left < 12) left = r.right + 18;
    if (left + bw > window.innerWidth - 12) {
      left = Math.max(12, Math.min(window.innerWidth - bw - 12, r.left + r.width / 2 - bw / 2));
      top = r.bottom + 18;
      if (top + bh > window.innerHeight - 12) top = r.top - bh - 18;
      // 目標很大（例如比較畫面）：氣泡蓋在目標下方內側
      if (top < 12) top = Math.min(window.innerHeight - bh - 12, r.bottom - bh - 12);
    }
    top = Math.max(12, Math.min(window.innerHeight - bh - 12, top));
    Object.assign(bubble.style, { left: `${left}px`, top: `${top}px`, transform: 'none' });
  };

  const lift = () => {
    if (layer.parentElement !== document.body) document.body.append(layer);
  };

  try {
    while (index < STEPS.length && !stopRequested) {
      const step = STEPS[index];
      jump = null;
      count.textContent = `${index + 1} / ${STEPS.length}`;
      await step.before?.();
      lift();
      await sleep(250);
      if (stopRequested) break;
      if (jump !== null) {
        index = jump;
        continue;
      }
      const line = iosApp() && step.ios ? step.ios : !desktop() && step.web ? step.web : step.text;
      text.textContent = line;
      robot.classList.remove('pop');
      void robot.offsetWidth;
      robot.classList.add('pop');
      place(step.target?.() ?? null);
      const follow = setInterval(() => {
        lift();
        place(step.target?.() ?? null);
      }, 400);
      await Promise.all([speak(line, robot), step.demo?.().then(() => sleep(400))]);
      clearInterval(follow);
      while (paused && !stopRequested && jump === null) await new Promise<void>((r) => (wake = r));
      wake = null;
      if (jump === null && !stopRequested) await sleep(500);
      index = jump ?? index + 1;
    }
  } finally {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    document.removeEventListener('keydown', onKey);
    layer.remove();
    running = false;
    app().openExport(false);
    app().setTool('select');
    app().setTab('cmd');
    if (app().scene().mode !== 'orbit') void app().setMode('orbit');
    try {
      localStorage.setItem('xiaoke-floorplan:guided', '1');
    } catch {
      // 無痕模式等情況：下次再自動播放也無妨
    }
  }
}

/** 第一次開啟時自動播放教學。 */
export function guideOnFirstRun() {
  let seen = '1';
  try {
    seen = localStorage.getItem('xiaoke-floorplan:guided') ?? '';
  } catch {
    seen = '1';
  }
  if (!seen && !/[?&]noguide/.test(location.search)) setTimeout(() => void startGuide(), 1200);
}

// --- 版本更新 ---------------------------------------------------------------------

const UPDATE_REPO = 'achir1015/xiaoke-floorplan';

function cmpVer(a: string, b: string) {
  const pa = a.replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

function dialog(html: string): HTMLDialogElement {
  const d = document.createElement('dialog');
  d.className = 'xk-dialog';
  d.innerHTML = `<form method="dialog">${html}</form>`;
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
  return d;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function initUpdateButton(current: string) {
  for (const b of document.querySelectorAll<HTMLButtonElement>('.xk-update')) b.addEventListener('click', () => void checkUpdate(current));
}

export async function checkUpdate(current: string, quiet = false) {
  const xk = desktop();
  try {
    let info: UpdateInfo;
    if (xk) info = await xk.update.check();
    else if (iosApp()) {
      // iPhone／iPad App：比對線上版的 version.json，有新版就到安裝頁重新安裝
      const res = await fetch(`${PAGES}/version.json?t=${Date.now()}`, { cache: 'no-store' });
      const j = (await res.json()) as { version: string; notes?: string };
      info = { current, latest: j.version, newer: cmpVer(j.version, current) > 0, notes: j.notes ?? '', page: `${PAGES}/ios/`, canInstall: true, flavor: 'ios' };
    }
    else {
      // 線上版：比對 version.json，有新版就重新整理頁面（略過快取）
      const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
      const j = (await res.json()) as { version: string; notes?: string };
      info = { current, latest: j.version, newer: cmpVer(j.version, current) > 0, notes: j.notes ?? '', page: `https://github.com/${UPDATE_REPO}/releases/latest`, canInstall: true, flavor: 'web' };
    }
    if (!info.newer) {
      if (!quiet) dialog(`<h2>已是最新版</h2><p>目前版本 v${esc(info.current)} 就是最新版。</p><div class="xk-row"><button class="ghost">關閉</button></div>`);
      return;
    }
    const d = dialog(`<h2>有新版本 v${esc(info.latest)}</h2><p>目前版本 v${esc(info.current)}</p>
      ${info.notes ? `<pre class="xk-notes">${esc(info.notes)}</pre>` : ''}
      <progress hidden max="1" value="0"></progress><p class="xk-msg"></p>
      <div class="xk-row"><button type="button" class="xk-go">${info.canInstall ? (xk ? '下載並安裝' : iosApp() ? '前往安裝頁更新' : '立即更新') : '開啟下載頁'}</button><button class="ghost">稍後</button></div>`);
    const go = d.querySelector<HTMLButtonElement>('.xk-go')!;
    const bar = d.querySelector<HTMLProgressElement>('progress')!;
    const msg = d.querySelector<HTMLElement>('.xk-msg')!;
    go.addEventListener('click', async () => {
      if (iosApp()) {
        await iosApp()!.postMessage({ cmd: 'open_url', args: [`${PAGES}/ios/`] });
        return;
      }
      if (!xk) {
        location.reload();
        return;
      }
      if (!info.canInstall) {
        await xk.update.openPage();
        return;
      }
      if (window.xkApp?.busy() && !confirm('正在處理中，更新會中斷。要繼續更新嗎？')) return;
      go.disabled = true;
      bar.hidden = false;
      const off = xk.update.onProgress(({ got, total }) => {
        if (total) bar.value = got / total;
        msg.textContent = `下載中 ${(got / 1048576).toFixed(1)} MB${total ? ` / ${(total / 1048576).toFixed(1)} MB` : ''}`;
      });
      try {
        const file = await xk.update.download();
        msg.textContent = '下載完成，正在安裝，程式會自動重新開啟…';
        const r = await xk.update.install(file);
        if (r.manual) msg.textContent = `已下載到 ${r.path}，請手動開啟安裝。`;
      } catch (e) {
        msg.textContent = `更新失敗：${(e as Error).message}`;
        go.disabled = false;
      } finally {
        off();
      }
    });
  } catch (e) {
    if (!quiet) dialog(`<h2>無法檢查更新</h2><p>${esc((e as Error).message)}</p><div class="xk-row"><button class="ghost">關閉</button></div>`);
  }
}

