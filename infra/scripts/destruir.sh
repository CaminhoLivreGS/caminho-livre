#!/bin/sh
# =============================================================================
# Desliga a infraestrutura do Caminho Livre a partir da máquina local.
#
# Caminho principal: GitHub Actions > Infra (Terraform) > Run workflow >
# acao=destroy (com aprovação no environment "infra"). Use este script só como
# alternativa de emergência; requer az login e terraform.tfvars local.
#
#   1. apaga os recursos que o Application Insights cria sozinho (detecção
#      inteligente), que não estão no Terraform e travam a exclusão do RG;
#   2. terraform destroy (mostra o plano e pede confirmação).
#
# A fundação (tfstate e identidades do GitHub) não é afetada.
# Uso: sh infra/scripts/destruir.sh
# =============================================================================
set -eu

TF_DIR="$(cd "$(dirname "$0")/../terraform" && pwd)"
RG="$(terraform -chdir="$TF_DIR" output -raw resource_group)"

echo "1/2 Removendo recursos criados automaticamente pelo Application Insights em $RG..."
az resource list -g "$RG" \
  --query "[?type=='microsoft.alertsmanagement/smartDetectorAlertRules' || (type=='microsoft.insights/actiongroups' && name=='Application Insights Smart Detection')].id" \
  -o tsv | while IFS= read -r id; do
    [ -n "$id" ] || continue
    echo "    apagando ${id##*/}"
    az resource delete --ids "$id" --output none
  done

echo "2/2 terraform destroy (revise o plano antes de confirmar)..."
terraform -chdir="$TF_DIR" destroy

echo "Pronto. Confira o gasto com: sh infra/scripts/custos.sh"
