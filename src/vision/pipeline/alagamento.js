/* global cv */
import { CONFIG, COR } from './config.js';
import { Rastreador } from './memoria.js';
import { ancora, arred, ccStat, desenharContornoEscalado, escalarRet, faixaHSV, morfologia, paraHSV, redimensionarParaLargura, zerarLinhasAcima } from './util.js';

// ---------------------------------------------------------------------------
// 9. Pipeline B — Alagamento
// ---------------------------------------------------------------------------

/**
 * Água = cor compatível (barro, reflexo do céu, claro/escuro reflexivo)
 * E superfície lisa (baixa rugosidade do Laplaciano). Calçada e asfalto
 * secos têm textura; barro seco e terra também.
 */
export function processarAlagamento(src, saida, cfg = CONFIG.ALAGAMENTO) {
  const t = new Rastreador();
  try {
    const { mat: peq, fator } = redimensionarParaLargura(src, cfg.LARGURA_ANALISE, t);
    const w = peq.cols;
    const h = peq.rows;
    const y0 = Math.round(h * cfg.INICIO);

    const hsv = t.add(new cv.Mat());
    paraHSV(peq, hsv);
    const gray = t.add(new cv.Mat());
    cv.cvtColor(peq, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
    const lap = t.add(new cv.Mat());
    cv.Laplacian(gray, lap, cv.CV_16S, 3, 1, 0, cv.BORDER_DEFAULT);
    const rug = t.add(new cv.Mat());
    cv.convertScaleAbs(lap, rug, 1, 0);
    cv.blur(rug, rug, new cv.Size(cfg.JANELA_RUGOSIDADE, cfg.JANELA_RUGOSIDADE), ancora(), cv.BORDER_DEFAULT);
    const liso = t.add(new cv.Mat());

    const corAgua = t.add(cv.Mat.zeros(h, w, cv.CV_8UC1));
    const parcial = t.add(new cv.Mat());
    const porFaixa = {};
    const areaInferior = w * (h - y0);
    for (const faixa of cfg.FAIXAS_HSV) {
      cv.threshold(rug, liso, faixa.lisoMax, 255, cv.THRESH_BINARY_INV);
      faixaHSV(hsv, faixa.baixo, faixa.alto, parcial);
      cv.bitwise_and(parcial, liso, parcial);
      zerarLinhasAcima(parcial, y0);
      porFaixa[faixa.nome] = arred(cv.countNonZero(parcial) / areaInferior);
      cv.bitwise_or(corAgua, parcial, corAgua);
    }

    morfologia(corAgua, corAgua, cv.MORPH_OPEN, cfg.OPEN_KERNEL);
    morfologia(corAgua, corAgua, cv.MORPH_CLOSE, cfg.CLOSE_KERNEL);

    const labels = t.add(new cv.Mat());
    const stats = t.add(new cv.Mat());
    const cents = t.add(new cv.Mat());
    const n = cv.connectedComponentsWithStats(corAgua, labels, stats, cents, 8, cv.CV_32S);
    let melhor = 0;
    let areaMancha = 0;
    for (let i = 1; i < n; i++) {
      const a = stats.intAt(i, ccStat('AREA'));
      if (a > areaMancha) {
        areaMancha = a;
        melhor = i;
      }
    }
    const fracao = areaMancha / areaInferior;
    const larguraRatio = melhor ? stats.intAt(melhor, ccStat('WIDTH')) / w : 0;
    const isValid = fracao >= cfg.AREA_MINIMA_RATIO && larguraRatio >= cfg.LARGURA_MINIMA_RATIO;

    const evidencias = [];
    if (melhor) {
      const mancha = t.add(new cv.Mat());
      const alvo = t.add(new cv.Mat(h, w, cv.CV_32S, new cv.Scalar(melhor)));
      cv.compare(labels, alvo, mancha, cv.CMP_EQ);
      const contornos = t.add(new cv.MatVector());
      const hier = t.add(new cv.Mat());
      cv.findContours(mancha, contornos, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      for (let i = 0; i < contornos.size(); i++) {
        const c = t.add(contornos.get(i));
        desenharContornoEscalado(saida, c, fator, isValid ? COR.AZUL : COR.LARANJA, 3);
      }
      if (isValid) {
        evidencias.push({
          tipo: 'AGUA',
          ...escalarRet(
            {
              x: stats.intAt(melhor, ccStat('LEFT')),
              y: stats.intAt(melhor, ccStat('TOP')),
              width: stats.intAt(melhor, ccStat('WIDTH')),
              height: stats.intAt(melhor, ccStat('HEIGHT')),
            },
            fator,
          ),
        });
      }
    }

    return {
      isValid,
      evidencias,
      detalhes: { fracao: arred(fracao), largura: arred(larguraRatio), porFaixa },
    };
  } finally {
    t.liberar();
  }
}
