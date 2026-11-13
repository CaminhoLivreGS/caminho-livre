/* global cv */
import { CONFIG } from './config.js';

// ---------------------------------------------------------------------------
// 3. Inicialização do OpenCV.js
// ---------------------------------------------------------------------------

let promessaOpenCV = null;

export function opencvPronto() {
  const c = globalThis.cv;
  return Boolean(c && typeof c.Mat === 'function');
}

/**
 * Resolve quando cv['onRuntimeInitialized'] disparar (ou se o runtime já
 * estiver pronto). Suporta builds antigos (objeto Module) e builds >= 4.8,
 * em que `cv` é exposto como Promise.
 * Resolve com `undefined` de propósito: o objeto Module do Emscripten possui
 * um `.then` próprio e resolvê-lo dentro de uma Promise pode gerar laço.
 */
export function carregarOpenCV(timeoutMs = CONFIG.GERAL.TIMEOUT_OPENCV_MS) {
  if (promessaOpenCV) return promessaOpenCV;

  promessaOpenCV = new Promise((resolve, reject) => {
    let finalizado = false;
    const concluir = (erro) => {
      if (finalizado) return;
      finalizado = true;
      clearInterval(poll);
      clearTimeout(timer);
      if (erro) reject(erro);
      else resolve();
    };

    const conectar = () => {
      const c = globalThis.cv;
      if (!c) return false;
      if (opencvPronto()) {
        concluir();
        return true;
      }
      if (typeof c.then === 'function') {
        c.then((modulo) => {
          if (modulo && typeof modulo.Mat === 'function') globalThis.cv = modulo;
          if (opencvPronto()) concluir();
        });
      }
      const anterior = c.onRuntimeInitialized;
      c.onRuntimeInitialized = () => {
        if (typeof anterior === 'function') anterior();
        concluir();
      };
      return true;
    };

    const poll = setInterval(() => {
      if (opencvPronto()) concluir();
    }, 50);
    const timer = setTimeout(
      () => concluir(new Error('OpenCV.js não inicializou dentro do tempo limite.')),
      timeoutMs,
    );

    if (!conectar()) {
      const espera = setInterval(() => {
        if (finalizado || conectar()) clearInterval(espera);
      }, 50);
    }
  }).catch((erro) => {
    promessaOpenCV = null;
    throw erro;
  });

  return promessaOpenCV;
}
