#!/bin/sh
# =============================================================================
# Fundação do Caminho Livre (executar uma vez, com um usuário Owner).
#
# Cria, no resource group rg-caminholivre-tfstate (nunca destruído):
#   1. Storage Account do tfstate: autenticação só por Entra ID (chaves
#      desligadas), TLS 1.2+, sem acesso público, versionamento e soft delete.
#   2. As 3 identidades do GitHub Actions, com credencial federada OIDC (sem
#      senha) presa aos IDs imutáveis do repositório e a um environment:
#        id-caminholivre-github-deploy  environment "production"
#        id-caminholivre-github-plan    environment "infra-plan"
#        id-caminholivre-github-apply   environment "infra" (aprovação manual)
#   3. Os papéis de assinatura/fundação de cada identidade (os papéis com
#      escopo nos recursos do app ficam no Terraform principal).
#   4. Locks: CanNotDelete no resource group e ReadOnly em cada identidade.
#      A identidade de apply tem Contributor, que não remove locks; assim ela
#      não consegue apagar o tfstate nem adicionar credenciais federadas às
#      identidades (escalada de privilégio).
# Ao final, grava infra/terraform/backend.hcl (ignorado pelo git).
#
# Uso: az login && sh infra/bootstrap/fundacao.sh [owner/repo] [regiao]
# Depois: sh infra/scripts/configurar-github.sh
# =============================================================================
set -eu

REPO="${1:-CaminhoLivreGS/caminho-livre}"
REGIAO="${2:-eastus}"   # regiões permitidas pela política da assinatura
RG="rg-caminholivre-tfstate"
CONTAINER="tfstate"
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"

ASSINATURA="$(az account show --query id -o tsv)"
ESCOPO_ASSINATURA="/subscriptions/${ASSINATURA}"
USUARIO="$(az ad signed-in-user show --query id -o tsv)"
# Nome globalmente único e estável por assinatura (3-24 caracteres, minúsculos).
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | cut -d' ' -f1
  else shasum -a 256 | cut -d' ' -f1; fi
}
SUFIXO="$(printf '%s' "$ASSINATURA" | sha256 | cut -c1-8)"
CONTA="stcltfstate${SUFIXO}"

# Subject OIDC com IDs imutáveis: repo:OWNER@ID/REPO@ID:environment:ENV.
# Um repositório recriado com o mesmo nome tem outro ID e não herda o acesso.
DONO="${REPO%/*}"; NOME="${REPO#*/}"
DONO_ID="$(gh api "repos/${REPO}" --jq .owner.id)"
REPO_ID="$(gh api "repos/${REPO}" --jq .id)"
PREFIXO_SUB="repo:${DONO}@${DONO_ID}/${NOME}@${REPO_ID}"

echo "Assinatura: $ASSINATURA | Região: $REGIAO | Storage: $CONTA | RG: $RG"
echo "Repositório: $REPO ($PREFIXO_SUB)"

# --- 0. Resource providers ---------------------------------------------------
# Assinaturas novas (ex.: Azure for Students) vêm sem providers registrados, e
# o provider do Terraform pede o registro mas não espera ele concluir.
for provedor in Microsoft.Storage Microsoft.Web Microsoft.ContainerRegistry \
  Microsoft.ManagedIdentity Microsoft.OperationalInsights Microsoft.Insights \
  Microsoft.AlertsManagement Microsoft.Consumption Microsoft.KeyVault; do
  if [ "$(az provider show --namespace "$provedor" --query registrationState -o tsv)" != "Registered" ]; then
    echo "Registrando o resource provider $provedor (gratuito, ~1 min)..."
    az provider register --namespace "$provedor" --wait
  fi
done

az group create --name "$RG" --location "$REGIAO" \
  --tags projeto=caminho-livre finalidade=fundacao --output none

# Locks são removidos durante o bootstrap e recriados no fim (só Owner pode).
for lock in $(az lock list --resource-group "$RG" --query "[?starts_with(name, 'fundacao-')].id" -o tsv); do
  az lock delete --ids "$lock"
done

# --- 1. Storage do tfstate ----------------------------------------------------
az storage account create \
  --name "$CONTA" \
  --resource-group "$RG" \
  --location "$REGIAO" \
  --sku Standard_LRS \
  --kind StorageV2 \
  --min-tls-version TLS1_2 \
  --https-only true \
  --allow-blob-public-access false \
  --allow-shared-key-access false \
  --tags projeto=caminho-livre finalidade=terraform-state \
  --output none

az storage account blob-service-properties update \
  --account-name "$CONTA" --resource-group "$RG" \
  --enable-versioning true \
  --enable-delete-retention true --delete-retention-days 14 \
  --enable-container-delete-retention true --container-delete-retention-days 14 \
  --output none

CONTA_ID="$(az storage account show --name "$CONTA" --resource-group "$RG" --query id -o tsv)"

atribuir() { # principal_id tipo papel escopo [condição ABAC]
  # Filtra por principalId (evita consultar o Graph para identidades recém-criadas).
  if [ "$(az role assignment list --scope "$4" --role "$3" --query "length([?principalId=='$1'])" -o tsv)" = "0" ]; then
    if [ -n "${5:-}" ]; then
      az role assignment create --assignee-object-id "$1" --assignee-principal-type "$2" \
        --role "$3" --scope "$4" --condition "$5" --condition-version "2.0" --output none
    else
      az role assignment create --assignee-object-id "$1" --assignee-principal-type "$2" \
        --role "$3" --scope "$4" --output none
    fi
    echo "    + $3 em ${4##*/providers/}"
  fi
}

atribuir "$USUARIO" User "Storage Blob Data Contributor" "$CONTA_ID"

# A atribuição de papel leva alguns segundos para propagar.
tentativas=0
until az storage container create --name "$CONTAINER" --account-name "$CONTA" --auth-mode login --output none 2>/dev/null; do
  tentativas=$((tentativas + 1))
  [ "$tentativas" -ge 12 ] && { echo "ERRO: não foi possível criar o container (permissão ainda não propagou?)" >&2; exit 1; }
  echo "Aguardando a permissão propagar ($tentativas/12)..."
  sleep 10
done

# --- 2. Identidades do GitHub Actions ----------------------------------------
identidade() { # nome environment
  az identity create --name "$1" --resource-group "$RG" --location "$REGIAO" \
    --tags projeto=caminho-livre finalidade=github-actions --output none
  az identity federated-credential create --name "github-$2" \
    --identity-name "$1" --resource-group "$RG" \
    --issuer "https://token.actions.githubusercontent.com" \
    --subject "${PREFIXO_SUB}:environment:$2" \
    --audiences "api://AzureADTokenExchange" --output none
  az identity show --name "$1" --resource-group "$RG" --query principalId -o tsv
}

echo "Identidades do GitHub:"
DEPLOY="$(identidade id-caminholivre-github-deploy production)"
PLAN="$(identidade id-caminholivre-github-plan infra-plan)"
APPLY="$(identidade id-caminholivre-github-apply infra)"
sleep 20   # o service principal da identidade leva alguns segundos para existir no Entra ID

# --- 3. Papéis ------------------------------------------------------------------
# plan: só leitura (assinatura e tfstate). Roda com -lock=false.
echo "  plan:"
atribuir "$PLAN" ServicePrincipal "Reader" "$ESCOPO_ASSINATURA"
atribuir "$PLAN" ServicePrincipal "Storage Blob Data Reader" "$CONTA_ID"

# apply: Contributor + administração de RBAC LIMITADA por condição ABAC aos
# papéis que o Terraform atribui (AcrPull, AcrPush, Reader, Website
# Contributor, Key Vault Secrets User e Officer). Não consegue conceder Owner,
# Contributor nem o próprio papel de administração de RBAC.
PAPEIS="7f951dda-4ed3-4680-a7ca-43fe172d538d, 8311e382-0749-4cb8-b61a-304f252e45ec, acdd72a7-3385-48ef-bd42-f606fba81ae7, de139f84-1756-47ae-9be6-808fbbe84772, 4633458b-17de-408a-b874-0445c86b69e6, b86a8fe4-44ce-4948-aee5-eccb2c155cd7"
CONDICAO="((!(ActionMatches{'Microsoft.Authorization/roleAssignments/write'})) OR (@Request[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {${PAPEIS}})) AND ((!(ActionMatches{'Microsoft.Authorization/roleAssignments/delete'})) OR (@Resource[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {${PAPEIS}}))"
echo "  apply:"
atribuir "$APPLY" ServicePrincipal "Contributor" "$ESCOPO_ASSINATURA"
atribuir "$APPLY" ServicePrincipal "Role Based Access Control Administrator" "$ESCOPO_ASSINATURA" "$CONDICAO"
atribuir "$APPLY" ServicePrincipal "Storage Blob Data Contributor" "$CONTA_ID"
# deploy: nenhum papel aqui; AcrPush e Website Contributor vêm do Terraform,
# com escopo no ACR e no Web App.

# --- 4. Locks -------------------------------------------------------------------
az lock create --name fundacao-nao-apagar --lock-type CanNotDelete --resource-group "$RG" \
  --notes "Fundação do Caminho Livre: tfstate e identidades do GitHub." --output none
for nome in id-caminholivre-github-deploy id-caminholivre-github-plan id-caminholivre-github-apply; do
  az lock create --name fundacao-somente-leitura --lock-type ReadOnly --resource-group "$RG" \
    --resource-name "$nome" --resource-type Microsoft.ManagedIdentity/userAssignedIdentities \
    --notes "Impede adicionar credenciais federadas à identidade." --output none
done

cat > "$RAIZ/infra/terraform/backend.hcl" <<EOF
resource_group_name  = "$RG"
storage_account_name = "$CONTA"
container_name       = "$CONTAINER"
key                  = "caminho-livre.tfstate"
use_azuread_auth     = true
EOF

echo
echo "Fundação pronta. backend.hcl gerado (não versionado)."
echo "  deploy principal: $DEPLOY"
echo "  plan   principal: $PLAN"
echo "  apply  principal: $APPLY"
echo "Próximo passo: sh infra/scripts/configurar-github.sh"
