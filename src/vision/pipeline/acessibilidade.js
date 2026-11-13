/* global cv */
import { CONFIG, COR } from './config.js';
import { Rastreador } from './memoria.js';
import { filtrarObjetos } from './obstaculo.js';
import { detectarFalhaPiso } from './piso.js';
import { detectarRachaduras } from './rachaduras.js';
import { analisarSuperficie } from './superficie.js';
import { arred, ccStat, desenharRetangulo, escalar, escalarRet, faixaHSV, limiaresCannyAuto, morfologia, paraHSV, redimensionarParaLargura } from './util.js';

// ---------------------------------------------------------------------------
// 11. Pipeline D — Acessibilidade
// ---------------------------------------------------------------------------

/** Degraus: ≥3 linhas horizontais longas, paralelas e com espaçamento regular. */
export function detectarDegraus(src, saida, cfg = CONFIG.ACESSIBILIDADE) {
  const t = new Rastreador();
  try {
    const { mat: peq, fator } = redimensionarParaLargura(src, cfg.LARGURA_ANALISE, t);
    const w = peq.cols;
    const h = peq.rows;
    const gray = t.add(new cv.Mat());
    cv.cvtColor(peq, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    const [b, a] = limiaresCannyAuto(gray, 0.33, 20);
    const bordas = t.add(new cv.Mat());
    cv.Canny(gray, bordas, b, a, 3, false);
    const linhas = t.add(new cv.Mat());
    cv.HoughLinesP(bordas, linhas, 1, Math.PI / 180, cfg.HOUGH_LIMIAR, w * cfg.HOUGH_COMPRIMENTO_MIN, cfg.HOUGH_GAP);

    const d = linhas.data32S;
    const horizontais = [];
    for (let i = 0; i < linhas.rows; i++) {
      const [x1, y1, x2, y2] = [d[i * 4], d[i * 4 + 1], d[i * 4 + 2], d[i * 4 + 3]];
      const ang = (Math.atan2(Math.abs(y2 - y1), Math.abs(x2 - x1)) * 180) / Math.PI;
      if (ang > cfg.ANGULO_MAX) continue;
      horizontais.push({ y: (y1 + y2) / 2, xa: Math.min(x1, x2), xb: Math.max(x1, x2) });
    }
    horizontais.sort((p, q) => p.y - q.y);

    // Agrupa linhas quase coincidentes.
    const grupos = [];
    for (const l of horizontais) {
      const g = grupos[grupos.length - 1];
      if (g && l.y - g.y < h * cfg.AGRUPAR_Y) {
        g.xa = Math.min(g.xa, l.xa);
        g.xb = Math.max(g.xb, l.xb);
      } else {
        grupos.push({ ...l });
      }
    }

    // Maior sequência de linhas sobrepostas com espaçamento regular.
    const g = gray.data;
    let melhorSeq = [];
    for (let i = 0; i < grupos.length; i++) {
      const seq = [grupos[i]];
      for (let j = i + 1; j < grupos.length; j++) {
        const ult = seq[seq.length - 1];
        const esp = grupos[j].y - ult.y;
        if (esp < h * cfg.ESPACAMENTO_MIN) continue;
        if (esp > h * cfg.ESPACAMENTO_MAX) break;
        const sobrep = Math.min(ult.xb, grupos[j].xb) - Math.max(ult.xa, grupos[j].xa);
        if (sobrep < 0.5 * Math.min(ult.xb - ult.xa, grupos[j].xb - grupos[j].xa)) continue;
        if (seq.length >= 2) {
          const espAnt = ult.y - seq[seq.length - 2].y;
          if (esp / espAnt < 0.5 || esp / espAnt > 2) continue;
        }
        seq.push(grupos[j]);
      }
      if (seq.length > melhorSeq.length) melhorSeq = seq;
    }

    // Rejeita faixas pintadas (zebra): bandas alternando claro/escuro forte.
    let alternancia = 0;
    if (melhorSeq.length >= cfg.MIN_DEGRAUS) {
      const medias = [];
      for (let k = 0; k < melhorSeq.length - 1; k++) {
        const ya = Math.round(melhorSeq[k].y) + 2;
        const yb = Math.round(melhorSeq[k + 1].y) - 2;
        const xa = Math.round(Math.max(melhorSeq[k].xa, melhorSeq[k + 1].xa));
        const xb = Math.round(Math.min(melhorSeq[k].xb, melhorSeq[k + 1].xb));
        let s = 0;
        let n = 0;
        for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x += 2) {
          s += g[y * w + x];
          n++;
        }
        medias.push(n ? s / n : 0);
      }
      for (let k = 0; k < medias.length - 1; k++) alternancia += Math.abs(medias[k] - medias[k + 1]);
      alternancia = medias.length > 1 ? alternancia / (medias.length - 1) : 0;
    }

    // Uniformidade horizontal de cada banda: o piso de um degrau é homogêneo
    // ao longo de x; faixas pintadas tipo "teclado" alternam claro/escuro.
    let variacaoHorizontal = 0;
    if (melhorSeq.length >= cfg.MIN_DEGRAUS) {
      const variacoes = [];
      for (let k = 0; k < melhorSeq.length - 1; k++) {
        const ya = Math.round(melhorSeq[k].y) + 2;
        const yb = Math.round(melhorSeq[k + 1].y) - 2;
        const xa = Math.round(Math.max(melhorSeq[k].xa, melhorSeq[k + 1].xa));
        const xb = Math.round(Math.min(melhorSeq[k].xb, melhorSeq[k + 1].xb));
        if (yb <= ya || xb - xa < cfg.SEGMENTOS_BANDA) continue;
        const passo = (xb - xa) / cfg.SEGMENTOS_BANDA;
        const segs = [];
        for (let s = 0; s < cfg.SEGMENTOS_BANDA; s++) {
          let soma = 0;
          let n = 0;
          for (let y = ya; y < yb; y++) {
            for (let x = Math.round(xa + s * passo); x < Math.round(xa + (s + 1) * passo); x++) {
              soma += g[y * w + x];
              n++;
            }
          }
          segs.push(n ? soma / n : 0);
        }
        const media = segs.reduce((p, q) => p + q, 0) / segs.length;
        variacoes.push(Math.sqrt(segs.reduce((p, q) => p + (q - media) ** 2, 0) / segs.length));
      }
      variacaoHorizontal = variacoes.length ? variacoes.reduce((p, q) => p + q, 0) / variacoes.length : 0;
    }

    const ok =
      melhorSeq.length >= cfg.MIN_DEGRAUS &&
      alternancia < cfg.PINTURA_DELTA &&
      variacaoHorizontal < cfg.VARIACAO_HORIZONTAL_MAX;
    const evidencias = [];
    if (ok) {
      const xa = Math.min(...melhorSeq.map((l) => l.xa));
      const xb = Math.max(...melhorSeq.map((l) => l.xb));
      const r = { x: xa, y: melhorSeq[0].y, width: xb - xa, height: melhorSeq[melhorSeq.length - 1].y - melhorSeq[0].y };
      const re = escalarRet(r, fator);
      evidencias.push({ tipo: 'DEGRAUS', ...re });
      for (const l of melhorSeq) {
        const yl = Math.round(l.y / fator);
        cv.line(saida, new cv.Point(Math.round(l.xa / fator), yl), new cv.Point(Math.round(l.xb / fator), yl), escalar(COR.AMARELO), 3, cv.LINE_8, 0);
      }
      desenharRetangulo(saida, re, COR.AMARELO, 2, 'DEGRAUS');
    }
    return {
      evidencias,
      linhas: melhorSeq.length,
      alternancia: arred(alternancia, 1),
      variacaoHorizontal: arred(variacaoHorizontal, 1),
      depuracao: { hough: linhas.rows, horizontais: horizontais.length, grupos: grupos.length, ys: grupos.map((l) => Math.round(l.y)).slice(0, 15) },
    };
  } finally {
    t.liberar();
  }
}

/** Piso tátil interrompido: só conta se houver piso amarelo na foto. */
export function detectarTatilInterrompido(src, saida, cfg = CONFIG.ACESSIBILIDADE) {
  const t = new Rastreador();
  try {
    const hsv = t.add(new cv.Mat());
    paraHSV(src, hsv);
    const mask = t.add(new cv.Mat());
    faixaHSV(hsv, cfg.TATIL_BAIXO, cfg.TATIL_ALTO, mask);
    const areaImg = src.rows * src.cols;
    const presenca = cv.countNonZero(mask) / areaImg;
    if (presenca < cfg.TATIL_PRESENCA_MIN) return { evidencias: [], presenca: arred(presenca, 4) };

    const fechada = t.add(new cv.Mat());
    morfologia(mask, fechada, cv.MORPH_CLOSE, cfg.TATIL_CLOSE_LARGURA, cfg.TATIL_CLOSE_ALTURA, cv.MORPH_RECT);
    const labels = t.add(new cv.Mat());
    const stats = t.add(new cv.Mat());
    const cents = t.add(new cv.Mat());
    const n = cv.connectedComponentsWithStats(fechada, labels, stats, cents, 8, cv.CV_32S);
    const grandes = [];
    const fragmentos = [];
    for (let i = 1; i < n; i++) {
      const comp = {
        x: stats.intAt(i, ccStat('LEFT')),
        y: stats.intAt(i, ccStat('TOP')),
        width: stats.intAt(i, ccStat('WIDTH')),
        height: stats.intAt(i, ccStat('HEIGHT')),
        area: stats.intAt(i, ccStat('AREA')),
      };
      if (comp.area >= cfg.TATIL_AREA_GRANDE * areaImg) grandes.push(comp);
      else if (comp.area >= cfg.TATIL_RUIDO_MIN) fragmentos.push(comp);
    }
    // Faixa interrompida = dois trechos alongados, com a mesma orientação,
    // alinhados e separados por uma lacuna. Manchas soltas (folhas, grama
    // amarelada, pintura) não formam esse padrão.
    const trechos = [...grandes, ...fragmentos].filter((c) => {
      if (c.area < cfg.TATIL_TRECHO_MIN * areaImg) return false;
      const alongamento = Math.max(c.width, c.height) / Math.max(1, Math.min(c.width, c.height));
      return alongamento >= cfg.TATIL_ALONGAMENTO_MIN;
    });
    const evidencias = [];
    for (const p of trechos) {
      for (const q of trechos) {
        if (p === q) continue;
        const horizontal = p.width > p.height && q.width > q.height;
        const vertical = p.height > p.width && q.height > q.width;
        let lacuna = -1;
        let alinhado = false;
        if (horizontal && q.x > p.x) {
          lacuna = q.x - (p.x + p.width);
          const sob = Math.min(p.y + p.height, q.y + q.height) - Math.max(p.y, q.y);
          alinhado = sob >= 0.5 * Math.min(p.height, q.height);
          lacuna /= src.cols;
        } else if (vertical && q.y > p.y) {
          lacuna = q.y - (p.y + p.height);
          const sob = Math.min(p.x + p.width, q.x + q.width) - Math.max(p.x, q.x);
          alinhado = sob >= 0.5 * Math.min(p.width, q.width);
          lacuna /= src.rows;
        }
        if (!alinhado || lacuna < cfg.TATIL_LACUNA_MIN || lacuna > cfg.TATIL_LACUNA_MAX) continue;
        const x0 = Math.min(p.x, q.x);
        const y0 = Math.min(p.y, q.y);
        const r = {
          x: x0,
          y: y0,
          width: Math.max(p.x + p.width, q.x + q.width) - x0,
          height: Math.max(p.y + p.height, q.y + q.height) - y0,
        };
        desenharRetangulo(saida, p, COR.LARANJA, 2);
        desenharRetangulo(saida, q, COR.LARANJA, 2);
        evidencias.push({ tipo: 'TATIL_INTERROMPIDO', ...r });
      }
    }
    return { evidencias: evidencias.slice(0, 1), presenca: arred(presenca, 4), trechos: trechos.length };
  } finally {
    t.liberar();
  }
}

/**
 * Acessibilidade: problema no próprio piso que impede ou arrisca a passagem
 * de pedestres, cadeirantes ou pessoas com deficiência visual.
 * Evidências: buraco/calçada quebrada, piso tátil interrompido, degraus e
 * passagem interrompida (ver INCLUIR_OBSTRUCAO).
 */
export function processarAcessibilidade(src, saida, cfg = CONFIG.ACESSIBILIDADE) {
  const piso = detectarFalhaPiso(src, saida);
  const tatil = detectarTatilInterrompido(src, saida, cfg);
  const degraus = detectarDegraus(src, saida, cfg);

  let obstrucoes = [];
  if (cfg.INCLUIR_OBSTRUCAO) {
    const superficie = analisarSuperficie(src);
    obstrucoes = filtrarObjetos(superficie.intrusoes).map((r) => ({ tipo: 'PASSAGEM_INTERROMPIDA', ...r }));
    obstrucoes.forEach((r) => desenharRetangulo(saida, r, COR.MAGENTA, 3, 'PASSAGEM'));
  }

  // Rachaduras: desenha só se ativo (com ATIVO=false apenas mede, em detalhes).
  const rascunho = CONFIG.RACHADURA.ATIVO ? null : saida.clone();
  let rachaduras;
  try {
    rachaduras = detectarRachaduras(src, rascunho ?? saida, CONFIG.RACHADURA);
  } finally {
    rascunho?.delete();
  }
  const evidRachaduras = CONFIG.RACHADURA.ATIVO ? rachaduras.evidencias : [];

  const evidencias = [...piso.evidencias, ...evidRachaduras, ...tatil.evidencias, ...degraus.evidencias, ...obstrucoes];
  const tipos = [...new Set(evidencias.map((e) => e.tipo))];
  return {
    isValid: evidencias.length > 0,
    evidencias,
    detalhes: {
      problemas: tipos, // ex.: ['BURACO_OU_QUEBRA', 'TATIL_INTERROMPIDO']
      buracoOuQuebra: { ok: piso.evidencias.length > 0, candidatos: piso.detalhes.candidatos },
      rachaduras: { ok: rachaduras.evidencias.length > 0, ...rachaduras.detalhes },
      tatil: { presenca: tatil.presenca, trechos: tatil.trechos ?? 0, ok: tatil.evidencias.length > 0 },
      degraus: {
        linhas: degraus.linhas,
        alternancia: degraus.alternancia,
        variacaoHorizontal: degraus.variacaoHorizontal,
        ok: degraus.evidencias.length > 0,
      },
      ...(cfg.INCLUIR_OBSTRUCAO ? { obstrucoes: obstrucoes.length } : {}),
    },
  };
}
