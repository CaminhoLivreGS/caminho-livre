#!/bin/sh
# =============================================================================
# Configura o GitHub para o pipeline (executar depois de infra/bootstrap/fundacao.sh).
# Requer: az login (Owner) e gh autenticado com admin no repositório.
#
#   Environments:
#     production  deploy da aplicação; só branches protegidas (main)
#     infra-plan  terraform plan (somente leitura)
#     infra       terraform apply/destroy; só a main E aprovação de um revisor
#   Secrets do repositório: AZURE_TENANT_ID, AZURE_SUBSCRIPTION_ID, ALERT_EMAIL
#   Secret AZURE_CLIENT_ID em cada environment (identidade correspondente)
#   Variables: TFSTATE_RESOURCE_GROUP, TFSTATE_STORAGE_ACCOUNT,
#              AZURE_DEPLOY_PRINCIPAL_ID, AZURE_PLAN_PRINCIPAL_ID, AZURE_APPLY_PRINCIPAL_ID
#
# Uso: EMAIL_ALERTA=voce@exemplo.com sh infra/scripts/configurar-github.sh [owner/repo]
# =============================================================================
set -eu

REPO="${1:-CaminhoLivreGS/caminho-livre}"
: "${EMAIL_ALERTA:?defina EMAIL_ALERTA (e-mail que recebe os alertas do Azure)}"
RG="rg-caminholivre-tfstate"

TENANT="$(az account show --query tenantId -o tsv)"
ASSINATURA="$(az account show --query id -o tsv)"
CONTA="$(az storage account list -g "$RG" --query "[?tags.finalidade=='terraform-state'].name | [0]" -o tsv)"
cliente() { az identity show -g "$RG" -n "$1" --query clientId -o tsv; }
principal() { az identity show -g "$RG" -n "$1" --query principalId -o tsv; }
REVISOR_ID="$(gh api user --jq .id)"

echo "1/3 Environments"
gh api -X PUT "repos/$REPO/environments/production" --silent --input - <<EOF
{ "deployment_branch_policy": { "protected_branches": true, "custom_branch_policies": false } }
EOF
gh api -X PUT "repos/$REPO/environments/infra-plan" --silent --input - <<EOF
{ "deployment_branch_policy": null }
EOF
gh api -X PUT "repos/$REPO/environments/infra" --silent --input - <<EOF
{
  "reviewers": [ { "type": "User", "id": $REVISOR_ID } ],
  "deployment_branch_policy": { "protected_branches": true, "custom_branch_policies": false }
}
EOF

echo "2/3 Secrets"
printf '%s' "$TENANT"       | gh secret set AZURE_TENANT_ID       --repo "$REPO"
printf '%s' "$ASSINATURA"   | gh secret set AZURE_SUBSCRIPTION_ID --repo "$REPO"
printf '%s' "$EMAIL_ALERTA" | gh secret set ALERT_EMAIL           --repo "$REPO"
cliente id-caminholivre-github-deploy | gh secret set AZURE_CLIENT_ID --repo "$REPO" --env production
cliente id-caminholivre-github-plan   | gh secret set AZURE_CLIENT_ID --repo "$REPO" --env infra-plan
cliente id-caminholivre-github-apply  | gh secret set AZURE_CLIENT_ID --repo "$REPO" --env infra
# Versões antigas: tenant/assinatura agora são secrets do repositório.
for s in AZURE_TENANT_ID AZURE_SUBSCRIPTION_ID; do
  gh secret delete "$s" --repo "$REPO" --env production 2>/dev/null || true
done

echo "3/3 Variables (não são segredos)"
gh variable set TFSTATE_RESOURCE_GROUP    --repo "$REPO" --body "$RG"
gh variable set TFSTATE_STORAGE_ACCOUNT   --repo "$REPO" --body "$CONTA"
gh variable set AZURE_DEPLOY_PRINCIPAL_ID --repo "$REPO" --body "$(principal id-caminholivre-github-deploy)"
gh variable set AZURE_PLAN_PRINCIPAL_ID   --repo "$REPO" --body "$(principal id-caminholivre-github-plan)"
gh variable set AZURE_APPLY_PRINCIPAL_ID  --repo "$REPO" --body "$(principal id-caminholivre-github-apply)"
# Versões antigas: o deploy agora localiza o ACR e o Web App pela tag do projeto.
for v in AZURE_ACR_NAME AZURE_RESOURCE_GROUP AZURE_WEBAPP_NAME; do
  gh variable delete "$v" --repo "$REPO" 2>/dev/null || true
done

echo "GitHub configurado em $REPO."
echo "Ligar a infra: Actions > Infra (Terraform) > Run workflow > acao=apply (aprovação no environment infra)."
