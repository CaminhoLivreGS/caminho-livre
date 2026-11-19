#!/bin/sh
# Gera docs/entrega/Caminho-Livre-Relatorio.pdf a partir de relatorio.html
# (Google Chrome headless), com o mesmo estilo (estilos.css) da Documentação
# Técnica de Visão Computacional. O diagrama vem de arquitetura.png; para atualizá-lo,
# edite arquitetura.mmd e renderize em https://mermaid.live (exportar PNG).
# Uso: sh docs/entrega/gerar-pdf.sh
set -eu
DIR="$(cd "$(dirname "$0")" && pwd)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PERFIL="$(mktemp -d)"
trap 'rm -rf "$PERFIL"' EXIT
"$CHROME" --headless=new --disable-gpu --no-first-run --user-data-dir="$PERFIL" \
  --no-pdf-header-footer --print-to-pdf="$DIR/Caminho-Livre-Relatorio.pdf" \
  "file://$DIR/relatorio.html" 2>/dev/null
echo "PDF gerado: $DIR/Caminho-Livre-Relatorio.pdf"
