from PIL import Image, ImageDraw
import math
import os

SS = 4
W = 1024 * SS
cx = cy = W // 2
TOP = (60, 129, 245)
BOT = (234, 72, 153)
ECG = (236, 72, 153)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "..", "HealthTracker", "Assets.xcassets", "AppIcon.appiconset", "icon-1024.png")

# --- gradiente verticale (colonna 1px -> resize, veloce) ---
col = Image.new("RGB", (1, W))
cp = col.load()
for y in range(W):
    f = y / (W - 1)
    cp[0, y] = tuple(round(TOP[i] + (BOT[i] - TOP[i]) * f) for i in range(3))
img = col.resize((W, W)).convert("RGBA")

ov = Image.new("RGBA", (W, W), (0, 0, 0, 0))
d = ImageDraw.Draw(ov)

# --- cuore (parametrico), piu' piccolo ---
HALF_W = 250 * SS
scale = HALF_W / 16.0
hx = cx
hy = cy - 94 * SS
pts = []
N = 600
for i in range(N + 1):
    t = 2 * math.pi * i / N
    x = 16 * math.sin(t) ** 3
    y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
    pts.append((hx + x * scale, hy - y * scale))
d.polygon(pts, fill=(255, 255, 255, 255))

# --- ECG (rosa) attraverso il cuore ---
baseY = hy + 30 * SS
ecg = [
    (hx - 235 * SS, baseY), (hx - 150 * SS, baseY),
    (hx - 120 * SS, baseY - 45 * SS), (hx - 95 * SS, baseY),
    (hx - 55 * SS, baseY),
    (hx - 15 * SS, baseY - 165 * SS),
    (hx + 20 * SS, baseY + 120 * SS),
    (hx + 50 * SS, baseY),
    (hx + 235 * SS, baseY),
]
d.line(ecg, fill=ECG + (255,), width=26 * SS, joint="curve")

# --- frecce di sincronizzazione attorno al cuore ---
R = 430 * SS
sw = 42 * SS
def arc_arrow(start, end):
    d.arc([cx - R, cy - R, cx + R, cy + R], start, end, fill=(255, 255, 255, 255), width=sw)
    a = math.radians(end)
    p = (cx + R * math.cos(a), cy + R * math.sin(a))
    tx, ty = -math.sin(a), math.cos(a)
    rx, ry = math.cos(a), math.sin(a)
    s = sw * 1.9
    tip = (p[0] + tx * s, p[1] + ty * s)
    b1 = (p[0] + rx * s * 0.95, p[1] + ry * s * 0.95)
    b2 = (p[0] - rx * s * 0.95, p[1] - ry * s * 0.95)
    d.polygon([tip, b1, b2], fill=(255, 255, 255, 255))
arc_arrow(20, 160)
arc_arrow(200, 340)

out = Image.alpha_composite(img, ov).convert("RGB")
out = out.resize((1024, 1024), Image.LANCZOS)
out.save(OUT)
print("saved", OUT)
