"""Draws the launcher icon (legacy + adaptive layers) into the Android res folder.
    python tools/make_icon.py
"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.join(os.path.dirname(__file__), '..', 'android', 'app', 'src', 'main', 'res')
N = 1024


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def background(size):
    img = Image.new('RGB', (size, size))
    px = img.load()
    top, mid, bot = (40, 110, 220), (245, 170, 215), (255, 222, 190)
    for y in range(size):
        t = y / size
        c = lerp(top, mid, min(1, t / 0.6)) if t < 0.6 else lerp(mid, bot, (t - 0.6) / 0.4)
        for x in range(size):
            px[x, y] = c
    d = ImageDraw.Draw(img)
    # moons
    for (cx, cy, r, a) in [(0.72, 0.2, 0.05, 210), (0.8, 0.28, 0.07, 230), (0.64, 0.14, 0.022, 190)]:
        d.ellipse([(cx - r) * size, (cy - r) * size, (cx + r) * size, (cy + r) * size], fill=(238, 240, 250))
    # green hill
    d.ellipse([-0.3 * size, 0.72 * size, 1.3 * size, 1.6 * size], fill=(90, 175, 70))
    d.ellipse([-0.2 * size, 0.78 * size, 1.2 * size, 1.7 * size], fill=(70, 150, 52))
    return img


def foreground(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    # glow
    glow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    g.ellipse([0.22 * size, 0.18 * size, 0.78 * size, 0.86 * size], fill=(255, 245, 220, 170))
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.06))
    img.alpha_composite(glow)
    d = ImageDraw.Draw(img)
    x0, y0, x1, y1 = 0.37 * size, 0.28 * size, 0.63 * size, 0.76 * size
    fw = 0.025 * size
    # bright doorway
    d.rectangle([x0, y0, x1, y1], fill=(255, 252, 240, 255))
    # frame
    d.rectangle([x0 - fw, y0 - fw, x1 + fw, y0], fill=(255, 255, 255, 255))
    d.rectangle([x0 - fw, y0, x0, y1], fill=(255, 255, 255, 255))
    d.rectangle([x1, y0, x1 + fw, y1], fill=(255, 255, 255, 255))
    # door leaf swung open (perspective trapezoid)
    leaf = [(x0, y0), (x0 + 0.1 * size, y0 + 0.04 * size), (x0 + 0.1 * size, y1 - 0.02 * size), (x0, y1)]
    d.polygon(leaf, fill=(255, 168, 205, 255))
    d.ellipse([x0 + 0.07 * size, 0.53 * size, x0 + 0.09 * size, 0.55 * size], fill=(230, 190, 90, 255))
    # light spill on the ground
    spill = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    s = ImageDraw.Draw(spill)
    s.polygon([(x0, y1), (x1, y1), (x1 + 0.12 * size, 0.9 * size), (x0 - 0.12 * size, 0.9 * size)], fill=(255, 246, 215, 150))
    spill = spill.filter(ImageFilter.GaussianBlur(size * 0.012))
    img.alpha_composite(spill)
    return img


def save(img, path, size):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.resize((size, size), Image.LANCZOS).save(path)


bg = background(N)
fg = foreground(N)
legacy = bg.convert('RGBA')
legacy.alpha_composite(fg)
# rounded square for legacy launchers
mask = Image.new('L', (N, N), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, N - 1, N - 1], radius=int(N * 0.22), fill=255)
legacy.putalpha(mask)

densities = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
for name, k in densities.items():
    save(legacy, os.path.join(ROOT, f'mipmap-{name}', 'ic_launcher.png'), int(48 * k))
    save(bg, os.path.join(ROOT, f'mipmap-{name}', 'ic_launcher_background.png'), int(108 * k))
    # adaptive foreground: keep the art inside the 66% safe zone
    pad = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    small = fg.resize((int(N * 0.8), int(N * 0.8)), Image.LANCZOS)
    pad.alpha_composite(small, (int(N * 0.1), int(N * 0.1)))
    save(pad, os.path.join(ROOT, f'mipmap-{name}', 'ic_launcher_foreground.png'), int(108 * k))

os.makedirs(os.path.join(ROOT, 'mipmap-anydpi-v26'), exist_ok=True)
with open(os.path.join(ROOT, 'mipmap-anydpi-v26', 'ic_launcher.xml'), 'w') as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
            '    <background android:drawable="@mipmap/ic_launcher_background" />\n'
            '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n</adaptive-icon>\n')
legacy.resize((512, 512), Image.LANCZOS).save(os.path.join(os.path.dirname(__file__), '..', 'docs', 'icon.png')) if os.path.isdir(os.path.join(os.path.dirname(__file__), '..', 'docs')) else None
print('icons written')
