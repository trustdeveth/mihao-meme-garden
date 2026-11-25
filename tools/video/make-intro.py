"""Builds the intro video from a gameplay recording and full-HD pictures taken in the game.

    python tools/video/make-intro.py <recording.mp4> <folder with the game pictures> [--end "Coming soon"]

The music and sound effects are synthesized here, so the video carries no one else's audio.
The wallet button in the recording is painted over in every frame.
Needs: pillow, numpy, opencv-python, imageio-ffmpeg.
"""
import argparse
import math
import random
import subprocess
import wave
from pathlib import Path

import cv2
import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ap = argparse.ArgumentParser()
ap.add_argument('recording')
ap.add_argument('pictures')
ap.add_argument('--end', default='COMING SOON')
ap.add_argument('--out', default=str(Path(__file__).resolve().parents[2] / 'output' / 'video' / 'mihao-intro.mp4'))
ap.add_argument('--preview', action='store_true', help='only write one picture per scene')
args = ap.parse_args()

W, H, FPS = 1920, 1080, 30
BEAT = 0.5  # 120 beats a minute: every cut lands on a beat
INK, GOLD, RED, WHITE = (23, 18, 15), (242, 182, 50), (179, 24, 27), (255, 255, 255)
PICS = Path(args.pictures)
OUT = Path(args.out)
OUT.parent.mkdir(parents=True, exist_ok=True)
# where the wallet button sits in the recording (source pixels), with room to spare
WALLET = (1636, 8, 1806, 68)

impact = lambda s: ImageFont.truetype('C:/Windows/Fonts/impact.ttf', s)

# ---------------------------------------------------------------- scenes: (beats, kind, settings)
# clip: start second in the recording, speed, zoom from -> to, focus point (source pixels) from -> to
SCENES = [
    (4, 'hook', {}),
    (5, 'title', {}),
    (7, 'clip', dict(at=52.6, speed=1.0, z=(1.0, 1.22), f=((960, 470), (990, 430)), cap='PLANT YOUR GARDEN', sub='29 very mihao crops')),
    (6, 'clip', dict(at=241.6, speed=0.9, z=(1.02, 1.28), f=((960, 440), (960, 330)), cap='FIND RARE CROPS', sub='moonlit. golden. mihao.')),
    (7, 'clip', dict(at=9.4, speed=1.0, z=(1.0, 1.34), f=((960, 470), (975, 330)), cap='SELL TO GUS', sub='sold! mihao.', coin=1.0)),
    (4, 'clip', dict(at=28.2, speed=1.2, z=(1.12, 1.22), f=((960, 455), (960, 455)), cap='SHOP THE VILLAGE')),
    (5, 'clip', dict(at=141.2, speed=1.0, z=(1.1, 1.45), f=((960, 430), (960, 330)), cap='DELIVER ORDERS', coin=1.0)),
    (6, 'clip', dict(at=171.0, speed=1.0, z=(1.18, 1.4), f=((960, 440), (960, 360)), cap='GET NEW DRIP', coin=1.1)),
    (10, 'outfits', {}),
    (3, 'still', dict(name='weather_storm', cap='WILD WEATHER', sub='beard storm', z=(1.04, 1.16), thunder=True)),
    (2, 'still', dict(name='weather_frosty', cap='WILD WEATHER', sub='frosty whiskers', z=(1.16, 1.06))),
    (3, 'still', dict(name='weather_stars', cap='WILD WEATHER', sub='shooting stars', z=(1.04, 1.18))),
    (6, 'clip', dict(at=297.0, speed=1.0, z=(1.08, 1.42), f=((960, 430), (1170, 270)), cap='RIDE THE SKY BALLOON', sub='to Sky Island')),
    (10, 'end', {}),
]
total_beats = sum(s[0] for s in SCENES)
DURATION = total_beats * BEAT


# ---------------------------------------------------------------- drawing helpers
def ease_out(t):
    return 1 - (1 - t) ** 3


def back(t):
    t = max(0.0, min(1.0, t))
    return 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2


def text_layer(text, size, fill=WHITE, stroke=None, pad=24):
    font = impact(size)
    stroke = stroke if stroke is not None else max(3, size // 12)
    box = ImageDraw.Draw(Image.new('RGBA', (4, 4))).textbbox((0, 0), text, font=font, stroke_width=stroke)
    im = Image.new('RGBA', (box[2] - box[0] + pad * 2, box[3] - box[1] + pad * 2))
    d = ImageDraw.Draw(im)
    d.text((pad - box[0] + size // 22, pad - box[1] + size // 18), text, font=font, fill=(0, 0, 0, 120), stroke_width=stroke, stroke_fill=(0, 0, 0, 120))
    d.text((pad - box[0], pad - box[1]), text, font=font, fill=fill, stroke_width=stroke, stroke_fill=INK)
    return im


def pill_layer(text, size):
    """Subtitle on a dark strip, readable over anything in the game."""
    t = text_layer(text, size, fill=(255, 233, 150), pad=10)
    im = Image.new('RGBA', (t.width + 44, t.height + 6))
    ImageDraw.Draw(im).rounded_rectangle((0, 0, im.width - 1, im.height - 1), radius=10, fill=(23, 18, 15, 232))
    im.alpha_composite(t, (22, 3))
    return im


def banner_layer(text, size=92):
    t = text_layer(text, size)
    w, h = t.width + 90, int(size * 1.42)
    im = Image.new('RGBA', (w + 20, h + 22))
    d = ImageDraw.Draw(im)
    d.rectangle((14, 16, w + 14, h + 16), fill=(0, 0, 0, 110))
    d.rectangle((0, 0, w, h), fill=INK)
    d.rectangle((6, 6, w - 6, h - 6), fill=GOLD)
    d.rectangle((14, 14, w - 14, h - 14), fill=RED)
    im.alpha_composite(t, ((w - t.width) // 2, (h - t.height) // 2))
    return im


def paste(canvas, layer, cx, cy, scale=1.0, angle=0.0, alpha=1.0):
    if scale <= 0.02 or alpha <= 0.02:
        return
    im = layer
    if abs(scale - 1) > 0.004:
        im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.BICUBIC)
    if abs(angle) > 0.05:
        im = im.rotate(angle, expand=True, resample=Image.BICUBIC)
    if alpha < 0.999:
        a = im.getchannel('A').point(lambda v: int(v * alpha))
        im = im.copy()
        im.putalpha(a)
    canvas.paste(im, (int(cx - im.width / 2), int(cy - im.height / 2)), im)


def zoomed(img, z, focus, out=(W, H)):
    """Cut a 16:9 window out of img around focus and scale it to the output size."""
    h, w = img.shape[:2]
    base_w = min(w, h * out[0] / out[1])
    cw, ch = base_w / z, base_w / z * out[1] / out[0]
    x = min(max(focus[0] - cw / 2, 0), w - cw)
    y = min(max(focus[1] - ch / 2, 0), h - ch)
    m = np.float32([[out[0] / cw, 0, -x * out[0] / cw], [0, out[1] / ch, -y * out[1] / ch]])
    return cv2.warpAffine(img, m, out, flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def picture(name):
    return np.array(Image.open(PICS / f'{name}.png').convert('RGB'))


def hide_wallet(frame):
    """Paint a solid block over the wallet button, so the address cannot be read or recovered."""
    x0, y0, x1, y1 = WALLET
    block = Image.new('RGB', (x1 - x0, y1 - y0), INK)
    d = ImageDraw.Draw(block)
    d.rectangle((3, 3, block.width - 4, block.height - 4), fill=RED, outline=GOLD, width=3)
    f = impact(30)
    d.text((block.width / 2, block.height / 2), 'MIHAO', font=f, fill=WHITE, anchor='mm')
    frame[y0:y1, x0:x1] = np.array(block)
    return frame


def burst_rays(t, colors=((196, 30, 33), (160, 20, 24))):
    im = Image.new('RGB', (W, H), colors[1])
    d = ImageDraw.Draw(im)
    for i in range(24):
        a = i / 24 * math.tau + t * 0.25
        d.polygon([(W / 2, H / 2), (W / 2 + math.cos(a) * 1500, H / 2 + math.sin(a) * 1500), (W / 2 + math.cos(a + 0.13) * 1500, H / 2 + math.sin(a + 0.13) * 1500)], fill=colors[0])
    return im


rnd = random.Random(8)
CONFETTI = [(rnd.random(), rnd.random(), rnd.random(), rnd.choice([(228, 51, 59), (255, 216, 74), (93, 187, 70), (47, 128, 237), (255, 122, 182), WHITE])) for _ in range(150)]


def confetti(canvas, t, strength=1.0):
    d = ImageDraw.Draw(canvas)
    for i, (a, b, c, col) in enumerate(CONFETTI[: int(len(CONFETTI) * strength)]):
        ang = a * math.tau
        v = 380 + b * 900
        x = W / 2 + math.cos(ang) * v * ease_out(min(1, t / 0.9))
        y = H * 0.42 + math.sin(ang) * v * 0.6 * ease_out(min(1, t / 0.9)) + 330 * t * t
        if not (-30 < x < W + 30 and -30 < y < H + 30):
            continue
        s, spin = 9 + c * 12, t * (3 + c * 6) + i
        pts = [(x + math.cos(spin + k * math.pi / 2) * s * (1 if k % 2 else 0.55), y + math.sin(spin + k * math.pi / 2) * s * (1 if k % 2 else 0.55)) for k in range(4)]
        d.polygon(pts, fill=col, outline=INK)


closeup = picture('closeup')
OUTFIT_NAMES = ['THE OFFICIAL', 'LIME ZIGZAG', 'GHOST HOODIE', 'SHADOW PAW', 'PUNK ALOHA', 'SAILOR', 'CAPTAIN', 'TACTICAL', 'MONKEY CAMO', 'PHOENIX']
outfits = [picture(f'outfit_{i}') for i in range(10)]
LAYERS = {}


def layer(key, make):
    if key not in LAYERS:
        LAYERS[key] = make()
    return LAYERS[key]


def caption(canvas, s, t, length):
    cap = s.get('cap')
    if not cap:
        return
    pop = back(min(1, (t - 0.08) / 0.3)) if t > 0.08 else 0
    leave = min(1, max(0, (t - (length - 0.12)) / 0.12))
    y = H - 168 + leave * 90
    paste(canvas, layer(('cap', cap), lambda: banner_layer(cap)), W / 2, y, scale=pop, angle=-2.2, alpha=1 - leave)
    if s.get('sub') and t > 0.35:
        paste(canvas, layer(('sub', s['sub']), lambda: pill_layer(s['sub'], 54)), W / 2, y + 102, scale=back((t - 0.35) / 0.25), angle=-2.2, alpha=1 - leave)


# ---------------------------------------------------------------- scenes
def scene_frame(kind, s, t, length, clip_frame):
    p = t / length
    if kind == 'hook':
        face = (960, 505)
        shake = 0
        if t >= 1.5:  # the punchline: snap in on the stare
            z = 1.72 + (t - 1.5) * 0.14
            shake = max(0, 1 - (t - 1.5) / 0.3) * 14
        else:
            z = 1.05 + ease_out(min(1, t / 1.5)) * 0.42
        im = Image.fromarray(zoomed(closeup, z, (face[0] + rnd.uniform(-shake, shake), face[1] + rnd.uniform(-shake, shake))))
        if t < 0.5:
            im = Image.blend(Image.new('RGB', (W, H), (0, 0, 0)), im, min(1, t / 0.5))
        if 0.35 <= t < 1.5:
            paste(im, layer('q', lambda: text_layer('ANY LAST WORDS?', 150)), W / 2, H - 190, scale=back((t - 0.35) / 0.3))
        if t >= 1.5:
            paste(im, layer('m', lambda: text_layer('MIHAO.', 190, fill=(255, 216, 74))), W / 2, H - 122, scale=back((t - 1.5) / 0.22), angle=-4)
        return im
    if kind == 'title':
        bg = Image.fromarray(zoomed(picture_cache('weather_frosty'), 1.28 - p * 0.14, (900, 560))).filter(ImageFilter.GaussianBlur(3))
        bg = Image.blend(bg, burst_rays(t), 0.62)
        confetti(bg, t)
        paste(bg, layer('t1', lambda: text_layer('MIHAO', 360, fill=(255, 216, 74))), W / 2, 330, scale=back(t / 0.32), angle=-4)
        if t > 0.5:
            paste(bg, layer('t2', lambda: banner_layer('MEME GARDEN', 168)), W / 2, 660, scale=back((t - 0.5) / 0.32), angle=-4)
        if t > 1.2:
            paste(bg, layer('t3', lambda: text_layer('grow a garden. be very mihao.', 66)), W / 2, 900, scale=back((t - 1.2) / 0.3))
        return bg
    if kind == 'clip':
        e = ease_out(min(1, p * 1.5))
        z = s['z'][0] + (s['z'][1] - s['z'][0]) * e
        f0, f1 = s['f']
        focus = (f0[0] + (f1[0] - f0[0]) * e, f0[1] + (f1[1] - f0[1]) * e)
        im = Image.fromarray(zoomed(clip_frame, z, focus))
        caption(im, s, t, length)
        return im
    if kind == 'still':
        z = s['z'][0] + (s['z'][1] - s['z'][0]) * p
        im = Image.fromarray(zoomed(picture_cache(s['name']), z, (960, 540)))
        if s.get('thunder') and (0.28 < t < 0.36 or 0.5 < t < 0.55):
            im = Image.blend(im, Image.new('RGB', (W, H), (225, 232, 255)), 0.55)
        caption(im, s, t, length)
        return im
    if kind == 'outfits':
        each = length / 10
        i = min(9, int(t / each))
        local = t - i * each
        z = 1.5 - min(1, local / each) * 0.07 + (0.1 * max(0, 1 - local / 0.12))
        im = Image.fromarray(zoomed(outfits[i], z, (960, 610)))
        paste(im, layer('which', lambda: banner_layer('WHICH MIHAO ARE YOU?', 90)), W / 2, 108, angle=-1.6, scale=back(t / 0.3))
        paste(im, layer(('o', i), lambda: text_layer(OUTFIT_NAMES[i], 110, fill=(255, 216, 74))), W / 2, H - 112, scale=back(local / 0.16), angle=-3 if i % 2 else 3)
        return im
    # end card
    base = Image.fromarray(zoomed(closeup, 1.42 + p * 0.1, (1232, 520)))
    shade = Image.new('RGBA', (W, H))
    d = ImageDraw.Draw(shade)
    for x in range(W):
        k = max(0, min(1, (x - W * 0.30) / (W * 0.30)))
        d.line([(x, 0), (x, H)], fill=(20, 8, 8, int(222 * k)))
    base.paste(shade, (0, 0), shade)
    cx = 1330
    paste(base, layer('e1', lambda: text_layer('MIHAO', 250, fill=(255, 216, 74))), cx, 275, scale=back(t / 0.3), angle=-3)
    if t > 0.3:
        paste(base, layer('e2', lambda: banner_layer('MEME GARDEN', 118)), cx, 495, scale=back((t - 0.3) / 0.3), angle=-3)
    if t > 1.0:
        paste(base, layer('e3', lambda: text_layer(args.end.upper(), 128)), cx, 715, scale=back((t - 1.0) / 0.3) * (1 + 0.03 * math.sin(t * 7)))
    if t > 1.5:
        paste(base, layer('e4', lambda: text_layer('#MihaoGarden', 76, fill=(255, 233, 150))), cx, 880, scale=back((t - 1.5) / 0.3))
    if t > 1.0:
        confetti(base, t - 1.0, 0.7)
    if t > length - 0.6:
        base = Image.blend(base, Image.new('RGB', (W, H), (0, 0, 0)), min(1, (t - (length - 0.6)) / 0.6))
    return base


_pics = {}


def picture_cache(name):
    if name not in _pics:
        _pics[name] = picture(name)
    return _pics[name]


# ---------------------------------------------------------------- sound
SR = 44100
audio = np.zeros(int(SR * (DURATION + 0.3)), np.float32)
nrng = np.random.default_rng(4)


def add(at, sig, vol=1.0):
    i = int(at * SR)
    if i >= len(audio):
        return
    sig = sig[: len(audio) - i]
    audio[i : i + len(sig)] += sig.astype(np.float32) * vol


def tt(dur):
    return np.arange(int(SR * dur)) / SR


def sweep(f0, f1, dur, decay):
    t = tt(dur)
    f = f0 * (f1 / f0) ** (t / dur)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * decay)


def noise(dur, lo, hi, decay=0.0):
    n = int(SR * dur)
    spec = np.fft.rfft(nrng.standard_normal(n))
    fr = np.fft.rfftfreq(n, 1 / SR)
    spec[(fr < lo) | (fr > hi)] = 0
    s = np.fft.irfft(spec, n)
    s /= max(1e-9, np.abs(s).max())
    return s * np.exp(-tt(dur)[:n] * decay)


def pluck(freq, dur=0.9, bright=0.5):
    """A plucked string (Karplus-Strong), close to a zither."""
    n = max(2, int(SR / freq))
    buf = nrng.uniform(-1, 1, n)
    buf = bright * buf + (1 - bright) * np.convolve(buf, np.ones(4) / 4, 'same')
    out = np.empty(int(SR * dur))
    for i in range(len(out)):
        j = i % n
        out[i] = buf[j]
        buf[j] = 0.4975 * (buf[j] + buf[(j + 1) % n])
    return out * np.exp(-tt(dur) * 2.2)


def gong(dur=3.0):
    t = tt(dur)
    s = sum(a * np.sin(2 * np.pi * f * t + 3 * np.sin(2 * np.pi * (4 + k) * t) * np.exp(-t * 2)) * np.exp(-t * d) for k, (f, a, d) in enumerate([(98, 1.0, 1.1), (147.5, 0.6, 1.4), (233, 0.45, 1.8), (311, 0.3, 2.4), (466, 0.2, 3.1)]))
    return s / 2.4 + noise(dur, 200, 3000, 5) * 0.18


kick = sweep(140, 42, 0.32, 11)
snare = noise(0.2, 900, 7000, 22) * 0.9 + sweep(210, 150, 0.2, 28) * 0.5
hat = noise(0.06, 7000, 16000, 75)
whoosh = noise(0.34, 500, 6000) * np.sin(np.linspace(0, np.pi, int(SR * 0.34))) ** 3
boom = sweep(95, 30, 0.9, 4.5) + noise(0.9, 30, 500, 8) * 0.5
coin = np.concatenate([np.sin(2 * np.pi * 988 * tt(0.07)), np.sin(2 * np.pi * 1319 * tt(0.38)) * np.exp(-tt(0.38) * 9)])

NOTE = {'A2': 110.0, 'C3': 130.81, 'D3': 146.83, 'E3': 164.81, 'G2': 98.0, 'G3': 196.0, 'A3': 220.0, 'C4': 261.63, 'D4': 293.66, 'E4': 329.63, 'G4': 392.0, 'A4': 440.0, 'C5': 523.25, 'D5': 587.33, 'E5': 659.25, 'G5': 783.99, 'A5': 880.0}
# an original pentatonic tune, one note per half beat ('-' is a rest)
TUNE = ('A4 - C5 D5 E5 - D5 C5 A4 - G4 A4 C5 - - - D5 - E5 G5 A5 - G5 E5 D5 - C5 D5 E5 - - - '
        'E5 E5 - D5 C5 - A4 C5 D5 D5 - C5 A4 - G4 - A4 C5 D5 E5 G5 E5 D5 C5 A4 - A4 - A4 - - -').split()
BASS = ['A2', 'A2', 'C3', 'C3', 'D3', 'D3', 'E3', 'G2']
string_cache = {}


def string(name, dur=0.7):
    if (name, dur) not in string_cache:
        string_cache[(name, dur)] = pluck(NOTE[name], dur)
    return string_cache[(name, dur)]


starts = []
b = 0
for beats, kind, s in SCENES:
    starts.append(b * BEAT)
    b += beats
music_in = starts[1]
end_at = starts[-1]

# the hook: quiet, a rising hum, then the gong on "mihao."
add(0.0, sweep(55, 110, 1.5, 0.2) * np.linspace(0, 1, int(SR * 1.5)), 0.35)
add(0.35, string('E4'), 0.4)
add(1.5, gong(), 0.85)
add(1.5, boom, 0.9)
add(music_in - 0.17, whoosh, 0.5)
# the beat from the title to the end card
n = int(round((end_at - music_in) / BEAT))
for k in range(n):
    at = music_in + k * BEAT
    add(at, kick, 0.8)
    if k % 2 == 1:
        add(at, snare, 0.42)
    add(at, hat, 0.16)
    add(at + BEAT / 2, hat, 0.26)
    add(at, string(BASS[(k // 4) % len(BASS)], 0.5), 0.55)
    add(at + BEAT * 0.75, string(BASS[(k // 4) % len(BASS)], 0.5), 0.28)
for k in range(n * 2):
    note = TUNE[k % len(TUNE)]
    if note != '-':
        add(music_in + k * BEAT / 2, string(note), 0.46)
# cuts, hits and effects
for (beats, kind, s), at in zip(SCENES, starts):
    if at > music_in:
        add(at - 0.17, whoosh, 0.42)
    if kind in ('title', 'outfits', 'end'):
        add(at, boom, 0.75)
    if kind == 'outfits':
        for i in range(10):
            add(at + i * beats * BEAT / 10, string(['A4', 'C5', 'D5', 'E5', 'G5', 'A5', 'G5', 'E5', 'D5', 'A5'][i], 0.4), 0.5)
    if s.get('coin') is not None:
        for j in range(4):
            add(at + s['coin'] + j * 0.09, coin, 0.2)
    if s.get('thunder'):
        add(at + 0.28, noise(1.2, 30, 900, 3.5), 0.8)
# the ending: gong, one last chord
add(end_at, gong(), 0.75)
for i, name in enumerate(['A3', 'E4', 'A4', 'C5', 'E5', 'A5']):
    add(end_at + 1.0 + i * 0.07, pluck(NOTE[name], 2.8), 0.42)
fade = int(SR * 0.9)
total = int(SR * DURATION)
audio = audio[:total]
audio[-fade:] *= np.linspace(1, 0, fade)
audio = np.tanh(audio * 0.9)  # gentle limiting
audio *= 0.89 / np.abs(audio).max()

# ---------------------------------------------------------------- render
cap = cv2.VideoCapture(args.recording)
if not cap.isOpened():
    raise SystemExit(f'cannot open {args.recording}')
src_fps = cap.get(cv2.CAP_PROP_FPS) or 30
if (int(cap.get(3)), int(cap.get(4))) != (1920, 910):
    raise SystemExit('The wallet cover and the zoom points are set for the 1920x910 recording. Check them before using another one.')


class Reader:
    """Reads the recording forwards from a start time, returning the frame for any later moment."""

    def __init__(self, start):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(start * src_fps))
        self.start, self.index, self.frame = start, -1, None

    def at(self, seconds):
        want = int(seconds * src_fps)
        while self.index < want:
            ok, f = cap.read()
            if not ok:
                break
            self.index += 1
            self.frame = f
        return hide_wallet(cv2.cvtColor(self.frame, cv2.COLOR_BGR2RGB))


silent = OUT.with_name('silent.mp4')
wav = OUT.with_name('music.wav')
ff = imageio_ffmpeg.get_ffmpeg_exe()
if args.preview:
    for n_scene, ((beats, kind, s), at) in enumerate(zip(SCENES, starts)):
        length = beats * BEAT
        t = length * 0.68
        frame = Reader(s['at']).at(t * s['speed']) if kind == 'clip' else None
        scene_frame(kind, s, t, length, frame).resize((640, 360), Image.LANCZOS).save(OUT.with_name(f'preview_{n_scene:02d}.jpg'), quality=88)
    print('previews written next to', OUT)
    raise SystemExit

enc = subprocess.Popen([ff, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                        '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-maxrate', '12M', '-bufsize', '24M', '-pix_fmt', 'yuv420p', str(silent)], stdin=subprocess.PIPE)
frame_no = 0
for n_scene, ((beats, kind, s), at) in enumerate(zip(SCENES, starts)):
    length = beats * BEAT
    reader = Reader(s['at']) if kind == 'clip' else None
    last = int(round((at + length) * FPS))
    while frame_no < last:
        t = frame_no / FPS - at
        clip_frame = reader.at(max(0, t) * s['speed']) if reader else None
        im = scene_frame(kind, s, t, length, clip_frame)
        if n_scene and t < 0.1:  # a quick white flash on every cut
            im = Image.blend(im, Image.new('RGB', (W, H), WHITE), 0.6 * (1 - t / 0.1))
        enc.stdin.write(np.asarray(im, np.uint8).tobytes())
        frame_no += 1
    print(f'scene {n_scene + 1}/{len(SCENES)} {kind} done', flush=True)
enc.stdin.close()
if enc.wait():
    raise SystemExit('video encoding failed')

with wave.open(str(wav), 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((audio * 32767).astype(np.int16).tobytes())
subprocess.run([ff, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(silent), '-i', str(wav), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-shortest', '-movflags', '+faststart', str(OUT)], check=True)
silent.unlink()
wav.unlink()
print(f'{OUT}  {DURATION:.1f}s  {OUT.stat().st_size / 1048576:.1f} MB')
