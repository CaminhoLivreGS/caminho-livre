/* global cv */
import { processarAcessibilidade } from './acessibilidade.js';
import { processarAlagamento } from './alagamento.js';
import { carregarClassificadores } from './cascades.js';
import { ALIASES, CATEGORIAS, CONFIG } from './config.js';
import { anonimizar, detectarRegioesSensiveis } from './lgpd.js';
import { Rastreador } from './memoria.js';
import { processarObstaculo } from './obstaculo.js';
import { carregarOpenCV } from './opencv.js';
import { avaliarCena, avaliarQualidade, calcularDHash, distanciaHamming, fracaoRostos } from './prevalidacao.js';
import { arred, redimensionarMaiorLado } from './util.js';

// ---------------------------------------------------------------------------
// 13. Interface central
// ---------------------------------------------------------------------------

export const STATUS = Object.freeze({
  CONFIRMADO: 'CONFIRMADO', // evidência encontrada: entra direto
  INCONCLUSIVO: 'INCONCLUSIVO', // foto boa, sem evidência automática: vai para moderação
  REJEITADO: 'REJEITADO', // problema claro com a FOTO: pedir outra ao usuário
});

/** Mensagens para o usuário, por motivo. */
export const MENSAGENS = Object.freeze({
  RESOLUCAO: 'A foto tem resolução muito baixa. Use a câmera do celular diretamente.',
  NITIDEZ: 'A foto ficou tremida ou fora de foco. Tente de novo, segurando o celular firme.',
  ESCURA: 'A foto está escura demais. Tente com mais luz ou durante o dia.',
  CLARA: 'A foto está clara demais (estourada). Evite fotografar contra o sol.',
  EXPOSICAO: 'A foto tem áreas muito escuras ou muito claras. Tente outro ângulo.',
  DUPLICATA: 'Esta foto já foi enviada antes.',
  ROSTO_DOMINANTE: 'A foto parece mostrar pessoas em destaque. Fotografe o local do problema.',
  FORA_DE_CONTEXTO: 'A foto não parece mostrar uma rua ou calçada. Fotografe o local do problema.',
  CONFIRMADO: 'Identificamos o problema na foto.',
  INCONCLUSIVO: 'Não conseguimos confirmar automaticamente. Sua denúncia será revisada por um moderador.',
});

/**
 * NÚCLEO (sem DOM — roda na thread principal ou num Web Worker).
 * Valida a imagem para a categoria informada.
 *
 * @param {ImageData} imageData pixels RGBA da foto (ver prepararEntrada)
 * @param {'ACESSIBILIDADE'|'OBSTACULO'|'ALAGAMENTO'} categoria
 *   ('BURACO' e 'PISO_TATIL' ainda são aceitos e viram 'ACESSIBILIDADE')
 * @param {{hashesAnteriores?: string[], dimensaoOriginal?: {largura: number, altura: number}}} [opcoes]
 *   hashesAnteriores: dHash de fotos já enviadas (detecta reenvio);
 *   dimensaoOriginal: tamanho da foto antes de qualquer redução (filtro de resolução).
 * @returns {Promise<{
 *   status: 'CONFIRMADO'|'INCONCLUSIVO'|'REJEITADO',
 *   aceitar: boolean,        // false só em REJEITADO
 *   isValid: boolean,        // true só em CONFIRMADO (compatibilidade)
 *   motivos: string[],       // códigos; ver MENSAGENS
 *   mensagem: string,        // texto pronto para o usuário
 *   hash: string,            // dHash para deduplicação no backend
 *   imagemProcessada: ImageData, // anonimizada + marcações
 *   detalhes: object
 * }>}
 */
export async function analisarImageData(imageData, categoria, opcoes = {}) {
  const cat = ALIASES[categoria] ?? categoria;
  if (!Object.values(CATEGORIAS).includes(cat)) throw new Error(`Categoria inválida: ${categoria}`);
  if (!imageData) throw new Error('imageData é obrigatório.');
  const inicio = typeof performance !== 'undefined' ? performance.now() : Date.now();

  await carregarOpenCV();

  let classificadores = [];
  let avisoLGPD = null;
  try {
    classificadores = await carregarClassificadores();
  } catch (erro) {
    if (CONFIG.LGPD.EXIGIR_ANONIMIZACAO) {
      throw new Error(`Anonimização indisponível, análise abortada (LGPD): ${erro.message}`);
    }
    avisoLGPD = erro.message;
  }

  const t = new Rastreador();
  try {
    const original = t.add(cv.matFromImageData(imageData));
    const src = t.add(redimensionarMaiorLado(original, CONFIG.GERAL.MAX_DIMENSAO));
    const dimensaoOriginal = opcoes.dimensaoOriginal ?? { largura: original.cols, altura: original.rows };

    // Pipeline 1 (detecção) em resolução maior.
    const det = t.add(redimensionarMaiorLado(original, CONFIG.LGPD.MAX_DIMENSAO_DETECCAO));
    const detGray = t.add(new cv.Mat());
    cv.cvtColor(det, detGray, cv.COLOR_RGBA2GRAY);
    const regioes = detectarRegioesSensiveis(detGray, classificadores, src.cols / detGray.cols);

    // Pré-validação (barata): qualidade e duplicata. Se reprovar, os
    // pipelines nem rodam — o resultado não seria confiável numa foto ruim.
    const qualidade = avaliarQualidade(dimensaoOriginal, src);
    const cena = avaliarCena(src);
    const hash = calcularDHash(src);
    const anteriores = opcoes.hashesAnteriores ?? [];
    const distMin = anteriores.reduce((m, h) => Math.min(m, distanciaHamming(hash, h)), 64);
    const duplicata = distMin <= CONFIG.QUALIDADE.DUPLICATA_DIST_MAX;
    // Rosto dominante (selfie/retrato): num retrato, os detectores de piso
    // disparam na roupa/fundo (falso positivo medido no dataset).
    const rostos = fracaoRostos(regioes, src);
    const motivos = [...qualidade.motivos];
    if (duplicata) motivos.push('DUPLICATA');
    if (rostos >= CONFIG.QUALIDADE.ROSTO_DOMINANTE) motivos.push('ROSTO_DOMINANTE');
    // Cena suspeita: rejeita, exceto em ALAGAMENTO (água calma é lisa de
    // verdade) — lá a foto vai para moderação em vez de ser confirmada.
    const cenaSuspeita = cena.suspeita && motivos.length === 0;
    if (cenaSuspeita && cat !== CATEGORIAS.ALAGAMENTO) motivos.push('FORA_DE_CONTEXTO');

    const saida = t.add(src.clone());
    let resultado = { isValid: false, evidencias: [], detalhes: {} };
    if (motivos.length === 0) {
      switch (cat) {
        case CATEGORIAS.ALAGAMENTO:
          resultado = processarAlagamento(src, saida);
          break;
        case CATEGORIAS.OBSTACULO:
          resultado = processarObstaculo(src, saida);
          break;
        case CATEGORIAS.ACESSIBILIDADE:
          resultado = processarAcessibilidade(src, saida);
          break;
      }
    }

    // Decisão em 3 níveis. Rejeitar é reservado a problemas claros com a
    // FOTO; ausência de evidência automática vai para moderação humana.
    let status;
    if (motivos.length) status = STATUS.REJEITADO;
    else if (resultado.isValid && !cenaSuspeita) status = STATUS.CONFIRMADO;
    else status = STATUS.INCONCLUSIVO;

    // Pipeline 1 (borrão) por ÚLTIMO: cobre também as marcações desenhadas.
    anonimizar(saida, regioes);

    // Cópia para fora do heap WASM (a Mat é liberada no finally).
    const imagemProcessada = new ImageData(new Uint8ClampedArray(saida.data), saida.cols, saida.rows);

    const mensagem = status === STATUS.REJEITADO ? MENSAGENS[motivos[0]] : MENSAGENS[status];
    const fim = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return {
      status,
      aceitar: status !== STATUS.REJEITADO,
      isValid: status === STATUS.CONFIRMADO,
      motivos,
      mensagem,
      hash,
      imagemProcessada,
      detalhes: {
        categoria: cat,
        tempoMs: Math.round(fim - inicio),
        qualidade: { nitidez: qualidade.nitidez, brilho: qualidade.brilho, saturados: qualidade.saturados },
        cena,
        duplicata: { distanciaMinima: anteriores.length ? distMin : null },
        fracaoRosto: arred(rostos, 4),
        ...resultado.detalhes,
        evidencias: resultado.evidencias.map((e) => ({
          ...e,
          x: Math.round(e.x),
          y: Math.round(e.y),
          width: Math.round(e.width),
          height: Math.round(e.height),
        })),
        anonimizacao: { regioes, aviso: avisoLGPD },
      },
    };
  } finally {
    t.liberar();
  }
}

/**
 * NÚCLEO (sem DOM). Borrão manual de LGPD: o usuário marca regiões que o
 * Haar não detectou (rosto de perfil, placa, documento). Mesmo GaussianBlur
 * proporcional do Pipeline 1, sem padding (a região já é a que o usuário quer).
 *
 * @param {ImageData} imageData imagem processada atual
 * @param {{x: number, y: number, width: number, height: number}[]} regioes em pixels da imagem
 * @returns {Promise<ImageData>} nova imagem borrada
 */
export async function borrarImageData(imageData, regioes) {
  await carregarOpenCV();
  const mat = cv.matFromImageData(imageData);
  try {
    const validas = regioes
      .map((r) => {
        const x = Math.max(0, Math.round(r.x));
        const y = Math.max(0, Math.round(r.y));
        return {
          x,
          y,
          width: Math.min(mat.cols - x, Math.round(r.width)),
          height: Math.min(mat.rows - y, Math.round(r.height)),
        };
      })
      .filter((r) => r.width >= 2 && r.height >= 2);
    anonimizar(mat, validas, { ...CONFIG.LGPD, PADDING: 0 });
    return new ImageData(new Uint8ClampedArray(mat.data), mat.cols, mat.rows);
  } finally {
    mat.delete();
  }
}
