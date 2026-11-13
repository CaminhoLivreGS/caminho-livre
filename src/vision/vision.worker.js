/* eslint-env worker */
/**
 * Web Worker (módulo) que roda o OpenCV.js fora da thread da interface.
 * O OpenCV entra pelo pacote npm (@techstark/opencv-js, mesma versão 4.9.0
 * dos testes) e o Vite empacota o worker com todo o pipeline. O pacote só é
 * baixado quando o worker é criado (AnalisadorVisao.preparar()).
 *
 * Protocolo (postMessage): { id, tipo, dados } → { id, ok, resultado | erro }
 *   tipo 'iniciar'  dados: { config }
 *   tipo 'analisar' dados: { imageData, categoria, opcoes }
 *   tipo 'borrar'   dados: { imageData, regioes }
 * Os buffers de ImageData são transferidos (sem cópia) nos dois sentidos.
 */
import cvModule from '@techstark/opencv-js';
import * as modulo from './VisionPipeline.js';

globalThis.cv = cvModule;
let inicializacao = null;

function mesclar(alvo, fonte) {
  for (const [k, v] of Object.entries(fonte ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && alvo[k]) mesclar(alvo[k], v);
    else alvo[k] = v;
  }
}

self.onmessage = async ({ data }) => {
  const { id, tipo, dados } = data;
  try {
    if (tipo === 'iniciar') {
      inicializacao ??= (async () => {
        mesclar(modulo.CONFIG, dados.config);
        await modulo.carregarOpenCV(); // espera cv['onRuntimeInitialized']
      })().catch((e) => {
        inicializacao = null; // permite nova tentativa
        throw e;
      });
      await inicializacao;
      self.postMessage({ id, ok: true });
      return;
    }
    if (!inicializacao) throw new Error('Worker não iniciado.');
    await inicializacao;

    if (tipo === 'analisar') {
      const r = await modulo.analisarImageData(dados.imageData, dados.categoria, dados.opcoes);
      self.postMessage({ id, ok: true, resultado: r }, [r.imagemProcessada.data.buffer]);
    } else if (tipo === 'borrar') {
      const img = await modulo.borrarImageData(dados.imageData, dados.regioes);
      self.postMessage({ id, ok: true, resultado: img }, [img.data.buffer]);
    } else {
      throw new Error(`Tipo de mensagem desconhecido: ${tipo}`);
    }
  } catch (e) {
    self.postMessage({ id, ok: false, erro: e?.message ?? String(e) });
  }
};
