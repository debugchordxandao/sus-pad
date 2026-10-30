#!/usr/bin/env python3
"""
Inspects RMS envelope across 100ms windows for all 96 original WAV files.
Identifies the swell end (attack end) and steady-state sustain plateau.
"""

import os
import wave
import struct
import math
import json

WAV_DIR = "/Users/alexandre/Downloads/PadLab-Web/_audio_backup_wav/pads"

def analyze_file(filepath):
    with wave.open(filepath, 'rb') as w:
        n_channels = w.getnchannels()
        sampwidth = w.getsampwidth()
        framerate = w.getframerate()
        n_frames = w.getnframes()
        raw_bytes = w.readframes(n_frames)

    fmt = f"<{n_frames * n_channels}h"
    samples = struct.unpack(fmt, raw_bytes)

    # 100 ms windows
    window_size = int(framerate * 0.1) # 4410 frames
    total_windows = n_frames // window_size

    rms_list = []
    times = []

    for i in range(total_windows):
        start = i * window_size * n_channels
        end = start + window_size * n_channels
        chunk = samples[start:end]
        
        sum_sq = sum(s * s for s in chunk)
        mean_sq = sum_sq / len(chunk)
        rms = math.sqrt(mean_sq) / 32768.0
        rms_list.append(rms)
        times.append(round(i * 0.1, 2))

    max_rms = max(rms_list) if rms_list else 1e-6
    # Normalize
    norm_rms = [r / max_rms for r in rms_list]

    # Find where it stabilizes (reaches steady state, e.g. >= 85% of peak and slope flattens)
    # Most pads have a swell in first 1-5s
    swell_end_time = 0.0
    for idx, (t, val) in enumerate(zip(times, norm_rms)):
        if t >= 0.5:
            # Check if this window and next 5 windows (500ms) are all >= 0.85
            window_slice = norm_rms[idx:idx+6]
            if len(window_slice) >= 6 and all(v >= 0.80 for v in window_slice):
                swell_end_time = t
                break

    # If not found or file starts high (e.g. dark_pad / worship)
    if swell_end_time == 0.0:
        swell_end_time = 1.0

    # Total duration
    duration = n_frames / framerate

    return {
        "duration": duration,
        "framerate": framerate,
        "n_frames": n_frames,
        "max_rms": round(max_rms, 4),
        "swell_end_time": swell_end_time,
        "norm_rms_first_5s": [round(norm_rms[i], 3) for i in range(min(50, len(norm_rms)))]
    }

def main():
    presets = sorted(os.listdir(WAV_DIR))
    summary = {}

    for p in presets:
        p_path = os.path.join(WAV_DIR, p)
        if not os.path.isdir(p_path): continue
        summary[p] = {}
        files = sorted(f for f in os.listdir(p_path) if f.endswith('.wav'))
        swell_times = []
        for f in files:
            res = analyze_file(os.path.join(p_path, f))
            summary[p][f] = res
            swell_times.append(res["swell_end_time"])
        avg_swell = sum(swell_times) / len(swell_times) if swell_times else 0
        min_swell = min(swell_times) if swell_times else 0
        max_swell = max(swell_times) if swell_times else 0
        print(f"Preset {p:15s}: Swell varia de {min_swell:.1f}s a {max_swell:.1f}s (Média: {avg_swell:.1f}s)")

if __name__ == "__main__":
    main()

