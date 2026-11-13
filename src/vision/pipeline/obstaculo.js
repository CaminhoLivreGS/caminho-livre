/* global cv */
import { CONFIG, COR } from './config.js';
import { Rastreador } from './memoria.js';
import { analisarSuperficie } from './superficie.js';
import { arred, desenharRetangulo, faixaHSV, mascaraDoContorno, morfologia, paraHSV } from './util.js';

// ---------------------------------------------------------------------------
// 10. Pipeline C — Obstáculos (obras, entulho, lixo, árvore caída)
// ---------------------------------------------------------------------------

/** Silhueta binária de cone (trapézio + base) usada no matchTemplate. */
export function criarTemplateSilhueta(cfg, t) {
  const w = cfg.TEMPLATE_LARGURA;
  const h = cfg.TEMPLATE_ALTURA;
  const templ = t.add(cv.Mat.zeros(h, w, cv.CV_8UC1));
  const pts = t.add(cv.matFromArray(4, 1, cv.CV_32SC2, [
    Math.round(w * 0.4), 0,
    Math.round(w * 0.6), 0,
    Math.round(w * 0.9), h - 1,
    Math.round(w * 0.1), h - 1,
  ]));
  const vec = t.add(new cv.MatVector());
  vec.push_back(pts);
  cv.fillPoly(templ, vec, new cv.Scalar(255));
  return templ;
}

export function larguraNaLinha(mask, y) {
  const row = mask.data.subarray(y * mask.cols, (y + 1) * mask.cols);
  let primeiro = -1;
  let ultimo = -1;
  for (let x = 0; x < row.length; x++) {
    if (row[x]) {
      if (primeiro < 0) primeiro = x;
      ultimo = x;
    }
  }
  return primeiro < 0 ? 0 : ultimo - primeiro + 1;
}

/**
 * Sinalização de obra: cor de segurança + (listras OU silhueta de cone).
 * - Listras: linhas do blob sem cor de segurança, entre linhas com cor, cujo
 *   conteúdo é branco/prata (ou preto, para sinalização amarela).
 * - Silhueta: matchTemplate (TM_CCOEFF_NORMED) da máscara do blob com um
 *   trapézio de cone, mais afunilamento real (topo mais estreito que a base).
 */
export function detectarSinalizacao(src, saida, cfg = CONFIG.OBSTACULO) {
  const t = new Rastreador();
  try {
    const hsv = t.add(new cv.Mat());
    paraHSV(src, hsv);
    const hsvData = hsv.data.slice();
    const areaImg = src.rows * src.cols;
    const templ = criarTemplateSilhueta(cfg, t);
    const evidencias = [];
    const candidatos = [];

    const mascaras = [];
    const laranja = t.add(new cv.Mat());
    faixaHSV(hsv, cfg.LARANJA_BAIXO, cfg.LARANJA_ALTO, laranja);
    const vermelho = t.add(new cv.Mat());
    faixaHSV(hsv, cfg.VERMELHO_BAIXO, cfg.VERMELHO_ALTO, vermelho);
    cv.bitwise_or(laranja, vermelho, laranja);
    mascaras.push({ nome: 'LARANJA', mask: laranja, listraPreta: false });
    const amarelo = t.add(new cv.Mat());
    faixaHSV(hsv, cfg.AMARELO_BAIXO, cfg.AMARELO_ALTO, amarelo);
    mascaras.push({ nome: 'AMARELO', mask: amarelo, listraPreta: true });

    for (const { nome, mask, listraPreta } of mascaras) {
      morfologia(mask, mask, cv.MORPH_OPEN, 3);
      const unida = t.add(new cv.Mat());
      morfologia(mask, unida, cv.MORPH_CLOSE, 3, cfg.UNIR_VERTICAL, cv.MORPH_RECT);
      const contornos = t.add(new cv.MatVector());
      const hier = t.add(new cv.Mat());
      cv.findContours(unida, contornos, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      const blobsCor = [];

      for (let i = 0; i < contornos.size(); i++) {
        const c = t.add(contornos.get(i));
        const area = cv.contourArea(c, false);
        if (area < cfg.AREA_PAR_MIN_RATIO * areaImg) continue;
        const r = cv.boundingRect(c);
        if (r.width < 6 || r.height < 6) continue;
        const aspecto = r.height / r.width;
        // Blobs pequenos (ponta do cone) só participam do teste de pares.
        if (area < cfg.AREA_MIN_RATIO * areaImg) {
          blobsCor.push(r);
          continue;
        }

        // Perfil por linha da cor bruta (dentro das colunas centrais do blob).
        const blob = t.add(mascaraDoContorno(contornos, i, r));
        const roiCor = t.add(mask.roi(new cv.Rect(r.x, r.y, r.width, r.height)));
        const corBruta = t.add(new cv.Mat());
        cv.bitwise_and(roiCor, blob, corBruta);
        const cb = corBruta.data;
        const bl = blob.data;
        const x1 = Math.floor(r.width * 0.2);
        const x2 = Math.ceil(r.width * 0.8);
        const fracLinha = new Float32Array(r.height);
        for (let y = 0; y < r.height; y++) {
          let cor = 0;
          let dentro = 0;
          for (let x = x1; x < x2; x++) {
            if (bl[y * r.width + x]) {
              dentro++;
              if (cb[y * r.width + x]) cor++;
            }
          }
          fracLinha[y] = dentro ? cor / dentro : 0;
        }

        // Listras: sequências de linhas pobres em cor entre linhas ricas em cor.
        let listras = 0;
        let y = 0;
        let viuCor = false;
        while (y < r.height) {
          if (fracLinha[y] >= cfg.LISTRA_MIN_COR) {
            viuCor = true;
            y++;
            continue;
          }
          if (!viuCor || fracLinha[y] > cfg.LISTRA_MAX_COR) {
            y++;
            continue;
          }
          const ini = y;
          while (y < r.height && fracLinha[y] <= cfg.LISTRA_MAX_COR) y++;
          const fim = y;
          const temCorAbaixo = Array.prototype.some.call(fracLinha.subarray(fim), (f) => f >= cfg.LISTRA_MIN_COR);
          if (!temCorAbaixo || fim - ini < Math.max(2, r.height * 0.04)) continue;
          // Conteúdo da faixa: branco/prata (ou preto).
          let somaS = 0;
          let somaV = 0;
          let cont = 0;
          for (let yy = ini; yy < fim; yy++) {
            for (let x = x1; x < x2; x++) {
              if (!bl[yy * r.width + x]) continue;
              const j = ((r.y + yy) * src.cols + (r.x + x)) * 3;
              somaS += hsvData[j + 1];
              somaV += hsvData[j + 2];
              cont++;
            }
          }
          if (!cont) continue;
          const s = somaS / cont;
          const v = somaV / cont;
          const branca = s <= cfg.LISTRA_S_MAX && v >= cfg.LISTRA_V_MIN;
          const preta = listraPreta && v <= cfg.LISTRA_PRETA_V_MAX;
          if (branca || preta) listras++;
        }

        // Silhueta (matchTemplate) e afunilamento.
        const blobEsc = t.add(new cv.Mat());
        cv.resize(blob, blobEsc, new cv.Size(cfg.TEMPLATE_LARGURA, cfg.TEMPLATE_ALTURA), 0, 0, cv.INTER_NEAREST);
        const resultado = t.add(new cv.Mat());
        const semMascara = t.add(new cv.Mat());
        cv.matchTemplate(blobEsc, templ, resultado, cv.TM_CCOEFF_NORMED, semMascara);
        const silhueta = cv.minMaxLoc(resultado, semMascara).maxVal;
        const larguraTopo = larguraNaLinha(blob, Math.floor(r.height * 0.2));
        const larguraBase = larguraNaLinha(blob, Math.floor(r.height * 0.85));
        const afunilamento = larguraBase ? larguraTopo / larguraBase : 1;

        const porListra = listras >= 1 && aspecto >= cfg.ASPECTO_LISTRA_MIN && aspecto <= cfg.ASPECTO_MAX;
        const porSilhueta =
          silhueta >= cfg.SILHUETA_MIN && afunilamento <= cfg.AFUNILAMENTO_MAX && aspecto >= cfg.ASPECTO_CONE_MIN;
        const ok = porListra || porSilhueta;
        candidatos.push({
          cor: nome,
          area: arred(area / areaImg, 4),
          aspecto: arred(aspecto, 2),
          listras,
          silhueta: arred(silhueta, 2),
          afunil: arred(afunilamento, 2),
          ok,
        });
        blobsCor.push(r);
        if (ok) {
          evidencias.push({ tipo: 'SINALIZACAO', ...r });
          desenharRetangulo(saida, r, COR.VERMELHO, 3, 'SINALIZACAO');
        }
      }

      // Listra larga: dois blobs da mesma cor alinhados verticalmente com uma
      // faixa branca/prata (ou preta) entre eles — cone/barril listrado.
      for (const a of blobsCor) {
        for (const b of blobsCor) {
          if (b === a || b.y <= a.y) continue;
          const gap = b.y - (a.y + a.height);
          const menorAltura = Math.min(a.height, b.height);
          if (gap < 2 || gap > cfg.PAR_GAP_MAX * menorAltura) continue;
          const xa = Math.max(a.x, b.x);
          const xb = Math.min(a.x + a.width, b.x + b.width);
          if (xb - xa < cfg.PAR_SOBREPOSICAO_MIN * Math.min(a.width, b.width)) continue;
          const m = Math.floor((xb - xa) * 0.2);
          let somaS = 0;
          let somaV = 0;
          let cont = 0;
          for (let y = a.y + a.height; y < b.y; y++) {
            for (let x = xa + m; x < xb - m; x++) {
              const j = (y * src.cols + x) * 3;
              somaS += hsvData[j + 1];
              somaV += hsvData[j + 2];
              cont++;
            }
          }
          if (!cont) continue;
          const s = somaS / cont;
          const v = somaV / cont;
          const branca = s <= cfg.PAR_S_MAX && v >= cfg.LISTRA_V_MIN;
          const preta = listraPreta && v <= cfg.LISTRA_PRETA_V_MAX;
          if (!branca && !preta) continue;
          const x0 = Math.min(a.x, b.x);
          const uniao = { x: x0, y: a.y, width: Math.max(a.x + a.width, b.x + b.width) - x0, height: b.y + b.height - a.y };
          if (uniao.height / uniao.width < cfg.ASPECTO_LISTRA_MIN) continue;
          const jaExiste = evidencias.some(
            (e) => uniao.x < e.x + e.width && e.x < uniao.x + uniao.width && uniao.y < e.y + e.height && e.y < uniao.y + uniao.height,
          );
          candidatos.push({ cor: nome, par: true, area: arred((uniao.width * uniao.height) / areaImg, 4), s: Math.round(s), v: Math.round(v), ok: true });
          if (jaExiste) continue;
          evidencias.push({ tipo: 'SINALIZACAO', ...uniao });
          desenharRetangulo(saida, uniao, COR.VERMELHO, 3, 'SINALIZACAO');
        }
      }
    }
    return { evidencias, candidatos: candidatos.sort((a, b) => b.area - a.area).slice(0, 6) };
  } finally {
    t.liberar();
  }
}

/** Mantém só intrusões com textura de objeto (descarta marcações planas). */
export function filtrarObjetos(intrusoes, cfg = CONFIG.OBSTACULO) {
  return intrusoes.filter((r) => r.densidade >= cfg.INTRUSAO_DENSIDADE_MIN);
}

export function processarObstaculo(src, saida, cfg = CONFIG.OBSTACULO) {
  const sinal = detectarSinalizacao(src, saida, cfg);
  const superficie = analisarSuperficie(src);
  const intrusoes = filtrarObjetos(superficie.intrusoes).map((r) => ({ tipo: 'OBSTRUCAO', ...r }));
  intrusoes.forEach((r) => desenharRetangulo(saida, r, COR.MAGENTA, 3, 'OBSTRUCAO'));
  const evidencias = [...sinal.evidencias, ...intrusoes];
  return {
    isValid: evidencias.length > 0,
    evidencias,
    detalhes: {
      sinalizacao: sinal.evidencias.length,
      obstrucoes: intrusoes.length,
      superficie: {
        confiavel: superficie.confiavel,
        fracao: superficie.fracaoSuperficie,
        intrusoes: superficie.intrusoes.map(({ fracao, densidade, verde, sat }) => ({ fracao, densidade, verde, sat })),
      },
      candidatosSinalizacao: sinal.candidatos,
    },
  };
}
