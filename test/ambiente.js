/**
 * Ambiente de teste no Node: carrega o OpenCV.js (mesma versão 4.9.0 do
 * navegador) e imita as APIs de navegador que o núcleo usa — ImageData e
 * fetch (para os Haar Cascades em public/cascades/).
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import cvModule from '@techstark/opencv-js';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));

globalThis.ImageData ??= class ImageData {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
};

const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (url, ...resto) => {
  const u = String(url);
  if (u.startsWith('cascades/')) {
    const dados = await readFile(`${RAIZ}public/${u}`);
    return { ok: true, status: 200, arrayBuffer: async () => dados.buffer.slice(dados.byteOffset, dados.byteOffset + dados.byteLength) };
  }
  return fetchOriginal(url, ...resto);
};

globalThis.cv = cvModule;
export const P = await import('../src/vision/VisionPipeline.js');
P.CONFIG.LGPD.CASCADE_BASE_URL = 'cascades/';
await P.carregarOpenCV();

/** Gerador pseudoaleatório com semente (testes reproduzíveis). */
export function aleatorio(semente = 42) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Imagem RGBA sintética: fundo cinza com ruído (textura de asfalto).
 * `desenhar(x, y, rgb)` permite pintar formas por cima.
 */
export function imagemSintetica({ largura = 640, altura = 480, cor = [120, 120, 120], ruido = 40, semente = 42, desenhar } = {}) {
  const rnd = aleatorio(semente);
  const data = new Uint8ClampedArray(largura * altura * 4);
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const i = (y * largura + x) * 4;
      const n = (rnd() - 0.5) * ruido;
      let rgb = [cor[0] + n, cor[1] + n, cor[2] + n];
      if (desenhar) rgb = desenhar(x, y, rgb, rnd) ?? rgb;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    }
  }
  return new ImageData(data, largura, altura);
}

/** Converte ImageData em cv.Mat RGBA (quem chama deve dar .delete()). */
export const paraMat = (img) => cv.matFromImageData(img);

/** Tamanho atual do heap do WASM, para detectar vazamento de memória. */
export const heapBytes = () => cv.HEAP8.length;
