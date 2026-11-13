/* global cv */
import { CONFIG } from './config.js';
import { Rastreador } from './memoria.js';
import { ccStat, impar } from './util.js';


// ---------------------------------------------------------------------------
// 6. Pipeline 1 — LGPD
// ---------------------------------------------------------------------------

/**
 * Detecta rostos (frontal + perfil nos dois sentidos) e placas.
 * `gray` pode estar em resolução maior que a imagem de saída; `fator`
 * converte as coordenadas (saida.cols / gray.cols).
 */
export function detectarRegioesSensiveis(gray, classificadores, fator = 1, cfg = CONFIG.LGPD) {
  const t = new Rastreador();
  const regioes = [];
  try {
    const eq = t.add(new cv.Mat());
    cv.equalizeHist(gray, eq);
    let espelhada = null;

    const detectar = (img, classificador, minNeighbors, espelhar, tipo, fonte) => {
      const rects = new cv.RectVector();
      try {
        classificador.detectMultiScale(
          img,
          rects,
          cfg.SCALE_FACTOR,
          minNeighbors,
          0,
          new cv.Size(cfg.MIN_TAMANHO, cfg.MIN_TAMANHO),
          new cv.Size(0, 0),
        );
        for (let i = 0; i < rects.size(); i++) {
          const r = rects.get(i);
          const x = espelhar ? img.cols - r.x - r.width : r.x;
          regioes.push({ tipo, fonte, x: x * fator, y: r.y * fator, width: r.width * fator, height: r.height * fator });
        }
      } finally {
        rects.delete();
      }
    };

    for (const { tipo, arquivo, classificador, minNeighbors, espelhar } of classificadores) {
      detectar(eq, classificador, minNeighbors ?? 4, false, tipo, arquivo);
      if (espelhar) {
        if (!espelhada) {
          espelhada = t.add(new cv.Mat());
          cv.flip(eq, espelhada, 1);
        }
        detectar(espelhada, classificador, minNeighbors ?? 4, true, tipo, arquivo);
      }
    }
    if (CONFIG.PLACA.ATIVO) {
      for (const p of detectarPlacas(gray)) {
        regioes.push({ ...p, x: p.x * fator, y: p.y * fator, width: p.width * fator, height: p.height * fator });
      }
    }
    return regioes.map((r) => ({ ...r, x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }));
  } finally {
    t.liberar();
  }
}

/**
 * Placas veiculares por agrupamento de caracteres (Mercosul e modelo antigo):
 *  1. limiar adaptativo (média local) nas duas polaridades: caractere escuro
 *     em placa clara (Mercosul, cinza antiga) e claro em placa escura (vermelha);
 *  2. componentes conexos com formato de caractere (mais altos que largos,
 *     preenchimento típico de letra);
 *  3. encadeamento horizontal: componentes vizinhos com altura e linha de base
 *     parecidas e espaçamento curto. Cadeia de 5+ caracteres = placa (têm 7).
 * Sem fechamento morfológico: a textura da rua não se funde com a placa.
 * Retorna regiões já expandidas para cobrir a placa inteira.
 */
export function detectarPlacas(gray, cfg = CONFIG.PLACA) {
  const t = new Rastreador();
  const placas = [];
  try {
    const w = gray.cols;
    const h = gray.rows;
    const bin = t.add(new cv.Mat());
    const labels = t.add(new cv.Mat());
    const stats = t.add(new cv.Mat());
    const cents = t.add(new cv.Mat());
    for (const tipo of [cv.THRESH_BINARY_INV, cv.THRESH_BINARY]) {
      cv.adaptiveThreshold(gray, bin, 255, cv.ADAPTIVE_THRESH_MEAN_C, tipo, cfg.BLOCO_ADAPTATIVO, cfg.CONTRASTE_ADAPTATIVO);
      const n = cv.connectedComponentsWithStats(bin, labels, stats, cents, 8, cv.CV_32S);
      const cand = [];
      for (let i = 1; i < n; i++) {
        const cw = stats.intAt(i, ccStat('WIDTH'));
        const ch = stats.intAt(i, ccStat('HEIGHT'));
        if (ch < cfg.ALTURA_MIN || ch > cfg.ALTURA_MAX * h) continue;
        const asp = cw / ch;
        if (asp < cfg.CARACTERE_ASPECTO_MIN || asp > cfg.CARACTERE_ASPECTO_MAX) continue;
        const preench = stats.intAt(i, ccStat('AREA')) / (cw * ch);
        if (preench < cfg.PREENCHIMENTO_MIN || preench > cfg.PREENCHIMENTO_MAX) continue;
        cand.push({ x: stats.intAt(i, ccStat('LEFT')), y: stats.intAt(i, ccStat('TOP')), w: cw, h: ch });
      }
      cand.sort((a, b) => a.x - b.x);

      const usado = new Uint8Array(cand.length);
      for (let i = 0; i < cand.length; i++) {
        if (usado[i]) continue;
        const cadeia = [i];
        let ult = cand[i];
        for (let j = i + 1; j < cand.length; j++) {
          const c = cand[j];
          const gap = c.x - (ult.x + ult.w);
          if (gap > cfg.ESPACO_MAX * ult.h) break; // ordenados por x: os próximos estão mais longe
          if (gap < -0.3 * ult.w || usado[j]) continue;
          if (Math.abs(c.h - ult.h) > cfg.VARIACAO_ALTURA_MAX * ult.h) continue;
          if (Math.abs(c.y + c.h / 2 - (ult.y + ult.h / 2)) > cfg.ALINHAMENTO_MAX * ult.h) continue;
          cadeia.push(j);
          ult = c;
        }
        if (cadeia.length < cfg.CARACTERES_MIN || cadeia.length > cfg.CARACTERES_MAX) continue;
        cadeia.forEach((k) => (usado[k] = 1));
        const cs = cadeia.map((k) => cand[k]);
        const x0 = Math.min(...cs.map((c) => c.x));
        const y0 = Math.min(...cs.map((c) => c.y));
        const x1 = Math.max(...cs.map((c) => c.x + c.w));
        const y1 = Math.max(...cs.map((c) => c.y + c.h));
        const asp = (x1 - x0) / (y1 - y0);
        if (asp < cfg.ASPECTO_MIN || asp > cfg.ASPECTO_MAX) continue;
        const dx = (x1 - x0) * cfg.EXPANSAO_X;
        const dy = (y1 - y0) * cfg.EXPANSAO_Y;
        const x = Math.max(0, x0 - dx);
        const y = Math.max(0, y0 - dy);
        placas.push({ tipo: 'PLACA', fonte: 'morfologia', x, y, width: Math.min(w, x1 + dx) - x, height: Math.min(h, y1 + dy) - y });
      }
    }
    return placas;
  } finally {
    t.liberar();
  }
}

/** Aplica GaussianBlur forte e proporcional em cada ROI (in-place em `saida`). */
export function anonimizar(saida, regioes, cfg = CONFIG.LGPD) {
  for (const r of regioes) {
    const padX = Math.round(r.width * cfg.PADDING);
    const padY = Math.round(r.height * cfg.PADDING);
    const x = Math.max(0, r.x - padX);
    const y = Math.max(0, r.y - padY);
    const w = Math.min(saida.cols - x, r.width + 2 * padX);
    const h = Math.min(saida.rows - y, r.height + 2 * padY);
    if (w < 2 || h < 2) continue;

    const k = impar(Math.max(cfg.BLUR_MINIMO, Math.max(w, h) * cfg.BLUR_FRACAO));
    const roi = saida.roi(new cv.Rect(x, y, w, h));
    try {
      for (let p = 0; p < cfg.BLUR_PASSADAS; p++) {
        cv.GaussianBlur(roi, roi, new cv.Size(k, k), 0, 0, cv.BORDER_REPLICATE);
      }
    } finally {
      roi.delete();
    }
  }
}
