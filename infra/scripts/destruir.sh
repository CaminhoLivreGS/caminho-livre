#!/bin/sh
# =============================================================================
# Desliga a infraestrutura do Caminho Livre para zerar o gasto no Azure.
# Mantém só o Storage do tfstate (< US$ 0,01/mês), para recriar tudo depois.
#
#   1. remove a variável AZURE_WEBAPP_NAME (o deploy passa a ser "skipped");
#   2. apaga os recursos que o Application Insights cria sozinho (detecção
#      inteligente), que não estão no Terraform e travam a exclusão do RG;
#   3. terraform destroy (mostra o plano e pede confirmação).
#
# Recriar: terraform apply + sh infra/scripts/configurar-github.sh
# Uso: sh infra/scripts/destruir.sh [owner/repo]
# =============================================================================
set -eu

REPO="${1:-CaminhoLivreGS/caminho-livre}"
TF_DIR="$(cd "$(dirname "$0")/../terraform" && pwd)"
RG="$(terraform -chdir="$TF_DIR" output -raw resource_group)"

echo "1/3 Desativando o deploy no GitHub ($REPO)..."
gh variable delete AZURE_WEBAPP_NAME --repo "$REPO" 2>/dev/null || echo "    (variável já ausente)"

echo "2/3 Removendo recursos criados automaticamente pelo Application Insights em $RG..."
az resource list -g "$RG" \
  --query "[?type=='microsoft.alertsmanagement/smartDetectorAlertRules' || (type=='microsoft.insights/actiongroups' && name=='Application Insights Smart Detection')].id" \
  -o tsv | while IFS= read -r id; do
    [ -n "$id" ] || continue
    echo "    apagando ${id##*/}"
    az resource delete --ids "$id" --output none
  done

echo "3/3 terraform destroy (revise o plano antes de confirmar)..."
terraform -chdir="$TF_DIR" destroy

echo "Pronto. Confira o gasto com: sh infra/scripts/custos.sh"
