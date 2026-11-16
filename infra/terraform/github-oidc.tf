# =============================================================================
# Identidade do pipeline (GitHub Actions -> Azure) via OIDC, sem segredo.
#
# Identidade gerenciada user-assigned com credencial federada: o Azure só
# aceita tokens do GitHub emitidos para ESTE repositório, no environment
# "production" (que, por regra do GitHub, só a branch main protegida usa).
# Não há senha/client secret para vazar ou rotacionar.
# =============================================================================

resource "azurerm_user_assigned_identity" "github_deploy" {
  name                = "id-${local.nome}-github-deploy"
  location            = azurerm_resource_group.principal.location
  resource_group_name = azurerm_resource_group.principal.name
  tags                = local.tags
}

resource "azurerm_federated_identity_credential" "github_production" {
  name                      = "github-${var.github_environment}"
  user_assigned_identity_id = azurerm_user_assigned_identity.github_deploy.id
  issuer                    = "https://token.actions.githubusercontent.com"
  audience                  = ["api://AzureADTokenExchange"]
  subject                   = "repo:${var.github_repository}:environment:${var.github_environment}"
}

# Menor privilégio: o pipeline só envia imagens ao ACR e atualiza ESTE Web App.
resource "azurerm_role_assignment" "github_acr_push" {
  scope                = azurerm_container_registry.principal.id
  role_definition_name = "AcrPush"
  principal_id         = azurerm_user_assigned_identity.github_deploy.principal_id
  principal_type       = "ServicePrincipal"
}

# Leitura do recurso ACR (az acr login / az acr show resolvem o login server).
resource "azurerm_role_assignment" "github_acr_reader" {
  scope                = azurerm_container_registry.principal.id
  role_definition_name = "Reader"
  principal_id         = azurerm_user_assigned_identity.github_deploy.principal_id
  principal_type       = "ServicePrincipal"
}

resource "azurerm_role_assignment" "github_webapp_contributor" {
  scope                = azurerm_linux_web_app.principal.id
  role_definition_name = "Website Contributor"
  principal_id         = azurerm_user_assigned_identity.github_deploy.principal_id
  principal_type       = "ServicePrincipal"
}
