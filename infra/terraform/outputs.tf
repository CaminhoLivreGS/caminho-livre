# Saídas da infraestrutura. As identidades do GitHub estão na fundação (infra/bootstrap/).

output "app_url" {
  description = "URL pública da aplicação."
  value       = "https://${azurerm_linux_web_app.principal.default_hostname}"
}

output "resource_group" {
  description = "Grupo de recursos do projeto."
  value       = azurerm_resource_group.principal.name
}

output "acr_name" {
  description = "Nome do ACR (o deploy o localiza pela tag projeto=caminho-livre)."
  value       = azurerm_container_registry.principal.name
}

output "acr_login_server" {
  description = "Servidor de login do ACR."
  value       = azurerm_container_registry.principal.login_server
}

output "webapp_name" {
  description = "Nome do Web App (o deploy o localiza pela tag projeto=caminho-livre)."
  value       = azurerm_linux_web_app.principal.name
}

output "tenant_id" {
  description = "Tenant do Entra ID."
  value       = data.azurerm_client_config.atual.tenant_id
}

output "subscription_id" {
  description = "Assinatura."
  value       = var.subscription_id
  sensitive   = true
}

output "log_analytics_workspace_id" {
  description = "Workspace do Log Analytics (consultas KQL das Métricas de Ouro)."
  value       = azurerm_log_analytics_workspace.principal.id
}

output "application_insights_name" {
  description = "Application Insights (testes de disponibilidade e alertas)."
  value       = azurerm_application_insights.principal.name
}

output "key_vault_name" {
  description = "Key Vault com autorização por RBAC."
  value       = azurerm_key_vault.principal.name
}
