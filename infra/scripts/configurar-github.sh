#!/bin/sh
# =============================================================================
# Cadastra no GitHub os Secrets e Variables que o pipeline usa, a partir dos
# outputs do Terraform. Requer: gh autenticado com acesso de admin ao repo.
#
# Uso: sh infra/scripts/configurar-github.sh [owner/repo]
# =============================================================================
set -eu

REPO="${1:-CaminhoLivreGS/caminho-livre}"
TF_DIR="$(cd "$(dirname "$0")/../terraform" && pwd)"

saida() { terraform -chdir="$TF_DIR" output -raw "$1"; }

# Secrets: identificadores da identidade OIDC (não há senha).
saida github_oidc_client_id | gh secret set AZURE_CLIENT_ID       --repo "$REPO" --env production
saida tenant_id             | gh secret set AZURE_TENANT_ID       --repo "$REPO" --env production
saida subscription_id       | gh secret set AZURE_SUBSCRIPTION_ID --repo "$REPO" --env production

# Variables: nomes de recursos (não são segredos).
gh variable set AZURE_ACR_NAME       --repo "$REPO" --body "$(saida acr_name)"
gh variable set AZURE_RESOURCE_GROUP --repo "$REPO" --body "$(saida resource_group)"
# Por último: é esta variável que habilita o job de deploy no pipeline.
gh variable set AZURE_WEBAPP_NAME    --repo "$REPO" --body "$(saida webapp_name)"

echo "Secrets (environment production) e variables cadastrados em $REPO."
echo "O próximo merge na main fará o deploy em: $(saida app_url)"
