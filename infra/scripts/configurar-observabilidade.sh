#!/bin/sh
# =============================================================================
# Aponta as sondas do Prometheus local para a URL pública do Azure, a partir
# do output app_url do Terraform. O Prometheus relê o arquivo em até 1 minuto.
#
# Uso: sh infra/scripts/configurar-observabilidade.sh
# =============================================================================
set -eu

RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
URL="$(terraform -chdir="$RAIZ/infra/terraform" output -raw app_url)"
DESTINO="$RAIZ/observability/prometheus/alvos/azure.yml"

case "$URL" in
  https://*.azurewebsites.net) ;;
  *) echo "ERRO: app_url inesperada: $URL" >&2; exit 1 ;;
esac

cat > "$DESTINO" <<EOF
# Gerado por infra/scripts/configurar-observabilidade.sh (não versionado).
- targets:
    - ${URL}/healthz
    - ${URL}/
  labels:
    ambiente: azure
EOF

echo "Sondas do Azure configuradas: ${URL}"
echo "Dashboard: http://127.0.0.1:3000 | Alertas: http://127.0.0.1:9090/alerts"
