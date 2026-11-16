#!/bin/sh
# =============================================================================
# Gasto real do mês (Cost Management), por grupo de recursos e por serviço.
# Requer: az login. Os dados do Azure têm atraso de ~8 a 24 h.
# Saldo de créditos do Azure for Students: https://www.microsoftazuresponsorships.com/Balance
#
# Uso: sh infra/scripts/custos.sh
# =============================================================================
set -eu

ASSINATURA="$(az account show --query id -o tsv)"
URL="https://management.azure.com/subscriptions/${ASSINATURA}/providers/Microsoft.CostManagement/query?api-version=2023-11-01"

consulta() { # dimensão
  az rest --method post --url "$URL" --body "{
    \"type\": \"ActualCost\",
    \"timeframe\": \"MonthToDate\",
    \"dataset\": {
      \"granularity\": \"None\",
      \"aggregation\": { \"total\": { \"name\": \"Cost\", \"function\": \"Sum\" } },
      \"grouping\": [ { \"type\": \"Dimension\", \"name\": \"$1\" } ]
    }
  }" --query "properties.rows" -o tsv
}

echo "Gasto do mês até agora (assinatura ${ASSINATURA}):"
echo
echo "Por grupo de recursos:"
consulta ResourceGroupName | awk -F'\t' '{ printf "  %-36s %10.4f %s\n", $2, $1, $3; total += $1 } END { printf "  %-36s %10.4f\n", "TOTAL", total }'
echo
echo "Por serviço:"
consulta ServiceName | awk -F'\t' '{ printf "  %-36s %10.4f %s\n", $2, $1, $3 }'
