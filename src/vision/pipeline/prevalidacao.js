/* global cv */
import { CONFIG } from './config.js';
import { Rastreador } from './memoria.js';
import { ancora, arred, paraHSV, redimensionarParaLargura } from './util.js';

// ---------------------------------------------------------------------------
// 12. Pré-validação: qualidade da foto, cena e duplicatas
// ---------------------------------------------------------------------------

/**
 * Qualidade técnica da foto, medida numa largura fixa para os limiares não
 * dependerem da resolução da câmera:
 *  - nitidez: variância do Laplaciano (baixa = tremida/fora de foco);
 *  - exposição: brilho médio e fração de pixels saturados (preto/branco).
 */
export function avaliarQualidade(dimensaoOriginal, src, cfg = CONFIG.QUALIDADE) {
  const t = new Rastreador();
  try {
    const motivos = [];
    if (Math.min(dimensaoOriginal.largura, dimensaoOriginal.altura) < cfg.MIN_LADO) motivos.push('RESOLUCAO');

    const { mat: peq } = redimensionarParaLargura(src, cfg.LARGURA_ANALISE, t);
    const gray = t.add(new cv.Mat());
    cv.cvtColor(peq, gray, cv.COLOR_RGBA2GRAY);

    const lap = t.add(new cv.Mat());
    cv.Laplacian(gray, lap, cv.CV_64F, 3, 1, 0, cv.BORDER_DEFAULT);
    const media = t.add(new cv.Mat());
    const desvio = t.add(new cv.Mat());
    cv.meanStdDev(lap, media, desvio);
    const nitidez = desvio.data64F[0] ** 2;
    if (nitidez < cfg.NITIDEZ_MIN) motivos.push('NITIDEZ');

    const d = gray.data;
    let soma = 0;
    let saturados = 0;
    for (let i = 0; i < d.length; i++) {
      soma += d[i];
      if (d[i] <= cfg.PRETO || d[i] >= cfg.BRANCO) saturados++;
    }
    const brilho = soma / d.length;
    const fracSaturados = saturados / d.length;
    if (brilho < cfg.BRILHO_MIN) motivos.push('ESCURA');
    else if (brilho > cfg.BRILHO_MAX) motivos.push('CLARA');
    else if (fracSaturados > cfg.SATURADOS_MAX) motivos.push('EXPOSICAO');

    return {
      ok: motivos.length === 0,
      motivos,
      nitidez: Math.round(nitidez),
      brilho: Math.round(brilho),
      saturados: arred(fracSaturados),
    };
  } finally {
    t.liberar();
  }
}

/**
 * Atributos de cena para distinguir foto de rua/calçada de foto fora de
 * contexto (produto em fundo liso, documento, tela, retrato):
 *  - plano: fração de pixels sem textura local (desvio < limiar);
 *  - planoNeutro: plano E sem cor (fundo de estúdio, parede, papel);
 *  - texturaInferior: |Laplaciano| médio na metade de baixo (onde fica o chão).
 */
export function avaliarCena(src, cfg = CONFIG.CENA) {
  const t = new Rastreador();
  try {
    const { mat: peq } = redimensionarParaLargura(src, cfg.LARGURA_ANALISE, t);
    const w = peq.cols;
    const h = peq.rows;
    const gray = t.add(new cv.Mat());
    cv.cvtColor(peq, gray, cv.COLOR_RGBA2GRAY);

    // Desvio-padrão local: sqrt(E[x²] − E[x]²) numa janela.
    const f = t.add(new cv.Mat());
    gray.convertTo(f, cv.CV_32F);
    const f2 = t.add(new cv.Mat());
    cv.multiply(f, f, f2, 1, -1);
    const jan = new cv.Size(cfg.JANELA, cfg.JANELA);
    const m = t.add(new cv.Mat());
    const m2 = t.add(new cv.Mat());
    cv.blur(f, m, jan, ancora(), cv.BORDER_REPLICATE);
    cv.blur(f2, m2, jan, ancora(), cv.BORDER_REPLICATE);
    const mm = t.add(new cv.Mat());
    cv.multiply(m, m, mm, 1, -1);
    const varLocal = t.add(new cv.Mat());
    cv.subtract(m2, mm, varLocal);

    const hsv = t.add(new cv.Mat());
    paraHSV(peq, hsv);
    const v = varLocal.data32F;
    const hs = hsv.data;
    const limiar = cfg.PLANO_DESVIO_MAX ** 2;
    let plano = 0;
    let planoNeutro = 0;
    for (let i = 0; i < v.length; i++) {
      if (v[i] < limiar) {
        plano++;
        if (hs[i * 3 + 1] < cfg.NEUTRO_S_MAX) planoNeutro++;
      }
    }

    const lap = t.add(new cv.Mat());
    cv.Laplacian(gray, lap, cv.CV_16S, 3, 1, 0, cv.BORDER_DEFAULT);
    const lapAbs = t.add(new cv.Mat());
    cv.convertScaleAbs(lap, lapAbs, 1, 0);
    const inferior = t.add(lapAbs.roi(new cv.Rect(0, Math.floor(h / 2), w, h - Math.floor(h / 2))));
    const texturaInferior = cv.mean(inferior)[0];

    const fracPlano = plano / v.length;
    return {
      // Fora de contexto = chão sem textura E muita área lisa (os dois juntos).
      suspeita: texturaInferior < cfg.TEXTURA_INFERIOR_MIN && fracPlano > cfg.PLANO_MAX,
      plano: arred(fracPlano),
      planoNeutro: arred(planoNeutro / v.length),
      texturaInferior: arred(texturaInferior, 1),
    };
  } finally {
    t.liberar();
  }
}

/**
 * Hash perceptual dHash (64 bits, hex): reduz para 9x8 em cinza e compara
 * cada pixel com o vizinho da direita. Resistente a redimensionamento,
 * recompressão JPEG e pequenos ajustes de brilho; NÃO reconhece o mesmo
 * problema fotografado de outro ângulo.
 */
export function calcularDHash(src) {
  const t = new Rastreador();
  try {
    const gray = t.add(new cv.Mat());
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    const mini = t.add(new cv.Mat());
    cv.resize(gray, mini, new cv.Size(9, 8), 0, 0, cv.INTER_AREA);
    const p = mini.data;
    let hex = '';
    for (let y = 0; y < 8; y++) {
      let byte = 0;
      for (let x = 0; x < 8; x++) byte = (byte << 1) | (p[y * 9 + x] > p[y * 9 + x + 1] ? 1 : 0);
      hex += byte.toString(16).padStart(2, '0');
    }
    return hex;
  } finally {
    t.liberar();
  }
}

/** Número de bits diferentes entre dois dHash hex (0 = idênticos, 64 = opostos). */
export function distanciaHamming(a, b) {
  if (!a || !b || a.length !== b.length) return 64;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      dist += x & 1;
      x >>= 1;
    }
  }
  return dist;
}

export function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.width * a.height + b.width * b.height - inter || 1);
}

/**
 * Fração da imagem ocupada pelo maior rosto CONFIRMADO por consenso: pelo
 * menos dois cascades diferentes detectando o mesmo lugar. Um cascade
 * sozinho erra em texturas (ladrilho, folhagem) — serve para borrar, não
 * para rejeitar a foto.
 */
export function fracaoRostos(regioes, src, cfg = CONFIG.QUALIDADE) {
  const rostos = regioes.filter((r) => r.tipo.startsWith('ROSTO'));
  let maior = 0;
  for (const r of rostos) {
    const fontes = new Set([r.fonte]);
    for (const o of rostos) if (o.fonte !== r.fonte && iou(r, o) >= cfg.ROSTO_IOU_CONSENSO) fontes.add(o.fonte);
    if (fontes.size >= cfg.ROSTO_CONSENSO_MIN) maior = Math.max(maior, r.width * r.height);
  }
  return maior / (src.cols * src.rows);
}
