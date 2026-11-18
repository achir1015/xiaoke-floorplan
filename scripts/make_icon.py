# 產生程式圖示：小柯機器人（頭盔造型）＋藍圖平面圖，上面立起一棟立體房子
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 1024
NAVY = (22, 52, 104, 255)


def layer():
    return Image.new('RGBA', (S, S), (0, 0, 0, 0))


img = layer()
bg = layer()
d = ImageDraw.Draw(bg)
d.rounded_rectangle((36, 36, 988, 988), 190, fill=NAVY)
d.rounded_rectangle((70, 70, 954, 954), 164, fill=(234, 242, 251, 255))
img = Image.alpha_composite(img, bg)

# --- 平面圖（藍圖紙，斜放成透視的地面） ------------------------------------------
# 等角投影：平面座標 (u, v) → 畫面
OX, OY, K = 455, 640, 0.66
def iso(u, v, h=0):
    return (OX + (u - v) * 0.87 * K, OY + (u + v) * 0.5 * K - h * K)

sheet = layer()
s = ImageDraw.Draw(sheet)
U, V = 400, 400
s.polygon([iso(-U, -V), iso(U, -V), iso(U, V), iso(-U, V)], fill=(40, 110, 205, 255))
for k in range(-U, U + 1, 80):
    s.line([iso(k, -V), iso(k, V)], fill=(110, 170, 240, 255), width=3)
    s.line([iso(-U, k), iso(U, k)], fill=(110, 170, 240, 255), width=3)
# 平面圖的牆線（白色）
W = 14
walls = [((-330, -330), (330, -330)), ((330, -330), (330, 330)), ((330, 330), (-330, 330)), ((-330, 330), (-330, -330)),
         ((-330, 40), (60, 40)), ((60, -330), (60, 120)), ((60, 200), (330, 200))]
for a, b in walls:
    s.line([iso(*a), iso(*b)], fill=(255, 255, 255, 255), width=W)
sh = layer()
ImageDraw.Draw(sh).polygon([iso(-U, -V + 30), iso(U + 30, -V + 30), iso(U + 30, V + 30), iso(-U, V + 30)], fill=(0, 0, 0, 80))
img = Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(20)))
img = Image.alpha_composite(img, sheet)

# --- 立起來的 3D 房子（從右下房間長出來） ------------------------------------------
house = layer()
h = ImageDraw.Draw(house)
u0, u1, v0, v1 = 80, 320, -320, 180
H = 230
WALL_L = (250, 250, 247, 255)
WALL_R = (214, 222, 233, 255)
ROOF_L = (244, 110, 40, 255)
ROOF_R = (205, 80, 25, 255)
# 左面（v = v1）與右面（u = u1）
h.polygon([iso(u0, v1), iso(u1, v1), iso(u1, v1, H), iso(u0, v1, H)], fill=WALL_L)
h.polygon([iso(u1, v0), iso(u1, v1), iso(u1, v1, H), iso(u1, v0, H)], fill=WALL_R)
# 門與窗
h.polygon([iso(150, v1), iso(215, v1), iso(215, v1, 125), iso(150, v1, 125)], fill=(140, 92, 55, 255))
for (a, b) in ((-260, -170), (-110, -20), (40, 130)):
    h.polygon([iso(u1, a), iso(u1, b), iso(u1, b, 150), iso(u1, a, 150)], fill=(150, 205, 250, 255))
    h.polygon([iso(u1, a), iso(u1, b), iso(u1, b, 150), iso(u1, a, 150)], outline=(255, 255, 255, 255), width=5)
# 屋頂（人字形，屋脊沿 v 方向）
ridge = H + 120
um = (u0 + u1) / 2
# 山牆（正面三角形）
h.polygon([iso(u0, v1, H), iso(u1, v1, H), iso(um, v1, ridge)], fill=(236, 238, 240, 255))
# 看得到的屋頂斜面（朝右）＋屋簷
h.polygon([iso(um, v1 + 25, ridge + 6), iso(u1 + 28, v1 + 25, H - 14), iso(u1 + 28, v0 - 25, H - 14), iso(um, v0 - 25, ridge + 6)], fill=ROOF_R)
h.line([iso(um, v1 + 25, ridge + 6), iso(um, v0 - 25, ridge + 6)], fill=ROOF_L, width=10)
h.line([iso(u0 - 25, v1 + 25, H - 14), iso(um, v1 + 25, ridge + 6)], fill=ROOF_L, width=18)
hs = layer()
ImageDraw.Draw(hs).polygon([iso(u0 + 20, v1 + 40), iso(u1 + 40, v1 + 40), iso(u1 + 40, v0 + 20), iso(u0 + 20, v0)], fill=(0, 0, 0, 120))
img = Image.alpha_composite(img, hs.filter(ImageFilter.GaussianBlur(16)))
img = Image.alpha_composite(img, house)

# --- 「2D→3D」綠色上升箭頭 -----------------------------------------------------------
arr = layer()
a = ImageDraw.Draw(arr)
GREEN = (30, 190, 130, 255)
ax, ay = 205, 470
a.rounded_rectangle((ax - 30, ay - 130, ax + 30, ay + 40), 16, fill=GREEN)
a.polygon([(ax - 85, ay - 120), (ax + 85, ay - 120), (ax, ay - 220)], fill=GREEN)
img = Image.alpha_composite(img, arr)

# --- 小柯機器人（頭盔造型），右上 ---------------------------------------------------
rb = layer()
r_ = ImageDraw.Draw(rb)
cx, cy = 760, 250
s = 0.62


def R(p, q, u, v):
    return (cx + p * s, cy + q * s, cx + u * s, cy + v * s)


r_.line((cx, cy - 250 * s, cx, cy - 190 * s), fill=(90, 100, 120, 255), width=16)
r_.ellipse(R(-34, -290, 34, -222), fill=(255, 196, 40, 255))
r_.rounded_rectangle(R(-262, -70, -210, 80), 20, fill=(40, 120, 220, 255))
r_.rounded_rectangle(R(210, -70, 262, 80), 20, fill=(40, 120, 220, 255))
r_.ellipse(R(-230, -210, 230, 220), fill=(70, 150, 240, 255))
r_.ellipse(R(-214, -196, 214, 200), fill=(240, 246, 255, 255))
r_.rounded_rectangle(R(-170, -110, 170, 90), int(90 * s), fill=(24, 36, 64, 255))
for ex in (-72, 72):
    r_.arc(R(ex - 46, -50, ex + 46, 30), 200, 340, fill=(90, 230, 255, 255), width=18)
r_.arc(R(-50, 10, 50, 70), 20, 160, fill=(90, 230, 255, 255), width=12)
r_.ellipse(R(-160, 40, -110, 80), fill=(255, 140, 160, 200))
r_.ellipse(R(110, 40, 160, 80), fill=(255, 140, 160, 200))
sh2 = layer()
ImageDraw.Draw(sh2).ellipse(R(-240, -190, 260, 260), fill=(0, 0, 0, 110))
img = Image.alpha_composite(img, sh2.filter(ImageFilter.GaussianBlur(22)))
img = Image.alpha_composite(img, rb)

mask = Image.new('L', (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle((70, 70, 954, 954), 164, fill=255)
inner = Image.composite(img, Image.new('RGBA', (S, S), (234, 242, 251, 255)), mask)
img = Image.alpha_composite(bg, Image.composite(inner, bg, mask))
os.makedirs(os.path.join(ROOT, 'build'), exist_ok=True)
img.save(os.path.join(ROOT, 'build', 'icon.png'))
img.save(os.path.join(ROOT, 'build', 'icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
pub = os.path.join(ROOT, 'public')
os.makedirs(pub, exist_ok=True)
img.resize((512, 512), Image.LANCZOS).save(os.path.join(pub, 'icon-512.png'))
img.resize((192, 192), Image.LANCZOS).save(os.path.join(pub, 'icon-192.png'))
img.resize((180, 180), Image.LANCZOS).save(os.path.join(pub, 'apple-touch-icon.png'))
img.resize((64, 64), Image.LANCZOS).save(os.path.join(pub, 'favicon.png'))
img.resize((128, 128), Image.LANCZOS).save(os.path.join(pub, 'logo.png'))
# iPhone／iPad：App 圖示（不透明，iOS 會自己裁圓角）與線上安裝頁圖示
full = Image.new('RGBA', (S, S), NAVY)
full = Image.alpha_composite(full, img)
appicon = os.path.join(ROOT, 'ios', 'XiaokeFloorplan', 'Assets.xcassets', 'AppIcon.appiconset')
if os.path.isdir(appicon):
    full.convert('RGB').save(os.path.join(appicon, 'icon-1024.png'))
pios = os.path.join(pub, 'ios')
if os.path.isdir(pios):
    for n in (512, 180, 57):
        full.convert('RGB').resize((n, n), Image.LANCZOS).save(os.path.join(pios, f'icon-{n}.png'))
    try:
        import qrcode
        qrcode.make('https://achir1015.github.io/xiaoke-floorplan/ios/', box_size=8, border=2).save(os.path.join(pios, 'qr.png'))
        print('qr ok')
    except ImportError:
        print('沒有 qrcode 套件，QR Code 沒更新')
for dd, n in (('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)):
    folder = os.path.join(ROOT, 'android', 'res', f'mipmap-{dd}')
    if os.path.isdir(folder):
        img.resize((n, n), Image.LANCZOS).save(os.path.join(folder, 'ic_launcher.png'))
print('icon ok')
