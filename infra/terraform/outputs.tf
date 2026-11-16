# Valores para cadastrar no GitHub (ver infra/scripts/configurar-github.sh).

output "app_url" {
  description = "URL pública da aplicação."
  value       = "https://${azurerm_linux_web_app.principal.default_hostname}"
}

output "resource_group" {
  description = "Grupo de recursos (vars.AZURE_RESOURCE_GROUP)."
  value       = azurerm_resource_group.principal.name
}

output "acr_name" {
  description = "Nome do ACR (vars.AZURE_ACR_NAME)."
  value       = azurerm_container_registry.principal.name
}

output "acr_login_server" {
  description = "Servidor de login do ACR."
  value       = azurerm_container_registry.principal.login_server
}

output "webapp_name" {
  description = "Nome do Web App (vars.AZURE_WEBAPP_NAME)."
  value       = azurerm_linux_web_app.principal.name
}

output "github_oidc_client_id" {
  description = "Client ID da identidade de deploy (secrets.AZURE_CLIENT_ID)."
  value       = azurerm_user_assigned_identity.github_deploy.client_id
}

output "tenant_id" {
  description = "Tenant do Entra ID (secrets.AZURE_TENANT_ID)."
  value       = data.azurerm_client_config.atual.tenant_id
}

output "subscription_id" {
  description = "Assinatura (secrets.AZURE_SUBSCRIPTION_ID)."
  value       = var.subscription_id
}

output "log_analytics_workspace_id" {
  description = "Workspace do Log Analytics (consultas KQL das Métricas de Ouro)."
  value       = azurerm_log_analytics_workspace.principal.id
}

output "application_insights_name" {
  description = "Application Insights (testes de disponibilidade e alertas)."
  value       = azurerm_application_insights.principal.name
}
