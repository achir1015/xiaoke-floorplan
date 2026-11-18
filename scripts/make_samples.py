# 產生範例平面圖（教學、測試用）：public/samples/*.png 與對照答案 tests/fixtures/*.json
# 畫法照一般建築平面圖：牆塗黑（或空心雙線）、門有門片與開門弧線、窗是三條細平行線、外面有尺寸標註。
import json
import math
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = 'C:/Windows/Fonts/msjhbd.ttc'
if not os.path.exists(FONT):
    FONT = '/System/Library/Fonts/PingFang.ttc'


def font(n):
    try:
        return ImageFont.truetype(FONT, n)
    except OSError:
        return ImageFont.load_default()


def plan_image(spec, out_png, out_json, hollow=False):
    PX = spec['px']  # 每公尺像素
    M = 110  # 邊界
    W = int(spec['w'] * PX + 2 * M)
    H = int(spec['d'] * PX + 2 * M)
    img = Image.new('RGB', (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    P = lambda x, z: (M + x * PX, M + z * PX)

    # 尺寸標註（細線＋數字）
    f = font(18)
    y = M - 55
    d.line([P(0, 0)[0], y, P(spec['w'], 0)[0], y], fill=(60, 60, 60), width=1)
    for x in (0, spec['w']):
        d.line([P(x, 0)[0], y - 8, P(x, 0)[0], y + 8], fill=(60, 60, 60), width=1)
    d.text(((P(0, 0)[0] + P(spec['w'], 0)[0]) / 2, y - 6), f"{int(spec['w'] * 1000)}", font=f, fill=(40, 40, 40), anchor='mb')
    x = M - 55
    d.line([x, P(0, 0)[1], x, P(0, spec['d'])[1]], fill=(60, 60, 60), width=1)
    for z in (0, spec['d']):
        d.line([x - 8, P(0, z)[1], x + 8, P(0, z)[1]], fill=(60, 60, 60), width=1)

    def wall_rect(w):
        (x1, z1), (x2, z2), t = w['a'], w['b'], w['t']
        if z1 == z2:
            return [P(min(x1, x2) - t / 2, z1 - t / 2), P(max(x1, x2) + t / 2, z1 + t / 2)]
        return [P(x1 - t / 2, min(z1, z2) - t / 2), P(x1 + t / 2, max(z1, z2) + t / 2)]

    # 牆：先整面塗，再把門窗位置挖掉
    mask = Image.new('L', (W, H), 0)
    md = ImageDraw.Draw(mask)
    for w in spec['walls']:
        r = wall_rect(w)
        md.rectangle([r[0][0], r[0][1], r[1][0] - 1, r[1][1] - 1], fill=255)
    for o in spec['openings']:
        x, z, L, horiz = o['x'], o['z'], o['w'], o['h']
        t = 0.32
        if horiz:
            md.rectangle([*P(x - L / 2, z - t), *P(x + L / 2, z + t)], fill=0)
        else:
            md.rectangle([*P(x - t, z - L / 2), *P(x + t, z + L / 2)], fill=0)
    if hollow:
        # 空心雙線牆：只畫外框線（3px）
        edge = Image.new('L', (W, H), 0)
        px = mask.load()
        ep = edge.load()
        for yy in range(1, H - 1):
            for xx in range(1, W - 1):
                if px[xx, yy] and (not px[xx - 1, yy] or not px[xx + 1, yy] or not px[xx, yy - 1] or not px[xx, yy + 1]):
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            if px[xx + dx, yy + dy]:
                                ep[xx + dx, yy + dy] = 255
        img.paste((30, 30, 30), mask=edge)
    else:
        img.paste((25, 25, 25), mask=mask)

    # 門窗（細線）
    for o in spec['openings']:
        x, z, L, horiz = o['x'], o['z'], o['w'], o['h']
        t = o.get('t', 0.15)
        if o['type'] == 'window':
            for k in (-t / 2, 0, t / 2):
                if horiz:
                    d.line([P(x - L / 2, z + k), P(x + L / 2, z + k)], fill=(40, 40, 40), width=2)
                else:
                    d.line([P(x + k, z - L / 2), P(x + k, z + L / 2)], fill=(40, 40, 40), width=2)
        else:
            s = o.get('swing', 1)
            if horiz:
                hx, hz = x - L / 2, z
                d.line([P(hx, hz), P(hx, hz + s * L)], fill=(40, 40, 40), width=2)
                bb = [*P(hx - L, hz - L), *P(hx + L, hz + L)]
                d.arc(bb, 0 if s > 0 else 270, 90 if s > 0 else 360, fill=(90, 90, 90), width=1)
            else:
                hx, hz = x, z - L / 2
                d.line([P(hx, hz), P(hx + s * L, hz)], fill=(40, 40, 40), width=2)
                bb = [*P(hx - L, hz - L), *P(hx + L, hz + L)]
                d.arc(bb, 0 if s > 0 else 90, 90 if s > 0 else 180, fill=(90, 90, 90), width=1)

    for c in spec.get('columns', []):
        d.rectangle([*P(c[0] - c[2] / 2, c[1] - c[2] / 2), *P(c[0] + c[2] / 2, c[1] + c[2] / 2)], fill=(25, 25, 25))
    # 房間名稱與坪數
    for r in spec['rooms']:
        cx, cz = r['label']
        d.text(P(cx, cz), r['name'], font=font(26), fill=(30, 30, 30), anchor='mm')
        d.text((P(cx, cz)[0], P(cx, cz)[1] + 26), r.get('sub', ''), font=font(16), fill=(110, 110, 110), anchor='mm')
    # 家具示意（細線，不應被當成牆）
    for fr in spec.get('furniture', []):
        d.rectangle([*P(fr[0], fr[1]), *P(fr[2], fr[3])], outline=(150, 150, 150), width=1)
    d.text((W - 20, H - 20), spec['title'], font=font(20), fill=(60, 60, 60), anchor='rb')
    img.save(out_png, optimize=True)
    with open(out_json, 'w', encoding='utf-8') as fp:
        json.dump({'pxPerM': PX, 'margin': M, **spec}, fp, ensure_ascii=False, indent=1)


EXT, INT = 0.2, 0.12

# 範例一：兩房一廳（12 × 9 m）
A = {
    'title': '範例：兩房一廳 約 32 坪',
    'px': 60, 'w': 12, 'd': 9,
    'walls': [
        {'a': (0, 0), 'b': (12, 0), 't': EXT}, {'a': (0, 9), 'b': (12, 9), 't': EXT},
        {'a': (0, 0), 'b': (0, 9), 't': EXT}, {'a': (12, 0), 'b': (12, 9), 't': EXT},
        {'a': (7, 0), 'b': (7, 9), 't': INT},          # 客廳｜臥室 隔間
        {'a': (7, 4.5), 'b': (12, 4.5), 't': INT},     # 主臥｜次臥
        {'a': (0, 5.5), 'b': (3.5, 5.5), 't': INT},    # 廚房上方
        {'a': (3.5, 5.5), 'b': (3.5, 9), 't': INT},    # 廚房｜餐廳
        {'a': (0, 7.3), 'b': (3.5, 7.3), 't': INT},    # 廚房｜浴室
    ],
    'openings': [
        {'type': 'door', 'x': 5.2, 'z': 9, 'w': 1.0, 'h': True, 'swing': -1},     # 大門
        {'type': 'door', 'x': 7, 'z': 2.0, 'w': 0.9, 'h': False, 'swing': 1},     # 主臥門
        {'type': 'door', 'x': 7, 'z': 6.5, 'w': 0.9, 'h': False, 'swing': 1},     # 次臥門
        {'type': 'door', 'x': 2.0, 'z': 5.5, 'w': 0.9, 'h': True, 'swing': 1},    # 廚房門
        {'type': 'door', 'x': 3.5, 'z': 7.9, 'w': 0.8, 'h': False, 'swing': 1},   # 浴室門
        {'type': 'window', 'x': 3.5, 'z': 0, 'w': 2.4, 'h': True},                # 客廳窗
        {'type': 'window', 'x': 9.5, 'z': 0, 'w': 1.8, 'h': True},                # 主臥窗
        {'type': 'window', 'x': 12, 'z': 6.8, 'w': 1.5, 'h': False},              # 次臥窗
        {'type': 'window', 'x': 0, 'z': 6.4, 'w': 1.0, 'h': False},               # 廚房窗
    ],
    'rooms': [
        {'name': '客廳', 'sub': '7.0 × 5.5 m', 'label': (3.5, 2.6)},
        {'name': '主臥室', 'sub': '', 'label': (9.5, 2.2)},
        {'name': '次臥室', 'sub': '', 'label': (9.5, 6.8)},
        {'name': '廚房', 'sub': '', 'label': (1.7, 6.4)},
        {'name': '浴室', 'sub': '', 'label': (1.7, 8.3)},
        {'name': '餐廳', 'sub': '', 'label': (5.3, 7.0), 'open': True},
    ],
    'furniture': [(0.6, 0.8, 3.0, 1.7), (8.0, 1.2, 10.0, 3.2), (8.0, 5.4, 9.6, 7.4)],
}

# 範例二：三房兩廳（14 × 10 m），空心雙線牆＋中間一根柱子
B = {
    'title': '範例：三房兩廳 空心牆線',
    'px': 55, 'w': 14, 'd': 10,
    'walls': [
        {'a': (0, 0), 'b': (14, 0), 't': 0.24}, {'a': (0, 10), 'b': (14, 10), 't': 0.24},
        {'a': (0, 0), 'b': (0, 10), 't': 0.24}, {'a': (14, 0), 'b': (14, 10), 't': 0.24},
        {'a': (5, 0), 'b': (5, 4), 't': 0.15},
        {'a': (0, 4), 'b': (5, 4), 't': 0.15},
        {'a': (10, 0), 'b': (10, 10), 't': 0.15},
        {'a': (10, 5), 'b': (14, 5), 't': 0.15},
        {'a': (0, 7), 'b': (4, 7), 't': 0.15},
        {'a': (4, 7), 'b': (4, 10), 't': 0.15},
    ],
    'openings': [
        {'type': 'door', 'x': 2.5, 'z': 4, 'w': 0.9, 'h': True, 'swing': -1},
        {'type': 'door', 'x': 10, 'z': 2.5, 'w': 0.9, 'h': False, 'swing': 1},
        {'type': 'door', 'x': 10, 'z': 7.5, 'w': 0.9, 'h': False, 'swing': 1},
        {'type': 'door', 'x': 2.0, 'z': 7, 'w': 0.9, 'h': True, 'swing': 1},
        {'type': 'door', 'x': 7.5, 'z': 10, 'w': 1.1, 'h': True, 'swing': -1},
        {'type': 'window', 'x': 2.5, 'z': 0, 'w': 1.8, 'h': True},
        {'type': 'window', 'x': 7.5, 'z': 0, 'w': 2.6, 'h': True},
        {'type': 'window', 'x': 12, 'z': 0, 'w': 1.6, 'h': True},
        {'type': 'window', 'x': 14, 'z': 7.5, 'w': 1.6, 'h': False},
        {'type': 'window', 'x': 0, 'z': 8.5, 'w': 1.0, 'h': False},
    ],
    'rooms': [
        {'name': '書房', 'label': (2.5, 2)}, {'name': '客餐廳', 'label': (7.5, 5.5)},
        {'name': '主臥', 'label': (12, 2.5)}, {'name': '小孩房', 'label': (12, 7.5)},
        {'name': '衛浴', 'label': (2, 8.5)},
    ],
    'columns': [(7.5, 3.2, 0.5)],
}

os.makedirs(os.path.join(ROOT, 'public', 'samples'), exist_ok=True)
os.makedirs(os.path.join(ROOT, 'tests', 'fixtures'), exist_ok=True)
plan_image(A, os.path.join(ROOT, 'public', 'samples', 'sample-2room.png'), os.path.join(ROOT, 'tests', 'fixtures', 'sample-2room.json'))
plan_image(B, os.path.join(ROOT, 'public', 'samples', 'sample-3room.png'), os.path.join(ROOT, 'tests', 'fixtures', 'sample-3room.json'), hollow=True)
print('samples ok')
