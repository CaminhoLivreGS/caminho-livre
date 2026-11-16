# Evidências da entrega

Sessão de validação no Azure em 16/11/2026: infraestrutura criada com `terraform apply`, deploy automático pelo pipeline, simulação de falha de segurança e alerta do Azure Monitor. Depois disso, a infraestrutura foi destruída para poupar créditos (gasto da sessão ≈ US$ 0,01).

## 1. Bloqueio automático por vulnerabilidade (Pilar 2)

[PR #3, simulação de falha](https://github.com/CaminhoLivreGS/caminho-livre/pull/3), fechado sem merge. Os segredos do PR são falsos e foram criados para o teste.

**Gitleaks** detecta a connection string do Azure Storage escrita no código:

![Gitleaks no PR #3](01-pr3-gitleaks-segredo.png)

**Semgrep** aponta XSS (`res.send` com entrada do usuário). O gate classifica `raw-html-format` como risco ALTO, que bloqueia, e `direct-response-write` como MÉDIO, que é só registrado:

![Semgrep XSS no PR #3](02-pr3-semgrep-xss.png)

**Semgrep** aponta segredo de JWT fixo no código (risco ALTO). O PR termina com "This branch has not been deployed":

![Semgrep JWT no PR #3](03-pr3-semgrep-jwt-sem-deploy.png)

**Gate de segurança** consolida o resultado e bloqueia o deploy:

![Gate de segurança: deploy bloqueado](04-gate-deploy-bloqueado.png)

**Trivy** encontra 68 vulnerabilidades HIGH/CRITICAL (65 HIGH, 3 CRITICAL) na imagem com base antiga (Alpine 3.21.3) e sem `apk upgrade`:

![Trivy: 68 CVEs](05-trivy-68-cves.png)

Logs completos dessa execução, guardados porque o GitHub apaga logs de Actions após 90 dias: [`logs-run-simulacao-43903627055.zip`](logs-run-simulacao-43903627055.zip) ([run original](https://github.com/CaminhoLivreGS/caminho-livre/actions/runs/43903627055)).

## 2. Pipeline aprovado com deploy automático no Azure (Pilares 1 e 2)

[Run #18](https://github.com/CaminhoLivreGS/caminho-livre/actions/runs/43898004965): os 6 jobs de verificação passam em paralelo, o gate aprova e o deploy publica no Azure Web App (login OIDC, push no ACR e smoke test em `/healthz`):

![Run verde com deploy](06-run-verde-com-deploy.png)

Infraestrutura criada pelo workflow *Infra (Terraform)*: o `apply` só rodou depois da aprovação manual no environment `infra` e disparou o deploy da aplicação:

![Apply aprovado no environment infra](15-infra-apply-aprovado.png)

Aplicação no ar em `https://app-caminholivre-prod-00e44e.azurewebsites.net`:

![App no ar no Azure](07-app-no-ar-azure.png)

## 3. Alerta do Azure Monitor (Pilar 3)

O alerta `alerta-caminholivre-prod-disponibilidade` (severidade 1) disparou às 12:35 (UTC-3), enquanto o app ainda respondia 503 antes do primeiro deploy. Ele se resolveu sozinho depois do deploy:

![Alertas no Azure Monitor](08-azure-monitor-alertas.png)

O gráfico mostra o `HealthCheckStatus` caindo de 100 para 0 e voltando ao normal:

![Detalhes do alerta de disponibilidade](09-azure-alerta-disponibilidade.png)

Na stack local (Prometheus + Grafana), uma queda simulada disparou o alerta `AplicacaoIndisponivel` em 2 minutos:

![Grafana: Métricas de Ouro durante a queda simulada](grafana-metricas-de-ouro-queda-simulada.png)

## 4. Notificações por e-mail do GitHub

O GitHub Code Scanning comentou os achados do Semgrep no PR #3:

![E-mail do Code Scanning](10-email-code-scanning-pr3.png)

Notificações de falha do pipeline na simulação. No primeiro commit (`34ae35f`), o Trivy falhou porque um comentário na linha do `FROM` quebrou o Dockerfile, e não por causa de CVEs. Isso foi corrigido no commit `3719912`, que gerou a execução válida acima.

| Commit | Push | PR |
|---|---|---|
| `34ae35f` (Dockerfile com erro de sintaxe) | ![push 34ae35f](11-email-run-falhou-push-34ae35f.png) | ![PR 34ae35f](12-email-run-falhou-pr-34ae35f.png) |
| `3719912` (execução válida) | ![push 3719912](13-email-run-falhou-push-3719912.png) | ![PR 3719912](14-email-run-falhou-pr-3719912.png) |
