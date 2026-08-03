# -*- coding: utf-8 -*-
# 대림대 배너 pptx 생성기 — 가천대 배너양식.pptx의 배경 이미지만 대림대판으로 교체.
# 텍스트 상자(일시기입/학교명기입) 좌표는 가천대판 그대로이므로, 칩(일시/장소) 위치를
# 가천대 배경과 동일한 자리에 그린다. 실행: python tools/make_daelim_banner.py
import zipfile, shutil, io, os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(__file__), "..")
SRC = os.path.join(ROOT, "templates", "gachon", "배너양식.pptx")
DST = os.path.join(ROOT, "templates", "배너양식.pptx")

W, H = 1280, 720
BLUE = (27, 91, 176)
GREEN = (62, 168, 75)
CHIP = (47, 111, 208)
BG = (238, 243, 250)
LIGHT = (208, 222, 243)
GRAY = (90, 100, 115)

def font(path, size):
    return ImageFont.truetype(os.path.join("C:/Windows/Fonts", path), size)

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# 장식 원 (가천대판 느낌의 옅은 파랑 원들)
d.ellipse((-60, 40, 120, 220), outline=LIGHT, width=10)
d.ellipse((470, -60, 560, 30), outline=LIGHT, width=8)
d.ellipse((1150, 250, 1260, 360), fill=LIGHT)
d.ellipse((30, 640, 90, 700), fill=(24, 68, 130))
d.ellipse((1180, 30, 1210, 60), fill=(24, 100, 90))
for gx in range(6):
    for gy in range(4):
        d.ellipse((1150 + gx * 18 - 4, 60 + gy * 18 - 4, 1150 + gx * 18 + 4, 60 + gy * 18 + 4), fill=LIGHT)

f_year = font("malgunbd.ttf", 52)
f_title_b = font("malgunbd.ttf", 88)
f_chip = font("malgunbd.ttf", 26)
f_small = font("malgun.ttf", 22)
f_small_b = font("malgunbd.ttf", 24)

def center_text(y, text, f, fill):
    w = d.textlength(text, font=f)
    d.text(((W - w) / 2, y), text, font=f, fill=fill)

# 2026 (파랑+초록)
y26 = 190
w1 = d.textlength("20", font=f_year); w2 = d.textlength("26", font=f_year)
x0 = (W - w1 - w2) / 2
d.text((x0, y26), "20", font=f_year, fill=BLUE)
d.text((x0 + w1, y26), "26", font=f_year, fill=GREEN)

# 타이틀: 대림대학교(파랑) 디지털새싹(초록)
t1, t2 = "대림대학교 ", "디지털새싹"
tw = d.textlength(t1, font=f_title_b) + d.textlength(t2, font=f_title_b)
tx = (W - tw) / 2
d.text((tx, 275), t1, font=f_title_b, fill=BLUE)
d.text((tx + d.textlength(t1, font=f_title_b), 275), t2, font=f_title_b, fill=GREEN)
# 새싹 잎 포인트
lx = tx + tw - 6
d.ellipse((lx, 262, lx + 26, 282), fill=GREEN)

# 일시/장소 칩 — 텍스트상자(x=518px, y=414/484px)와 나란한 위치
for cy, label in ((417, "일시"), (486, "장소")):
    d.rounded_rectangle((402, cy, 494, cy + 37), radius=18, fill=CHIP)
    lw = d.textlength(label, font=f_chip)
    d.text((402 + (92 - lw) / 2, cy + 4), label, font=f_chip, fill=(255, 255, 255))

# 하단 기관 표기 (텍스트만)
line1 = "교육부  ·  17개 시도교육청  ·  한국과학창의재단"
center_text(612, line1, f_small, GRAY)
center_text(648, "대림대학교", f_small_b, BLUE)

buf = io.BytesIO()
img.save(buf, format="JPEG", quality=92)
bg_jpg = buf.getvalue()

# pptx 재패키징: image1.jpg만 교체
zin = zipfile.ZipFile(SRC)
with zipfile.ZipFile(DST, "w", zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == "ppt/media/image1.jpg":
            data = bg_jpg
        if item.filename == "docProps/thumbnail.jpeg":
            thumb = img.copy(); thumb.thumbnail((256, 144))
            tb = io.BytesIO(); thumb.save(tb, format="JPEG", quality=80)
            data = tb.getvalue()
        zout.writestr(item, data)
print("written:", DST)
