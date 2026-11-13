/**
 * Caminho Livre — interface de nova denúncia (acessível).
 *
 * Fluxo: Foto → Tipo → Resultado (borrar/enviar) → Enviado.
 * Acessibilidade:
 *  - a cada troca de passo o foco vai para o título e um aria-live anuncia o passo;
 *  - status nunca só por cor (ícone + título + mensagem);
 *  - borrão manual sem arrastar: tocar posiciona, setas/botões movem, +/− redimensionam,
 *    Enter aplica (teclado) — atende WCAG 2.1.1 (teclado) e 2.5.7 (movimentos de arrastar).
 */
import { AnalisadorVisao } from '../src/vision/AnalisadorVisao.js';
import { canvasParaBlob } from '../src/vision/VisionPipeline.js';

// Endpoint do backend. null = modo demonstração (nada sai do aparelho).
const ENDPOINT_DENUNCIAS = null;

const analisador = new AnalisadorVisao({
  // Arquivos de public/ ficam na raiz do site, tanto no `vite dev` quanto no build (dist/).
  // O OpenCV vem empacotado no worker de visão (não há opencvUrl).
  config: { LGPD: { CASCADE_BASE_URL: './cascades/' } },
});

const $ = (id) => document.getElementById(id);

// Testes: abrir com ?limpar apaga a lista de fotos já enviadas nesta aba
// (usada para recusar reenvios) e remove o parâmetro da URL.
const CHAVE_HASHES = 'hashesEnviados';
if (new URLSearchParams(location.search).has('limpar')) {
  sessionStorage.removeItem(CHAVE_HASHES);
  history.replaceState(null, '', location.pathname);
  console.info('Caminho Livre: lista de fotos enviadas apagada.');
}

const PASSOS = {
  foto: { secao: 'passo-foto', titulo: 'titulo-foto', indice: 0, nome: 'Foto' },
  tipo: { secao: 'passo-tipo', titulo: 'titulo-tipo', indice: 1, nome: 'Tipo do problema' },
  resultado: { secao: 'passo-resultado', titulo: 'titulo-resultado', indice: 2, nome: 'Resultado' },
  enviado: { secao: 'passo-enviado', titulo: 'titulo-enviado', indice: 3, nome: 'Enviado' },
};

const STATUS_UI = {
  CONFIRMADO: { icone: 'i-ok', titulo: 'Problema identificado' },
  INCONCLUSIVO: { icone: 'i-revisao', titulo: 'Vamos revisar' },
  REJEITADO: { icone: 'i-erro', titulo: 'Tire outra foto' },
};

// Nomes curtos das evidências, para dizer ao usuário o que foi encontrado.
const NOMES_EVIDENCIA = {
  BURACO_OU_QUEBRA: 'buraco ou calçada quebrada',
  TATIL_INTERROMPIDO: 'piso tátil interrompido',
  DEGRAUS: 'degraus',
  PASSAGEM_INTERROMPIDA: 'passagem bloqueada',
  SINALIZACAO: 'sinalização de obra',
  OBSTRUCAO: 'objeto no caminho',
  AGUA: 'água acumulada',
};

const estado = {
  imagem: null, // HTMLImageElement da foto escolhida
  urlImagem: null,
  resultado: null,
  canvas: null,
  historico: [], // ImageData para desfazer borrões
  caixa: null, // { x, y, lado } em pixels do canvas
};

// ---------------------------------------------------------------------------
// Navegação
// ---------------------------------------------------------------------------

function anunciar(texto) {
  // Limpa antes para o leitor de tela anunciar mesmo textos repetidos.
  $('anuncio').textContent = '';
  setTimeout(() => ($('anuncio').textContent = texto), 50);
}

function irPara(nome) {
  const alvo = PASSOS[nome];
  for (const p of Object.values(PASSOS)) $(p.secao).hidden = p !== alvo;

  // Progresso: 3 marcadores (o passo "enviado" marca todos como feitos).
  document.querySelectorAll('#passos li').forEach((li, i) => {
    li.classList.toggle('feito', i < alvo.indice);
    if (i === Math.min(alvo.indice, 2) && nome !== 'enviado') li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
  });

  const titulo = $(alvo.titulo);
  titulo.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
  if (alvo.indice < 3) anunciar(`Passo ${alvo.indice + 1} de 3: ${alvo.nome}`);
}

function reiniciar() {
  if (estado.urlImagem) URL.revokeObjectURL(estado.urlImagem);
  Object.assign(estado, { imagem: null, urlImagem: null, resultado: null, canvas: null, historico: [], caixa: null });
  $('in-camera').value = '';
  $('in-galeria').value = '';
  $('aviso-camera').hidden = true;
  fecharBorrao(false);
  irPara('foto');
}

// ---------------------------------------------------------------------------
// Passo 1 — Foto
// ---------------------------------------------------------------------------

$('btn-galeria').addEventListener('click', () => $('in-galeria').click());

/** Usa uma foto (arquivo da galeria ou quadro capturado da câmera). */
async function usarFoto(blob) {
  // Carregamento sob demanda: o motor (OpenCV) começa a baixar agora,
  // enquanto a pessoa escolhe o tipo do problema.
  analisador.preparar().catch(() => {});

  if (estado.urlImagem) URL.revokeObjectURL(estado.urlImagem);
  estado.urlImagem = URL.createObjectURL(blob);
  const img = new Image();
  img.src = estado.urlImagem;
  try {
    await img.decode();
  } catch {
    mostrarAvisoCamera('Não foi possível abrir essa imagem. Escolha outra.');
    return;
  }
  $('aviso-camera').hidden = true;
  estado.imagem = img;
  $('miniatura').src = estado.urlImagem;
  irPara('tipo');
}

function aoEscolherArquivo(ev) {
  const arquivo = ev.target.files?.[0];
  if (arquivo) usarFoto(arquivo);
}
$('in-camera').addEventListener('change', aoEscolherArquivo);
$('in-galeria').addEventListener('change', aoEscolherArquivo);

// ---------------------------------------------------------------------------
// Câmera ao vivo (getUserMedia)
// Funciona em computador e celular. Exige contexto seguro (HTTPS ou
// localhost/127.0.0.1). Sem suporte ou sem permissão, cai para o seletor
// nativo (<input capture>), que no celular também abre a câmera.
// ---------------------------------------------------------------------------

const camera = { stream: null, frontal: false };
const dialogo = $('dialogo-camera');
const video = $('video-camera');

function mostrarAvisoCamera(texto) {
  $('aviso-camera').textContent = texto;
  $('aviso-camera').hidden = false;
}

function pararCamera() {
  camera.stream?.getTracks().forEach((t) => t.stop());
  camera.stream = null;
  video.srcObject = null;
}

async function iniciarStream() {
  pararCamera();
  $('btn-disparar').disabled = true;
  camera.stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: camera.frontal ? 'user' : 'environment' }, // traseira por padrão
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  });
  video.srcObject = camera.stream;
  await video.play().catch(() => {});
  if (!video.videoWidth) await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
  $('btn-disparar').disabled = false;
}

async function abrirCamera() {
  $('aviso-camera').hidden = true;
  const suportada = window.isSecureContext && navigator.mediaDevices?.getUserMedia;
  if (!suportada) {
    $('in-camera').click(); // fallback nativo
    return;
  }
  dialogo.showModal();
  anunciar('Câmera aberta. Aponte para o problema e toque em Tirar foto.');
  try {
    await iniciarStream();
    $('btn-disparar').focus();
    // "Trocar câmera" só aparece se houver mais de uma (lista exige permissão já dada).
    const dispositivos = await navigator.mediaDevices.enumerateDevices();
    $('btn-trocar-camera').hidden = dispositivos.filter((d) => d.kind === 'videoinput').length < 2;
  } catch (e) {
    fecharCamera();
    if (e.name === 'NotAllowedError') {
      mostrarAvisoCamera('O acesso à câmera foi negado. Permita nas configurações do navegador ou use a Galeria.');
    } else if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') {
      mostrarAvisoCamera('Nenhuma câmera encontrada. Use a Galeria.');
    } else {
      mostrarAvisoCamera('Não foi possível abrir a câmera. Use a Galeria.');
    }
    console.error(e);
  }
}

function fecharCamera() {
  pararCamera();
  if (dialogo.open) dialogo.close();
}

function capturar() {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  fecharCamera();
  canvas.toBlob((blob) => blob && usarFoto(blob), 'image/jpeg', 0.92);
}

$('btn-camera').addEventListener('click', abrirCamera);
$('btn-disparar').addEventListener('click', capturar);
$('btn-cancelar-camera').addEventListener('click', () => {
  fecharCamera();
  $('btn-camera').focus();
});
$('btn-trocar-camera').addEventListener('click', async () => {
  camera.frontal = !camera.frontal;
  try {
    await iniciarStream();
    anunciar(camera.frontal ? 'Câmera frontal.' : 'Câmera traseira.');
  } catch (e) {
    console.error(e);
  }
});
// Esc fecha o <dialog> nativamente: garante que a câmera desligue também.
dialogo.addEventListener('close', () => {
  pararCamera();
  if (!estado.imagem) $('btn-camera').focus();
});
// Desliga a câmera se a aba for para segundo plano.
document.addEventListener('visibilitychange', () => document.hidden && fecharCamera());

// ---------------------------------------------------------------------------
// Passo 2 — Tipo
// ---------------------------------------------------------------------------

document.querySelectorAll('[data-voltar]').forEach((b) => b.addEventListener('click', () => irPara(b.dataset.voltar)));

document.querySelectorAll('.botao-tipo').forEach((botao) => {
  botao.addEventListener('click', () => analisar(botao.dataset.categoria));
});

async function analisar(categoria) {
  irPara('resultado');
  $('resultado').hidden = true;
  $('erro').hidden = true;
  $('btn-erro-voltar').hidden = true;
  $('carregando').hidden = false;
  $('passo-resultado').setAttribute('aria-busy', 'true');
  $('texto-carregando').textContent = 'Analisando…';
  anunciar('Analisando a foto. Aguarde.');

  try {
    const hashesAnteriores = JSON.parse(sessionStorage.getItem('hashesEnviados') ?? '[]');
    const res = await analisador.analisar(estado.imagem, categoria, { hashesAnteriores });
    estado.resultado = res;
    mostrarResultado(res);
  } catch (e) {
    $('mensagem-erro').textContent = 'Não conseguimos analisar a foto. Tente outra vez.';
    $('erro').hidden = false;
    $('btn-erro-voltar').hidden = false;
    console.error(e);
  } finally {
    $('carregando').hidden = true;
    $('passo-resultado').removeAttribute('aria-busy');
  }
}

// ---------------------------------------------------------------------------
// Passo 3 — Resultado
// ---------------------------------------------------------------------------

function mostrarResultado(res) {
  const ui = STATUS_UI[res.status];
  $('faixa-status').dataset.status = res.status;
  $('icone-status').setAttribute('href', `#${ui.icone}`);
  $('titulo-status').textContent = ui.titulo;

  let mensagem = res.mensagem;
  if (res.status === 'CONFIRMADO') {
    const tipos = [...new Set((res.detalhes.evidencias ?? []).map((e) => NOMES_EVIDENCIA[e.tipo]).filter(Boolean))];
    if (tipos.length) mensagem = `Encontramos: ${tipos.join(', ')}.`;
  }
  $('mensagem-status').textContent = mensagem;

  const canvas = res.processedCanvas;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Sua foto, com rostos e placas borrados');
  estado.canvas = canvas;
  estado.historico = [];
  $('area-foto').replaceChildren($('caixa-borrar'), canvas);

  // Ações conforme o status: rejeitada → só "Outra foto" (em destaque).
  const rejeitada = !res.aceitar;
  $('btn-enviar').hidden = rejeitada;
  $('btn-borrar').hidden = rejeitada;
  $('btn-outra').classList.toggle('botao-secundario', !rejeitada);
  fecharBorrao(false);

  $('resultado').hidden = false;
  anunciar(`${ui.titulo}. ${mensagem}`);
}

$('btn-outra').addEventListener('click', reiniciar);
$('btn-erro-voltar')?.addEventListener('click', reiniciar);

// ---- Envio ------------------------------------------------------------------

$('btn-enviar').addEventListener('click', async () => {
  const botao = $('btn-enviar');
  botao.disabled = true;
  try {
    // Só o canvas anonimizado (com borrões manuais) sai do aparelho;
    // toBlob não leva metadados EXIF (ex.: GPS da foto).
    const blob = await canvasParaBlob(estado.canvas);
    if (ENDPOINT_DENUNCIAS) {
      const dados = new FormData();
      dados.append('foto', blob, 'denuncia.jpg');
      dados.append('categoria', estado.resultado.detalhes.categoria);
      dados.append('status', estado.resultado.status);
      dados.append('hash', estado.resultado.hash);
      const resp = await fetch(ENDPOINT_DENUNCIAS, { method: 'POST', body: dados });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      $('detalhe-enviado').textContent =
        estado.resultado.status === 'CONFIRMADO' ? 'Obrigado por ajudar a cidade.' : 'Um moderador vai revisar sua foto.';
    } else {
      $('detalhe-enviado').textContent = 'Modo demonstração: a denúncia não saiu do aparelho.';
    }
    const hashes = JSON.parse(sessionStorage.getItem('hashesEnviados') ?? '[]');
    hashes.push(estado.resultado.hash);
    sessionStorage.setItem('hashesEnviados', JSON.stringify(hashes.slice(-50)));
    irPara('enviado');
    anunciar('Denúncia enviada.');
  } catch (e) {
    console.error(e);
    anunciar('Não foi possível enviar. Verifique a internet e tente de novo.');
  } finally {
    botao.disabled = false;
  }
});

$('btn-nova').addEventListener('click', reiniciar);

// ---------------------------------------------------------------------------
// Borrão manual
// ---------------------------------------------------------------------------

const area = $('area-foto');
const caixaEl = $('caixa-borrar');

function abrirBorrao() {
  const c = estado.canvas;
  const lado = Math.round(Math.min(c.width, c.height) * 0.2);
  estado.caixa = estado.caixa ?? { x: (c.width - lado) / 2, y: (c.height - lado) / 2, lado };
  $('painel-borrar').hidden = false;
  $('btn-borrar').setAttribute('aria-expanded', 'true');
  area.classList.add('borrando');
  area.tabIndex = 0;
  area.setAttribute('role', 'group'); // aria-label exige um papel no elemento
  area.setAttribute('aria-label', 'Foto. Setas movem o quadrado, mais e menos mudam o tamanho, Enter borra.');
  caixaEl.hidden = false;
  // No modo borrar só os controles do borrão ficam visíveis, logo abaixo da foto.
  $('acoes').hidden = true;
  desenharCaixa();
  area.scrollIntoView({ block: 'start', behavior: 'smooth' });
  $('btn-aplicar-borrao').focus({ preventScroll: true });
  anunciar('Modo borrar. Posicione o quadrado sobre o que quer esconder.');
}

function fecharBorrao(devolverFoco = true) {
  $('painel-borrar').hidden = true;
  $('btn-borrar').setAttribute('aria-expanded', 'false');
  area.classList.remove('borrando');
  area.tabIndex = -1;
  area.removeAttribute('aria-label');
  area.removeAttribute('role');
  caixaEl.hidden = true;
  $('acoes').hidden = false;
  if (devolverFoco) $('btn-borrar').focus();
}

$('btn-borrar').addEventListener('click', () => ($('painel-borrar').hidden ? abrirBorrao() : fecharBorrao()));
$('btn-concluir-borrao').addEventListener('click', () => fecharBorrao());

function limitarCaixa() {
  const c = estado.canvas;
  const k = estado.caixa;
  k.lado = Math.max(16, Math.min(k.lado, Math.min(c.width, c.height)));
  k.x = Math.max(0, Math.min(k.x, c.width - k.lado));
  k.y = Math.max(0, Math.min(k.y, c.height - k.lado));
}

function desenharCaixa() {
  if (!estado.caixa || !estado.canvas) return;
  limitarCaixa();
  const escala = estado.canvas.getBoundingClientRect().width / estado.canvas.width;
  const k = estado.caixa;
  Object.assign(caixaEl.style, {
    left: `${k.x * escala}px`,
    top: `${k.y * escala}px`,
    width: `${k.lado * escala}px`,
    height: `${k.lado * escala}px`,
  });
}
window.addEventListener('resize', desenharCaixa);

function mover(dx, dy, passoFracao = 0.04) {
  const passo = estado.canvas.width * passoFracao;
  estado.caixa.x += dx * passo;
  estado.caixa.y += dy * passo;
  desenharCaixa();
}
function redimensionar(sentido) {
  const k = estado.caixa;
  const novo = k.lado * (sentido > 0 ? 1.2 : 1 / 1.2);
  // Mantém o centro no lugar.
  k.x -= (novo - k.lado) / 2;
  k.y -= (novo - k.lado) / 2;
  k.lado = novo;
  desenharCaixa();
}

document.querySelectorAll('[data-mover]').forEach((b) =>
  b.addEventListener('click', () => {
    const [dx, dy] = b.dataset.mover.split(',').map(Number);
    mover(dx, dy);
  }),
);
document.querySelectorAll('[data-tamanho]').forEach((b) => b.addEventListener('click', () => redimensionar(Number(b.dataset.tamanho))));

// Toque/clique posiciona o centro do quadrado; arrastar também move (opcional).
let arrastando = false;
function centralizarEm(ev) {
  const r = estado.canvas.getBoundingClientRect();
  const escala = estado.canvas.width / r.width;
  estado.caixa.x = (ev.clientX - r.left) * escala - estado.caixa.lado / 2;
  estado.caixa.y = (ev.clientY - r.top) * escala - estado.caixa.lado / 2;
  desenharCaixa();
}
area.addEventListener('pointerdown', (ev) => {
  if (!area.classList.contains('borrando')) return;
  arrastando = true;
  area.setPointerCapture(ev.pointerId);
  centralizarEm(ev);
});
area.addEventListener('pointermove', (ev) => arrastando && centralizarEm(ev));
area.addEventListener('pointerup', () => (arrastando = false));
area.addEventListener('pointercancel', () => (arrastando = false));

// Teclado na foto: setas (Shift = passo maior), + / −, Enter/Espaço borra, Esc fecha.
area.addEventListener('keydown', (ev) => {
  if (!area.classList.contains('borrando')) return;
  const passo = ev.shiftKey ? 0.1 : 0.02;
  const mapa = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  if (mapa[ev.key]) {
    mover(...mapa[ev.key], passo);
  } else if (ev.key === '+' || ev.key === '=') {
    redimensionar(1);
  } else if (ev.key === '-' || ev.key === '_') {
    redimensionar(-1);
  } else if (ev.key === 'Enter' || ev.key === ' ') {
    aplicarBorrao();
  } else {
    return;
  }
  ev.preventDefault();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !$('painel-borrar').hidden) fecharBorrao();
});

async function aplicarBorrao() {
  const c = estado.canvas;
  const k = estado.caixa;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  estado.historico.push(ctx.getImageData(0, 0, c.width, c.height));
  $('btn-aplicar-borrao').disabled = true;
  try {
    await analisador.borrar(c, [{ x: k.x, y: k.y, width: k.lado, height: k.lado }]);
    $('btn-desfazer').disabled = false;
    anunciar('Área borrada.');
  } catch (e) {
    estado.historico.pop();
    console.error(e);
    anunciar('Não foi possível borrar. Tente de novo.');
  } finally {
    $('btn-aplicar-borrao').disabled = false;
  }
}
$('btn-aplicar-borrao').addEventListener('click', aplicarBorrao);

$('btn-desfazer').addEventListener('click', () => {
  const anterior = estado.historico.pop();
  if (anterior) estado.canvas.getContext('2d').putImageData(anterior, 0, 0);
  $('btn-desfazer').disabled = estado.historico.length === 0;
  anunciar('Borrão desfeito.');
});
