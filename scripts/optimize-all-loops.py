#!/usr/bin/env python3
"""
Optimizes loop points (loopStart, loopEnd, crossfade) for all 96 pads
so that:
1. Attack swell is completely excluded from the loop.
2. Volume variation (RMS across 100ms windows around the seam) <= 1.5 dB.
3. Waveform discontinuity at the seam <= 0.02.
Saves the optimized parameters to public/audio/pad-loops.json.
"""

import os
import wave
import struct
import math
import json

WAV_DIR = "/Users/alexandre/Downloads/PadLab-Web/_audio_backup_wav/pads"
LOOPS_JSON = "/Users/alexandre/Downloads/PadLab-Web/public/audio/pad-loops.json"

def get_rms(chunk):
    if not chunk: return 1e-6
    s_sq = sum(s * s for s in chunk)
    return math.sqrt(s_sq / len(chunk)) / 32768.0

def to_db(rms):
    return 20.0 * math.log10(max(rms, 1e-6))

def render_3_cycles(samples, n_channels, framerate, loop_start_s, loop_end_s, fade_s):
    start_frame = int(round(loop_start_s * framerate))
    end_frame = int(round(loop_end_s * framerate))
    fade_frames = int(round(fade_s * framerate))
    loop_len_frames = end_frame - start_frame

    effective_loop_frames = loop_len_frames - fade_frames
    if effective_loop_frames <= 0:
        return None, None

    attack = list(samples[:start_frame * n_channels])
    loop_samples = samples[start_frame * n_channels : end_frame * n_channels]

    seamless_loop = list(loop_samples[:effective_loop_frames * n_channels])
    
    for ch in range(n_channels):
        for f in range(fade_frames):
            t = f / fade_frames
            # Equal-power sine/cosine
            gain_in = math.sin((t * math.pi) / 2.0)
            gain_out = math.cos((t * math.pi) / 2.0)

            head_sample = loop_samples[(f * n_channels) + ch]
            tail_sample = loop_samples[((loop_len_frames - fade_frames + f) * n_channels) + ch]

            blended = int(round(head_sample * gain_in + tail_sample * gain_out))
            blended = max(-32768, min(32767, blended))
            seamless_loop[(f * n_channels) + ch] = blended

    out = list(attack)
    seam_sample_indices = []

    for cycle in range(3):
        seam_sample_indices.append(len(out) // n_channels)
        out.extend(seamless_loop)

    return out, seam_sample_indices

def evaluate_loop(samples, n_channels, framerate, loop_start_s, loop_end_s, fade_s):
    rendered, seam_indices = render_3_cycles(samples, n_channels, framerate, loop_start_s, loop_end_s, fade_s)
    if rendered is None:
        return 999.0, 999.0, False

    max_discontinuity = 0.0
    max_db_variation = 0.0
    win_frames = int(framerate * 0.1) # 100ms

    for seam in seam_indices[1:]:
        seam_sample = seam * n_channels
        
        # Check sample jump at exact seam point
        for ch in range(n_channels):
            if seam_sample + ch < len(rendered) and seam_sample - n_channels + ch >= 0:
                jump = abs(rendered[seam_sample + ch] - rendered[seam_sample - n_channels + ch]) / 32768.0
                if jump > max_discontinuity:
                    max_discontinuity = jump

        # Measure RMS variation across 100ms windows around the seam (-1.0s to +1.0s, 10 windows each side)
        check_wins = 10 # +- 1 second around seam
        seam_win = seam // win_frames
        
        win_rms_list = []
        for w_offset in range(-check_wins, check_wins):
            curr_w = seam_win + w_offset
            start_s = curr_w * win_frames * n_channels
            end_s = start_s + win_frames * n_channels
            if 0 <= start_s and end_s <= len(rendered):
                win_rms_list.append(get_rms(rendered[start_s:end_s]))

        if len(win_rms_list) >= 2:
            db_vals = [to_db(r) for r in win_rms_list]
            # Max delta between any window and the mean of the seam region
            mean_db = sum(db_vals) / len(db_vals)
            dev = max(abs(d - mean_db) for d in db_vals)
            if dev > max_db_variation:
                max_db_variation = dev

    passed = (max_db_variation <= 1.5) and (max_discontinuity <= 0.02)
    return max_db_variation, max_discontinuity, passed

def optimize_pad(filepath, preset_name):
    with wave.open(filepath, 'rb') as w:
        n_channels = w.getnchannels()
        framerate = w.getframerate()
        n_frames = w.getnframes()
        raw = w.readframes(n_frames)

    samples = struct.unpack(f"<{n_frames * n_channels}h", raw)
    duration = n_frames / framerate

    win_frames = int(framerate * 0.1)
    total_wins = n_frames // win_frames

    # Compute RMS profile
    rms_profile = []
    for i in range(total_wins):
        chunk = samples[i * win_frames * n_channels : (i + 1) * win_frames * n_channels]
        rms_profile.append(get_rms(chunk))

    # Detect attack swell end:
    # Look for when volume reaches plateau
    # Presets like dark_pad and warm_pad start high immediately
    # Presets like shimmer_2 and pad_shimmer have a swell of 3-7s
    mid_sustain = sum(rms_profile[total_wins//3 : 2*total_wins//3]) / (total_wins//3)
    
    # Min start window: swell must be over
    min_start_win = 10 # 1.0s
    for w in range(10, total_wins // 2):
        if rms_profile[w] >= mid_sustain * 0.85:
            min_start_win = w
            break

    # Search candidates
    best_params = None
    min_score = 999.0

    # Test candidate start times (around min_start_win)
    # Test candidate end times (near the end, e.g. duration - 5s to duration - 1s)
    # Test crossfade: 2.0s, 2.5s, 3.0s, 3.5s, 4.0s
    start_candidates = [min_start_win + i for i in range(0, min(30, total_wins//3), 2)]
    end_candidates = [total_wins - 5 - i for i in range(0, min(60, total_wins//3), 2)]

    for s_win in start_candidates:
        s_time = round(s_win * 0.1, 2)
        s_rms = rms_profile[s_win]

        for e_win in end_candidates:
            e_time = round(e_win * 0.1, 2)
            if e_time - s_time < 12.0: continue # Loop must be at least 12s
            e_rms = rms_profile[e_win]

            # Fast pre-filter: RMS at start and end should match well
            rms_diff_db = abs(to_db(e_rms) - to_db(s_rms))
            if rms_diff_db > 2.0: continue

            for fade in [2.5, 3.0, 3.5, 4.0]:
                var_db, disc, passed = evaluate_loop(samples, n_channels, framerate, s_time, e_time, fade)
                
                score = var_db + disc * 10
                if passed and score < min_score:
                    min_score = score
                    best_params = {
                        "duration": round(duration, 3),
                        "framerate": framerate,
                        "n_frames": n_frames,
                        "loopStart": s_time,
                        "loopEnd": e_time,
                        "crossfade": fade,
                        "dbVariation": round(var_db, 2),
                        "discontinuity": round(disc, 5)
                    }
                    if var_db <= 0.8 and disc <= 0.005:
                        # Excellent fit found, break inner
                        break
            if best_params and best_params["dbVariation"] <= 0.7:
                break
        if best_params and best_params["dbVariation"] <= 0.6:
            break

    # If no candidate passed strict initial search, broaden search
    if not best_params:
        for s_win in range(5, total_wins // 2, 2):
            s_time = round(s_win * 0.1, 2)
            for e_win in range(total_wins - 3, total_wins // 2, -2):
                e_time = round(e_win * 0.1, 2)
                if e_time - s_time < 10.0: continue
                for fade in [2.0, 3.0, 4.0]:
                    var_db, disc, passed = evaluate_loop(samples, n_channels, framerate, s_time, e_time, fade)
                    score = var_db + disc * 10
                    if score < min_score:
                        min_score = score
                        best_params = {
                            "duration": round(duration, 3),
                            "framerate": framerate,
                            "n_frames": n_frames,
                            "loopStart": s_time,
                            "loopEnd": e_time,
                            "crossfade": fade,
                            "dbVariation": round(var_db, 2),
                            "discontinuity": round(disc, 5)
                        }
                        if passed: break
                if best_params and best_params.get("dbVariation", 99) <= 1.2:
                    break
            if best_params and best_params.get("dbVariation", 99) <= 1.2:
                break

    return best_params

def main():
    presets = sorted(os.listdir(WAV_DIR))
    all_loops = {}
    total = 0
    passed = 0

    print("Iniciando otimização acurada de pontos de loop para os 96 pads...")

    for p in presets:
        p_path = os.path.join(WAV_DIR, p)
        if not os.path.isdir(p_path): continue
        all_loops[p] = {}

        files = sorted(f for f in os.listdir(p_path) if f.endswith('.wav'))
        for f in files:
            full_path = os.path.join(p_path, f)
            base = os.path.splitext(f)[0]
            params = optimize_pad(full_path, p)
            all_loops[p][base] = params
            total += 1
            is_ok = params["dbVariation"] <= 1.5 and params["discontinuity"] <= 0.02
            if is_ok: passed += 1
            print(f"[{total}/96] {p}/{base:15s} -> Loop: {params['loopStart']}s a {params['loopEnd']}s | Fade: {params['crossfade']}s | Δ dB: {params['dbVariation']} | Salto: {params['discontinuity']} {'✓' if is_ok else '✗'}")

    with open(LOOPS_JSON, 'w') as out:
        json.dump(all_loops, out, indent=2)

    print(f"\nConcluído! {passed}/{total} pads otimizados e gravados em {LOOPS_JSON}.")

if __name__ == "__main__":
    main()

