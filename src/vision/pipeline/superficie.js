/* global cv */
import { CONFIG } from './config.js';
import { Rastreador } from './memoria.js';
import { arred, ccStat, escalarRet, faixaHSV, impar, limiaresCannyAuto, morfologia, paraHSV, redimensionarParaLargura, zerarLinhasAcima } from './util.js';

// ---------------------------------------------------------------------------
// 7. Análise da superfície caminhável (compartilhada por OBSTACULO e
//    ACESSIBILIDADE)
// ---------------------------------------------------------------------------

/**
 * Estima o piso a partir de sementes na base da foto (crescimento de região
 * por similaridade em Lab + connectedComponents) e encontra "intrusões":
 * regiões que interrompem o piso e que um fechamento morfológico grande
 * preencheria (objetos sobre a calçada: entulho, lixo, galhos, postes).
 */
export function analisarSuperficie(src, cfg = CONFIG.SUPERFICIE) {
  const t = new Rastreador();
  try {
    const { mat: peq, fator } = redimensionarParaLargura(src, cfg.LARGURA_ANALISE, t);
    const w = peq.cols;
    const h = peq.rows;
    const rgb = t.add(new cv.Mat());
    cv.cvtColor(peq, rgb, cv.COLOR_RGBA2RGB);
    cv.GaussianBlur(rgb, rgb, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    const lab = t.add(new cv.Mat());
    cv.cvtColor(rgb, lab, cv.COLOR_RGB2Lab);
    const L = lab.data.slice(); // cópia: a view do heap pode mudar se o WASM crescer
    const y0 = Math.round(h * cfg.INICIO);
    const areaChao = w * (h - y0);

    let melhor = null;
    for (const fx of cfg.SEMENTES_X) {
      const sx = Math.round(w * fx);
      const sy = Math.min(h - 1 - cfg.RAIO_SEMENTE, Math.round(h * cfg.SEMENTE_Y));
      // Cor da semente: mediana do patch (robusta a pequenas sujeiras).
      const canais = [[], [], []];
      for (let y = sy - cfg.RAIO_SEMENTE; y <= sy + cfg.RAIO_SEMENTE; y++) {
        for (let x = sx - cfg.RAIO_SEMENTE; x <= sx + cfg.RAIO_SEMENTE; x++) {
          const i = (y * w + x) * 3;
          canais[0].push(L[i]);
          canais[1].push(L[i + 1]);
          canais[2].push(L[i + 2]);
        }
      }
      const [l0, a0, b0] = canais.map((c) => c.sort((p, q) => p - q)[c.length >> 1]);

      const sim = t.add(cv.Mat.zeros(h, w, cv.CV_8UC1));
      const s = sim.data;
      for (let i = y0 * w; i < w * h; i++) {
        const j = i * 3;
        if (Math.abs(L[j] - l0) <= cfg.TOL_L && Math.abs(L[j + 1] - a0) <= cfg.TOL_AB && Math.abs(L[j + 2] - b0) <= cfg.TOL_AB) s[i] = 255;
      }
      morfologia(sim, sim, cv.MORPH_CLOSE, 3);
      const labels = t.add(new cv.Mat());
      const stats = t.add(new cv.Mat());
      const cents = t.add(new cv.Mat());
      cv.connectedComponentsWithStats(sim, labels, stats, cents, 4, cv.CV_32S);
      const lab32 = labels.data32S;
      const rotulo = lab32[sy * w + sx];
      if (!rotulo) continue;
      const area = stats.intAt(rotulo, ccStat('AREA'));
      if (!melhor || area > melhor.area) {
        const m = new Uint8Array(w * h);
        for (let i = 0; i < m.length; i++) if (lab32[i] === rotulo) m[i] = 255;
        melhor = { area, mascara: m, cor: [l0, a0, b0] };
      }
    }

    const fracaoSuperficie = melhor ? melhor.area / areaChao : 0;
    if (!melhor || fracaoSuperficie < cfg.MIN_SUPERFICIE) {
      return { confiavel: false, fracaoSuperficie: arred(fracaoSuperficie), intrusoes: [] };
    }

    const sup = t.add(new cv.Mat(h, w, cv.CV_8UC1));
    sup.data.set(melhor.mascara);
    morfologia(sup, sup, cv.MORPH_CLOSE, cfg.FECHAMENTO_BURACOS); // juntas, folhas

    // Intrusões = o que um fechamento grande preencheria e não é piso.
    const fechado = t.add(new cv.Mat());
    morfologia(sup, fechado, cv.MORPH_CLOSE, impar(w * cfg.FECHAMENTO_INTRUSAO));
    const naoSup = t.add(new cv.Mat());
    cv.bitwise_not(sup, naoSup);
    const intr = t.add(new cv.Mat());
    cv.bitwise_and(fechado, naoSup, intr);
    zerarLinhasAcima(intr, y0);
    morfologia(intr, intr, cv.MORPH_OPEN, cfg.ABERTURA_INTRUSAO);

    // Atributos para distinguir OBJETO (entulho, lixo, galhos: textura alta,
    // borda irregular) de MARCAÇÃO PLANA (faixa pintada, sombra, piso tátil).
    const gray = t.add(new cv.Mat());
    cv.cvtColor(peq, gray, cv.COLOR_RGBA2GRAY);
    const [cb, ca] = limiaresCannyAuto(gray, 0.33, 20);
    const bordas = t.add(new cv.Mat());
    cv.Canny(gray, bordas, cb, ca, 3, false);
    const hsv = t.add(new cv.Mat());
    paraHSV(peq, hsv);
    const verde = t.add(new cv.Mat());
    faixaHSV(hsv, CONFIG.PISO.VERDE_BAIXO, CONFIG.PISO.VERDE_ALTO, verde);
    const canais = t.add(new cv.MatVector());
    cv.split(hsv, canais);
    const sat = t.add(canais.get(1));

    const labels = t.add(new cv.Mat());
    const stats = t.add(new cv.Mat());
    const cents = t.add(new cv.Mat());
    const n = cv.connectedComponentsWithStats(intr, labels, stats, cents, 8, cv.CV_32S);
    const areaSup = cv.countNonZero(sup);
    const intrusoes = [];
    for (let i = 1; i < n; i++) {
      const area = stats.intAt(i, ccStat('AREA'));
      const fracao = area / areaSup;
      if (fracao < cfg.INTRUSAO_MIN_RATIO) continue;
      const r = {
        x: stats.intAt(i, ccStat('LEFT')),
        y: stats.intAt(i, ccStat('TOP')),
        width: stats.intAt(i, ccStat('WIDTH')),
        height: stats.intAt(i, ccStat('HEIGHT')),
      };
      const rect = new cv.Rect(r.x, r.y, r.width, r.height);
      const labRoi = t.add(labels.roi(rect));
      const alvo = t.add(new cv.Mat(r.height, r.width, cv.CV_32S, new cv.Scalar(i)));
      const comp = t.add(new cv.Mat());
      cv.compare(labRoi, alvo, comp, cv.CMP_EQ);
      const bordaRoi = t.add(bordas.roi(rect));
      const densidade = cv.mean(bordaRoi, comp)[0] / 255;
      const verdeRoi = t.add(verde.roi(rect));
      const fracVerde = cv.mean(verdeRoi, comp)[0] / 255;
      const satRoi = t.add(sat.roi(rect));
      const saturacao = cv.mean(satRoi, comp)[0];
      intrusoes.push({
        ...escalarRet(r, fator),
        fracao: arred(fracao),
        densidade: arred(densidade),
        verde: arred(fracVerde, 2),
        sat: Math.round(saturacao),
      });
    }
    return { confiavel: true, fracaoSuperficie: arred(fracaoSuperficie), intrusoes };
  } finally {
    t.liberar();
  }
}
