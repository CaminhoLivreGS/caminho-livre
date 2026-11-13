/* global cv */
import { CONFIG, COR } from './config.js';
import { Rastreador } from './memoria.js';
import { arred, ccStat, desenharRetangulo, escalarRet, faixaHSV, morfologia, paraHSV, redimensionarParaLargura, zerarLinhasAcima } from './util.js';

// ---------------------------------------------------------------------------
// Rachaduras finas (usado por ACESSIBILIDADE)
// ---------------------------------------------------------------------------

/**
 * Detecta rachaduras finas no piso:
 *  1. black-hat morfológico (fechamento − imagem) realça traços escuros mais
 *     finos que o kernel; limiarização isola os traços;
 *  2. cobertura alta no chão inteiro = padrão do piso (pedra portuguesa,
 *     ladrilho) → nenhuma evidência;
 *  3. cada componente conexo longo e fino é medido:
 *     - retilineidade (PCA dos pixels): ~1 = junta reta → descartado;
 *     - serrilhado: vértices do contorno após approxPolyDP por 20 px de
 *       perímetro; rachaduras são irregulares.
 */
export function detectarRachaduras(src, saida, cfg = CONFIG.RACHADURA) {
  const t = new Rastreador();
  try {
    const { mat: peq, fator } = redimensionarParaLargura(src, cfg.LARGURA_ANALISE, t);
    const w = peq.cols;
    const h = peq.rows;
    const y0 = Math.round(h * CONFIG.GERAL.INICIO_CHAO);
    const areaChao = w * (h - y0);

    const gray = t.add(new cv.Mat());
    cv.cvtColor(peq, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
    const bh = t.add(new cv.Mat());
    morfologia(gray, bh, cv.MORPH_BLACKHAT, cfg.KERNEL_BLACKHAT);
    const bin = t.add(new cv.Mat());
    cv.threshold(bh, bin, cfg.LIMIAR_BLACKHAT, 255, cv.THRESH_BINARY);

    // Vegetação entre placas não é rachadura.
    const hsv = t.add(new cv.Mat());
    paraHSV(peq, hsv);
    const verde = t.add(new cv.Mat());
    faixaHSV(hsv, CONFIG.PISO.VERDE_BAIXO, CONFIG.PISO.VERDE_ALTO, verde);
    cv.bitwise_not(verde, verde);
    cv.bitwise_and(bin, verde, bin);
    zerarLinhasAcima(bin, y0);

    const cobertura = cv.countNonZero(bin) / areaChao;
    if (cobertura > cfg.COBERTURA_MAX) {
      return { evidencias: [], detalhes: { cobertura: arred(cobertura), padrao: true, tracos: [] } };
    }
    morfologia(bin, bin, cv.MORPH_CLOSE, 3); // une falhas de 1-2 px no traço

    const labels = t.add(new cv.Mat());
    const stats = t.add(new cv.Mat());
    const cents = t.add(new cv.Mat());
    const n = cv.connectedComponentsWithStats(bin, labels, stats, cents, 8, cv.CV_32S);
    const lab = labels.data32S;
    const tracos = [];
    for (let i = 1; i < n; i++) {
      const r = {
        x: stats.intAt(i, ccStat('LEFT')),
        y: stats.intAt(i, ccStat('TOP')),
        width: stats.intAt(i, ccStat('WIDTH')),
        height: stats.intAt(i, ccStat('HEIGHT')),
      };
      const area = stats.intAt(i, ccStat('AREA'));
      const diag = Math.hypot(r.width, r.height);
      if (diag < cfg.COMPRIMENTO_MIN * w) continue;
      const espessura = area / diag;
      if (espessura > cfg.ESPESSURA_MAX) continue;

      // Retilineidade por PCA das coordenadas dos pixels do traço.
      let sx = 0;
      let sy = 0;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      for (let y = r.y; y < r.y + r.height; y++) {
        for (let x = r.x; x < r.x + r.width; x++) {
          if (lab[y * w + x] !== i) continue;
          sx += x;
          sy += y;
          sxx += x * x;
          syy += y * y;
          sxy += x * y;
        }
      }
      const vx = sxx / area - (sx / area) ** 2;
      const vy = syy / area - (sy / area) ** 2;
      const cxy = sxy / area - (sx / area) * (sy / area);
      const raiz = Math.sqrt(((vx - vy) / 2) ** 2 + cxy ** 2);
      const l1 = (vx + vy) / 2 + raiz;
      const l2 = Math.max(0, (vx + vy) / 2 - raiz);
      const retilineidade = l1 > 0 ? 1 - Math.sqrt(l2 / l1) : 1;

      // Serrilhado: vértices do contorno simplificado por 20 px de perímetro.
      const roi = t.add(labels.roi(new cv.Rect(r.x, r.y, r.width, r.height)));
      const alvo = t.add(new cv.Mat(r.height, r.width, cv.CV_32S, new cv.Scalar(i)));
      const mascara = t.add(new cv.Mat());
      cv.compare(roi, alvo, mascara, cv.CMP_EQ);
      const contornos = t.add(new cv.MatVector());
      const hier = t.add(new cv.Mat());
      cv.findContours(mascara, contornos, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);
      let serrilhado = 0;
      if (contornos.size()) {
        const c = t.add(contornos.get(0));
        const perimetro = cv.arcLength(c, true);
        const aprox = t.add(new cv.Mat());
        cv.approxPolyDP(c, aprox, 2, true);
        serrilhado = aprox.rows / Math.max(1, perimetro / 20);
      }

      const traco = {
        ...r,
        diag: arred(diag / w),
        espessura: arred(espessura, 1),
        retilineidade: arred(retilineidade),
        serrilhado: arred(serrilhado, 2),
      };
      traco.ok = retilineidade <= cfg.RETILINEIDADE_MAX && serrilhado >= cfg.SERRILHADO_MIN;
      tracos.push(traco);
    }

    const validos = tracos.filter((tr) => tr.ok);
    const comprimento = validos.reduce((s, tr) => s + tr.diag, 0);
    const evidencias = [];
    if (comprimento >= cfg.COMPRIMENTO_TOTAL_MIN) {
      for (const tr of validos) desenharRetangulo(saida, escalarRet(tr, fator), COR.LARANJA, 2);
      const xa = Math.min(...validos.map((v) => v.x));
      const ya = Math.min(...validos.map((v) => v.y));
      const xb = Math.max(...validos.map((v) => v.x + v.width));
      const yb = Math.max(...validos.map((v) => v.y + v.height));
      const area = escalarRet({ x: xa, y: ya, width: xb - xa, height: yb - ya }, fator);
      desenharRetangulo(saida, area, COR.LARANJA, 3, 'RACHADURA');
      evidencias.push({ tipo: 'RACHADURA', ...area });
    }
    return {
      evidencias,
      detalhes: {
        cobertura: arred(cobertura),
        padrao: false,
        comprimento: arred(comprimento),
        tracos: tracos
          .sort((a, b) => b.diag - a.diag)
          .slice(0, 5)
          .map(({ diag, espessura, retilineidade, serrilhado, ok }) => ({ diag, espessura, retilineidade, serrilhado, ok })),
      },
    };
  } finally {
    t.liberar();
  }
}
