/* global cv */
import { CONFIG, COR } from './config.js';
import { Rastreador } from './memoria.js';
import { ancora, arred, desenharContornoEscalado, escalarRet, faixaHSV, impar, limiaresCannyAuto, mascaraDoContorno, mediaNaMascara, medianaMascarada, morfologia, paraHSV, redimensionarParaLargura, zerarLinhasAcima } from './util.js';

// ---------------------------------------------------------------------------
// 8. Detector de buraco / calçada quebrada (usado por ACESSIBILIDADE)
// ---------------------------------------------------------------------------

/**
 * Procura uma ANOMALIA do piso em relação ao próprio piso:
 *  - textura: densidade local de bordas (Canny + dilatação) muito acima da
 *    mediana do chão (cascalho, quebra, borda de buraco);
 *  - escurecimento local abrupto (cavidade).
 * Padrões regulares (pedra portuguesa, ladrilho) elevam a própria mediana e
 * não disparam; vegetação e faixas finas (meio-fio, juntas) são descartadas.
 */
export function detectarFalhaPiso(src, saida, cfg = CONFIG.PISO) {
  const t = new Rastreador();
  try {
    const { mat: peq, fator } = redimensionarParaLargura(src, cfg.LARGURA_ANALISE, t);
    const w = peq.cols;
    const h = peq.rows;
    const y0 = Math.round(h * CONFIG.GERAL.INICIO_CHAO);
    const areaChao = w * (h - y0);

    const gray = t.add(new cv.Mat());
    cv.cvtColor(peq, gray, cv.COLOR_RGBA2GRAY);
    const suave = t.add(new cv.Mat());
    cv.medianBlur(gray, suave, impar(cfg.MEDIAN_KERNEL));

    const [cBaixo, cAlto] = limiaresCannyAuto(suave, cfg.CANNY_SIGMA, cfg.CANNY_MIN_BAIXO);
    const bordas = t.add(new cv.Mat());
    cv.Canny(suave, bordas, cBaixo, cAlto, 3, false);
    const k3 = t.add(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)));
    const dil = t.add(new cv.Mat());
    cv.dilate(bordas, dil, k3, ancora(), cfg.DILATE_ITERACOES, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
    const dens = t.add(new cv.Mat());
    cv.blur(dil, dens, new cv.Size(cfg.JANELA_DENSIDADE, cfg.JANELA_DENSIDADE), ancora(), cv.BORDER_DEFAULT);

    const hsv = t.add(new cv.Mat());
    paraHSV(peq, hsv);
    const verde = t.add(new cv.Mat());
    faixaHSV(hsv, cfg.VERDE_BAIXO, cfg.VERDE_ALTO, verde);
    const tatil = t.add(new cv.Mat());
    faixaHSV(hsv, cfg.TATIL_BAIXO, cfg.TATIL_ALTO, tatil);
    cv.bitwise_or(verde, tatil, verde); // "verde" = tudo que não é defeito
    // Dilata para cobrir também a fronteira (borda grama/calçada, borda do tátil).
    morfologia(verde, verde, cv.MORPH_DILATE, cfg.EXCLUSAO_DILATACAO);

    // Anomalia de textura relativa à mediana do chão.
    const medDens = medianaMascarada(dens, verde, y0);
    const limiarDens = Math.min(250, Math.max(medDens * cfg.RAZAO_DENSIDADE, medDens + cfg.DELTA_DENSIDADE));
    const anom = t.add(new cv.Mat());
    cv.threshold(dens, anom, limiarDens, 255, cv.THRESH_BINARY);

    // Anomalia de escurecimento: fundo (blur largo) − pixel.
    const fundo = t.add(new cv.Mat());
    const sigma = Math.max(5, w / cfg.FUNDO_DIVISOR);
    cv.GaussianBlur(suave, fundo, new cv.Size(0, 0), sigma, sigma, cv.BORDER_REPLICATE);
    const escuro = t.add(new cv.Mat());
    cv.subtract(fundo, suave, escuro); // satura em 0 onde o pixel é mais claro
    const escuroBin = t.add(new cv.Mat());
    cv.threshold(escuro, escuroBin, cfg.ESCURO_DELTA, 255, cv.THRESH_BINARY);

    // Tensor de estrutura (Sobel): coerência alta = bordas retas/alinhadas
    // (meio-fio, faixa, objeto); baixa = quebra/cascalho (orientação aleatória).
    const gx = t.add(new cv.Mat());
    const gy = t.add(new cv.Mat());
    cv.Sobel(suave, gx, cv.CV_32F, 1, 0, 3, 1, 0, cv.BORDER_DEFAULT);
    cv.Sobel(suave, gy, cv.CV_32F, 0, 1, 3, 1, 0, cv.BORDER_DEFAULT);
    const jxx = t.add(new cv.Mat());
    const jyy = t.add(new cv.Mat());
    const jxy = t.add(new cv.Mat());
    cv.multiply(gx, gx, jxx, 1, -1);
    cv.multiply(gy, gy, jyy, 1, -1);
    cv.multiply(gx, gy, jxy, 1, -1);
    const jan = new cv.Size(cfg.JANELA_COERENCIA, cfg.JANELA_COERENCIA);
    for (const m of [jxx, jyy, jxy]) cv.blur(m, m, jan, ancora(), cv.BORDER_DEFAULT);
    // coerência local = sqrt((Jxx-Jyy)² + (2Jxy)²) / (Jxx+Jyy)
    const dif = t.add(new cv.Mat());
    cv.subtract(jxx, jyy, dif);
    const dobro = t.add(new cv.Mat());
    cv.add(jxy, jxy, dobro);
    const num = t.add(new cv.Mat());
    cv.magnitude(dif, dobro, num);
    const den = t.add(new cv.Mat());
    cv.add(jxx, jyy, den);
    const eps = t.add(new cv.Mat(den.rows, den.cols, den.type(), new cv.Scalar(1e-3)));
    cv.add(den, eps, den);
    const coer = t.add(new cv.Mat());
    cv.divide(num, den, coer, 1, -1);

    const cand = t.add(new cv.Mat());
    cv.bitwise_or(anom, escuroBin, cand);
    const naoVerde = t.add(new cv.Mat());
    cv.bitwise_not(verde, naoVerde);
    cv.bitwise_and(cand, naoVerde, cand);
    zerarLinhasAcima(cand, y0);
    morfologia(cand, cand, cv.MORPH_OPEN, cfg.OPEN_KERNEL);
    morfologia(cand, cand, cv.MORPH_CLOSE, cfg.CLOSE_KERNEL);

    const contornos = t.add(new cv.MatVector());
    const hier = t.add(new cv.Mat());
    cv.findContours(cand, contornos, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const candidatos = [];
    const evidencias = [];
    for (let i = 0; i < contornos.size(); i++) {
      const c = t.add(contornos.get(i));
      const area = cv.contourArea(c, false);
      const areaRatio = area / areaChao;
      if (areaRatio < cfg.AREA_MIN_RATIO || areaRatio > cfg.AREA_MAX_RATIO) continue;

      const ret = cv.boundingRect(c);
      const aspecto = Math.min(ret.width, ret.height) / Math.max(ret.width, ret.height);
      const hull = t.add(new cv.Mat());
      cv.convexHull(c, hull, false, true);
      const solidez = area / Math.max(1, cv.contourArea(hull, false));

      const mask = t.add(mascaraDoContorno(contornos, i, ret));
      const densAbs = mediaNaMascara(dens, ret, mask);
      const densRazao = densAbs / Math.max(1, medDens);
      const escuridao = mediaNaMascara(escuro, ret, mask);
      // Coerência média medida só nos pixels de borda dentro do candidato.
      const bordaRoi = t.add(dil.roi(new cv.Rect(ret.x, ret.y, ret.width, ret.height)));
      const maskBorda = t.add(new cv.Mat());
      cv.bitwise_and(mask, bordaRoi, maskBorda);
      const coerencia = cv.countNonZero(maskBorda) ? mediaNaMascara(coer, ret, maskBorda) : 1;

      const feat = {
        area: arred(areaRatio),
        aspecto: arred(aspecto, 2),
        solidez: arred(solidez, 2),
        densAbs: Math.round(densAbs),
        densRazao: arred(densRazao, 2),
        escuridao: arred(escuridao, 1),
        coer: arred(coerencia, 2),
      };
      const geometriaOk = aspecto >= cfg.ASPECTO_MIN && solidez >= cfg.SOLIDEZ_MIN;
      const razaoMin = medDens >= cfg.MEDIANA_PADRAO ? cfg.TEXTURA_RAZAO_MIN_PADRAO : cfg.TEXTURA_RAZAO_MIN;
      const textura =
        coerencia < cfg.TEXTURA_COERENCIA_MAX && densAbs >= cfg.TEXTURA_DENSIDADE_MIN && densRazao >= razaoMin;
      const cavidade =
        escuridao >= cfg.CAVIDADE_ESCURIDAO_MIN && solidez >= cfg.CAVIDADE_SOLIDEZ_MIN && aspecto >= cfg.CAVIDADE_ASPECTO_MIN;
      const cratera =
        escuridao >= cfg.CRATERA_ESCURIDAO_MIN && solidez >= cfg.CRATERA_SOLIDEZ_MIN && areaRatio >= cfg.CRATERA_AREA_MIN;
      feat.motivo = textura ? 'TEXTURA' : cavidade ? 'CAVIDADE' : cratera ? 'CRATERA' : null;
      feat.ok = geometriaOk && feat.motivo !== null;
      candidatos.push(feat);
      if (feat.ok) {
        evidencias.push({ tipo: 'BURACO_OU_QUEBRA', motivo: feat.motivo, ...escalarRet(ret, fator) });
        desenharContornoEscalado(saida, c, fator, COR.VERDE, 3);
      }
    }

    return {
      isValid: evidencias.length > 0,
      evidencias,
      detalhes: {
        medianaDensidade: medDens,
        candidatos: candidatos.sort((a, b) => b.area - a.area).slice(0, 4),
      },
    };
  } finally {
    t.liberar();
  }
}
