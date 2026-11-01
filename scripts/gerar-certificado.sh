#!/usr/bin/env bash
# Gera key.pem e cert.pem na raiz do projeto para o servidor local rodar em HTTPS.
# Com HTTPS, os celulares mantêm a tela acesa (Wake Lock), instalam o app e guardam os sons offline.
#
# Preferência: mkcert (certificado confiável depois de instalar a CA no celular).
# Sem mkcert: certificado autoassinado via openssl (o celular mostra um aviso uma vez).
set -euo pipefail
cd "$(dirname "$0")/.."

IPS=$(node -e "const os=require('os');console.log(Object.values(os.networkInterfaces()).flat().filter(i=>i&&i.family==='IPv4'&&!i.internal).map(i=>i.address).join(' '))")
echo "IPs desta máquina: ${IPS:-nenhum}"

if command -v mkcert >/dev/null 2>&1; then
  mkcert -install
  # shellcheck disable=SC2086
  mkcert -key-file key.pem -cert-file cert.pem localhost 127.0.0.1 $IPS
  echo
  echo "Pronto. Para o iPhone/Android confiarem no certificado, instale neles a CA do mkcert:"
  echo "  $(mkcert -CAROOT)/rootCA.pem"
else
  echo "mkcert não encontrado (no Mac: brew install mkcert). Gerando certificado autoassinado com openssl…"
  SAN="DNS:localhost,IP:127.0.0.1"
  for ip in $IPS; do SAN="$SAN,IP:$ip"; done
  openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 825 \
    -keyout key.pem -out cert.pem -subj "/CN=Sus Pad" -addext "subjectAltName=$SAN"
  echo
  echo "Pronto. Na primeira vez, cada celular vai mostrar um aviso de segurança: toque em 'Avançado' e continue."
fi
echo "Reinicie o servidor (npm start): ele detecta key.pem e cert.pem e sobe em https://"
