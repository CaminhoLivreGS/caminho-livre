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
  description = "SKU do App Service Plan Linux. B1 é o menor com Always On e health check."
  type        = string
  default     = "B1"
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
  description = "Teto diário de ingestão de logs, para controlar custo."
  type        = number
  default     = 1
}

variable "tags" {
  description = "Tags adicionais aplicadas a todos os recursos."
  type        = map(string)
  default     = {}
}
