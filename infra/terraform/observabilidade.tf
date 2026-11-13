# =============================================================================
# Observabilidade no Azure Monitor: Métricas de Ouro (Google SRE)
#
#   Sinal       Métrica de plataforma do Web App (Microsoft.Web/sites)
#   ---------   ---------------------------------------------------------
#   Latência    HttpResponseTime (s)
#   Tráfego     Requests
#   Erros       Http5xx (e Http4xx no painel)
#   Saturação   CpuTime (s de CPU; métrica indicada para planos F1/Free),
#               MemoryWorkingSet
#
# Custo: regras de alerta de métrica ~US$ 0,10/mês cada (4 regras ~US$ 0,40/mês,
# cobrado proporcional ao tempo). E-mails do action group: 1.000/mês grátis.
# Workbooks não têm custo; consultam o Log Analytics (dentro da cota gratuita).
# =============================================================================

resource "azurerm_monitor_action_group" "email" {
  name                = "ag-${local.nome}-email"
  resource_group_name = azurerm_resource_group.principal.name
  short_name          = "cl-alertas"
  location            = "global"
  tags                = local.tags

  dynamic "email_receiver" {
    for_each = toset(var.emails_alerta)
    content {
      name                    = "email-${replace(email_receiver.value, "/[^a-zA-Z0-9]/", "-")}"
      email_address           = email_receiver.value
      use_common_alert_schema = true
    }
  }
}

locals {
  alertas_metricas = {
    erros-5xx = {
      descricao  = "Erros: mais de ${var.alerta_5xx_max} respostas HTTP 5xx em 5 minutos."
      metrica    = "Http5xx"
      agregacao  = "Total"
      operador   = "GreaterThan"
      limite     = var.alerta_5xx_max
      janela     = "PT5M"
      frequencia = "PT1M"
      severidade = 1
    }
    latencia = {
      descricao  = "Latência: tempo médio de resposta acima de ${var.alerta_latencia_s} s em 5 minutos."
      metrica    = "HttpResponseTime"
      agregacao  = "Average"
      operador   = "GreaterThan"
      limite     = var.alerta_latencia_s
      janela     = "PT5M"
      frequencia = "PT1M"
      severidade = 2
    }
    saturacao-cpu = {
      descricao  = "Saturação: mais de ${var.alerta_cpu_segundos} s de CPU em 15 minutos (no F1 a cota é de 60 min de CPU/dia)."
      metrica    = "CpuTime"
      agregacao  = "Total"
      operador   = "GreaterThan"
      limite     = var.alerta_cpu_segundos
      janela     = "PT15M"
      frequencia = "PT5M"
      severidade = 2
    }
    disponibilidade = {
      descricao = "Disponibilidade: health check (/healthz) abaixo de 100% em 5 minutos."
      metrica   = "HealthCheckStatus"
      agregacao = "Average"
      operador  = "LessThan"
      limite    = 100
      # A métrica só existe em grãos de 5 min (PT5M, PT1H, P1D).
      janela     = "PT5M"
      frequencia = "PT5M"
      severidade = 1
    }
  }
}

resource "azurerm_monitor_metric_alert" "webapp" {
  for_each = local.alertas_metricas

  name                = "alerta-${local.nome}-${each.key}"
  resource_group_name = azurerm_resource_group.principal.name
  scopes              = [azurerm_linux_web_app.principal.id]
  description         = each.value.descricao
  severity            = each.value.severidade
  window_size         = each.value.janela
  frequency           = each.value.frequencia
  auto_mitigate       = true
  tags                = local.tags

  criteria {
    metric_namespace = "Microsoft.Web/sites"
    metric_name      = each.value.metrica
    aggregation      = each.value.agregacao
    operator         = each.value.operador
    threshold        = each.value.limite
  }

  action {
    action_group_id = azurerm_monitor_action_group.email.id
  }
}

# -----------------------------------------------------------------------------
# Workbook (painel no portal): Métricas de Ouro via KQL no Log Analytics.
# AzureMetrics vem do diagnostic setting "AllMetrics" (funciona em qualquer
# plano); AppServiceHTTPLogs traz percentis de latência por requisição.
# -----------------------------------------------------------------------------
locals {
  law_id    = azurerm_log_analytics_workspace.principal.id
  webapp_id = azurerm_linux_web_app.principal.id

  kql_metrica = "AzureMetrics | where ResourceId =~ '${local.webapp_id}'"

  consultas_workbook = [
    {
      nome   = "latencia"
      titulo = "Latência: tempo de resposta (média e máximo, s)"
      kql    = "${local.kql_metrica} | where MetricName == 'HttpResponseTime' | summarize ['Média']=avg(Average), ['Máximo']=max(Maximum) by bin(TimeGenerated, 5m)"
      viz    = "timechart"
    },
    {
      nome   = "latencia-percentis"
      titulo = "Latência por requisição: p50 / p95 / p99 (ms, logs HTTP)"
      kql    = "AppServiceHTTPLogs | where _ResourceId =~ '${local.webapp_id}' | summarize p50=percentile(TimeTaken, 50), p95=percentile(TimeTaken, 95), p99=percentile(TimeTaken, 99) by bin(TimeGenerated, 5m)"
      viz    = "timechart"
    },
    {
      nome   = "trafego"
      titulo = "Tráfego: requisições a cada 5 minutos"
      kql    = "${local.kql_metrica} | where MetricName == 'Requests' | summarize ['Requisições']=sum(Total) by bin(TimeGenerated, 5m)"
      viz    = "timechart"
    },
    {
      nome   = "erros"
      titulo = "Erros: respostas 4xx e 5xx a cada 5 minutos"
      kql    = "${local.kql_metrica} | where MetricName in ('Http4xx', 'Http5xx') | summarize Total=sum(Total) by MetricName, bin(TimeGenerated, 5m)"
      viz    = "timechart"
    },
    {
      nome   = "saturacao-cpu"
      titulo = "Saturação: segundos de CPU a cada 5 minutos"
      kql    = "${local.kql_metrica} | where MetricName == 'CpuTime' | summarize ['CPU (s)']=sum(Total) by bin(TimeGenerated, 5m)"
      viz    = "timechart"
    },
    {
      nome   = "saturacao-memoria"
      titulo = "Saturação: memória em uso (MB)"
      kql    = "${local.kql_metrica} | where MetricName == 'MemoryWorkingSet' | summarize ['Memória (MB)']=avg(Average) / 1048576 by bin(TimeGenerated, 5m)"
      viz    = "timechart"
    },
  ]

  workbook = {
    version = "Notebook/1.0"
    items = concat(
      [
        {
          type = 1
          name = "cabecalho"
          content = {
            json = "## Caminho Livre - Métricas de Ouro\nLatência, Tráfego, Erros e Saturação do Web App `${azurerm_linux_web_app.principal.name}`. Alertas com e-mail: Http5xx, HttpResponseTime, CpuTime e HealthCheckStatus."
          }
        },
        {
          type = 9
          name = "parametros"
          content = {
            version = "KqlParameterItem/1.0"
            parameters = [{
              id         = "8b5b7d3e-6a4f-4f37-9e43-1c7d2f0a9a11"
              version    = "KqlParameterItem/1.0"
              name       = "Periodo"
              label      = "Período"
              type       = 4
              isRequired = true
              value      = { durationMs = 3600000 }
              typeSettings = {
                selectableValues = [
                  { durationMs = 1800000 },
                  { durationMs = 3600000 },
                  { durationMs = 14400000 },
                  { durationMs = 86400000 },
                  { durationMs = 604800000 },
                ]
              }
            }]
          }
        },
      ],
      [
        for c in local.consultas_workbook : {
          type        = 3
          name        = c.nome
          customWidth = "50"
          content = {
            version                  = "KqlItem/1.0"
            title                    = c.titulo
            query                    = c.kql
            size                     = 0
            queryType                = 0
            resourceType             = "microsoft.operationalinsights/workspaces"
            crossComponentResources  = [local.law_id]
            timeContextFromParameter = "Periodo"
            visualization            = c.viz
          }
        }
      ]
    )
    fallbackResourceIds = [local.law_id]
    "$schema"           = "https://github.com/Microsoft/Application-Insights-Workbooks/blob/master/schema/workbook.json"
  }
}

resource "azurerm_application_insights_workbook" "metricas_de_ouro" {
  # O nome de um workbook precisa ser um UUID; uuidv5 o mantém estável.
  name                = uuidv5("url", "caminho-livre/${local.nome}/metricas-de-ouro")
  resource_group_name = azurerm_resource_group.principal.name
  location            = azurerm_resource_group.principal.location
  display_name        = "Caminho Livre - Métricas de Ouro"
  source_id           = lower(local.law_id)
  category            = "workbook"
  data_json           = jsonencode(local.workbook)
  tags                = local.tags
}
