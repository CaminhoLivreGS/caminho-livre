data "azurerm_client_config" "atual" {}

locals {
  # Sufixo estável por assinatura: nomes globais (ACR, Web App) sem colisão.
  sufixo = substr(sha256(var.subscription_id), 0, 6)
  nome   = "${var.projeto}-${var.ambiente}"

  tags = merge({
    projeto     = "caminho-livre"
    ambiente    = var.ambiente
    gerenciado  = "terraform"
    repositorio = var.github_repository
  }, var.tags)
}

# -----------------------------------------------------------------------------
# Grupo de recursos
# -----------------------------------------------------------------------------
resource "azurerm_resource_group" "principal" {
  name     = "rg-${local.nome}"
  location = var.location
  tags     = local.tags
}

# -----------------------------------------------------------------------------
# Observabilidade: Log Analytics + Application Insights (workspace-based)
# -----------------------------------------------------------------------------
resource "azurerm_log_analytics_workspace" "principal" {
  name                = "log-${local.nome}"
  location            = azurerm_resource_group.principal.location
  resource_group_name = azurerm_resource_group.principal.name
  sku                 = "PerGB2018"
  retention_in_days   = var.log_retention_days
  daily_quota_gb      = var.log_daily_quota_gb
  tags                = local.tags
}

resource "azurerm_application_insights" "principal" {
  name                = "appi-${local.nome}"
  location            = azurerm_resource_group.principal.location
  resource_group_name = azurerm_resource_group.principal.name
  workspace_id        = azurerm_log_analytics_workspace.principal.id
  application_type    = "web"
  # Sem IP do cliente nos dados de telemetria (LGPD).
  ip_masking_enabled = true
  tags               = local.tags
}

# -----------------------------------------------------------------------------
# Azure Container Registry: imagens privadas, sem usuário admin
# -----------------------------------------------------------------------------
resource "azurerm_container_registry" "principal" {
  name                = "acr${var.projeto}${local.sufixo}"
  location            = azurerm_resource_group.principal.location
  resource_group_name = azurerm_resource_group.principal.name
  sku                 = "Basic"
  # Sem senha compartilhada: push via OIDC (GitHub) e pull via identidade
  # gerenciada (Web App), ambos por RBAC.
  admin_enabled          = false
  anonymous_pull_enabled = false
  tags                   = local.tags
}

# -----------------------------------------------------------------------------
# App Service (Linux) + Web App for Containers
# -----------------------------------------------------------------------------
resource "azurerm_service_plan" "principal" {
  name                = "asp-${local.nome}"
  location            = azurerm_resource_group.principal.location
  resource_group_name = azurerm_resource_group.principal.name
  os_type             = "Linux"
  sku_name            = var.app_service_sku
  tags                = local.tags
}

resource "azurerm_linux_web_app" "principal" {
  name                = "app-${local.nome}-${local.sufixo}"
  location            = azurerm_resource_group.principal.location
  resource_group_name = azurerm_resource_group.principal.name
  service_plan_id     = azurerm_service_plan.principal.id

  https_only              = true
  client_affinity_enabled = false
  # Publicação só pela imagem no ACR: FTP e WebDeploy com senha desligados.
  ftp_publish_basic_authentication_enabled       = false
  webdeploy_publish_basic_authentication_enabled = false

  identity {
    type = "SystemAssigned"
  }

  site_config {
    # O plano gratuito (F1) não oferece Always On.
    always_on           = var.app_service_sku != "F1"
    http2_enabled       = true
    minimum_tls_version = "1.2"
    ftps_state          = "Disabled"
    websockets_enabled  = false

    remote_debugging_enabled          = false
    health_check_path                 = "/healthz"
    health_check_eviction_time_in_min = 5

    container_registry_use_managed_identity = true
    application_stack {
      docker_registry_url = "https://${azurerm_container_registry.principal.login_server}"
      # Tag inicial; o pipeline publica e aplica a tag do commit (ver lifecycle).
      docker_image_name = "caminho-livre:latest"
    }

    # Site público (só 80/443 existem no App Service; HTTP redireciona p/ HTTPS).
    ip_restriction_default_action = "Allow"

    # Administração (SCM/Kudu/SSH): negada por padrão, liberada só para
    # admin_cidrs. Nunca aberta para 0.0.0.0/0.
    scm_use_main_ip_restriction       = false
    scm_ip_restriction_default_action = "Deny"
    scm_minimum_tls_version           = "1.2"

    dynamic "scm_ip_restriction" {
      for_each = var.admin_cidrs
      content {
        name       = "admin-${scm_ip_restriction.key}"
        ip_address = scm_ip_restriction.value
        action     = "Allow"
        priority   = 100 + scm_ip_restriction.key
      }
    }
  }

  app_settings = {
    WEBSITES_PORT                       = "8080"
    WEBSITES_ENABLE_APP_SERVICE_STORAGE = "false"
  }

  logs {
    detailed_error_messages = false
    failed_request_tracing  = false
    http_logs {
      file_system {
        retention_in_days = 3
        retention_in_mb   = 35
      }
    }
  }

  tags = local.tags

  lifecycle {
    # A imagem em produção é responsabilidade do pipeline (tag = SHA do commit);
    # sem isto, cada terraform apply voltaria para :latest.
    ignore_changes = [site_config[0].application_stack[0].docker_image_name]
  }
}

# O Web App puxa imagens do ACR com a própria identidade (sem senha).
resource "azurerm_role_assignment" "webapp_acr_pull" {
  scope                = azurerm_container_registry.principal.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_linux_web_app.principal.identity[0].principal_id
  principal_type       = "ServicePrincipal"
}

# Logs HTTP, de console e métricas do Web App no Log Analytics (Métricas de Ouro).
resource "azurerm_monitor_diagnostic_setting" "webapp" {
  name                       = "diag-${local.nome}"
  target_resource_id         = azurerm_linux_web_app.principal.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.principal.id

  enabled_log {
    category = "AppServiceHTTPLogs"
  }
  enabled_log {
    category = "AppServiceConsoleLogs"
  }
  enabled_log {
    category = "AppServicePlatformLogs"
  }
  enabled_metric {
    category = "AllMetrics"
  }
}
