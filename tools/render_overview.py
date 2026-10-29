"""Render exports/japan-overview.png — all places on a map of Japan, with Tokyo & Nagoya insets.

Run after build_data.py:  python tools/render_overview.py
"""
import pathlib, sys
from PIL import Image, ImageDraw, ImageFont
from staticmap import StaticMap, CircleMarker

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from build_data import CATEGORIES, P  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
HEADERS = {"User-Agent": "travel-journal-overview/1.0 (personal use)"}


def font(size, bold=False):
    for name in (["seguisb.ttf", "arialbd.ttf"] if bold else ["segoeui.ttf", "arial.ttf"]):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def render(w, h, center, zoom, places, r=9):
    m = StaticMap(w, h, url_template=TILES, headers=HEADERS)
    for p in places:
        m.add_marker(CircleMarker((p[4], p[3]), "white", r + 3))
        m.add_marker(CircleMarker((p[4], p[3]), CATEGORIES[p[5]]["color"], r))
    return m.render(zoom=zoom, center=center).convert("RGB")


def in_box(p, lat0, lat1, lng0, lng1):
    return lat0 <= p[3] <= lat1 and lng0 <= p[4] <= lng1


main = render(1100, 1300, (134.8, 34.6), 6, P)  # (lng, lat)
tokyo_box, nagoya_box = (35.55, 35.80, 139.55, 139.90), (35.13, 35.21, 136.86, 136.99)
tokyo = render(520, 400, (139.74, 35.69), 11, [p for p in P if in_box(p, *tokyo_box)], r=8)
nagoya = render(520, 400, (136.925, 35.172), 13, [p for p in P if in_box(p, *nagoya_box)], r=8)

W, H = 1680, 1380
img = Image.new("RGB", (W, H), "#f7f5f2")
d = ImageDraw.Draw(img)
img.paste(main, (20, 60))
d.text((20, 14), f"Japan — {len(P)} places to go", fill="#1c1917", font=font(32, True))

x0 = 1140
for title, im, y in (("Tokyo close-up", tokyo, 60), ("Nagoya close-up", nagoya, 500)):
    d.text((x0, y), title, fill="#1c1917", font=font(20, True))
    img.paste(im, (x0, y + 30))
    d.rectangle([x0, y + 30, x0 + im.width, y + 30 + im.height], outline="#a8a29e")

counts = {}
for p in P:
    counts[p[5]] = counts.get(p[5], 0) + 1
y = 950
d.text((x0, y), "Themes", fill="#1c1917", font=font(20, True))
y += 34
for k, c in sorted(CATEGORIES.items(), key=lambda kv: -counts.get(kv[0], 0)):
    d.ellipse([x0, y + 4, x0 + 16, y + 20], fill=c["color"], outline="white", width=2)
    d.text((x0 + 26, y), f"{c['label']}  ({counts.get(k, 0)})", fill="#1c1917", font=font(17))
    y += 28
d.text((20, H - 26), "Map data © OpenStreetMap contributors", fill="#78716c", font=font(14))

out = ROOT / "exports" / "japan-overview.png"
img.save(out, optimize=True)
print("wrote", out)
