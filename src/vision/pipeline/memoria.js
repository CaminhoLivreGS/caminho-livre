/* global cv */

// ---------------------------------------------------------------------------
// 2. Gestão de memória
// ---------------------------------------------------------------------------

/**
 * Registra objetos do WASM (cv.Mat, MatVector, RectVector, ...) e libera
 * todos em liberar(). Uso obrigatório: try { ... } finally { t.liberar(); }
 */
export class Rastreador {
  constructor() {
    this.itens = [];
  }
  add(obj) {
    this.itens.push(obj);
    return obj;
  }
  liberar() {
    for (let i = this.itens.length - 1; i >= 0; i--) {
      const o = this.itens[i];
      try {
        if (o && !(typeof o.isDeleted === 'function' && o.isDeleted())) o.delete();
      } catch {
        // já liberado
      }
    }
    this.itens = [];
  }
}
