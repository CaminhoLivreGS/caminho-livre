import { useCallback, useEffect, useRef, useState } from 'react';
import { AnalisadorVisao } from './AnalisadorVisao';

/**
 * Hook que expõe o módulo de visão para componentes React.
 * O OpenCV.js roda num Web Worker (a interface não trava) e só é baixado
 * quando preparar() ou analisar() é chamado (carregamento sob demanda) —
 * não é preciso <script> do opencv.js no index.html.
 *
 * const { pronto, processando, erro, preparar, analisar, borrar } =
 *   useVisionPipeline({ opencvUrl: '/opencv/opencv.js' });
 * useEffect(() => { preparar(); }, []);   // ex.: ao abrir a tela de denúncia
 * const r = await analisar(imgRef.current, 'ACESSIBILIDADE', { hashesAnteriores });
 * // r.status: 'CONFIRMADO' | 'INCONCLUSIVO' | 'REJEITADO'
 * // r.aceitar: enviar ao backend? (false só em REJEITADO)
 * // r.mensagem: texto para mostrar ao usuário
 * // r.hash: dHash para o backend deduplicar
 * await borrar(r.processedCanvas, [{ x, y, width, height }]); // LGPD manual
 */
export function useVisionPipeline(opcoesAnalisador = {}) {
  const [pronto, setPronto] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState(null);
  const montado = useRef(true);
  const analisadorRef = useRef(null);

  const obterAnalisador = () => {
    analisadorRef.current ??= new AnalisadorVisao(opcoesAnalisador);
    return analisadorRef.current;
  };

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
      analisadorRef.current?.encerrar(); // libera o worker e a memória WASM
      analisadorRef.current = null;
    };
  }, []);

  const preparar = useCallback(async () => {
    try {
      await obterAnalisador().preparar();
      if (montado.current) setPronto(true);
    } catch (e) {
      if (montado.current) setErro(e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const executar = useCallback(async (fn) => {
    setProcessando(true);
    setErro(null);
    try {
      const r = await fn(obterAnalisador());
      if (montado.current) setPronto(true);
      return r;
    } catch (e) {
      if (montado.current) setErro(e);
      throw e;
    } finally {
      if (montado.current) setProcessando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const analisar = useCallback(
    (imageElement, categoria, opcoes) => executar((a) => a.analisar(imageElement, categoria, opcoes)),
    [executar],
  );
  const borrar = useCallback((canvas, regioes) => executar((a) => a.borrar(canvas, regioes)), [executar]);

  return { pronto, processando, erro, preparar, analisar, borrar };
}
