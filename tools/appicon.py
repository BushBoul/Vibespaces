# Vibespaces app icon: four little app windows in a 2x2 that waves like the old flag (own shapes and shades)
import sys, math
from PIL import Image, ImageDraw
out, preview = sys.argv[1], sys.argv[2]
SS = 4                      # supersampling
S = 256 * SS
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
# our own shades (not Microsoft's logo colours)
COLS = [(229, 72, 77), (70, 167, 88), (62, 139, 245), (245, 184, 61)]
def window(cx, cy, w, h, col, tilt):
    tile = Image.new('RGBA', (int(w * 1.6), int(h * 1.6)), (0, 0, 0, 0))
    d = ImageDraw.Draw(tile)
    ox, oy = (tile.width - w) // 2, (tile.height - h) // 2
    r = int(w * 0.16)
    d.rounded_rectangle([ox, oy, ox + w, oy + h], r, fill=col)
    bar = int(h * 0.24)
    dark = tuple(int(c * 0.78) for c in col)
    d.rounded_rectangle([ox, oy, ox + w, oy + bar + r], r, fill=dark)
    d.rectangle([ox, oy + bar, ox + w, oy + bar + r], fill=col)
    # Windows title bar buttons, on the right: minimize, maximize, close
    k = bar * 0.34; by = oy + bar / 2; gap = k * 1.25; lw0 = max(2, int(w * 0.022)); ink = (255, 255, 255, 215)
    x = ox + w - w * 0.10 - k
    d.line([x - 2 * (k + gap), by, x - 2 * (k + gap) + k, by], fill=ink, width=lw0)
    d.rectangle([x - (k + gap), by - k / 2, x - (k + gap) + k, by + k / 2], outline=ink, width=lw0)
    d.line([x, by - k / 2, x + k, by + k / 2], fill=ink, width=lw0)
    d.line([x, by + k / 2, x + k, by - k / 2], fill=ink, width=lw0)
    # content lines
    lw = int(h * 0.07)
    for i, frac in enumerate((0.62, 0.78, 0.48)):
        y = oy + bar + int(h * 0.17) + i * int(h * 0.15)
        x0 = ox + int(w * 0.13)
        d.rounded_rectangle([x0, y, x0 + int((w * 0.74) * frac), y + lw], lw // 2, fill=(255, 255, 255, 215))
    tile = tile.rotate(tilt, resample=Image.BICUBIC)
    img.alpha_composite(tile, (int(cx - tile.width / 2), int(cy - tile.height / 2)))
w = int(S * 0.40); h = int(S * 0.34)
pad = S * 0.07
# the wave: right column higher than left, each window tilted a little
spots = [(S * 0.29, S * 0.31 + pad * 0.35, 4), (S * 0.71, S * 0.27, -4), (S * 0.29, S * 0.71 + pad * 0.35, 4), (S * 0.71, S * 0.67, -4)]
for (cx, cy, tilt), col in zip(spots, COLS):
    window(cx, cy, w, h, col, tilt)
final = img.resize((256, 256), Image.LANCZOS)
final.save(out)
sheet = Image.new('RGBA', (256 + 128 + 64 + 32 + 60, 256), (31, 31, 31, 255))
x = 0
for sz in (256, 128, 64, 32):
    sheet.alpha_composite(final.resize((sz, sz), Image.LANCZOS), (x, (256 - sz) // 2)); x += sz + 15
sheet.save(preview)
print('ok')
