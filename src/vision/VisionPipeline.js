/**
 * VisionPipeline.js — Módulo de Visão Computacional do Caminho Livre (v2).
 *
 * Validador client-side: o usuário informa a categoria e o pipeline clássico
 * (filtros espaciais, morfologia, Canny, limiarização, Hough, template matching)
 * CONFIRMA ou REJEITA a evidência. Rostos e placas são borrados (LGPD) como
 * ÚLTIMA etapa, depois de todas as marcações, para nada ser desenhado por cima.
 *
 * Categorias (3):
 *   ACESSIBILIDADE  barreira no caminho do pedestre: buraco, calçada quebrada,
 *                   piso tátil interrompido, degraus, passagem interrompida
 *                   (aliases legados: BURACO, PISO_TATIL)
 *   OBSTACULO       sinalização de obra (cones, barris, barreiras), entulho,
 *                   lixo, árvore caída, poste no meio
 *   ALAGAMENTO      água parada/alagamento (cor de água + superfície lisa)
 *
 * Restrições atendidas:
 *  - Somente OpenCV.js (WebAssembly), 100% no navegador. Sem redes neurais
 *    (a única IA treinada é o Haar Cascade, usado só para LGPD).
 *  - Toda cv.Mat / MatVector / RectVector é liberada com .delete() em
 *    try...finally (via Rastreador, que registra e libera tudo no finally).
 *  - Nada roda antes de cv['onRuntimeInitialized'] (ver carregarOpenCV()).
 */

// Ponto de entrada: reexporta a API pública dos módulos em ./pipeline/.
export { CATEGORIAS, CONFIG } from './pipeline/config.js';
export { carregarOpenCV } from './pipeline/opencv.js';
export { liberarRecursos } from './pipeline/cascades.js';
export { anonimizar, detectarRegioesSensiveis } from './pipeline/lgpd.js';
export { analisarSuperficie } from './pipeline/superficie.js';
export { detectarFalhaPiso } from './pipeline/piso.js';
export { processarAlagamento } from './pipeline/alagamento.js';
export { detectarSinalizacao, processarObstaculo } from './pipeline/obstaculo.js';
export { detectarDegraus, detectarTatilInterrompido, processarAcessibilidade } from './pipeline/acessibilidade.js';
export { avaliarCena, avaliarQualidade, calcularDHash, distanciaHamming } from './pipeline/prevalidacao.js';
export { MENSAGENS, STATUS, analisarImageData, borrarImageData } from './pipeline/analise.js';
export { analisarImagem, borrarCanvas, canvasParaBlob, imageDataParaCanvas, prepararEntrada } from './pipeline/navegador.js';
