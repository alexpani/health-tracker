"""Genera l'app icon di Health Sync (1024x1024) — cuore+ECG incorniciato da
frecce di sincronizzazione, su gradiente blu->rosa. Le frecce passano DIETRO il
cuore grazie a un alone di gradiente. Geometria identica all'anteprima SVG
approvata. Supersampling 4x + LANCZOS. Scrive direttamente sull'asset."""
from PIL import Image, ImageDraw
import math, os

SS = 4
W = 1024 * SS
cx = cy = W // 2
TOP, BOT, ECG = (60, 129, 245), (234, 72, 153), (236, 72, 153)
WHITE = (255, 255, 255, 255)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "..", "HealthTracker", "Assets.xcassets", "AppIcon.appiconset", "icon-1024.png")

# gradiente verticale
col = Image.new("RGB", (1, W)); cp = col.load()
for y in range(W):
    f = y / (W - 1); cp[0, y] = tuple(round(TOP[i] + (BOT[i] - TOP[i]) * f) for i in range(3))
grad = col.resize((W, W)).convert("RGBA")

# cuore (bezier, coord 1024 -> *SS)
def bez(p0, p1, p2, p3, n=90):
    out = []
    for i in range(n + 1):
        t = i / n; m = 1 - t
        out.append((SS*(m**3*p0[0]+3*m*m*t*p1[0]+3*m*t*t*p2[0]+t**3*p3[0]),
                    SS*(m**3*p0[1]+3*m*m*t*p1[1]+3*m*t*t*p2[1]+t**3*p3[1])))
    return out
segs = [((512,489),(512,489),(464,309),(362,309)),
        ((362,309),(242,309),(212,429),(212,501)),
        ((212,501),(212,597),(344,693),(512,849)),
        ((512,849),(680,693),(812,597),(812,501)),
        ((812,501),(812,429),(782,309),(662,309)),
        ((662,309),(560,309),(512,489),(512,489))]
pts = []
for s in segs:
    pts += bez(*s)

# frecce
arrows = Image.new("RGBA", (W, W), (0,0,0,0)); da = ImageDraw.Draw(arrows)
R = 400 * SS; sw = 40 * SS
def arc_arrow(s, e):
    da.arc([cx-R, cy-R, cx+R, cy+R], s, e, fill=WHITE, width=sw)
    a = math.radians(e); p = (cx+R*math.cos(a), cy+R*math.sin(a))
    tx, ty = -math.sin(a), math.cos(a); rx, ry = math.cos(a), math.sin(a); k = sw*2.0
    da.polygon([(p[0]+tx*k, p[1]+ty*k), (p[0]+rx*k*0.9, p[1]+ry*k*0.9),
                (p[0]-rx*k*0.9, p[1]-ry*k*0.9)], fill=WHITE)
arc_arrow(18, 162); arc_arrow(198, 342)
base = Image.alpha_composite(grad, arrows)

# alone: rimetti gradiente pulito su cuore+gap -> frecce dietro
GAP = 20 * SS
mask = Image.new("L", (W, W), 0); dm = ImageDraw.Draw(mask)
dm.polygon(pts, fill=255); dm.line(pts, fill=255, width=2*GAP, joint="curve")
base.paste(grad, (0, 0), mask)

# cuore + ECG davanti
fg = Image.new("RGBA", (W, W), (0,0,0,0)); df = ImageDraw.Draw(fg)
df.polygon(pts, fill=WHITE)
ecg = [(295,540),(430,540),(455,505),(478,540),(512,540),(540,420),(565,648),(588,540),(735,540)]
df.line([(x*SS, y*SS) for x, y in ecg], fill=ECG+(255,), width=30*SS, joint="curve")
base = Image.alpha_composite(base, fg)

base.convert("RGB").resize((1024, 1024), Image.LANCZOS).save(OUT)
print("saved", OUT)
