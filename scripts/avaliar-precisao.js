#!/usr/bin/env node
/**
 * Teste de regressão de precisão: roda avaliacao.html no Chrome headless
 * contra dataset/manifest.json e compara com test/limites-precisao.json.
 * Sai com código 1 se algum número piorar.
 *
 *   npm run test:precisao               categorias + filtro de cena (~5 min)
 *   npm run test:precisao -- --completo inclui filtros de qualidade (~20 min)
 *   npm run test:precisao -- --so=ALAGAMENTO   só uma avaliação
 *   npm run test:precisao -- --dataset=brasil --conjunto=teste   mede o conjunto
 *       de teste brasileiro (relatório, sem limites; ver npm run dataset:brasil)
 *
 * Sobe um servidor estático próprio, só em 127.0.0.1 e numa porta aleatória.
 * Chrome: caminho padrão do macOS ou variável CHROME.
 */
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const completo = process.argv.includes('--completo');
// --so=ALAGAMENTO (ou CENA, QUALIDADE...) roda só essa avaliação.
const so = process.argv.find((a) => a.startsWith('--so='))?.slice(5);
// --dataset=brasil --conjunto=teste mede outro conjunto (só relatório, sem limites).
const opcao = (nome, padrao) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.split('=')[1] ?? padrao;
const dataset = opcao('dataset', 'commons');
const conjunto = opcao('conjunto', 'treino');
const comLimites = dataset === 'commons' && conjunto === 'treino';
const rodar = (nome) => {
  if (!comLimites && !['ACESSIBILIDADE', 'OBSTACULO', 'ALAGAMENTO'].includes(nome)) return false;
  return so ? so === nome : nome !== 'QUALIDADE' || completo;
};
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.xml': 'application/xml', '.svg': 'image/svg+xml' };

// ---- Servidor estático (somente leitura, sem sair da raiz do projeto) -------
const servidor = createServer(async (req, res) => {
  try {
    const caminho = path.resolve(RAIZ, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!caminho.startsWith(RAIZ)) throw Object.assign(new Error('fora da raiz'), { status: 403 });
    const dados = await readFile(caminho);
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(caminho)] ?? 'application/octet-stream' });
    res.end(dados);
  } catch (e) {
    res.writeHead(e.status ?? 404);
    res.end();
  }
});
await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${servidor.address().port}`;

// ---- Executa uma avaliação no Chrome headless --------------------------------
async function avaliar(categoria) {
  const perfil = await mkdtemp(path.join(tmpdir(), 'cl-chrome-'));
  try {
    const html = await new Promise((ok, falha) =>
      execFile(
        CHROME,
        ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${perfil}`, '--virtual-time-budget=3000000', '--dump-dom', `${base}/avaliacao.html?cat=${categoria}&dataset=${dataset}&conjunto=${conjunto}`],
        { maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60 * 1000 },
        (erro, saida) => (erro ? falha(erro) : ok(saida)),
      ),
    );
    const bloco = html.match(/<pre id="out"[^>]*>([\s\S]*?)<\/pre>/)?.[1] ?? '';
    const texto = bloco.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    if (texto.startsWith('ERRO')) throw new Error(`${categoria}: ${texto.slice(0, 300)}`);
    return JSON.parse(texto.slice(0, texto.indexOf('\n\n')))[categoria];
  } finally {
    await rm(perfil, { recursive: true, force: true });
  }
}

// ---- Compara com os limites -------------------------------------------------
const limites = JSON.parse(await readFile(path.join(RAIZ, 'test/limites-precisao.json'), 'utf8'));
const falhas = [];
const checar = (nome, valor, op, limite) => {
  const ok = op === '>=' ? valor >= limite : valor <= limite;
  console.log(`  ${ok ? 'ok  ' : 'FALHA'} ${nome}: ${valor} (limite ${op} ${limite})`);
  if (!ok) falhas.push(nome);
};

try {
  for (const cat of ['ACESSIBILIDADE', 'OBSTACULO', 'ALAGAMENTO'].filter(rodar)) {
    const r = await avaliar(cat);
    const l = limites[cat];
    if (!r.total) {
      console.log(`${cat}  (sem fotos em ${dataset}/${conjunto})`);
      continue;
    }
    const precisao = r.VP + r.FP ? r.VP / (r.VP + r.FP) : null;
    const revocacao = r.VP + r.FN ? r.VP / (r.VP + r.FN) : null;
    const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
    console.log(`${cat}  VP=${r.VP} FN=${r.FN} VN=${r.VN} FP=${r.FP}  acurácia ${pct(r.acuracia)}  precisão ${pct(precisao)}  revocação ${pct(revocacao)}  (${r.total} fotos)`);
    if (!comLimites) {
      if (r.rejeitados.length) console.log(`  fotos rejeitadas pela pré-validação: ${r.rejeitados.join('; ')}`);
      continue;
    }
    checar(`${cat} acurácia`, r.acuracia, '>=', l.acuraciaMin);
    checar(`${cat} falsos positivos`, r.FP, '<=', l.falsosPositivosMax);
    checar(`${cat} fotos reais rejeitadas`, r.rejeitados.length, '<=', l.fotosReaisRejeitadasMax);
  }

  if (rodar('CENA')) {
    const cena = await avaliar('CENA');
    console.log('CENA');
    checar('fotos de rua rejeitadas pelo filtro de cena', cena.rejeitadosRua.length, '<=', limites.CENA.fotosDeRuaRejeitadasMax);
    checar(`fotos fora de contexto rejeitadas (de ${cena.totalFora})`, cena.rejeitadosFora, '>=', limites.CENA.foraDeContextoRejeitadasMin);
  }

  if (rodar('PLACAS')) {
    const p = await avaliar('PLACAS');
    console.log('PLACAS (LGPD)');
    checar(`placas cobertas pelo borrão (de ${p.composicoes})`, p.cobertas, '>=', limites.PLACAS.placasCobertasMin);
    checar(`área média borrada por engano em ${p.totalFundos} fotos de rua`, p.fpArea, '<=', limites.PLACAS.areaFalsaMediaMax);
  }

  if (rodar('QUALIDADE')) {
    const q = await avaliar('QUALIDADE');
    console.log('QUALIDADE');
    checar('fotos reais rejeitadas por qualidade', q.originaisRejeitados.length, '<=', limites.QUALIDADE.originaisRejeitadosMax);
    checar(`fotos degradadas aceitas (de ${q.total * 4})`, q.degradadasAceitas.length, '<=', limites.QUALIDADE.degradadasAceitasMax);
    checar(`reenvios detectados (de ${q.total})`, q.dupDetectadas, '>=', q.total);
    checar('colisões de hash entre fotos diferentes', q.colisoes.length, '<=', limites.QUALIDADE.colisoesMax);
  }
} catch (e) {
  console.error('Erro ao avaliar:', e.message);
  falhas.push('execução');
} finally {
  servidor.close();
}

console.log(falhas.length ? `\n${falhas.length} regressão(ões).` : '\nSem regressões.');
process.exit(falhas.length ? 1 : 0);
