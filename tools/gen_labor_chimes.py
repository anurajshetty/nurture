#!/usr/bin/env python3
"""
Generate the native soft-chime WAV assets for the labor-readiness sections
(Willow, Sept 2026).

Web builds synthesize these tones with WebAudio (see
src/labor/breathing/tone.ts and src/labor/pelvicfloor/device.ts); native
builds have no WebAudio, so expo-audio plays these pre-rendered assets
instead. The samples below reproduce the WebAudio gain envelopes sample for
sample (exponential ramps, same frequencies, same durations) so the native
chime sounds identical to the web one.

- chime-breathing.wav : 392 Hz sine, 0.55s — attack 0.0001->0.1 over 0.04s,
  decay 0.1->0.0001 by 0.55s (matches breathing/tone.ts)
- chime-pelvicfloor.wav : 523.25 Hz (C5) sine, 1.4s — attack 0.0001->0.12
  over 0.1s, decay 0.12->0.0001 by 1.4s (matches pelvicfloor/device.ts)

44.1 kHz, 16-bit mono PCM. Output: src/labor/assets/.

Usage: python3 tools/gen_labor_chimes.py
"""
import math
import struct
import wave
from pathlib import Path

SR = 44100
OUT = Path(__file__).resolve().parent.parent / "src" / "labor" / "assets"


def exp_ramp(v0: float, v1: float, t0: float, t1: float, t: float) -> float:
    """WebAudio exponentialRampToValueAtTime equivalent."""
    return v0 * (v1 / v0) ** ((t - t0) / (t1 - t0))


def render(freq: float, attack_end: float, attack_peak: float, duration: float) -> bytes:
    n = int(duration * SR)
    frames = bytearray()
    for i in range(n):
        t = i / SR
        if t <= attack_end:
            gain = exp_ramp(0.0001, attack_peak, 0.0, attack_end, t)
        else:
            gain = exp_ramp(attack_peak, 0.0001, attack_end, duration, t)
        s = math.sin(2.0 * math.pi * freq * t) * gain
        # Soft peaks (0.1 / 0.12) — no clipping possible; clamp for safety.
        s = max(-1.0, min(1.0, s))
        frames += struct.pack("<h", int(round(s * 32767)))
    return bytes(frames)


def write_wav(name: str, pcm: bytes) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / name
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm)
    print(f"wrote {path} ({len(pcm) // 2} samples, {len(pcm) / 1024:.1f} KiB)")


def main() -> None:
    write_wav("chime-breathing.wav", render(392.0, 0.04, 0.10, 0.55))
    write_wav("chime-pelvicfloor.wav", render(523.25, 0.10, 0.12, 1.40))


if __name__ == "__main__":
    main()
