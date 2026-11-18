// 自然語言指令（本機規則，不需網路）：中文與英文常用說法。
// 看不懂的指令交給 AI（有金鑰時）處理。
import { type Plan, type El, type ElType, type Wall, type Opening, type Column, type Room, clone, newId, updateBounds, TYPE_NAME, centroid } from './plan';
import { rescalePlan } from './detect';

export type ViewAction = 'walk' | 'orbit' | 'top' | 'vr' | 'night' | 'day' | 'labels-on' | 'labels-off' | 'reset' | 'undo' | 'redo' | 'screenshot';

export interface CmdResult {
  ok: boolean;
  message: string;
  plan?: Plan;
  view?: ViewAction;
  select?: string | null;
}

const COLORS: [RegExp, string, string][] = [
  [/紅|red/i, '#d9534f', '紅色'],
  [/橘|橙|orange/i, '#f0883e', '橘色'],
  [/黃|yellow/i, '#f2d14b', '黃色'],
  [/淺綠|light ?green/i, '#a8d8a0', '淺綠色'],
  [/綠|green/i, '#4caf50', '綠色'],
  [/淺藍|天藍|sky|light ?blue/i, '#a9d4f5', '淺藍色'],
  [/藍|blue/i, '#3b78d8', '藍色'],
  [/紫|purple|violet/i, '#9b6dd6', '紫色'],
  [/粉紅|粉|pink/i, '#f4a7c0', '粉紅色'],
  [/米白|米色|奶油|beige|cream/i, '#efe6d2', '米色'],
  [/白|white/i, '#f7f7f5', '白色'],
  [/黑|black/i, '#2b2b2b', '黑色'],
  [/淺灰|light ?gr[ae]y/i, '#cfd2d6', '淺灰色'],
  [/灰|水泥|gr[ae]y|concrete/i, '#9a9fa6', '灰色'],
  [/深木|胡桃|walnut|dark ?wood/i, '#7a5236', '深木色'],
  [/木|wood|oak/i, '#c8a27a', '木頭色'],
  [/咖啡|棕|褐|brown/i, '#8b5a3c', '咖啡色'],
  [/大理石|marble/i, '#e9e6e1', '大理石色'],
];

const CN_NUM: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 半: 0.5 };

/** 把「三點五」「兩」「十二」之類換成阿拉伯數字 */
export function cnToNumber(s: string) {
  return s.replace(/[零〇一二兩两三四五六七八九十半]+(點[零〇一二兩两三四五六七八九]+)?(?=\s*(公尺|米|公分|釐米|厘米|毫米|公釐|呎|倍|m|cm|mm))/g, (m) => {
    if (m === '半') return '0.5';
    const [ip, fp] = m.split('點');
    let v = 0;
    if (ip.includes('十')) {
      const [a, b] = ip.split('十');
      v = (a ? CN_NUM[a] ?? 1 : 1) * 10 + (b ? CN_NUM[b] ?? 0 : 0);
    } else v = Number([...ip].map((c) => CN_NUM[c] ?? 0).join('')) || 0;
    if (fp) v = Number(`${v}.${[...fp].map((c) => CN_NUM[c] ?? 0).join('')}`);
    return String(v);
  });
}

/** 指令裡的長度（公尺）：支援 公尺／米／m／公分／cm／mm */
function length(s: string): number | null {
  const m = /(-?\d+(?:\.\d+)?)\s*(公分|釐米|厘米|cm|毫米|公釐|mm|公尺|米|m(?![a-z])|meters?|呎|ft)?/i.exec(s);
  if (!m) return null;
  let v = parseFloat(m[1]);
  const u = (m[2] ?? '').toLowerCase();
  if (/公分|釐米|厘米|cm/.test(u)) v /= 100;
  else if (/毫米|公釐|mm/.test(u)) v /= 1000;
  else if (/呎|ft/.test(u)) v *= 0.3048;
  return v;
}

function targetTypes(s: string): ElType[] | null {
  const t: ElType[] = [];
  if (/牆|墙|walls?\b/i.test(s)) t.push('wall');
  if (/門|门|doors?\b/i.test(s)) t.push('door');
  if (/窗|windows?\b/i.test(s)) t.push('window');
  if (/柱|columns?\b|pillars?\b/i.test(s)) t.push('column');
  if (/房間|房间|空間|rooms?\b/i.test(s)) t.push('room');
  return t.length ? t : null;
}

export interface CmdContext {
  selected: string | null;
}

export function runCommand(input: string, plan: Plan, ctx: CmdContext): CmdResult {
  const raw = input.trim();
  if (!raw) return { ok: false, message: '請輸入指令' };
  const s = cnToNumber(raw);
  const low = s.toLowerCase();

  // ---- 視角類 ----
  if (/復原|还原|還原|上一步|undo/i.test(s)) return { ok: true, message: '已復原上一步', view: 'undo' };
  if (/重做|redo/i.test(s)) return { ok: true, message: '已重做', view: 'redo' };
  if (/\bvr\b|虛擬實境|頭戴|眼鏡/i.test(s)) return { ok: true, message: '進入 VR 模式', view: 'vr' };
  if (/漫遊|走進|進去|走走|第一人稱|walk|first.?person/i.test(s)) return { ok: true, message: '切換到漫遊模式：用 W A S D 或方向鍵走動，拖曳畫面轉頭', view: 'walk' };
  if (/俯視|正上方|平面|top.?view|from above/i.test(s)) return { ok: true, message: '切換到俯視', view: 'top' };
  if (/鳥瞰|外面|全景|重設視角|回到|overview|reset view|orbit/i.test(s)) return { ok: true, message: '切換到鳥瞰', view: 'reset' };
  if (/夜|晚上|開燈|night|lights? on/i.test(s)) return { ok: true, message: '切換成夜晚，房間燈打開了', view: 'night' };
  if (/白天|日間|關燈|day|lights? off/i.test(s)) return { ok: true, message: '切換成白天', view: 'day' };
  if (/截圖|拍照|screenshot/i.test(s)) return { ok: true, message: '已截圖', view: 'screenshot' };
  if (/(隱藏|關閉|不要|hide).*(名稱|標籤|文字|label)/i.test(s)) return { ok: true, message: '已隱藏房間名稱', view: 'labels-off' };
  if (/(顯示|打開|show).*(名稱|標籤|文字|label)/i.test(s)) return { ok: true, message: '已顯示房間名稱', view: 'labels-on' };

  const p = clone(plan);
  const sel = ctx.selected ? p.elements.find((e) => e.id === ctx.selected) ?? null : null;

  // ---- 屋頂 ----
  if (/屋頂|天花板|roof|ceiling/i.test(s)) {
    const on = !/(隱藏|拿掉|移除|刪除|關閉|不要|去掉|hide|remove|off)/i.test(s);
    p.showRoof = on;
    return { ok: true, message: on ? '已加上屋頂' : '已移除屋頂', plan: p };
  }

  // ---- 房間改名 ----
  const rn = /(?:把|將|将)?\s*(.+?)\s*(?:改名|命名|名稱改|名字改|重新命名)\s*(?:為|成|叫|做)?\s*[「"']?(.+?)[」"']?\s*$/.exec(s) || /rename\s+(.+?)\s+(?:to|as)\s+(.+)$/i.exec(s);
  if (rn) {
    const key = rn[1].replace(/^(這個|这个|選取的|the)\s*/i, '').trim();
    const room = (/這個|这个|選取|selected|this|它/.test(rn[1]) && sel?.type === 'room' ? sel : null) ?? (p.elements.find((e) => e.type === 'room' && (e.name === key || e.name.replace(/\s/g, '') === key.replace(/\s/g, ''))) as Room | undefined);
    if (!room || room.type !== 'room') return { ok: false, message: `找不到「${key}」這個房間；可以先在 3D 畫面點一下房間地板再說「把這個改名為客廳」` };
    const old = room.name;
    room.name = rn[2].trim().slice(0, 20);
    return { ok: true, message: `已把「${old}」改名為「${room.name}」`, plan: p, select: room.id };
  }

  // ---- 選取目標 ----
  const types = targetTypes(s);
  const useSel = !!sel && (/這|这|選取|選中|它|selected|this|it\b/i.test(s) || !types);
  // 「客廳的牆」：只找跟某房間相鄰的元素
  const roomNamed = p.elements.find((e): e is Room => e.type === 'room' && s.includes(e.name));
  let targets: El[];
  if (useSel && sel) targets = [sel];
  else if (types) {
    targets = p.elements.filter((e) => types.includes(e.type));
    if (roomNamed && !types.includes('room')) targets = targets.filter((e) => near(e, roomNamed));
    if (roomNamed && types.includes('room')) targets = [roomNamed];
  } else if (roomNamed) targets = [roomNamed];
  else targets = [];
  const what = useSel && sel ? `選取的${TYPE_NAME[sel.type]}` : roomNamed ? `${roomNamed.name}${types ? `的${types.map((t) => TYPE_NAME[t]).join('、')}` : ''}` : types ? `所有${types.map((t) => TYPE_NAME[t]).join('、')}` : '';

  // ---- 刪除 ----
  if (/刪除|删除|移除|拿掉|去掉|拆掉|delete|remove/i.test(s)) {
    if (!targets.length) return { ok: false, message: '要刪除什麼？例如「刪除所有柱子」或先點選物件再說「刪除這個」' };
    const ids = new Set(targets.map((e) => e.id));
    p.elements = p.elements.filter((e) => !ids.has(e.id));
    return { ok: true, message: `已刪除 ${what}（${ids.size} 個）`, plan: p, select: null };
  }

  // ---- 新增 ----
  if (/新增|加一|加個|加入|增加一|放一|蓋一|add|create|put/i.test(s) && types && !/高|厚|寬|height|thick|wide/i.test(s)) {
    const t = types[0];
    const pos = sel && sel.type === 'room' ? centroid(sel.points) : roomNamed ? centroid(roomNamed.points) : [0, 0];
    const at = /在\s*\(?\s*(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)/.exec(s);
    const [x, z] = at ? [parseFloat(at[1]), parseFloat(at[2])] : pos;
    let el: El;
    if (t === 'column') el = { id: newId('column'), type: 'column', x, z, w: 0.4, d: 0.4, height: p.wallHeight, shape: /圓|round|circle/i.test(s) ? 'round' : 'box' } as Column;
    else if (t === 'wall') {
      const L = length(s.replace(/在.*$/, '')) ?? 3;
      el = { id: newId('wall'), type: 'wall', x1: x - L / 2, z1: z, x2: x + L / 2, z2: z, thickness: 0.12, height: p.wallHeight } as Wall;
    } else if (t === 'door' || t === 'window') {
      // 門窗放在選取的牆中央
      const w = sel?.type === 'wall' ? sel : null;
      if (!w) return { ok: false, message: `請先在 3D 畫面點選一道牆，再說「在這道牆加一扇${TYPE_NAME[t]}」` };
      el = {
        id: newId(t),
        type: t,
        x: (w.x1 + w.x2) / 2,
        z: (w.z1 + w.z2) / 2,
        width: length(s) ?? (t === 'door' ? 0.9 : 1.5),
        height: t === 'door' ? 2.1 : 1.2,
        sill: t === 'door' ? 0 : 0.9,
        angle: Math.atan2(w.z2 - w.z1, w.x2 - w.x1),
      } as Opening;
    } else return { ok: false, message: '房間請在左邊 2D 圖上用工具畫牆圍出來' };
    p.elements.push(el);
    updateBounds(p);
    return { ok: true, message: `已新增一個${TYPE_NAME[t]}`, plan: p, select: el.id };
  }

  // ---- 顏色 ----
  const col = COLORS.find(([re]) => re.test(s.replace(/顏色|颜色|color/gi, '')));
  if (col && /色|color|改成|換成|變成|漆|刷|paint|make/i.test(s)) {
    if (/地板|地面|floor/i.test(s) && !useSel) {
      p.floorColor = col[1];
      for (const e of p.elements) if (e.type === 'room') e.color = col[1];
      return { ok: true, message: `地板改成${col[2]}`, plan: p };
    }
    const allWalls = !useSel && !roomNamed && (!types || (types.length === 1 && types[0] === 'wall'));
    if (allWalls) {
      // 整棟的牆：改預設牆色，清掉個別顏色
      p.wallColor = col[1];
      for (const e of p.elements) if (e.type === 'wall') delete e.color;
    } else for (const e of targets) e.color = col[1];
    return { ok: true, message: `${what || '所有牆'}改成${col[2]}`, plan: p };
  }

  // ---- 尺寸（高度／厚度／寬度） ----
  const prop = /厚|thick/i.test(s) ? 'thickness' : /寬|宽|width|wide/i.test(s) ? 'width' : /高|height|tall|tall/i.test(s) ? 'height' : null;
  const v = length(s);
  if (prop && v !== null) {
    const rel = /增加|加高|提高|加厚|加寬|多|增高|raise|increase|by\s/i.test(s) && !/(增加|提高|加高)到/.test(s) ? 1 : /減少|降低|減|少|縮|lower|decrease|reduce/i.test(s) && !/(降低|減少)到/.test(s) ? -1 : 0;
    let tg = targets.length ? targets : prop === 'height' ? p.elements.filter((e) => e.type === 'wall' || e.type === 'column') : [];
    if (!tg.length) return { ok: false, message: '要改哪些物件？例如「所有牆的厚度改成 20 公分」' };
    let n = 0;
    for (const e of tg) {
      const apply = (cur: number) => Math.max(0.02, rel ? cur + rel * v : v);
      if (prop === 'height' && (e.type === 'wall' || e.type === 'column' || e.type === 'door' || e.type === 'window')) {
        e.height = +apply(e.height).toFixed(3);
        n++;
      } else if (prop === 'thickness' && e.type === 'wall') {
        e.thickness = +apply(e.thickness).toFixed(3);
        n++;
      } else if (prop === 'width' && (e.type === 'door' || e.type === 'window')) {
        e.width = +apply(e.width).toFixed(3);
        n++;
      } else if (prop === 'width' && e.type === 'column') {
        e.w = e.d = +apply(e.w).toFixed(3);
        n++;
      }
    }
    if (prop === 'height' && !useSel && !roomNamed && (!types || types.includes('wall'))) {
      p.wallHeight = +(rel ? p.wallHeight + rel * v : v).toFixed(3);
    }
    tg = tg.slice(0, n);
    const name = { height: '高度', thickness: '厚度', width: '寬度' }[prop];
    if (!n) return { ok: false, message: `${what || '這些物件'}沒有${name}可以改` };
    return { ok: true, message: `${what || '所有牆'}的${name}${rel > 0 ? `增加 ${fmt(v)}` : rel < 0 ? `減少 ${fmt(v)}` : `改成 ${fmt(v)}`}（${n} 個）`, plan: p };
  }

  // ---- 移動 ----
  const dirm = /(左|右|前|後|后|上|下|北|南|東|西|left|right|forward|back(?:ward)?|up|down|north|south|east|west)/i.exec(s);
  if (/移|搬|挪|推|move|shift/i.test(s) && dirm) {
    const d = length(s) ?? 1;
    const dir = dirm[1].toLowerCase();
    let dx = 0, dz = 0;
    if (/左|西|left|west/.test(dir)) dx = -d;
    else if (/右|東|right|east/.test(dir)) dx = d;
    else if (/前|上|北|forward|up|north/.test(dir)) dz = -d;
    else dz = d;
    if (!targets.length) return { ok: false, message: '要移動什麼？先點選物件，或說「把所有柱子往左移 1 公尺」' };
    for (const e of targets) moveEl(e, dx, dz);
    updateBounds(p);
    return { ok: true, message: `${what}往${dirm[1]}移動 ${fmt(d)}`, plan: p };
  }

  // ---- 整體縮放 ----
  const sc = /(放大|縮小|scale)\s*(?:成|為|到)?\s*(\d+(?:\.\d+)?)\s*(倍|%|x)?/i.exec(s);
  if (sc) {
    let f = parseFloat(sc[2]);
    if (sc[3] === '%') f /= 100;
    if (/縮小/.test(sc[1]) && f > 1) f = 1 / f;
    if (!(f > 0.05 && f < 20)) return { ok: false, message: '縮放倍數不合理' };
    rescalePlan(p, f);
    return { ok: true, message: `整體尺寸×${+f.toFixed(3)}（${p.width.toFixed(1)} × ${p.depth.toFixed(1)} 公尺）`, plan: p };
  }

  // ---- 旋轉門窗方向等：交給 AI ----
  void low;
  return { ok: false, message: '' };
}

function fmt(m: number) {
  return m < 1 ? `${Math.round(m * 100)} 公分` : `${+m.toFixed(2)} 公尺`;
}

function moveEl(e: El, dx: number, dz: number) {
  if (e.type === 'wall') {
    e.x1 += dx;
    e.x2 += dx;
    e.z1 += dz;
    e.z2 += dz;
  } else if (e.type === 'room') e.points = e.points.map(([x, z]) => [x + dx, z + dz]);
  else {
    e.x += dx;
    e.z += dz;
  }
}

/** 元素是否在房間邊上或裡面 */
function near(e: El, r: Room) {
  const xs = r.points.map((q) => q[0]), zs = r.points.map((q) => q[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs) - 0.4, Math.max(...xs) + 0.4, Math.min(...zs) - 0.4, Math.max(...zs) + 0.4];
  const inside = (x: number, z: number) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
  if (e.type === 'wall') return inside((e.x1 + e.x2) / 2, (e.z1 + e.z2) / 2) || (inside(e.x1, e.z1) && inside(e.x2, e.z2));
  if (e.type === 'room') return e.id === r.id;
  return inside(e.x, e.z);
}

export const EXAMPLES = [
  '把所有牆壁的高度改成 3.5 公尺',
  '牆壁高度增加 50 公分',
  '把牆漆成淺藍色',
  '地板換成深木色',
  '刪除所有柱子',
  '把選取的柱子往左移 1 公尺',
  '把空間 A 改名為客廳',
  '加上屋頂',
  '晚上開燈',
  '進入漫遊模式',
];
