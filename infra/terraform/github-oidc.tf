# =============================================================================
# Permissões das identidades do GitHub Actions nos recursos do projeto.
#
# As 3 identidades (deploy, plan e apply) e suas credenciais federadas OIDC
# ficam na fundação (infra/bootstrap/), que nunca é destruída: se ficassem
# aqui, o terraform destroy apagaria a identidade que o CI usa para recriar
# a infraestrutura. Este arquivo concede só o acesso com escopo de recurso.
#
#   deploy  environment "production": envia a imagem e atualiza o Web App
#   plan    environment "infra-plan": leitura (Reader na assinatura, na fundação)
#   apply   environment "infra", com aprovação manual (papéis na fundação)
# =============================================================================

# Deploy: menor privilégio, só neste ACR e neste Web App.
resource "azurerm_role_assignment" "github_acr_push" {
  scope                = azurerm_container_registry.principal.id
  role_definition_name = "AcrPush"
  principal_id         = var.github_deploy_principal_id
  principal_type       = "ServicePrincipal"
}

# Leitura do recurso ACR (az acr login / az acr list resolvem o login server).
resource "azurerm_role_assignment" "github_acr_reader" {
  scope                = azurerm_container_registry.principal.id
  role_definition_name = "Reader"
  principal_id         = var.github_deploy_principal_id
  principal_type       = "ServicePrincipal"
}

resource "azurerm_role_assignment" "github_webapp_contributor" {
  scope                = azurerm_linux_web_app.principal.id
  role_definition_name = "Website Contributor"
  principal_id         = var.github_deploy_principal_id
  principal_type       = "ServicePrincipal"
}
