#!/bin/sh
# Baixa as dependências binárias do módulo de visão (não versionadas no git):
#   public/opencv/opencv.js   OpenCV.js 4.9.0 (WASM embutido, ~10 MB)
#   public/cascades/*.xml     Haar Cascades oficiais do OpenCV 4.9.0 (LGPD)
# Cada arquivo é conferido por SHA-256; se não bater, é apagado e o script falha.
# Uso: sh scripts/baixar-dependencias.sh   (ou: npm run deps)
set -eu

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
CASCADES_URL="https://raw.githubusercontent.com/opencv/opencv/4.9.0/data/haarcascades"

# sha256sum (Linux/Alpine, usado no Docker) ou shasum (macOS).
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

baixar() { # destino url sha256
  destino="$RAIZ/$1"
  if [ -f "$destino" ] && [ "$(sha256 "$destino")" = "$3" ]; then
    echo "ok (já existe)  $1"
    return
  fi
  mkdir -p "$(dirname "$destino")"
  curl -fsSL -o "$destino" "$2"
  obtido="$(sha256 "$destino")"
  if [ "$obtido" != "$3" ]; then
    rm -f "$destino"
    echo "ERRO: checksum não confere para $1" >&2
    echo "  esperado $3" >&2
    echo "  obtido   $obtido" >&2
    exit 1
  fi
  echo "ok (baixado)    $1"
}

baixar public/opencv/opencv.js \
  https://docs.opencv.org/4.9.0/opencv.js \
  4d7b85e2e12ea0bd088f491c311d620a45b53d1489b7f065b4492a230bda243a
baixar public/cascades/haarcascade_frontalface_default.xml \
  "$CASCADES_URL/haarcascade_frontalface_default.xml" \
  0f7d4527844eb514d4a4948e822da90fbb16a34a0bbbbc6adc6498747a5aafb0
baixar public/cascades/haarcascade_frontalface_alt2.xml \
  "$CASCADES_URL/haarcascade_frontalface_alt2.xml" \
  7b0c967d9abbdfbde025eb9c786947d151b6426040d07a8f9562ed8fd90724b4
baixar public/cascades/haarcascade_profileface.xml \
  "$CASCADES_URL/haarcascade_profileface.xml" \
  b39a4a3be45539db146a7fc1d3e761a292c196eb88421185e6a615b3055e612d
baixar public/cascades/haarcascade_russian_plate_number.xml \
  "$CASCADES_URL/haarcascade_russian_plate_number.xml" \
  814cb5954682af570e58361f9e5f8b5b513a4112776bb9ecacef9f0e4ca6c2d7
