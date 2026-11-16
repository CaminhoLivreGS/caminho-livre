# =============================================================================
# Cofre de segredos: Azure Key Vault com autorização só por RBAC.
#
# A arquitetura evita segredos de longa duração (deploy por OIDC, pull do ACR
# por identidade gerenciada). O cofre guarda a configuração sensível que existe
# hoje (connection string do Application Insights) e fica pronto para o backend
# de denúncias. O Web App lê o valor por Key Vault Reference, com a própria
# identidade gerenciada; nada sensível fica em app settings, no código ou no git.
#
# Custo: sem mensalidade no SKU standard; US$ 0,03 a cada 10 mil operações.
# =============================================================================

# Purge protection desligada de propósito (risco aceito, mesma justificativa do
# AZU-0016 no .trivyignore): ciclo destruir/recriar entre avaliações.
resource "azurerm_key_vault" "principal" { # nosemgrep: terraform.azure.security.keyvault.keyvault-purge-enabled.keyvault-purge-enabled
  name                = "kv-${var.projeto}-${local.sufixo}"
  location            = azurerm_resource_group.principal.location
  resource_group_name = azurerm_resource_group.principal.name
  tenant_id           = data.azurerm_client_config.atual.tenant_id
  sku_name            = "standard"

  # Permissões só por RBAC (sem access policies).
  rbac_authorization_enabled = true

  # Retenção mínima de exclusão (7 dias). A proteção contra purge fica desligada
  # porque a infra é destruída e recriada entre avaliações para poupar créditos;
  # com ela ligada, o nome do cofre ficaria bloqueado por até 90 dias.
  soft_delete_retention_days = 7
  purge_protection_enabled   = false

  enabled_for_deployment          = false
  enabled_for_disk_encryption     = false
  enabled_for_template_deployment = false

  # Acesso pela rede pública com autenticação Entra ID + RBAC. Restringir por IP
  # exigiria VNet Integration no Web App (indisponível no plano F1) e IPs fixos
  # para os runners do GitHub. Ver .trivyignore.
  network_acls {
    default_action = "Allow"
    bypass         = "AzureServices"
  }

  tags = local.tags
}

# A identidade de apply do CI grava o segredo. É explícita (e não "quem estiver
# executando") para o plan do CI, que roda com outra identidade, não acusar
# diferença. Para aplicar localmente, defina github_apply_principal_id com o
# seu object ID (az ad signed-in-user show --query id -o tsv).
resource "azurerm_role_assignment" "kv_operador" {
  scope                = azurerm_key_vault.principal.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = var.github_apply_principal_id
}

# O Web App lê os segredos referenciados nas app settings.
resource "azurerm_role_assignment" "kv_webapp" {
  scope                = azurerm_key_vault.principal.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_linux_web_app.principal.identity[0].principal_id
  principal_type       = "ServicePrincipal"
}

# O terraform plan do CI lê o segredo ao atualizar o estado (refresh).
resource "azurerm_role_assignment" "kv_plan" {
  scope                = azurerm_key_vault.principal.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = var.github_plan_principal_id
  principal_type       = "ServicePrincipal"
}

# Atribuições de RBAC levam alguns minutos para valer no data plane do cofre.
resource "time_sleep" "rbac_key_vault" {
  depends_on      = [azurerm_role_assignment.kv_operador]
  create_duration = "90s"
}

resource "azurerm_key_vault_secret" "appinsights_connection_string" {
  name         = "appinsights-connection-string"
  key_vault_id = azurerm_key_vault.principal.id
  content_type = "text/plain"

  # Write-only: o valor vai para o cofre, mas nunca é gravado no tfstate.
  # Para trocar o valor, incremente value_wo_version.
  value_wo         = azurerm_application_insights.principal.connection_string
  value_wo_version = 1

  expiration_date = var.segredos_expiram_em

  tags       = local.tags
  depends_on = [time_sleep.rbac_key_vault]
}
