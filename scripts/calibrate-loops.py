#!/usr/bin/env python3
"""
Precision loop builder and validator for all 96 pads.
Finds loopStart (after attack swell) and loopEnd such that:
1. Attack plays once.
2. Loop region has equal-power crossfade (2 to 4s).
3. 3-cycle offline render has RMS variation <= 1.5 dB across 100ms windows around the seam.
4. Waveform discontinuity at seam <= 0.02.
Compensates M4A priming frames.
"""

import os
import wave
import struct
import math
import json

WAV_DIR = "/Users/alexandre/Downloads/PadLab-Web/_audio_backup_wav/pads"
M4A_DIR = "/Users/alexandre/Downloads/PadLab-Web/audio/pads"
LOOPS_JSON = "/Users/alexandre/Downloads/PadLab-Web/public/audio/pad-loops.json"

def get_rms(chunk):
    if not chunk: return 1e-6
    s_sq = sum(s * s for s in chunk)
    return math.sqrt(s_sq / len(chunk)) / 32768.0

def to_db(rms):
    return 20.0 * math.log10(max(rms, 1e-6))

def render_seamless_loop(samples, n_channels, framerate, loop_start_s, loop_end_s, fade_s):
    start_f = int(round(loop_start_s * framerate))
    end_f = int(round(loop_end_s * framerate))
    fade_f = int(round(fade_s * framerate))
    loop_len = end_f - start_f

    effective_len = loop_len - fade_f
    if effective_len <= 0:
        return None, None

    attack = list(samples[:start_f * n_channels])
    loop_raw = samples[start_f * n_channels : end_f * n_channels]

    # Equal power crossfade between the tail of the loop and the head
    seamless_unit = list(loop_raw[:effective_len * n_channels])

    for ch in range(n_channels):
        for f in range(fade_f):
            t = f / float(fade_f)
            gain_in = math.sin(t * (math.pi / 2.0))
            gain_out = math.cos(t * (math.pi / 2.0))

            head = loop_raw[f * n_channels + ch]
            tail = loop_raw[(loop_len - fade_f + f) * n_channels + ch]

            blended = int(round(head * gain_in + tail * gain_out))
            blended = max(-32768, min(32767, blended))
            seamless_unit[f * n_channels + ch] = blended

    # Assemble 3 cycles: Attack + Loop 1 + Loop 2 + Loop 3
    out = list(attack)
    seams = []

    for c in range(3):
        seams.append(len(out) // n_channels)
        out.extend(seamless_unit)

    return out, seams

def evaluate_seam_windows(rendered, seams, framerate, n_channels):
    """
    Measures 100ms window RMS variation around each seam (+- 1.0s) and max sample jump.
    """
    win_f = int(framerate * 0.1) # 100ms
    max_disc = 0.0
    max_db_var = 0.0

    for seam in seams[1:]: # Seams between loop cycles
        seam_idx = seam * n_channels
        
        # 1. Sample jump at seam
        for ch in range(n_channels):
            if seam_idx + ch < len(rendered) and seam_idx - n_channels + ch >= 0:
                jump = abs(rendered[seam_idx + ch] - rendered[seam_idx - n_channels + ch]) / 32768.0
                if jump > max_disc:
                    max_disc = jump

        # 2. RMS across 100ms windows around seam (+- 1s = 10 windows before, 10 after)
        seam_win = seam // win_f
        window_rms = []
        for w in range(-10, 10):
            w_start = (seam_win + w) * win_f * n_channels
            w_end = w_start + win_f * n_channels
            if 0 <= w_start and w_end <= len(rendered):
                window_rms.append(get_rms(rendered[w_start:w_end]))

        if len(window_rms) >= 4:
            # Measure peak variation within the seam transition area
            db_vals = [to_db(r) for r in window_rms]
            median_db = sorted(db_vals)[len(db_vals)//2]
            var = max(abs(d - median_db) for d in db_vals)
            if var > max_db_var:
                max_db_var = var

    return max_db_var, max_disc

def find_best_loop_for_pad(filepath):
    with wave.open(filepath, 'rb') as w:
        n_channels = w.getnchannels()
        framerate = w.getframerate()
        n_frames = w.getnframes()
        raw = w.readframes(n_frames)

    samples = struct.unpack(f"<{n_frames * n_channels}h", raw)
    duration = n_frames / float(framerate)

    win_f = int(framerate * 0.1)
    n_wins = n_frames // win_f

    # 100ms RMS profile
    profile = []
    for i in range(n_wins):
        chunk = samples[i * win_f * n_channels : (i + 1) * win_f * n_channels]
        profile.append(get_rms(chunk))

    # Identify swell end: find when volume reaches steady state
    # Take median of middle 50% as reference sustain level
    mid_sustain = sorted(profile[n_wins//4 : 3*n_wins//4])[len(profile[n_wins//4 : 3*n_wins//4])//2]

    # Swell end is when profile reaches 80% of mid_sustain
    swell_win = 10 # at least 1.0s
    for i in range(5, n_wins // 2):
        if profile[i] >= mid_sustain * 0.80:
            if all(profile[i+k] >= mid_sustain * 0.70 for k in range(5)):
                swell_win = i
                break

    best_res = None
    min_cost = 999.0

    # Search window candidates for start (after swell)
    start_candidates = [swell_win + o for o in range(0, min(40, n_wins // 3), 2)]
    # Search window candidates for end (near end of file, but before any final fade)
    end_candidates = [n_wins - 5 - o for o in range(0, min(50, n_wins // 3), 2)]

    for s_w in start_candidates:
        s_sec = round(s_w * 0.1, 3)
        s_rms = profile[s_w]

        for e_w in end_candidates:
            e_sec = round(e_w * 0.1, 3)
            if e_sec - s_sec < 14.0: continue # Loop must be at least 14 seconds
            e_rms = profile[e_w]

            # RMS match pre-filter
            diff_db = abs(to_db(e_rms) - to_db(s_rms))
            if diff_db > 1.5: continue

            for fade in [2.5, 3.0, 3.5, 4.0]:
                rendered, seams = render_seamless_loop(samples, n_channels, framerate, s_sec, e_sec, fade)
                if rendered is None: continue

                db_var, disc = evaluate_seam_windows(rendered, seams, framerate, n_channels)
                
                cost = db_var + disc * 20.0
                if db_var <= 1.5 and disc <= 0.02 and cost < min_cost:
                    min_cost = cost
                    best_res = {
                        "loopStart": s_sec,
                        "loopEnd": e_sec,
                        "crossfade": fade,
                        "dbVariation": round(db_var, 2),
                        "discontinuity": round(disc, 5),
                        "duration": round(duration, 3),
                        "framerate": framerate,
                        "n_frames": n_frames
                    }
                    if db_var <= 0.6 and disc <= 0.005:
                        break
            if best_res and best_res["dbVariation"] <= 0.5:
                break
        if best_res and best_res["dbVariation"] <= 0.5:
            break

    # If strict search didn't find <= 1.5 dB, scan with fine-grained step
    if not best_res:
        for s_w in range(swell_win, n_wins // 2):
            s_sec = round(s_w * 0.1, 3)
            for e_w in range(n_wins - 3, s_w + 120, -1):
                e_sec = round(e_w * 0.1, 3)
                for fade in [2.0, 2.5, 3.0, 3.5, 4.0]:
                    rendered, seams = render_seamless_loop(samples, n_channels, framerate, s_sec, e_sec, fade)
                    if not rendered: continue
                    db_var, disc = evaluate_seam_windows(rendered, seams, framerate, n_channels)
                    cost = db_var + disc * 20.0
                    if cost < min_cost:
                        min_cost = cost
                        best_res = {
                            "loopStart": s_sec,
                            "loopEnd": e_sec,
                            "crossfade": fade,
                            "dbVariation": round(db_var, 2),
                            "discontinuity": round(disc, 5),
                            "duration": round(duration, 3),
                            "framerate": framerate,
                            "n_frames": n_frames
                        }
                        if db_var <= 1.5 and disc <= 0.02:
                            break
                if best_res and best_res["dbVariation"] <= 1.4:
                    break
            if best_res and best_res["dbVariation"] <= 1.4:
                break

    return best_res

def main():
    presets = sorted(os.listdir(WAV_DIR))
    loop_database = {}
    total = 0
    passed = 0
    failures = []

    print("\n=======================================================================================")
    print("      🎯 PROCESSANDO CALIBRAÇÃO E VALIDAÇÃO DOS 96 PADS (CRITÉRIO <= 1.5 dB)")
    print("=======================================================================================")
    print("Pad                         | LoopStart | LoopEnd | Fade(s) | Δ dB Seam | Salto Max | Status")
    print("----------------------------|-----------|---------|---------|-----------|-----------|-------")

    for p in presets:
        p_path = os.path.join(WAV_DIR, p)
        if not os.path.isdir(p_path): continue
        loop_database[p] = {}

        files = sorted(f for f in os.listdir(p_path) if f.endswith('.wav'))
        for f in files:
            full_path = os.path.join(p_path, f)
            base = os.path.splitext(f)[0]
            res = find_best_loop_for_pad(full_path)
            
            # Compensate M4A priming
            # 688 or 494 frames typically = ~0.015s
            res["m4aPrimingSec"] = 0.0156
            res["m4aLoopStart"] = round(res["loopStart"] + 0.0156, 3)
            res["m4aLoopEnd"] = round(res["loopEnd"] + 0.0156, 3)

            loop_database[p][base] = res
            total += 1

            is_ok = (res["dbVariation"] <= 1.5) and (res["discontinuity"] <= 0.02)
            if is_ok:
                passed += 1
            else:
                failures.append((p, base, res))

            pad_label = f"{p[:13]}/{base[:12]}".ljust(27)
            l_s = f"{res['loopStart']:.1f}s".rjust(9)
            l_e = f"{res['loopEnd']:.1f}s".rjust(7)
            fade = f"{res['crossfade']:.1f}s".rjust(7)
            db_s = f"{res['dbVariation']:.2f} dB".rjust(9)
            disc_s = f"{res['discontinuity']:.4f}".rjust(9)
            st_s = "APROVADO" if is_ok else "REPROVADO"

            print(f"{pad_label} | {l_s} | {l_e} | {fade} | {db_s} | {disc_s} | {st_s}")

    os.makedirs(os.path.dirname(LOOPS_JSON), exist_ok=True)
    with open(LOOPS_JSON, 'w') as out:
        json.dump(loop_database, out, indent=2)

    print("=======================================================================================")
    print(f"Resultado Consolidado: {passed}/{total} pads APROVADOS nos critérios rígidos.")
    if failures:
        print(f"Falhas ({len(failures)}):")
        for p, b, r in failures:
            print(f"  • {p}/{b}: Δ dB = {r['dbVariation']}, Salto = {r['discontinuity']}")
    print(f"Configurações gravadas com sucesso em: {LOOPS_JSON}\n")

if __name__ == "__main__":
    main()

