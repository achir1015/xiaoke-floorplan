// AI（OpenAI，使用者自備金鑰，只存在這台電腦／瀏覽器）：
// 1. 讀圖：整張平面圖交給視覺模型辨識（像素座標，再換算公尺）
// 2. 輔助：本機辨識的幾何＋AI 判讀房間名稱與比例尺（最準）
// 3. 指令：本機規則看不懂的自然語言指令
// 4. 語音輸入：錄音轉文字
import { type Plan, normalizePlan, repairJson, clone, type Room, centroid } from './plan';

export interface AiConfig {
  key: string;
  model: string;
}

export const MODELS = [
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 mini（快、便宜，推薦）' },
  { id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra（最聰明，較慢）' },
  { id: 'gpt-4o', name: 'GPT-4o（參考專案原本使用）' },
];

const CFG_KEY = 'xiaoke-floorplan:ai';

export function loadAi(): AiConfig {
  try {
    const v = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
    return { key: v.key || '', model: v.model || MODELS[0].id };
  } catch {
    return { key: '', model: MODELS[0].id };
  }
}
export function saveAi(c: AiConfig) {
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(c));
  } catch {
    // 無痕模式：只在這次使用
  }
}

async function call(cfg: AiConfig, content: unknown[], instructions: string, signal?: AbortSignal): Promise<string> {
  if (!cfg.key) throw new Error('還沒有設定 OpenAI 金鑰（右上「設定」）');
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({
      model: cfg.model,
      instructions,
      input: [{ role: 'user', content }],
      text: { format: { type: 'json_object' } },
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = j?.error?.message || `HTTP ${res.status}`;
    if (res.status === 401) throw new Error('OpenAI 金鑰不正確或已失效');
    if (res.status === 429) throw new Error('OpenAI 額度不足或請求太頻繁，請稍後再試');
    throw new Error(`OpenAI 錯誤：${msg}`);
  }
  const text = j.output_text ?? (j.output ?? []).flatMap((o: { content?: { type: string; text?: string }[] }) => o.content ?? []).filter((c: { type: string }) => c.type === 'output_text').map((c: { text?: string }) => c.text ?? '').join('');
  if (!text) throw new Error('AI 沒有回應內容');
  return text;
}

/** 圖片縮到長邊 maxSide 以內，轉成 data URL */
export function imageToDataUrl(img: HTMLImageElement | HTMLCanvasElement, maxSide = 1600): { url: string; w: number; h: number } {
  const W = 'naturalWidth' in img ? img.naturalWidth : img.width;
  const H = 'naturalHeight' in img ? img.naturalHeight : img.height;
  const k = Math.min(1, maxSide / Math.max(W, H));
  const c = document.createElement('canvas');
  c.width = Math.round(W * k);
  c.height = Math.round(H * k);
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  return { url: c.toDataURL('image/jpeg', 0.9), w: c.width, h: c.height };
}

const VISION_PROMPT = (w: number, h: number) => `你是建築平面圖辨識專家。圖片大小 ${w}×${h} 像素，座標原點在左上角，x 往右、y 往下。
請辨識所有牆、門、窗、柱子與房間，用「像素座標」回傳 JSON（只回 JSON）：
{
 "metersPerPixel": 數字（依圖上尺寸標註推算；沒有標註就依一般門寬約 0.9 公尺推算）,
 "wallHeight": 數字（公尺，預設 3）,
 "walls": [[x1,y1,x2,y2,厚度像素], ...]   牆中心線；水平或垂直的牆請讓座標精準對齊,
 "doors": [[中心x,中心y,寬度像素,"h"或"v"], ...]   "h"=門在水平牆上,
 "windows": [[中心x,中心y,寬度像素,"h"或"v"], ...],
 "columns": [[中心x,中心y,寬像素,深像素], ...],
 "rooms": [{"name":"客廳","points":[[x,y],...]}]   房間外框多邊形與圖上寫的名稱（繁體中文）
}
門窗必須位在牆上。不要漏掉外牆。`;

/** AI 整張讀圖 */
export async function aiAnalyze(cfg: AiConfig, img: HTMLImageElement, wallHeight: number, signal?: AbortSignal): Promise<Plan> {
  const { url, w, h } = imageToDataUrl(img);
  const text = await call(cfg, [{ type: 'input_text', text: '請辨識這張建築平面圖。' }, { type: 'input_image', image_url: url }], VISION_PROMPT(w, h), signal);
  const j = repairJson(text) as Record<string, unknown>;
  const k = Number(j.metersPerPixel) > 0 && Number(j.metersPerPixel) < 1 ? Number(j.metersPerPixel) : 0.02;
  const scale = img.naturalWidth / w; // 換回原圖像素
  const mPerPx = k / scale;
  const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[][]).filter(Array.isArray) : []);
  // 原點：牆的外框中心
  const xs: number[] = [], ys: number[] = [];
  for (const q of arr(j.walls)) {
    xs.push(+q[0], +q[2]);
    ys.push(+q[1], +q[3]);
  }
  const ox = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : w / 2;
  const oy = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : h / 2;
  const X = (v: unknown) => +((+(v as number) - ox) * k).toFixed(3);
  const Y = (v: unknown) => +((+(v as number) - oy) * k).toFixed(3);
  const H = Number(j.wallHeight) > 1.8 && Number(j.wallHeight) < 10 ? Number(j.wallHeight) : wallHeight;
  const els: unknown[] = [];
  for (const q of arr(j.walls)) els.push({ type: 'wall', x1: X(q[0]), z1: Y(q[1]), x2: X(q[2]), z2: Y(q[3]), thickness: Math.max(0.08, (+(q[4] as number) || 8) * k), height: H });
  for (const [t, list] of [['door', j.doors], ['window', j.windows]] as const)
    for (const q of arr(list)) els.push({ type: t, x: X(q[0]), z: Y(q[1]), width: Math.max(0.4, (+(q[2] as number) || 40) * k), angle: q[3] === 'v' ? Math.PI / 2 : 0, height: t === 'door' ? 2.1 : 1.2, sill: t === 'door' ? 0 : 0.9 });
  for (const q of arr(j.columns)) els.push({ type: 'column', x: X(q[0]), z: Y(q[1]), w: Math.max(0.1, (+(q[2] as number) || 20) * k), d: Math.max(0.1, (+(q[3] as number) || +(q[2] as number) || 20) * k), height: H, shape: 'box' });
  const palette = ['#f6d7a7', '#cfe6c9', '#cfe0f5', '#f3cfd8', '#e2d6f3', '#f7ecb5', '#d5efe9', '#f1dcc8'];
  (Array.isArray(j.rooms) ? (j.rooms as { name?: string; points?: number[][] }[]) : []).forEach((r, i) => {
    if (Array.isArray(r?.points) && r.points.length >= 3) els.push({ type: 'room', name: r.name || `空間 ${i + 1}`, color: palette[i % palette.length], points: r.points.map((q) => [X(q[0]), Y(q[1])]) });
  });
  const plan = normalizePlan({ name: 'AI 辨識結果', wallHeight: H, elements: els });
  plan.image = { w: img.naturalWidth, h: img.naturalHeight, mPerPx, ox: ox * scale, oz: oy * scale };
  return plan;
}

/** 本機幾何＋AI 補房間名稱與比例尺 */
export async function aiAssist(cfg: AiConfig, img: HTMLImageElement, plan: Plan, signal?: AbortSignal): Promise<{ plan: Plan; scale: number; names: number }> {
  const im = plan.image;
  if (!im) return { plan, scale: 1, names: 0 };
  const { url, w } = imageToDataUrl(img);
  const k = w / im.w;
  const rooms = plan.elements.filter((e): e is Room => e.type === 'room');
  const list = rooms.map((r, i) => {
    const [cx, cz] = centroid(r.points);
    return { i, x: Math.round((cx / im.mPerPx + im.ox) * k), y: Math.round((cz / im.mPerPx + im.oz) * k) };
  });
  const walls = plan.elements.filter((e) => e.type === 'wall');
  const ext = walls.length ? { widthPx: Math.round((plan.width / im.mPerPx) * k), depthPx: Math.round((plan.depth / im.mPerPx) * k) } : null;
  const text = await call(
    cfg,
    [
      {
        type: 'input_text',
        text: `這是建築平面圖（${w} 像素寬）。已偵測到 ${list.length} 個房間，中心點像素座標：${JSON.stringify(list)}。建築外框約 ${ext?.widthPx}×${ext?.depthPx} 像素。
請回傳 JSON：{"names":[{"i":編號,"name":"房間名稱（繁體中文，依圖上文字；沒寫就依大小與位置推測，例如客廳、臥室、廚房、浴室、陽台、走道）"}],"buildingWidthM":建築外框實際寬度公尺（依尺寸標註；看不出來填 null）}`,
      },
      { type: 'input_image', image_url: url },
    ],
    '你是建築平面圖判讀專家，只回 JSON。',
    signal,
  );
  const j = repairJson(text) as { names?: { i: number; name: string }[]; buildingWidthM?: number | null };
  const out = clone(plan);
  const outRooms = out.elements.filter((e): e is Room => e.type === 'room');
  let names = 0;
  for (const n of j.names ?? []) {
    if (outRooms[n.i] && typeof n.name === 'string' && n.name.trim()) {
      outRooms[n.i].name = n.name.trim().slice(0, 20);
      names++;
    }
  }
  let scale = 1;
  const bw = Number(j.buildingWidthM);
  if (bw > 2 && bw < 500 && out.width > 0) scale = bw / out.width;
  return { plan: out, scale, names };
}

/** AI 修改場景 */
export async function aiCommand(cfg: AiConfig, command: string, plan: Plan, selected: string | null, signal?: AbortSignal): Promise<{ plan: Plan; message: string }> {
  const slim = clone(plan);
  delete slim.image;
  const text = await call(
    cfg,
    [
      {
        type: 'input_text',
        text: `目前的 3D 建築模型（JSON，單位公尺，x 往右、z 往下（南）、y 往上；牆是中心線 x1,z1→x2,z2；門窗 x,z 是中心、angle 是弧度、sill 是離地高度；房間 points 是地板多邊形）：
${JSON.stringify(slim)}
${selected ? `使用者目前選取的物件 id：${selected}` : ''}
使用者指令：「${command}」
請依指令修改模型，回傳 JSON：{"message":"用繁體中文簡短說明你做了什麼","elements":[修改後完整的 elements 陣列],"wallHeight":數字,"floorColor":"#rrggbb","wallColor":"#rrggbb","showRoof":true/false}
保留沒有改到的物件與 id。顏色用 #rrggbb。`,
      },
    ],
    '你是 3D 建築模型編輯助手，聽得懂中文與英文指令，只回 JSON。',
    signal,
  );
  const j = repairJson(text) as Record<string, unknown>;
  if (!Array.isArray(j.elements)) throw new Error(typeof j.message === 'string' ? j.message : 'AI 沒有回傳模型');
  const next = normalizePlan(j, plan);
  next.image = plan.image;
  next.name = plan.name;
  return { plan: next, message: typeof j.message === 'string' ? j.message : '已依指令修改' };
}

/** 錄音轉文字 */
export async function transcribe(cfg: AiConfig, blob: Blob): Promise<string> {
  if (!cfg.key) throw new Error('語音輸入需要 OpenAI 金鑰');
  const fd = new FormData();
  fd.append('file', blob, blob.type.includes('mp4') ? 'voice.mp4' : 'voice.webm');
  fd.append('model', 'gpt-4o-mini-transcribe');
  fd.append('language', 'zh');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${cfg.key}` }, body: fd });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error?.message || `語音辨識失敗（${res.status}）`);
  return String(j.text ?? '').trim();
}
