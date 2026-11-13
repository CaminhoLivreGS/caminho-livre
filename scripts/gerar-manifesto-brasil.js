#!/usr/bin/env node
/**
 * Gera dataset/brasil/manifest.json a partir das pastas de fotos:
 *
 *   dataset/brasil/<categoria>/positivo/   fotos COM o problema da categoria
 *   dataset/brasil/<categoria>/negativo/   fotos SEM o problema (calçada boa, etc.)
 *   categorias: acessibilidade, obstaculo, alagamento
 *
 * Separação treino/teste determinística: cada foto vai para "teste" se o
 * SHA-256 do CONTEÚDO cair abaixo da fração de teste (padrão 30%). Renomear
 * ou mover a foto entre execuções não muda o conjunto; a mesma foto copiada
 * em duas categorias cai no mesmo conjunto nas duas.
 *
 * Regra de uso: calibre os limiares olhando só o TREINO; o TESTE serve para
 * medir a precisão real e só deve ser consultado no fim.
 *
 *   npm run dataset:brasil
 *   npm run dataset:brasil -- --teste=0.25
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const BASE = path.join(RAIZ, 'dataset/brasil');
const CATEGORIAS = { acessibilidade: 'ACESSIBILIDADE', obstaculo: 'OBSTACULO', alagamento: 'ALAGAMENTO' };
const EXTENSOES = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const fracaoTeste = Number(process.argv.find((a) => a.startsWith('--teste='))?.slice(8) ?? 0.3);
if (!(fracaoTeste > 0 && fracaoTeste < 1)) throw new Error('--teste deve estar entre 0 e 1');

/** Fração em [0, 1) derivada dos primeiros 4 bytes do SHA-256 do conteúdo. */
async function sorteio(arquivo) {
  const hash = createHash('sha256').update(await readFile(arquivo)).digest();
  return hash.readUInt32BE(0) / 2 ** 32;
}

async function listar(pasta) {
  try {
    return (await readdir(pasta)).filter((n) => EXTENSOES.has(path.extname(n).toLowerCase())).sort();
  } catch {
    return [];
  }
}

const manifesto = { diretorio: 'dataset/brasil/', fracaoTeste, geradoEm: new Date().toISOString() };
const resumo = [];
for (const [pasta, cat] of Object.entries(CATEGORIAS)) {
  const entrada = { treino: { positivos: [], negativos: [] }, teste: { positivos: [], negativos: [] } };
  for (const [sub, chave] of [['positivo', 'positivos'], ['negativo', 'negativos']]) {
    const dirSub = path.join(BASE, pasta, sub);
    await mkdir(dirSub, { recursive: true }); // cria a estrutura para quem for adicionar fotos
    for (const nome of await listar(dirSub)) {
      const conjunto = (await sorteio(path.join(dirSub, nome))) < fracaoTeste ? 'teste' : 'treino';
      entrada[conjunto][chave].push(`${pasta}/${sub}/${nome}`);
    }
  }
  manifesto[cat] = entrada;
  const n = (c) => entrada[c].positivos.length + entrada[c].negativos.length;
  resumo.push(`${cat.padEnd(15)} treino ${String(n('treino')).padStart(3)} (${entrada.treino.positivos.length}+ / ${entrada.treino.negativos.length}-)   teste ${String(n('teste')).padStart(3)} (${entrada.teste.positivos.length}+ / ${entrada.teste.negativos.length}-)`);
}

await writeFile(path.join(BASE, 'manifest.json'), JSON.stringify(manifesto, null, 2) + '\n');
console.log(resumo.join('\n'));
console.log(`\nManifesto gravado em dataset/brasil/manifest.json (teste = ${Math.round(fracaoTeste * 100)}%).`);
const vazias = Object.keys(CATEGORIAS).filter((p) => !manifesto[CATEGORIAS[p]].teste.positivos.length || !manifesto[CATEGORIAS[p]].teste.negativos.length);
if (vazias.length) console.log(`Atenção: sem positivos ou negativos de teste em: ${vazias.join(', ')}. Adicione mais fotos (recomendado: 40+ por categoria).`);
