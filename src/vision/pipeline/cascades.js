/* global cv */
import { CONFIG } from './config.js';

// ---------------------------------------------------------------------------
// 4. Recursos compartilhados (cascades) com cache
// ---------------------------------------------------------------------------

let promessaClassificadores = null;
export const arquivosNoFS = new Set();

export function carregarClassificadores() {
  if (promessaClassificadores) return promessaClassificadores;

  promessaClassificadores = (async () => {
    const lista = [];
    try {
      for (const def of CONFIG.LGPD.CASCADES) {
        const { arquivo } = def;
        if (!arquivosNoFS.has(arquivo)) {
          const resposta = await fetch(CONFIG.LGPD.CASCADE_BASE_URL + arquivo);
          if (!resposta.ok) throw new Error(`Falha ao baixar ${arquivo} (HTTP ${resposta.status}).`);
          const dados = new Uint8Array(await resposta.arrayBuffer());
          try {
            cv.FS_unlink('/' + arquivo);
          } catch {
            // não existia
          }
          cv.FS_createDataFile('/', arquivo, dados, true, false, false);
          arquivosNoFS.add(arquivo);
        }
        const classificador = new cv.CascadeClassifier();
        if (!classificador.load(arquivo)) {
          classificador.delete();
          throw new Error(`CascadeClassifier não conseguiu carregar ${arquivo}.`);
        }
        lista.push({ ...def, classificador });
      }
      return lista;
    } catch (erro) {
      lista.forEach(({ classificador }) => classificador.delete());
      throw erro;
    }
  })().catch((erro) => {
    promessaClassificadores = null;
    throw erro;
  });

  return promessaClassificadores;
}

/** Libera os classificadores em cache (ex.: ao desmontar a tela). */
export async function liberarRecursos() {
  const classificadores = await promessaClassificadores?.catch(() => null);
  classificadores?.forEach(({ classificador }) => classificador.delete());
  promessaClassificadores = null;
}
