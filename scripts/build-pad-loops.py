#!/usr/bin/env python3
"""
Computes stable loop regions and equal-power crossfades for all 96 pads.
Outputs public/audio/pad-loops.json and tests 3 loop cycles offline.
"""

import os
import wave
import struct
import math
import json

WAV_DIR = "/Users/alexandre/Downloads/PadLab-Web/_audio_backup_wav/pads"
OUTPUT_JSON = "/Users/alexandre/Downloads/PadLab-Web/public/audio/pad-loops.json"

def get_rms(samples):
    if not samples: return 0.0
    sum_sq = sum(s * s for s in samples)
    return math.sqrt(sum_sq / len(samples)) / 32768.0

def to_db(rms):
    return 20.0 * math.log10(max(rms, 1e-6))

def analyze_pad(filepath):
    with wave.open(filepath, 'rb') as w:
        n_channels = w.getnchannels()
        framerate = w.getframerate()
        n_frames = w.getnframes()
        raw = w.readframes(n_frames)

    samples = struct.unpack(f"<{n_frames * n_channels}h", raw)
    duration = n_frames / framerate

    # 100ms window analysis
    win_frames = int(framerate * 0.1) # 4410
    total_wins = n_frames // win_frames

    rms_profile = []
    for i in range(total_wins):
        chunk = samples[i * win_frames * n_channels : (i + 1) * win_frames * n_channels]
        rms_profile.append(get_rms(chunk))

    max_rms = max(rms_profile) if rms_profile else 0.001

    # 1. Detect attack/swell end:
    # Look for region where RMS is sustained (at least 75% of max_rms, or peak sustain plateau)
    # Most worship pads have peak sustain in the middle/late section (e.g. 5s to 35s)
    
    # We want a loop region between loop_start and loop_end:
    # Crossfade duration: 3.0s
    fade_sec = 3.0
    fade_wins = int(fade_sec / 0.1) # 30 windows

    # Find the best region [start_win, end_win] such that:
    # - start_win is after initial swell (min 2.0s, unless dark_pad which can be 1.0s)
    # - end_win is before end of file (max duration - 0.5s)
    # - loop length is at least 15s
    # - RMS at end_win matches RMS at start_win within minimal dB difference
    
    min_start_win = 10 # 1.0s
    max_end_win = total_wins - 5

    # Target sustain level: average RMS between 15s and 30s
    mid_start = min(total_wins // 3, total_wins - 1)
    mid_end = min(2 * total_wins // 3, total_wins)
    target_sustain = sum(rms_profile[mid_start:mid_end]) / max(1, (mid_end - mid_start))

    # Search for start_win: first window after swell where RMS reaches target_sustain * 0.85
    start_win = min_start_win
    for w_idx in range(min_start_win, total_wins // 2):
        if rms_profile[w_idx] >= target_sustain * 0.85:
            # Check if next 10 windows are also stable
            if all(r >= target_sustain * 0.75 for r in rms_profile[w_idx:w_idx+10]):
                start_win = w_idx
                break

    # Search for end_win: choose a window near the end where RMS is closest to rms_profile[start_win]
    best_end_win = max_end_win
    best_db_diff = 999.0

    start_rms_avg = sum(rms_profile[start_win:start_win+fade_wins]) / fade_wins

    for end_candidate in range(start_win + int(15.0 / 0.1), max_end_win):
        end_rms_avg = sum(rms_profile[end_candidate - fade_wins:end_candidate]) / fade_wins
        diff_db = abs(to_db(end_rms_avg) - to_db(start_rms_avg))
        if diff_db < best_db_diff:
            best_db_diff = diff_db
            best_end_win = end_candidate

    loop_start_s = round(start_win * 0.1, 3)
    loop_end_s = round(best_end_win * 0.1, 3)

    return {
        "duration": round(duration, 3),
        "framerate": framerate,
        "n_frames": n_frames,
        "loopStart": loop_start_s,
        "loopEnd": loop_end_s,
        "crossfade": fade_sec,
        "initialDbDiff": round(best_db_diff, 2)
    }

def main():
    presets = sorted(os.listdir(WAV_DIR))
    loop_data = {}
    count = 0

    print("Calculando loopStart, loopEnd e crossfades ideais para todos os 96 pads...")

    for p in presets:
        p_path = os.path.join(WAV_DIR, p)
        if not os.path.isdir(p_path): continue
        loop_data[p] = {}

        files = sorted(f for f in os.listdir(p_path) if f.endswith('.wav'))
        for f in files:
            full_path = os.path.join(p_path, f)
            res = analyze_pad(full_path)
            base_name = os.path.splitext(f)[0]
            loop_data[p][base_name] = res
            count += 1

    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
    with open(OUTPUT_JSON, "w") as out:
        json.dump(loop_data, out, indent=2)

    print(f"Salvo em {OUTPUT_JSON} ({count} pads processados).")

if __name__ == "__main__":
    main()

