"""Procedurally composes the original ambient tracks used by the game.

    python tools/make_music.py web/audio

Produces seamless loops (pastel_lullaby, aqua_halls, cloud_choir, fog_bridge,
empty_mall, courtyard_night) — dreamy
lo-fi pads, music box, glassy plucks, tape wobble and big reverb. No vocals.
Requires numpy + scipy + ffmpeg.
"""
import os
import subprocess
import sys

import numpy as np
from scipy.signal import butter, fftconvolve, lfilter

SR = 44100


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def env_adsr(n, a, d, s, r, sr=SR):
    a, d, r = int(a * sr), int(d * sr), int(r * sr)
    e = np.zeros(n)
    sustain_len = max(0, n - a - d - r)
    seg = [np.linspace(0, 1, a, endpoint=False), np.linspace(1, s, d, endpoint=False),
           np.full(sustain_len, s), np.linspace(s, 0, r)]
    v = np.concatenate(seg)[:n]
    e[:len(v)] = v
    return e


def lowpass(x, f, order=2):
    b, a = butter(order, min(0.99, f / (SR / 2)), 'low')
    return lfilter(b, a, x, axis=0)


def highpass(x, f, order=2):
    b, a = butter(order, f / (SR / 2), 'high')
    return lfilter(b, a, x, axis=0)


def saw_pad(freq, dur, rng, detune=0.12, harmonics=10, voices=3):
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for v in range(voices):
        f = freq * 2 ** ((rng.uniform(-detune, detune)) / 12)
        ph = rng.uniform(0, 2 * np.pi)
        vib = 1 + 0.002 * np.sin(2 * np.pi * rng.uniform(0.15, 0.4) * t + ph)
        phase = 2 * np.pi * f * np.cumsum(vib) / SR
        for h in range(1, harmonics + 1):
            if f * h > 9000:
                break
            out += np.sin(h * phase + ph * h) / h * (0.92 ** h)
    return out / voices


def sine_stack(freq, dur, partials, rng):
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for mult, amp in partials:
        ph = rng.uniform(0, 2 * np.pi)
        trem = 1 + 0.15 * np.sin(2 * np.pi * rng.uniform(0.1, 0.3) * t + ph)
        out += amp * np.sin(2 * np.pi * freq * mult * t + ph) * trem
    return out


def bell(freq, dur, rng, bright=1.0):
    """music box / celesta: inharmonic sines with exponential decay"""
    n = int(dur * SR)
    t = np.arange(n) / SR
    partials = [(1, 1.0, 2.2), (2.0, 0.45 * bright, 3.5), (3.01, 0.25 * bright, 5.0), (4.17, 0.12 * bright, 7.0), (5.43, 0.06 * bright, 9.0)]
    out = np.zeros(n)
    for m, a, dec in partials:
        out += a * np.sin(2 * np.pi * freq * m * (1 + rng.uniform(-0.002, 0.002)) * t) * np.exp(-t * dec)
    att = np.minimum(1, t / 0.004)
    return out * att


def pluck(freq, dur, rng):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = freq * (1 + 0.6 * np.exp(-t * 60))  # little pitch blip = droplet
    ph = 2 * np.pi * np.cumsum(f) / SR
    return (np.sin(ph) + 0.3 * np.sin(2 * ph)) * np.exp(-t * 4.5) * np.minimum(1, t / 0.003)


def make_ir(seconds, decay, rng, tone=6000):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = rng.normal(0, 1, (n, 2)) * np.exp(-t * decay)[:, None]
    ir = lowpass(ir, tone, 1)
    ir[: int(0.01 * SR)] *= np.linspace(0, 1, int(0.01 * SR))[:, None]
    return ir / np.sqrt(np.sum(ir ** 2, axis=0, keepdims=True))


def place(buf, sig, start, pan=0.0, gain=1.0):
    s = int(start * SR)
    if s >= len(buf):
        return
    e = min(len(buf), s + len(sig))
    l = np.cos((pan + 1) * np.pi / 4)
    r = np.sin((pan + 1) * np.pi / 4)
    buf[s:e, 0] += sig[: e - s] * l * gain
    buf[s:e, 1] += sig[: e - s] * r * gain


def tape(x, rng, wow=0.0025, flutter=0.0004):
    n = len(x)
    t = np.arange(n) / SR
    warp = t + wow * np.sin(2 * np.pi * 0.33 * t) + flutter * np.sin(2 * np.pi * 6.1 * t + 1.3)
    idx = np.clip(warp * SR, 0, n - 1)
    out = np.empty_like(x)
    for c in range(x.shape[1]):
        out[:, c] = np.interp(idx, np.arange(n), x[:, c])
    return out


def crackle(n, rng, density=4.0, amp=0.02):
    out = np.zeros((n, 2))
    count = int(n / SR * density)
    pos = rng.integers(0, n - 200, count)
    for p in pos:
        k = rng.uniform(0.2, 1.0) * amp
        out[p:p + 30, rng.integers(0, 2)] += k * rng.normal(0, 1, 30) * np.exp(-np.arange(30) / 6)
    hiss = rng.normal(0, 1, (n, 2)) * amp * 0.08
    return highpass(out + lowpass(hiss, 7000, 1), 1200, 1)


def finish(dry, wet_send, ir, loop_len, rng, wet=0.55, lp=None, sat=1.3):
    """mix + reverb, fold the tail back into the start so the file loops"""
    rev = np.stack([fftconvolve(wet_send[:, c], ir[:, c]) for c in range(2)], axis=1)
    mix = np.zeros((len(rev), 2))
    mix[: len(dry)] += dry
    mix += rev * wet
    total = int(loop_len * SR)
    loop = mix[:total].copy()
    tail = mix[total:]
    k = min(len(tail), total)
    loop[:k] += tail[:k]
    loop = tape(loop, rng)
    if lp:
        loop = lowpass(loop, lp, 1)
    loop = highpass(loop, 35, 2)
    loop = np.tanh(loop * sat) / np.tanh(sat)
    loop /= np.max(np.abs(loop)) + 1e-9
    return loop * 0.89


def write(path, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2').tobytes()
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ar', str(SR), '-ac', '2', '-i', '-',
                    '-b:a', '128k', path], input=pcm, check=True)
    print('wrote', path, f'{len(x) / SR:.1f}s')


# ---------------------------------------------------------------------------
def pastel_lullaby(rng):
    bpm = 70
    beat = 60 / bpm
    bar = beat * 4
    chords = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59],
              [46, 50, 53, 57], [45, 48, 52, 55], [50, 53, 57, 62], [43, 47, 50, 55]]
    bars = 32
    L = bars * bar
    n = int((L + 6) * SR)
    dry = np.zeros((n, 2))
    send = np.zeros((n, 2))
    scale = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81]
    for b in range(bars):
        ch = chords[b % len(chords)]
        t0 = b * bar
        # warm pad
        for i, note in enumerate(ch):
            p = saw_pad(midi(note), bar + 1.5, rng, harmonics=8) * env_adsr(int((bar + 1.5) * SR), 1.2, 0.5, 0.8, 1.6)
            p = lowpass(p, 1400, 1)
            place(dry, p, t0, pan=(i - 1.5) * 0.35, gain=0.05)
            place(send, p, t0, pan=(i - 1.5) * 0.35, gain=0.06)
        # soft sub bass
        bs = sine_stack(midi(ch[0] - 12), bar, [(1, 1.0), (2, 0.25)], rng) * env_adsr(int(bar * SR), 0.05, 0.4, 0.7, 0.6)
        place(dry, bs, t0, gain=0.11)
        # music box melody (eighth notes, sparse)
        if b >= 2:
            for k in range(8):
                if rng.random() < (0.55 if b % 4 != 3 else 0.3):
                    tones = [x for x in scale if (x % 12) in [c % 12 for c in ch]] or scale
                    note = rng.choice(tones) + (12 if rng.random() < 0.3 else 0)
                    s = bell(midi(note), 3.0, rng)
                    pan = rng.uniform(-0.5, 0.5)
                    place(dry, s, t0 + k * beat / 2 + rng.uniform(0, 0.012), pan, 0.09)
                    place(send, s, t0 + k * beat / 2, pan, 0.12)
        # gentle brushed hat
        if b >= 4 and b < bars - 1:
            for k in range(4):
                h = highpass(rng.normal(0, 1, int(0.08 * SR)), 6000, 2) * np.exp(-np.arange(int(0.08 * SR)) / (0.02 * SR))
                place(dry, h, t0 + (k + 0.5) * beat, rng.uniform(-0.3, 0.3), 0.025)
            for k in [0, 2]:
                kk = np.sin(2 * np.pi * np.cumsum(60 + 80 * np.exp(-np.arange(int(0.3 * SR)) / (0.03 * SR))) / SR) * np.exp(-np.arange(int(0.3 * SR)) / (0.08 * SR))
                place(dry, kk, t0 + k * beat, 0, 0.12)
    ir = make_ir(4.5, 1.1, rng, 5000)
    out = finish(dry, send, ir, L, rng, wet=0.6, lp=9000)
    out += crackle(len(out), rng, 3, 0.03)
    return out / (np.max(np.abs(out)) + 1e-9) * 0.89


def aqua_halls(rng):
    bpm = 58
    beat = 60 / bpm
    bar = beat * 4
    chords = [[57, 60, 64, 71], [53, 57, 60, 67], [48, 52, 55, 62], [55, 59, 62, 64]]
    bars = 24
    L = bars * bar
    n = int((L + 8) * SR)
    dry = np.zeros((n, 2))
    send = np.zeros((n, 2))
    for b in range(bars):
        ch = chords[(b // 2) % len(chords)]
        t0 = b * bar
        if b % 2 == 0:
            for i, note in enumerate(ch):
                dur = bar * 2 + 2
                p = sine_stack(midi(note), dur, [(1, 1.0), (2, 0.35), (3, 0.12), (4.0 * 1.003, 0.08)], rng)
                p *= env_adsr(int(dur * SR), 2.0, 1.0, 0.75, 2.5)
                place(dry, p, t0, pan=(i - 1.5) * 0.5, gain=0.045)
                place(send, p, t0, pan=(i - 1.5) * 0.5, gain=0.08)
            dr = sine_stack(midi(ch[0] - 24), bar * 2 + 1, [(1, 1.0), (1.5, 0.2)], rng) * env_adsr(int((bar * 2 + 1) * SR), 1.5, 0.5, 0.8, 1.5)
            place(dry, dr, t0, gain=0.12)
        # water drop plucks: arpeggio
        if b >= 1:
            for k in range(8):
                if rng.random() < 0.5:
                    note = ch[rng.integers(0, len(ch))] + 12 * rng.integers(1, 3)
                    s = pluck(midi(note), 2.2, rng)
                    pan = rng.uniform(-0.8, 0.8)
                    place(dry, s, t0 + k * beat / 2, pan, 0.05)
                    place(send, s, t0 + k * beat / 2, pan, 0.16)
    ir = make_ir(6.0, 0.75, rng, 4200)
    out = finish(dry, send, ir, L, rng, wet=0.75, lp=7000)
    # slow "underwater" filter sweep
    t = np.arange(len(out)) / SR
    lfo = 0.5 + 0.5 * np.sin(2 * np.pi * t / L * 2)
    lo = lowpass(out, 900, 1)
    out = out * (0.55 + 0.45 * lfo[:, None]) + lo * (0.45 - 0.45 * lfo[:, None])
    return out / (np.max(np.abs(out)) + 1e-9) * 0.89


def cloud_choir(rng):
    bpm = 64
    beat = 60 / bpm
    bar = beat * 4
    chords = [[62, 66, 69, 73, 76], [59, 62, 66, 69, 76], [55, 59, 62, 66, 71], [57, 61, 64, 66, 69]]
    bars = 24
    L = bars * bar
    n = int((L + 8) * SR)
    dry = np.zeros((n, 2))
    send = np.zeros((n, 2))
    for b in range(bars):
        ch = chords[(b // 2) % len(chords)]
        t0 = b * bar
        if b % 2 == 0:
            for i, note in enumerate(ch):
                dur = bar * 2 + 2.5
                # airy shimmer pad: soft saws + octave sines
                p = lowpass(saw_pad(midi(note), dur, rng, detune=0.08, harmonics=6, voices=4), 2200, 1)
                p += 0.4 * sine_stack(midi(note + 12), dur, [(1, 1.0), (2, 0.2)], rng)
                p *= env_adsr(int(dur * SR), 2.5, 1.0, 0.8, 2.8)
                place(dry, p, t0, pan=(i - 2) * 0.35, gain=0.035)
                place(send, p, t0, pan=(i - 2) * 0.35, gain=0.07)
            bs = sine_stack(midi(ch[0] - 24), bar * 2, [(1, 1.0), (2, 0.15)], rng) * env_adsr(int(bar * 2 * SR), 1.0, 0.5, 0.8, 1.2)
            place(dry, bs, t0, gain=0.1)
        # celesta arpeggio, rising
        if b >= 2:
            arp = sorted(ch)
            for k in range(8):
                if rng.random() < 0.7:
                    note = arp[k % len(arp)] + 12
                    s = bell(midi(note), 2.5, rng, bright=0.6)
                    pan = np.sin(k * 0.8) * 0.6
                    place(dry, s, t0 + k * beat / 2, pan, 0.05)
                    place(send, s, t0 + k * beat / 2, pan, 0.1)
    ir = make_ir(7.0, 0.6, rng, 6500)
    return finish(dry, send, ir, L, rng, wet=0.8, lp=10000)


def fm_piano(freq, dur, rng, bright=1.0):
    """soft electric piano (two-operator FM) for the mallsoft track"""
    n = int(dur * SR)
    t = np.arange(n) / SR
    env = np.exp(-t * 1.6) * np.minimum(1, t / 0.005)
    mod = np.sin(2 * np.pi * freq * 1.0 * t) * (1.6 * bright) * np.exp(-t * 4)
    car = np.sin(2 * np.pi * freq * t + mod)
    car += 0.15 * np.sin(2 * np.pi * freq * 2.0 * t + mod * 0.5)
    return car * env


def fog_bridge(rng):
    """slow drones over the sea, a far-away foghorn, wind"""
    L = 112.0
    n = int((L + 8) * SR)
    dry = np.zeros((n, 2))
    send = np.zeros((n, 2))
    roots = [45, 43, 41, 43]
    for k in range(8):
        t0 = k * L / 8
        note = roots[k % 4]
        dur = L / 8 + 6
        for i, iv in enumerate([0, 7, 12, 16]):
            p = lowpass(saw_pad(midi(note + iv), dur, rng, detune=0.1, harmonics=6, voices=3), 900, 1)
            p *= env_adsr(int(dur * SR), 4.0, 2.0, 0.8, 5.0)
            place(dry, p, t0, pan=(i - 1.5) * 0.4, gain=0.05)
            place(send, p, t0, pan=(i - 1.5) * 0.4, gain=0.09)
    for t0 in [10, 46, 82]:
        horn = sine_stack(midi(33), 6, [(1, 1.0), (2, 0.35), (3, 0.15)], rng) * env_adsr(int(6 * SR), 1.2, 1.0, 0.7, 3.0)
        place(dry, lowpass(horn, 400, 2), t0, pan=-0.3, gain=0.07)
        place(send, horn, t0, pan=-0.3, gain=0.12)
    wind = lowpass(rng.normal(0, 1, n), 500, 2) * (0.6 + 0.4 * np.sin(2 * np.pi * np.arange(n) / SR / 17))
    dry[:, 0] += wind * 0.02
    dry[:, 1] += np.roll(wind, 3000) * 0.02
    ir = make_ir(7.0, 0.55, rng, 3500)
    return finish(dry, send, ir, L, rng, wet=0.8, lp=6000)


def empty_mall(rng):
    """muffled easy-listening heard from another room of an empty store"""
    bpm = 76
    beat = 60 / bpm
    bar = beat * 4
    prog = [[53, 57, 60, 64, 67], [52, 55, 59, 62, 69], [50, 53, 57, 60, 64], [55, 59, 62, 65, 69]]
    bars = 32
    L = bars * bar
    n = int((L + 6) * SR)
    dry = np.zeros((n, 2))
    send = np.zeros((n, 2))
    mel = [72, 71, 69, 67, 69, 72, 74, 72, 71, 67, 69, 71]
    for b in range(bars):
        ch = prog[b % 4]
        t0 = b * bar
        for k in (0, 2.5):
            for i, note in enumerate(ch[:4]):
                s = fm_piano(midi(note), 2.6, rng, 0.8)
                place(dry, s, t0 + k * beat + i * 0.012, pan=(i - 1.5) * 0.3, gain=0.05)
                place(send, s, t0 + k * beat, pan=(i - 1.5) * 0.3, gain=0.06)
        bass = sine_stack(midi(ch[0] - 24), bar, [(1, 1.0), (2, 0.3)], rng) * env_adsr(int(bar * SR), 0.02, 0.6, 0.6, 0.4)
        place(dry, bass, t0, gain=0.12)
        if b % 8 >= 2:
            for k in range(4):
                if rng.random() < 0.6:
                    note = mel[(b * 4 + k) % len(mel)]
                    s = fm_piano(midi(note), 1.8, rng, 1.2)
                    place(dry, s, t0 + k * beat, pan=0.2, gain=0.06)
                    place(send, s, t0 + k * beat, pan=0.2, gain=0.08)
        for k in range(4):
            hh = highpass(rng.normal(0, 1, int(0.05 * SR)), 7000, 2) * np.exp(-np.arange(int(0.05 * SR)) / (0.01 * SR))
            place(dry, hh, t0 + (k + 0.5) * beat, 0.1, 0.012)
    ir = make_ir(3.5, 1.2, rng, 3000)
    out = finish(dry, send, ir, L, rng, wet=0.65, lp=2200, sat=1.1)
    return out


def courtyard_night(rng):
    """quiet night between tall buildings: soft high pads, sparse plucks, city drone"""
    bpm = 60
    bar = 4.0
    chords = [[62, 66, 69, 73], [61, 64, 68, 71], [59, 62, 66, 69], [57, 61, 64, 68]]
    bars = 26
    L = bars * bar
    n = int((L + 8) * SR)
    dry = np.zeros((n, 2))
    send = np.zeros((n, 2))
    for b in range(0, bars, 2):
        ch = chords[(b // 2) % 4]
        for i, note in enumerate(ch):
            dur = bar * 2 + 3
            p = sine_stack(midi(note + 12), dur, [(1, 1.0), (2, 0.12)], rng) * env_adsr(int(dur * SR), 3.0, 1.0, 0.7, 3.5)
            place(dry, p, b * bar, pan=(i - 1.5) * 0.5, gain=0.03)
            place(send, p, b * bar, pan=(i - 1.5) * 0.5, gain=0.07)
        for k in range(6):
            if rng.random() < 0.45:
                s = pluck(midi(ch[rng.integers(0, 4)] + 24), 2.5, rng)
                place(dry, s, b * bar + k * 1.3 + rng.uniform(0, 0.3), rng.uniform(-0.7, 0.7), 0.025)
                place(send, s, b * bar + k * 1.3, 0, 0.07)
    city = lowpass(rng.normal(0, 1, n), 160, 2)
    dry[:, 0] += city * 0.05
    dry[:, 1] += np.roll(city, 5000) * 0.05
    ir = make_ir(6.0, 0.65, rng, 5000)
    return finish(dry, send, ir, L, rng, wet=0.75, lp=8000)


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'web/audio'
    os.makedirs(out, exist_ok=True)
    write(os.path.join(out, 'pastel_lullaby.mp3'), pastel_lullaby(np.random.default_rng(7)))
    write(os.path.join(out, 'aqua_halls.mp3'), aqua_halls(np.random.default_rng(11)))
    write(os.path.join(out, 'cloud_choir.mp3'), cloud_choir(np.random.default_rng(23)))
    write(os.path.join(out, 'fog_bridge.mp3'), fog_bridge(np.random.default_rng(31)))
    write(os.path.join(out, 'empty_mall.mp3'), empty_mall(np.random.default_rng(37)))
    write(os.path.join(out, 'courtyard_night.mp3'), courtyard_night(np.random.default_rng(41)))
