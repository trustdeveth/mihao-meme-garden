"""Music and sound effects for the Thanksgiving video, all synthesized here (nobody else's audio).

    python music.py <out.wav> <shots as JSON: [{id, at, len}, ...]>
"""
import json
import sys
import wave

import numpy as np

SR = 44100
BEAT = 0.5  # 120 beats a minute: every cut lands on a beat
shots = {s['id']: s for s in json.loads(sys.argv[2])}
DURATION = max(s['at'] + s['len'] for s in shots.values())
audio = np.zeros(int(SR * DURATION), np.float32)
rng = np.random.default_rng(26)


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
    spec = np.fft.rfft(rng.standard_normal(n))
    fr = np.fft.rfftfreq(n, 1 / SR)
    spec[(fr < lo) | (fr > hi)] = 0
    s = np.fft.irfft(spec, n)
    s /= max(1e-9, np.abs(s).max())
    return s * np.exp(-tt(dur)[:n] * decay)


NOTE = {'F2': 87.31, 'G2': 98.0, 'A2': 110.0, 'C3': 130.81, 'D3': 146.83, 'E3': 164.81, 'F3': 174.61, 'G3': 196.0, 'A3': 220.0, 'B3': 246.94,
        'C4': 261.63, 'D4': 293.66, 'E4': 329.63, 'F4': 349.23, 'G4': 392.0, 'A4': 440.0, 'C5': 523.25, 'D5': 587.33, 'E5': 659.25, 'G5': 783.99, 'A5': 880.0, 'C6': 1046.5}
cache = {}


def pluck(name, dur=0.8, bright=0.5):
    """A plucked string (Karplus-Strong), close to a zither."""
    if (name, dur) not in cache:
        n = max(2, int(SR / NOTE[name]))
        buf = rng.uniform(-1, 1, n)
        buf = bright * buf + (1 - bright) * np.convolve(buf, np.ones(4) / 4, 'same')
        out = np.empty(int(SR * dur))
        for i in range(len(out)):
            j = i % n
            out[i] = buf[j]
            buf[j] = 0.4975 * (buf[j] + buf[(j + 1) % n])
        cache[(name, dur)] = out * np.exp(-tt(dur) * 2.2)
    return cache[(name, dur)]


def bell(name, dur=1.2):
    t = tt(dur)
    f = NOTE[name]
    return (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t * 6)) * np.exp(-t * 4)


def gong(dur=2.6):
    t = tt(dur)
    s = sum(a * np.sin(2 * np.pi * f * t + 3 * np.sin(2 * np.pi * (4 + k) * t) * np.exp(-t * 2)) * np.exp(-t * d)
            for k, (f, a, d) in enumerate([(98, 1.0, 1.1), (147.5, 0.6, 1.4), (233, 0.45, 1.8), (311, 0.3, 2.4), (466, 0.2, 3.1)]))
    return s / 2.4 + noise(dur, 200, 3000, 5) * 0.18


def gobble(dur=0.7):
    """A cartoon turkey: a buzzy voice whose pitch and loudness warble quickly."""
    t = tt(dur)
    warble = np.sin(2 * np.pi * 15 * t)
    f = 520 - 170 * t / dur + 140 * warble
    ph = 2 * np.pi * np.cumsum(f) / SR
    voice = sum(np.sin(ph * k) / k for k in (1, 2, 3, 4, 5))
    env = (0.55 + 0.45 * warble) * np.minimum(1, t / 0.04) * np.minimum(1, (dur - t) / 0.12)
    return voice * env / 1.8


kick = sweep(140, 42, 0.3, 11)
clap = noise(0.16, 900, 6000, 26)
hat = noise(0.05, 7000, 15000, 80)
whoosh = noise(0.34, 500, 6000) * np.sin(np.linspace(0, np.pi, int(SR * 0.34))) ** 3
boom = sweep(95, 30, 0.9, 4.5) + noise(0.9, 30, 500, 8) * 0.5

ask, turkey, spared, title, end = (shots[k] for k in ('ask', 'turkey', 'spared', 'title', 'end'))
# the stare: a low rising hum and two plucks
add(0.0, sweep(55, 104, ask['len'], 0.15) * np.linspace(0, 1, int(SR * ask['len'])), 0.34)
add(0.4, pluck('E4'), 0.45)
add(1.5, pluck('F4'), 0.4)
# the turkey: a nervous gobble and a tick-tock, then the gong on "mihao."
add(turkey['at'], whoosh, 0.4)
add(turkey['at'] + 0.18, gobble(0.65), 0.34)
for k in range(3):
    add(turkey['at'] + 0.25 + k * 0.3, noise(0.03, 2000, 6000, 130), 0.25)
add(turkey['at'] + 1.15, gong(), 0.8)
add(turkey['at'] + 1.15, boom, 0.85)
# respect: a warm rising chord
add(spared['at'], whoosh, 0.4)
for i, n in enumerate(['C4', 'E4', 'G4', 'C5', 'E5']):
    add(spared['at'] + 0.25 + i * 0.08, pluck(n, 1.8), 0.34)
add(spared['at'] + 1.65, gobble(0.55), 0.3)

# the feast: a warm original tune over C - A minor - F - G, from the title to the last bar
start, stop = title['at'], DURATION - 1.5
CHORDS = [('C3', ['C4', 'E4', 'G4']), ('A2', ['C4', 'E4', 'A4']), ('F2', ['C4', 'F4', 'A4']), ('G2', ['B3', 'D4', 'G4'])]
TUNE = ('E5 - G5 E5 D5 C5 D5 - E5 - C5 - A4 - C5 - D5 C5 A4 - C5 D5 E5 - D5 - - E5 D5 C5 D5 - '
        'G5 - A5 G5 E5 - D5 C5 E5 - D5 C5 A4 - C5 - D5 - E5 D5 C5 - A4 C5 D5 E5 D5 - C5 - - -').split()
beats = int(round((stop - start) / BEAT))
for k in range(beats):
    at = start + k * BEAT
    root, chord = CHORDS[(k // 4) % 4]
    add(at, kick, 0.62 if k % 2 == 0 else 0.3)
    if k % 2 == 1:
        add(at, clap, 0.3)
    add(at, hat, 0.12)
    add(at + BEAT / 2, hat, 0.2)
    add(at, pluck(root, 0.6), 0.6)
    for j, n in enumerate(chord):
        add(at + BEAT / 2 + j * 0.012, pluck(n, 0.5), 0.17)
for k in range(beats * 2):
    n = TUNE[k % len(TUNE)]
    if n != '-':
        add(start + k * BEAT / 2, pluck(n), 0.42)
        if k % 4 == 0:
            add(start + k * BEAT / 2, bell(n), 0.1)
for s in shots.values():
    if s['at'] >= title['at']:
        add(s['at'] - 0.17, whoosh, 0.36)
add(title['at'], boom, 0.7)
add(end['at'], boom, 0.7)
add(end['at'], gong(), 0.4)
add(shots['right']['at'] + 0.5, gobble(0.6), 0.2)
# one last chord and a small "ting"
for i, n in enumerate(['C3', 'G3', 'C4', 'E4', 'G4', 'C5', 'E5']):
    add(stop + i * 0.05, pluck(n, 1.5), 0.36)
add(stop + 0.4, bell('C6', 1.1), 0.18)

fade = int(SR * 0.6)
audio[-fade:] *= np.linspace(1, 0, fade)
audio = np.tanh(audio * 0.9)  # gentle limiting
audio *= 0.89 / np.abs(audio).max()
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((audio * 32767).astype(np.int16).tobytes())
