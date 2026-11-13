# =============================================================================
# Caminho Livre - Infraestrutura Azure (Terraform)
#
# Estado remoto: Azure Blob Storage com autenticação Entra ID (sem chaves).
# Os valores do backend ficam em backend.hcl, gerado por
# infra/bootstrap/criar-backend-tfstate.sh e ignorado pelo git, assim como
# terraform.tfvars e qualquer *.tfstate.
#
#   sh infra/bootstrap/criar-backend-tfstate.sh        # uma vez
#   cd infra/terraform
#   cp terraform.tfvars.example terraform.tfvars        # e preencha
#   terraform init -backend-config=backend.hcl
#   terraform plan -out=tfplan && terraform apply tfplan
# =============================================================================

terraform {
  required_version = ">= 1.9.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 5.13"
    }
  }

  # Configuração parcial: os valores vêm de -backend-config=backend.hcl.
  backend "azurerm" {}
}

provider "azurerm" {
  features {}

  subscription_id = var.subscription_id
  # Data plane do Storage via Entra ID (as contas não aceitam chave de acesso).
  storage_use_azuread = true

  # Registra só os resource providers usados aqui (assinaturas de estudante
  # podem não ter permissão para o conjunto padrão).
  resource_provider_registrations = "none"
  resource_providers_to_register = [
    "Microsoft.Consumption",
    "Microsoft.ContainerRegistry",
    "Microsoft.Insights",
    "Microsoft.ManagedIdentity",
    "Microsoft.OperationalInsights",
    "Microsoft.Web",
  ]
}
