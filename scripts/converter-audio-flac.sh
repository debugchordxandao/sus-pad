#!/usr/bin/env bash
# Converte os WAV de bateria e clicks para FLAC (sem perda) e confere amostra a amostra.
# Usado em 2026-10: 48 arquivos, 43 MB → 13 MB, PCM idêntico.
# Por que FLAC e não M4A: o AAC adiciona ~20–40 ms de silêncio no início de cada som,
# o que atrasaria cada batida de bateria. O FLAC não tem esse atraso.
set -euo pipefail
cd "$(dirname "$0")/.."
for f in $(find audio -name "*.wav"); do
  out="${f%.wav}.flac"
  ffmpeg -nostdin -hide_banner -loglevel error -y -i "$f" -c:a flac -compression_level 8 "$out"
  a=$(ffmpeg -nostdin -loglevel error -i "$f" -f md5 -)
  b=$(ffmpeg -nostdin -loglevel error -i "$out" -f md5 -)
  [ "$a" = "$b" ] || { echo "DIFERENÇA em $f"; exit 1; }
  dest="_audio_backup_wav/${f#audio/}"
  mkdir -p "$(dirname "$dest")"
  mv "$f" "$dest"
  echo "ok $out"
done
