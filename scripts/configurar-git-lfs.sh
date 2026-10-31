#!/usr/bin/env bash
# Move os áudios do repositório para o Git LFS (o histórico atual tem ~95 MB de áudio).
#
# ATENÇÃO: o passo "migrate" REESCREVE O HISTÓRICO do Git. Rode antes do primeiro push para o GitHub,
# ou combine com quem mais usa o repositório. Confirme também que o serviço de deploy baixa arquivos LFS
# (no Railway/Render, sem LFS os áudios chegariam como ponteiros e o app ficaria mudo).
set -euo pipefail
cd "$(dirname "$0")/.."

if ! git lfs version >/dev/null 2>&1; then
  echo "Instale o Git LFS primeiro (no Mac: brew install git-lfs) e rode de novo."
  exit 1
fi

git lfs install
git lfs track "audio/**/*.m4a" "audio/**/*.flac" "audio/**/*.wav"
git add .gitattributes

read -r -p "Reescrever o histórico para mover os áudios antigos para o LFS? [s/N] " ok
if [[ "$ok" =~ ^[sS]$ ]]; then
  git lfs migrate import --include="audio/**/*.m4a,audio/**/*.flac,audio/**/*.wav" --everything
  echo "Histórico migrado. Tamanho agora:"
  git count-objects -vH | grep size-pack
else
  git commit -m "chore: áudios novos passam a ir para o Git LFS"
  echo "Só os próximos áudios irão para o LFS; o histórico antigo continua como está."
fi
