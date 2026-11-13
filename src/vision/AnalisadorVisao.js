/**
 * AnalisadorVisao — API da thread principal que delega o OpenCV.js a um
 * Web Worker em módulo (empacotado pelo Vite). A interface não trava durante
 * a análise e o OpenCV (~10 MB) só é baixado quando preparar()/analisar() é
 * chamado pela primeira vez (carregamento sob demanda).
 *
 *   const analisador = new AnalisadorVisao({ config: { LGPD: { CASCADE_BASE_URL: '/cascades/' } } });
 *   analisador.preparar();                       // ex.: ao escolher a foto
 *   const r = await analisador.analisar(img, 'ACESSIBILIDADE', { hashesAnteriores });
 *   await analisador.borrar(r.processedCanvas, [{ x, y, width, height }]);
 *
 * Sem suporte a Worker, cai para a thread principal (mesmo resultado).
 */
import { prepararEntrada, imageDataParaCanvas } from './VisionPipeline.js';

function mesclar(alvo, fonte) {
  for (const [k, v] of Object.entries(fonte ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && alvo[k]) mesclar(alvo[k], v);
    else alvo[k] = v;
  }
}

export class AnalisadorVisao {
  /**
   * @param {object} [o]
   * @param {object} [o.config]      sobrescritas de CONFIG (ex.: LGPD.CASCADE_BASE_URL)
   * @param {boolean} [o.usarWorker] false força a thread principal
   */
  constructor({ config = {}, usarWorker = typeof Worker !== 'undefined' } = {}) {
    // URLs relativas da config viram absolutas: o worker resolve caminhos a
    // partir da própria URL, não da página.
    this.config = structuredClone(config);
    if (this.config.LGPD?.CASCADE_BASE_URL) {
      this.config.LGPD.CASCADE_BASE_URL = new URL(this.config.LGPD.CASCADE_BASE_URL, globalThis.location?.href).href;
    }
    this.usarWorker = usarWorker;
    this.worker = null;
    this.pendentes = new Map();
    this.proximoId = 1;
    this.prontoPromessa = null;
    this.local = null; // módulo carregado na thread principal (fallback)
  }

  /** Inicia o worker e o OpenCV.js. Idempotente; chame cedo para adiantar o download. */
  preparar() {
    if (this.prontoPromessa) return this.prontoPromessa;
    this.prontoPromessa = (this.usarWorker ? this.#iniciarWorker() : this.#iniciarLocal()).catch((e) => {
      this.encerrar();
      throw e;
    });
    return this.prontoPromessa;
  }

  async #iniciarWorker() {
    // new URL(..., import.meta.url) + type 'module': o Vite empacota o worker.
    this.worker = new Worker(new URL('./vision.worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => {
      const p = this.pendentes.get(data.id);
      if (!p) return;
      this.pendentes.delete(data.id);
      if (data.ok) p.resolve(data.resultado);
      else p.reject(new Error(data.erro));
    };
    this.worker.onerror = (ev) => {
      const erro = new Error(ev.message || 'Erro no worker de visão.');
      for (const p of this.pendentes.values()) p.reject(erro);
      this.pendentes.clear();
    };
    await this.#enviar('iniciar', { config: this.config });
  }

  async #iniciarLocal() {
    const [{ default: cvModule }, modulo] = await Promise.all([import('@techstark/opencv-js'), import('./VisionPipeline.js')]);
    globalThis.cv = cvModule;
    mesclar(modulo.CONFIG, this.config);
    await modulo.carregarOpenCV();
    this.local = modulo;
  }

  #enviar(tipo, dados, transferir = []) {
    const id = this.proximoId++;
    return new Promise((resolve, reject) => {
      this.pendentes.set(id, { resolve, reject });
      this.worker.postMessage({ id, tipo, dados }, transferir);
    });
  }

  /**
   * Analisa a foto. Retorna { status, aceitar, mensagem, motivos, hash,
   * processedCanvas (anonimizado), detalhes }.
   */
  async analisar(elemento, categoria, opcoes = {}) {
    await this.preparar();
    const { imageData, dimensaoOriginal } = prepararEntrada(elemento);
    const op = { ...opcoes, dimensaoOriginal };
    const r = this.worker
      ? await this.#enviar('analisar', { imageData, categoria, opcoes: op }, [imageData.data.buffer])
      : await this.local.analisarImageData(imageData, categoria, op);
    const { imagemProcessada, ...resto } = r;
    return { ...resto, processedCanvas: imageDataParaCanvas(imagemProcessada) };
  }

  /** Borra regiões (coordenadas em pixels do canvas) e atualiza o canvas. */
  async borrar(canvas, regioes) {
    await this.preparar();
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const img = this.worker
      ? await this.#enviar('borrar', { imageData, regioes }, [imageData.data.buffer])
      : await this.local.borrarImageData(imageData, regioes);
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  /** Encerra o worker e libera a memória do WASM. */
  encerrar() {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pendentes.values()) p.reject(new Error('Analisador encerrado.'));
    this.pendentes.clear();
    this.prontoPromessa = null;
  }
}
