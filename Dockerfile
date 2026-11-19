# syntax=docker/dockerfile:1.7
# =============================================================================
# Caminho Livre - imagem de produção (SPA Vite + OpenCV.js servida por nginx)
#
# Multi-stage:
#   1. build   -> Node: instala dependências (npm ci), baixa OpenCV.js e Haar
#                 Cascades com verificação SHA-256 e gera o dist/ com o Vite.
#   2. runtime -> nginx-unprivileged: só arquivos estáticos, usuário non-root
#                 (UID 101), porta 8080 (> 1024, não exige privilégio).
#
# Nenhum segredo entra na imagem: não há ARG/ENV com credenciais, e o
# .dockerignore exclui .env, *.tfvars, *.tfstate e afins.
# Dica para o CI: fixe as imagens base por digest (@sha256:...) para builds
# reprodutíveis; o Trivy acusa quando a base fica desatualizada.
# =============================================================================

# ---------- Estágio 1: build ----------
FROM node:22-alpine3.24 AS build

WORKDIR /app

# curl: download das dependências binárias (o script confere o SHA-256).
RUN apk add --no-cache curl

# Copia só os manifests primeiro para aproveitar o cache de camadas do npm ci.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Código-fonte (filtrado pelo .dockerignore).
COPY . .

# Baixa opencv.js + cascades para public/ (falha se o checksum não conferir)
# e gera o bundle de produção em dist/. O opencv.js avulso (10 MB) só serve
# ao avaliacao.html (dev): o app usa o OpenCV empacotado no worker de visão.
RUN npm run deps && npm run build && rm -rf dist/opencv

# ---------- Estágio 2: runtime ----------
# Linha "stable" do nginx (1.30) sobre Alpine 3.24.
FROM nginxinc/nginx-unprivileged:1.30-alpine3.24 AS runtime

LABEL org.opencontainers.image.title="caminho-livre" \
      org.opencontainers.image.description="Caminho Livre - denúncias de acessibilidade urbana com visão computacional (OpenCV.js) e anonimização LGPD no navegador" \
      org.opencontainers.image.licenses="Apache-2.0"

# Atualiza pacotes do SO (reduz CVEs apontadas pelo Trivy) e volta para o
# usuário sem privilégios logo em seguida.
#
# O nginx vem do repositório oficial nginx.org, que a imagem base não deixa
# configurado: sem o passo abaixo, o apk upgrade não recebe correções do nginx
# publicadas antes de uma nova tag da imagem. Mesmo método do Dockerfile
# oficial: a chave de assinatura só é aceita se o SHA-512 conferir, e é removida
# depois. A versão mínima fica explícita para o build falhar se não estiver lá.
ARG NGINX_KEY_SHA512=e09fa32f0a0eab2b879ccbbc4d0e4fb9751486eedda75e35fac65802cc9faa266425edf83e261137a2f4d16281ce2c1a5f4502930fe75154723da014214f0655
ARG NGINX_MIN_VERSION=1.30.7
USER root
RUN set -eu; \
    wget -q -O /tmp/nginx_signing.rsa.pub https://nginx.org/keys/nginx_signing.rsa.pub; \
    echo "${NGINX_KEY_SHA512} */tmp/nginx_signing.rsa.pub" | sha512sum -c -; \
    mv /tmp/nginx_signing.rsa.pub /etc/apk/keys/; \
    NGINX_REPO="https://nginx.org/packages/alpine/v$(grep -oE '^[0-9]+\.[0-9]+' /etc/alpine-release)/main"; \
    apk upgrade --no-cache -X "$NGINX_REPO"; \
    apk add --no-cache -X "$NGINX_REPO" "nginx>=${NGINX_MIN_VERSION}"; \
    rm -f /etc/apk/keys/nginx_signing.rsa.pub; \
    nginx -v; \
    rm -rf /var/cache/apk/*

# Configuração do servidor (headers de segurança, /healthz, métricas internas).
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY docker/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf

# Artefatos estáticos: pertencem ao root e são só leitura para o nginx.
COPY --from=build /app/dist /usr/share/nginx/html

# OBRIGATÓRIO: roda como usuário non-root (nginx, UID 101 na imagem base).
USER 101

# 8080 = aplicação | 8081 = stub_status (métricas, só rede interna)
EXPOSE 8080 8081

# wget já vem no busybox da imagem alpine.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
