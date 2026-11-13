/* global cv */
import { analisarImageData, borrarImageData } from './analise.js';
import { CONFIG } from './config.js';

// ---------------------------------------------------------------------------
// 14. Camada da thread principal (usa DOM: <img>, <canvas>)
// ---------------------------------------------------------------------------

/**
 * Converte <img>/<canvas> em ImageData, reduzindo fotos grandes já no
 * navegador (drawImage é acelerado por GPU). Uma foto de 12 MP vira ~2,5 MP:
 * menos memória no WASM e menos dados copiados para o worker. A análise
 * usa no máximo 1280 px (LGPD) e 1024 px (pipelines), então não há perda.
 */
export function prepararEntrada(elemento, maxLado = CONFIG.GERAL.MAX_ENTRADA) {
  const largura = elemento.naturalWidth || elemento.videoWidth || elemento.width;
  const altura = elemento.naturalHeight || elemento.videoHeight || elemento.height;
  if (!largura || !altura) throw new Error('Imagem ainda não carregada.');
  const f = Math.min(1, maxLado / Math.max(largura, altura));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(largura * f);
  canvas.height = Math.round(altura * f);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(elemento, 0, 0, canvas.width, canvas.height);
  return {
    imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
    dimensaoOriginal: { largura, altura },
  };
}

/** Desenha um ImageData num <canvas> novo (ou no informado). */
export function imageDataParaCanvas(imageData, canvas = document.createElement('canvas')) {
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Versão para a thread principal (mesma API das versões anteriores).
 * Para não travar a interface, prefira AnalisadorVisao (Web Worker).
 * processedCanvas é SEMPRE a versão anonimizada — é ela que deve ir ao backend.
 */
export async function analisarImagem(imageElement, categoria, opcoes = {}) {
  if (!imageElement) throw new Error('imageElement é obrigatório.');
  const { imageData, dimensaoOriginal } = prepararEntrada(imageElement);
  const r = await analisarImageData(imageData, categoria, { ...opcoes, dimensaoOriginal });
  const { imagemProcessada, ...resto } = r;
  return { ...resto, processedCanvas: imageDataParaCanvas(imagemProcessada) };
}

/** Versão para a thread principal do borrão manual (altera o canvas). */
export async function borrarCanvas(canvas, regioes) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = await borrarImageData(ctx.getImageData(0, 0, canvas.width, canvas.height), regioes);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Converte o canvas processado em Blob (JPEG) para upload ao backend. */
export function canvasParaBlob(canvas, tipo = 'image/jpeg', qualidade = 0.9) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Falha ao gerar Blob.'))), tipo, qualidade);
  });
}
