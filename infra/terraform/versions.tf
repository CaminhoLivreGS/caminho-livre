# =============================================================================
# Caminho Livre - Infraestrutura Azure (Terraform)
#
# Estado remoto: Azure Blob Storage com autenticação Entra ID (sem chaves).
# Os valores do backend ficam em backend.hcl, gerado por
# infra/bootstrap/fundacao.sh e ignorado pelo git, assim como
# terraform.tfvars e qualquer *.tfstate.
#
#   sh infra/bootstrap/fundacao.sh                     # uma vez (Owner)
#   No dia a dia, o plan e o apply rodam no GitHub Actions (infra.yml);
#   o fluxo local abaixo é a alternativa de emergência.
#   cd infra/terraform
#   cp terraform.tfvars.example terraform.tfvars        # e preencha
#   terraform init -backend-config=backend.hcl
#   terraform plan -out=tfplan && terraform apply tfplan
# =============================================================================

terraform {
  # 1.11+: atributos write-only (value_wo do segredo no Key Vault).
  required_version = ">= 1.11.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 5.13"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.13"
    }
  }

  # Configuração parcial: os valores vêm de -backend-config=backend.hcl.
  backend "azurerm" {}
}

provider "azurerm" {
  features {
    key_vault {
      # Ciclo destruir/recriar: o cofre apagado é purgado no destroy e, se ainda
      # estiver em soft delete, é recuperado em vez de recriado.
      purge_soft_delete_on_destroy    = true
      recover_soft_deleted_key_vaults = true
    }
  }

  subscription_id = var.subscription_id
  # Data plane do Storage via Entra ID (as contas não aceitam chave de acesso).
  storage_use_azuread = true

  # Registra só os resource providers usados aqui (assinaturas de estudante
  # podem não ter permissão para o conjunto padrão).
  resource_provider_registrations = "none"
  # O bootstrap (infra/bootstrap/) registra e aguarda estes mesmos providers.
  resource_providers_to_register = [
    "Microsoft.AlertsManagement",
    "Microsoft.Consumption",
    "Microsoft.ContainerRegistry",
    "Microsoft.Insights",
    "Microsoft.KeyVault",
    "Microsoft.ManagedIdentity",
    "Microsoft.OperationalInsights",
    "Microsoft.Web",
  ]
}
