// =============================================================================
// SIMULAÇÃO DE FALHA DevSecOps (evidência para a avaliação). NÃO MESCLAR.
// Todos os segredos abaixo são FALSOS e nunca existiram no Azure.
// =============================================================================
const express = require('express');
const jwt = require('jsonwebtoken');
const app = express();

// Gitleaks: connection string do Azure Storage escrita no código.
const AZURE_STORAGE = "DefaultEndpointsProtocol=https;AccountName=caminholivresimu;AccountKey=q8Zt3VnR5kLw2YpHs9JdF4mXc7BvN1aQe6TgUoPi0rSyWlKjHbGfDzXcVbNmQwErTyUiOpAsDfGhJkLzXcVbNm12==;EndpointSuffix=core.windows.net";

// Semgrep: XSS (entrada do usuário refletida sem escape).
app.get('/relato', (req, res) => {
  res.send('<p>' + req.query.nome + '</p>');
});

// Semgrep: segredo de JWT fixo no código.
jwt.sign({ usuario: 1 }, 'segredo-fixo-no-codigo');
