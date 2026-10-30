#!/usr/bin/env python3
"""
Analyzes loop continuity and codec priming for all 96 pads.
Compares decoded M4A audio against original WAVs in _audio_backup_wav/pads.
"""

import os
import subprocess
import struct
import json

WAV_DIR = "/Users/alexandre/Downloads/PadLab-Web/_audio_backup_wav/pads"
M4A_DIR = "/Users/alexandre/Downloads/PadLab-Web/audio/pads"
FFMPEG = "/Users/alexandre/.local/bin/ffmpeg"

def decode_pcm16(file_path):
    cmd = [
        FFMPEG, "-v", "error",
        "-i", file_path,
        "-f", "s16le",
        "-acodec", "pcm_s16le",
        "-"
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    raw, _ = proc.communicate()
    samples = struct.unpack(f"<{len(raw)//2}h", raw)
    return samples

def main():
    presets = sorted(os.listdir(M4A_DIR))
    report = []
    
    total_files = 0
    priming_count = 0
    large_step_count = 0

    print("Iniciando análise dos 96 arquivos de pads...")

    for preset in presets:
        preset_m4a = os.path.join(M4A_DIR, preset)
        preset_wav = os.path.join(WAV_DIR, preset)
        if not os.path.isdir(preset_m4a):
            continue

        for fname in sorted(os.listdir(preset_m4a)):
            if not fname.endswith(".m4a"):
                continue

            base = os.path.splitext(fname)[0]
            m4a_file = os.path.join(preset_m4a, fname)
            wav_file = os.path.join(preset_wav, base + ".wav")

            if not os.path.exists(wav_file):
                print(f"[AVISO] WAV original não encontrado para {preset}/{fname}")
                continue

            total_files += 1
            wav_s = decode_pcm16(wav_file)
            m4a_s = decode_pcm16(m4a_file)

            # Assumes stereo (2 channels)
            wav_frames = len(wav_s) // 2
            m4a_frames = len(m4a_s) // 2

            frame_diff = m4a_frames - wav_frames
            dur_wav = wav_frames / 44100.0
            dur_m4a = m4a_frames / 44100.0

            # Seam amplitude jump (Left channel)
            wav_seam_jump = abs(wav_s[-2] - wav_s[0]) / 32768.0
            m4a_seam_jump = abs(m4a_s[-2] - m4a_s[0]) / 32768.0

            # Right channel
            wav_seam_jump_r = abs(wav_s[-1] - wav_s[1]) / 32768.0
            m4a_seam_jump_r = abs(m4a_s[-1] - m4a_s[1]) / 32768.0

            max_m4a_jump = max(m4a_seam_jump, m4a_seam_jump_r)
            max_wav_jump = max(wav_seam_jump, wav_seam_jump_r)

            if frame_diff != 0:
                priming_count += 1
            if max_m4a_jump > 0.05:
                large_step_count += 1

            report.append({
                "preset": preset,
                "file": fname,
                "wav_frames": wav_frames,
                "m4a_frames": m4a_frames,
                "frame_diff": frame_diff,
                "dur_wav_s": round(dur_wav, 4),
                "dur_m4a_s": round(dur_m4a, 4),
                "wav_seam_jump": round(max_wav_jump, 4),
                "m4a_seam_jump": round(max_m4a_jump, 4),
                "jump_diff": round(max_m4a_jump - max_wav_jump, 4)
            })

    output_path = "/Users/alexandre/Downloads/PadLab-Web/scripts/loop-analysis.json"
    with open(output_path, "w") as f:
        json.dump(report, f, indent=2)

    print(f"\n========================================================")
    print(f"  RELATÓRIO DE ANÁLISE DE LOOP (AAC / M4A vs WAV)")
    print(f"========================================================")
    print(f"Total de arquivos analisados: {total_files}")
    print(f"Arquivos com priming/diferença de frames: {priming_count}/{total_files}")
    print(f"Arquivos com salto de amplitude > 0.05 na emenda: {large_step_count}/{total_files}")

    # Amostra de diferenças de frames
    diffs = set(r["frame_diff"] for r in report)
    print(f"Padrões de deslocamento de frames (M4A - WAV): {sorted(list(diffs))}")

    # Top 5 maiores saltos no M4A
    report.sort(key=lambda x: x["m4a_seam_jump"], reverse=True)
    print("\nTop 5 maiores descontinuidades no M4A:")
    for r in report[:5]:
        print(f"  • {r['preset']}/{r['file']}: salto={r['m4a_seam_jump']} (WAV original={r['wav_seam_jump']}), diff frames={r['frame_diff']}")

if __name__ == "__main__":
    main()

