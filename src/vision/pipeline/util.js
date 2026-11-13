/* global cv */
import { CC_STAT } from './config.js';

// ---------------------------------------------------------------------------
// 5. Utilitários
// ---------------------------------------------------------------------------

export const escalar = (v) => new cv.Scalar(...v);
export const impar = (n) => {
  const r = Math.max(1, Math.round(n));
  return r % 2 === 0 ? r + 1 : r;
};
export const ancora = () => new cv.Point(-1, -1);
export const ccStat = (nome) => (typeof cv[`CC_STAT_${nome}`] === 'number' ? cv[`CC_STAT_${nome}`] : CC_STAT[nome]);
export const arred = (v, casas = 3) => Number(v.toFixed(casas));

export function morfologia(src, dst, op, largura, altura = largura, forma = cv.MORPH_ELLIPSE) {
  const k = cv.getStructuringElement(forma, new cv.Size(largura, altura));
  try {
    cv.morphologyEx(src, dst, op, k, ancora(), 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
  } finally {
    k.delete();
  }
}

export function redimensionarParaLargura(src, largura, t) {
  const dst = t.add(new cv.Mat());
  const fator = Math.min(1, largura / src.cols);
  if (fator === 1) {
    src.copyTo(dst);
  } else {
    cv.resize(src, dst, new cv.Size(Math.round(src.cols * fator), Math.round(src.rows * fator)), 0, 0, cv.INTER_AREA);
  }
  return { mat: dst, fator: dst.cols / src.cols };
}

export function redimensionarMaiorLado(src, maximo) {
  const maior = Math.max(src.cols, src.rows);
  const dst = new cv.Mat();
  try {
    if (maior <= maximo) {
      src.copyTo(dst);
    } else {
      const f = maximo / maior;
      cv.resize(src, dst, new cv.Size(Math.round(src.cols * f), Math.round(src.rows * f)), 0, 0, cv.INTER_AREA);
    }
    return dst;
  } catch (e) {
    dst.delete();
    throw e;
  }
}

export function paraHSV(srcRgba, hsv) {
  const rgb = new cv.Mat();
  try {
    cv.cvtColor(srcRgba, rgb, cv.COLOR_RGBA2RGB);
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
  } finally {
    rgb.delete();
  }
}

/** inRange com limites cv.Scalar (via Mats constantes). */
export function faixaHSV(hsv, baixo, alto, dst) {
  const b = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), escalar(baixo));
  const a = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), escalar(alto));
  try {
    cv.inRange(hsv, b, a, dst);
  } finally {
    b.delete();
    a.delete();
  }
}

export function zerarLinhasAcima(mask, y0) {
  if (y0 <= 0) return;
  const roi = mask.roi(new cv.Rect(0, 0, mask.cols, Math.min(y0, mask.rows)));
  try {
    roi.setTo(new cv.Scalar(0));
  } finally {
    roi.delete();
  }
}

/** Limiares de Canny automáticos a partir da mediana dos tons de cinza. */
export function limiaresCannyAuto(gray, sigma, minimoBaixo) {
  const hist = new Uint32Array(256);
  const d = gray.data;
  for (let i = 0; i < d.length; i++) hist[d[i]]++;
  let acc = 0;
  let mediana = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= d.length / 2) {
      mediana = v;
      break;
    }
  }
  const baixo = Math.max(minimoBaixo, (1 - sigma) * mediana);
  const alto = Math.max(baixo * 2, Math.min(255, (1 + sigma) * mediana));
  return [baixo, alto];
}

export function medianaMascarada(mat, excluir, y0) {
  const d = mat.data;
  const e = excluir ? excluir.data : null;
  const hist = new Uint32Array(256);
  let n = 0;
  for (let i = y0 * mat.cols; i < d.length; i++) {
    if (e && e[i]) continue;
    hist[d[i]]++;
    n++;
  }
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= n / 2) return v;
  }
  return 0;
}

export function desenharRetangulo(saida, r, cor, espessura = 3, rotulo = null) {
  const p1 = new cv.Point(Math.round(r.x), Math.round(r.y));
  const p2 = new cv.Point(Math.round(r.x + r.width), Math.round(r.y + r.height));
  cv.rectangle(saida, p1, p2, escalar(cor), espessura, cv.LINE_8, 0);
  if (rotulo) {
    const y = Math.max(14, Math.round(r.y) - 5);
    cv.putText(saida, rotulo, new cv.Point(Math.round(r.x), y), cv.FONT_HERSHEY_SIMPLEX, 0.5, escalar(cor), 2, cv.LINE_AA, false);
  }
}

/** Desenha um contorno calculado em escala reduzida na imagem de saída. */
export function desenharContornoEscalado(saida, contorno, fator, cor, espessura = 2) {
  const pts = contorno.data32S;
  const escalados = new Int32Array(pts.length);
  for (let i = 0; i < pts.length; i++) escalados[i] = Math.round(pts[i] / fator);
  const mat = new cv.Mat(contorno.rows, 1, cv.CV_32SC2);
  const vec = new cv.MatVector();
  try {
    mat.data32S.set(escalados);
    vec.push_back(mat);
    cv.drawContours(saida, vec, 0, escalar(cor), espessura, cv.LINE_8);
  } finally {
    mat.delete();
    vec.delete();
  }
}

export const escalarRet = (r, fator) => ({
  x: r.x / fator,
  y: r.y / fator,
  width: r.width / fator,
  height: r.height / fator,
});

/** Máscara (no tamanho do bounding rect) do contorno i, para estatísticas locais. */
export function mascaraDoContorno(contornos, i, ret) {
  const mask = cv.Mat.zeros(ret.height, ret.width, cv.CV_8UC1);
  const semHierarquia = new cv.Mat();
  try {
    cv.drawContours(mask, contornos, i, new cv.Scalar(255), -1, cv.LINE_8, semHierarquia, 0, new cv.Point(-ret.x, -ret.y));
    return mask;
  } catch (e) {
    mask.delete();
    throw e;
  } finally {
    semHierarquia.delete();
  }
}

export function mediaNaMascara(mat, ret, mask) {
  const roi = mat.roi(new cv.Rect(ret.x, ret.y, ret.width, ret.height));
  try {
    return cv.mean(roi, mask)[0];
  } finally {
    roi.delete();
  }
}
