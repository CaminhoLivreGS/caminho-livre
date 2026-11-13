variable "subscription_id" {
  description = "ID da assinatura Azure onde a infraestrutura será criada."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-fA-F-]{36}$", var.subscription_id))
    error_message = "subscription_id deve ser um GUID."
  }
}

variable "location" {
  description = "Região Azure. brazilsouth mantém os dados no Brasil (alinhado à LGPD)."
  type        = string
  default     = "brazilsouth"
}

variable "projeto" {
  description = "Prefixo dos nomes dos recursos."
  type        = string
  default     = "caminholivre"

  validation {
    condition     = can(regex("^[a-z0-9]{3,16}$", var.projeto))
    error_message = "projeto: 3 a 16 caracteres, só letras minúsculas e números."
  }
}

variable "ambiente" {
  description = "Nome do ambiente (vai nos nomes e tags)."
  type        = string
  default     = "prod"
}

variable "github_repository" {
  description = "Repositório autorizado a fazer deploy via OIDC (owner/nome)."
  type        = string
  default     = "CaminhoLivreGS/caminho-livre"

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository deve estar no formato owner/repositorio."
  }
}

variable "github_environment" {
  description = "Environment do GitHub cujo token OIDC é aceito (só a main pode usá-lo)."
  type        = string
  default     = "production"
}

variable "app_service_sku" {
  description = <<-EOT
    SKU do App Service Plan Linux.
    F1 (padrão): gratuito; 60 min de CPU/dia, sem Always On (cold start) e sem SLA.
    B1: ~US$ 0,02/h em brazilsouth (~US$ 14,60/mês); use só se o F1 não atender.
  EOT
  type        = string
  default     = "F1"

  validation {
    condition     = contains(["F1", "B1", "B2", "S1"], var.app_service_sku)
    error_message = "app_service_sku deve ser F1, B1, B2 ou S1."
  }
}

variable "orcamento_mensal_usd" {
  description = "Orçamento mensal da assinatura (USD). Alertas em 50%, 80% e 100% do gasto real e 100% do previsto."
  type        = number
  default     = 10
}

variable "emails_alerta" {
  description = "E-mails que recebem os alertas de custo (budget) e de operação (Métricas de Ouro)."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for e in var.emails_alerta : can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", e))])
    error_message = "emails_alerta deve conter só endereços de e-mail válidos."
  }
}

variable "alerta_5xx_max" {
  description = "Alerta de erros: máximo de respostas 5xx aceitas em 5 minutos."
  type        = number
  default     = 5
}

variable "alerta_latencia_s" {
  description = "Alerta de latência: tempo médio de resposta máximo (segundos) em 5 minutos."
  type        = number
  default     = 2
}

variable "alerta_cpu_segundos" {
  description = "Alerta de saturação: segundos de CPU máximos em 15 minutos."
  type        = number
  default     = 60
}

variable "admin_cidrs" {
  description = <<-EOT
    Faixas IP autorizadas no site de administração (SCM/Kudu, por onde passa o
    SSH do App Service). Vazio = administração bloqueada para todos.
    NUNCA use 0.0.0.0/0: a validação rejeita qualquer faixa maior que /16.
  EOT
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for c in var.admin_cidrs :
      can(cidrhost(c, 0)) && tonumber(split("/", c)[1]) >= 16
    ])
    error_message = "admin_cidrs: use CIDRs válidos de /16 a /32 (ex.: 203.0.113.10/32). 0.0.0.0/0 é proibido."
  }
}

variable "log_retention_days" {
  description = "Retenção dos logs no Log Analytics (30 dias = faixa gratuita)."
  type        = number
  default     = 30
}

variable "log_daily_quota_gb" {
  description = "Teto diário de ingestão de logs. 0,1 GB/dia (~3 GB/mês) fica dentro dos 5 GB/mês gratuitos."
  type        = number
  default     = 0.1
}

variable "tags" {
  description = "Tags adicionais aplicadas a todos os recursos."
  type        = map(string)
  default     = {}
}
