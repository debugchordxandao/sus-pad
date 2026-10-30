#!/usr/bin/env python3
"""
Validates loop seamlessness across 3 offline cycles for all 96 pads.
Criteria:
- Volume variation (RMS in 100ms windows around each seam) <= 1.5 dB.
- Waveform sample discontinuity <= 0.02.
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
    start_frame = int(loop_start_s * framerate)
    end_frame = int(loop_end_s * framerate)
    fade_frames = int(fade_s * framerate)
    loop_len_frames = end_frame - start_frame

    # 1. Attack portion: [0, start_frame]
    attack = list(samples[:start_frame * n_channels])

    # 2. Sustain loop body: [start_frame, end_frame]
    # To make it seamless: the last fade_frames of the loop crossfades back into the first fade_frames
    # Pre-rendered seamless loop buffer of length: loop_len_frames - fade_frames
    effective_loop_frames = loop_len_frames - fade_frames
    if effective_loop_frames <= 0:
        raise ValueError("Loop duration is too short for the crossfade")

    # Let's construct a continuous 3-cycle output stream directly:
    # Cycle 1: attack + sustain segment 1
    # Cycle 2: crossfaded transition + sustain segment 2
    # Cycle 3: crossfaded transition + sustain segment 3
    
    # We will build the 3-cycle audio buffer:
    out = list(attack)
    seam_sample_indices = []

    # Let loop_segment be samples[start_frame:end_frame]
    loop_samples = samples[start_frame * n_channels : end_frame * n_channels]

    # Pre-render seamless loop buffer:
    # Length = effective_loop_frames
    # It consists of loop_samples from 0 to effective_loop_frames,
    # where the first fade_frames is blended with the tail (the last fade_frames of loop_samples)
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
            # Clamp to 16-bit
            blended = max(-32768, min(32767, blended))
            seamless_loop[(f * n_channels) + ch] = blended

    # Now play 3 full cycles of seamless_loop:
    for cycle in range(3):
        seam_sample_indices.append(len(out) // n_channels)
        out.extend(seamless_loop)

    return out, seam_sample_indices

def test_pad(filepath, loop_info):
    with wave.open(filepath, 'rb') as w:
        n_channels = w.getnchannels()
        framerate = w.getframerate()
        n_frames = w.getnframes()
        raw = w.readframes(n_frames)

    samples = struct.unpack(f"<{n_frames * n_channels}h", raw)

    loop_start_s = loop_info["loopStart"]
    loop_end_s = loop_info["loopEnd"]
    fade_s = loop_info.get("crossfade", 3.0)

    rendered, seam_indices = render_3_cycles(
        samples, n_channels, framerate, loop_start_s, loop_end_s, fade_s
    )

    # Validate seams:
    # For each seam (between cycle 1-2 and cycle 2-3):
    # Check 1: Sample discontinuity at seam boundary (sample right before vs sample right after)
    # Check 2: Max RMS variation in 100ms windows across the seam region (+- 2.0s around seam)
    
    max_discontinuity = 0.0
    max_db_variation = 0.0

    win_frames = int(framerate * 0.1) # 100ms

    for seam in seam_indices[1:]: # Seams between cycles
        seam_sample = seam * n_channels
        
        # Check sample jump at exact seam point
        for ch in range(n_channels):
            if seam_sample + ch < len(rendered) and seam_sample - n_channels + ch >= 0:
                jump = abs(rendered[seam_sample + ch] - rendered[seam_sample - n_channels + ch]) / 32768.0
                if jump > max_discontinuity:
                    max_discontinuity = jump

        # Check RMS variation around seam (+- 2 seconds, i.e., 20 windows before and 20 windows after)
        check_range_wins = 20 # 2.0s
        seam_win = seam // win_frames
        
        win_rms_list = []
        for w_offset in range(-check_range_wins, check_range_wins):
            curr_w = seam_win + w_offset
            start_s = curr_w * win_frames * n_channels
            end_s = start_s + win_frames * n_channels
            if 0 <= start_s and end_s <= len(rendered):
                win_rms_list.append(get_rms(rendered[start_s:end_s]))

        if win_rms_list:
            db_vals = [to_db(r) for r in win_rms_list]
            mean_db = sum(db_vals) / len(db_vals)
            max_dev = max(abs(d - mean_db) for d in db_vals)
            if max_dev > max_db_variation:
                max_db_variation = max_dev

    return {
        "max_discontinuity": round(max_discontinuity, 5),
        "max_db_variation": round(max_db_variation, 2),
        "passed": (max_db_variation <= 1.5) and (max_discontinuity <= 0.02)
    }

def main():
    with open(LOOPS_JSON, 'r') as f:
        loop_data = json.load(f)

    presets = sorted(loop_data.keys())
    total = 0
    passed_count = 0
    failed_pads = []

    print("\n=======================================================================================")
    print("         🔬 VALIDAÇÃO OBJETIVA DE LOOPS (3 VOLTAS OFFLINE - 96 PADS)")
    print("  Critérios de Aprovação: Variação RMS <= 1.5 dB  |  Descontinuidade <= 0.02")
    print("=======================================================================================")
    print("Preset / Nota               | LoopStart | LoopEnd | Fade(s) | Δ dB Max | Salto Max | Status")
    print("----------------------------|-----------|---------|---------|----------|-----------|-------")

    for p in presets:
        p_data = loop_data[p]
        for base_name, info in sorted(p_data.items()):
            total += 1
            wav_file = os.path.join(WAV_DIR, p, base_name + ".wav")
            res = test_pad(wav_file, info)
            
            status_str = "APROVADO" if res["passed"] else "REPROVADO"
            if res["passed"]:
                passed_count += 1
            else:
                failed_pads.append((p, base_name, res))

            pad_label = f"{p[:13]}/{base_name[:12]}".ljust(27)
            l_start = f"{info['loopStart']:.1f}s".rjust(9)
            l_end = f"{info['loopEnd']:.1f}s".rjust(7)
            fade = f"{info.get('crossfade', 3.0):.1f}s".rjust(7)
            db_var = f"{res['max_db_variation']:.2f} dB".rjust(8)
            disc = f"{res['max_discontinuity']:.4f}".rjust(9)

            print(f"{pad_label} | {l_start} | {l_end} | {fade} | {db_var} | {disc} | {status_str}")

    print("=======================================================================================")
    print(f"Resultado Final: {passed_count}/{total} pads aprovados.")
    if failed_pads:
        print(f"Pads que falharam ({len(failed_pads)}):")
        for p, b, r in failed_pads:
            print(f"  • {p}/{b}: Δ dB = {r['max_db_variation']}, Salto = {r['max_discontinuity']}")
    print("=======================================================================================\n")

if __name__ == "__main__":
    main()

