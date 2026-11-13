# =============================================================================
# Controle de custos: orçamento mensal da assinatura com alertas por e-mail.
# Budgets não têm custo. Os alertas usam o gasto real (Actual) e o previsto
# (Forecasted) pelo Cost Management, que atualiza com atraso de ~8 a 24 h.
# =============================================================================

resource "azurerm_consumption_budget_subscription" "mensal" {
  name            = "budget-${local.nome}-mensal"
  subscription_id = "/subscriptions/${var.subscription_id}"
  amount          = var.orcamento_mensal_usd
  time_grain      = "Monthly"

  time_period {
    # Budgets começam no 1º dia de um mês.
    start_date = formatdate("YYYY-MM-01'T'00:00:00Z", plantimestamp())
  }

  dynamic "notification" {
    for_each = { "50" = "Actual", "80" = "Actual", "100" = "Actual" }
    content {
      enabled        = true
      threshold      = tonumber(notification.key)
      threshold_type = notification.value
      operator       = "GreaterThanOrEqualTo"
      contact_emails = var.emails_alerta_custo
      contact_roles  = ["Owner"]
    }
  }

  # Aviso antecipado: a previsão do mês já passa do orçamento.
  notification {
    enabled        = true
    threshold      = 100
    threshold_type = "Forecasted"
    operator       = "GreaterThanOrEqualTo"
    contact_emails = var.emails_alerta_custo
    contact_roles  = ["Owner"]
  }

  lifecycle {
    # plantimestamp() muda a cada plan; a data de início só importa na criação.
    ignore_changes = [time_period]
  }
}
