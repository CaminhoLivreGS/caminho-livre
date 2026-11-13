#!/bin/sh
# =============================================================================
# Bootstrap do backend remoto do Terraform (executar UMA vez, antes do init).
#
# Cria um Storage Account dedicado ao tfstate, FORA do repositório:
#   - autenticação só por Microsoft Entra ID (chaves de acesso desativadas);
#   - TLS 1.2+, HTTPS obrigatório, sem acesso público anônimo a blobs;
#   - versionamento + soft delete (recupera um state corrompido/apagado);
#   - o usuário logado recebe "Storage Blob Data Contributor" só nessa conta.
# Ao final, grava infra/terraform/backend.hcl (ignorado pelo git).
#
# Uso:  az login && sh infra/bootstrap/criar-backend-tfstate.sh [regiao]
# =============================================================================
set -eu

REGIAO="${1:-brazilsouth}"
RG="rg-caminholivre-tfstate"
CONTAINER="tfstate"
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"

ASSINATURA="$(az account show --query id -o tsv)"
USUARIO="$(az ad signed-in-user show --query id -o tsv)"
# Nome globalmente único e estável por assinatura (3-24 caracteres, minúsculos).
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | cut -d' ' -f1
  else shasum -a 256 | cut -d' ' -f1; fi
}
SUFIXO="$(printf '%s' "$ASSINATURA" | sha256 | cut -c1-8)"
CONTA="stcltfstate${SUFIXO}"

echo "Assinatura: $ASSINATURA"
echo "Região:     $REGIAO"
echo "Storage:    $CONTA (RG $RG)"

az group create --name "$RG" --location "$REGIAO" \
  --tags projeto=caminho-livre finalidade=terraform-state --output none

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
az role assignment create \
  --assignee-object-id "$USUARIO" --assignee-principal-type User \
  --role "Storage Blob Data Contributor" --scope "$CONTA_ID" --output none 2>/dev/null || true

# A atribuição de papel leva alguns segundos para propagar.
tentativas=0
until az storage container create --name "$CONTAINER" --account-name "$CONTA" --auth-mode login --output none 2>/dev/null; do
  tentativas=$((tentativas + 1))
  [ "$tentativas" -ge 12 ] && { echo "ERRO: não foi possível criar o container (permissão ainda não propagou?)" >&2; exit 1; }
  echo "Aguardando a permissão propagar ($tentativas/12)..."
  sleep 10
done

cat > "$RAIZ/infra/terraform/backend.hcl" <<EOF
resource_group_name  = "$RG"
storage_account_name = "$CONTA"
container_name       = "$CONTAINER"
key                  = "caminho-livre.tfstate"
use_azuread_auth     = true
EOF

echo
echo "Backend pronto. Arquivo gerado: infra/terraform/backend.hcl (não versionado)."
echo "Próximo passo: cd infra/terraform && terraform init -backend-config=backend.hcl"
