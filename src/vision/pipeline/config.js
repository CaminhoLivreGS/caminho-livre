/* global cv */

// ---------------------------------------------------------------------------
// 1. Constantes de configuração
// ---------------------------------------------------------------------------

export const CATEGORIAS = Object.freeze({
  ACESSIBILIDADE: 'ACESSIBILIDADE',
  OBSTACULO: 'OBSTACULO',
  ALAGAMENTO: 'ALAGAMENTO',
});

// Nomes antigos continuam aceitos.
export const ALIASES = Object.freeze({
  BURACO: CATEGORIAS.ACESSIBILIDADE,
  PISO_TATIL: CATEGORIAS.ACESSIBILIDADE,
});

export const COR = Object.freeze({
  VERDE: [0, 255, 0, 255],
  VERMELHO: [255, 0, 0, 255],
  AZUL: [0, 128, 255, 255],
  LARANJA: [255, 140, 0, 255],
  MAGENTA: [255, 0, 255, 255],
  AMARELO: [255, 230, 0, 255],
});

export const CONFIG = {
  // Placas por agrupamento de caracteres (Mercosul e modelo antigo),
  // complementa o Haar de placa russa. Medidas na imagem de detecção (1280 px).
  PLACA: {
    ATIVO: true,
    BLOCO_ADAPTATIVO: 31, // vizinhança do limiar adaptativo (ímpar)
    CONTRASTE_ADAPTATIVO: 12, // caractere precisa diferir 12 níveis da média local
    ALTURA_MIN: 10, // px: caracteres menores não são legíveis (nem precisam borrar)
    ALTURA_MAX: 0.2, // fração da altura da imagem
    CARACTERE_ASPECTO_MIN: 0.15, // largura / altura de um caractere ("1" é estreito)
    CARACTERE_ASPECTO_MAX: 1.0,
    PREENCHIMENTO_MIN: 0.2,
    PREENCHIMENTO_MAX: 0.9,
    ESPACO_MAX: 0.8, // espaço entre caracteres ≤ 0,8 × altura
    VARIACAO_ALTURA_MAX: 0.2,
    ALINHAMENTO_MAX: 0.2, // centros verticais dentro de 20% da altura
    CARACTERES_MIN: 5, // placas têm 7
    CARACTERES_MAX: 10,
    ASPECTO_MIN: 2.5, // cadeia inteira: largura / altura
    ASPECTO_MAX: 8,
    EXPANSAO_X: 0.15, // linha de caracteres → placa inteira
    EXPANSAO_Y: 0.6,
  },

  // Pré-validação. Calibrada em avaliacao.html?cat=QUALIDADE (64 fotos reais
  // + variantes degradadas). Princípio: só rejeitar o que é claramente ruim.
  QUALIDADE: {
    MIN_LADO: 240, // px do menor lado da foto original
    LARGURA_ANALISE: 640,
    // Variância do Laplaciano: fotos reais ≥ 981; blur 3px ≤ 656; blur 6px ≤ 99.
    NITIDEZ_MIN: 300,
    // Brilho médio: fotos reais 53–168.
    BRILHO_MIN: 40,
    BRILHO_MAX: 200,
    PRETO: 10,
    BRANCO: 245,
    // Pixels saturados (preto/branco): fotos reais ≤ 0,21.
    SATURADOS_MAX: 0.3,
    // Bits diferentes no dHash (de 64). Reenvio reduzido+recomprimido: 64/64
    // detectados; menor distância entre fotos diferentes do dataset: 14.
    DUPLICATA_DIST_MAX: 6,
    ROSTO_DOMINANTE: 0.04, // maior rosto ≥ 4% da imagem = selfie/retrato
    ROSTO_CONSENSO_MIN: 2, // nº de cascades diferentes que precisam concordar
    ROSTO_IOU_CONSENSO: 0.3,
  },

  CENA: {
    LARGURA_ANALISE: 320,
    JANELA: 9,
    PLANO_DESVIO_MAX: 2.5, // desvio local abaixo disso = "sem textura"
    NEUTRO_S_MAX: 30,
    // Calibrado em avaliacao.html?cat=CENA: fotos de rua têm textura ≥ 33,8;
    // as com textura baixa têm plano ≤ 0,27. Produto/fundo liso: 24–32 e > 0,35.
    TEXTURA_INFERIOR_MIN: 32,
    PLANO_MAX: 0.3,
  },

  GERAL: {
    MAX_ENTRADA: 1600, // a foto é reduzida a isso antes de entrar no WASM
    MAX_DIMENSAO: 1024, // maior lado da imagem de análise
    TIMEOUT_OPENCV_MS: 30000,
    INICIO_CHAO: 0.35, // abaixo desta fração da altura consideramos "chão"
  },

  LGPD: {
    CASCADE_BASE_URL: '/cascades/',
    // Rostos distantes são pequenos: a detecção usa uma resolução maior que a
    // da análise e as regiões são reprojetadas na imagem de saída.
    MAX_DIMENSAO_DETECCAO: 1280,
    CASCADES: [
      { tipo: 'ROSTO', arquivo: 'haarcascade_frontalface_default.xml', minNeighbors: 5 },
      { tipo: 'ROSTO', arquivo: 'haarcascade_frontalface_alt2.xml', minNeighbors: 4 },
      // O cascade de perfil só detecta um lado: roda também na imagem espelhada.
      { tipo: 'ROSTO_PERFIL', arquivo: 'haarcascade_profileface.xml', minNeighbors: 5, espelhar: true },
      { tipo: 'PLACA', arquivo: 'haarcascade_russian_plate_number.xml', minNeighbors: 4 },
    ],
    SCALE_FACTOR: 1.08,
    MIN_TAMANHO: 20,
    PADDING: 0.25, // expande a ROI (cabelo, bordas da placa)
    // Kernel do GaussianBlur proporcional à ROI: k = max(BLUR_MINIMO, lado * BLUR_FRACAO)
    BLUR_FRACAO: 0.5,
    BLUR_MINIMO: 21,
    BLUR_PASSADAS: 3,
    EXIGIR_ANONIMIZACAO: true, // fail-closed
  },

  // Detector de buraco / calçada quebrada (evidência de ACESSIBILIDADE).
  PISO: {
    LARGURA_ANALISE: 512,
    MEDIAN_KERNEL: 5,
    CANNY_SIGMA: 0.33, // limiares automáticos a partir da mediana da imagem
    CANNY_MIN_BAIXO: 20,
    DILATE_ITERACOES: 1,
    JANELA_DENSIDADE: 21, // janela da densidade local de bordas
    JANELA_COERENCIA: 9, // janela do tensor de estrutura
    // Anomalia de textura: densidade local >> mediana do piso.
    RAZAO_DENSIDADE: 2.0,
    DELTA_DENSIDADE: 45,
    // Anomalia de escurecimento: fundo (blur largo) - pixel.
    FUNDO_DIVISOR: 12, // sigma = largura / 12
    ESCURO_DELTA: 28,
    VERDE_BAIXO: [30, 50, 30, 0], // vegetação não é falha do piso
    VERDE_ALTO: [90, 255, 255, 0],
    OPEN_KERNEL: 5,
    CLOSE_KERNEL: 9,
    TATIL_BAIXO: [18, 100, 100, 0], // piso tátil é textura projetada, não defeito
    TATIL_ALTO: [34, 255, 255, 0],
    EXCLUSAO_DILATACAO: 1, // 7 e 15 testados: perdem buracos com musgo ao redor
    AREA_MIN_RATIO: 0.01, // em relação à área do chão
    AREA_MAX_RATIO: 0.6,
    ASPECTO_MIN: 0.2, // descarta faixas finas (meio-fio, juntas)
    SOLIDEZ_MIN: 0.45,
    // Piso com padrão (pedra portuguesa, ladrilho): mediana de densidade alta.
    MEDIANA_PADRAO: 30,
    // Evidência A — textura quebrada (cascalho, asfalto esfarelado, quebra):
    TEXTURA_COERENCIA_MAX: 0.6, // orientação de bordas aleatória
    TEXTURA_DENSIDADE_MIN: 60, // densidade absoluta mínima de bordas (0-255)
    TEXTURA_RAZAO_MIN: 1.8, // densidade / mediana do piso liso
    TEXTURA_RAZAO_MIN_PADRAO: 3.5, // ... em piso com padrão
    // Evidência B — cavidade escura pequena e compacta:
    CAVIDADE_ESCURIDAO_MIN: 40,
    CAVIDADE_SOLIDEZ_MIN: 0.85,
    CAVIDADE_ASPECTO_MIN: 0.5,
    // Evidência C — cavidade escura grande:
    CRATERA_ESCURIDAO_MIN: 25,
    CRATERA_SOLIDEZ_MIN: 0.75,
    CRATERA_AREA_MIN: 0.1,
  },

  // Rachaduras finas (evidência de ACESSIBILIDADE), por morfologia black-hat.
  RACHADURA: {
    // Calibrado com 5 fotos de rachadura e 18 negativos (avaliacao.html):
    // +3 rachaduras confirmadas, +1 falso positivo (meio-fio em degrau_pos_1).
    // Poucos exemplos: revisar com o dataset brasileiro.
    ATIVO: true, // false = só mede (detalhes), não altera a decisão
    LARGURA_ANALISE: 640,
    KERNEL_BLACKHAT: 15, // realça traços escuros mais finos que ~15 px
    LIMIAR_BLACKHAT: 40, // contraste mínimo do traço (25 marcava quase todo piso como padrão)
    COBERTURA_MAX: 0.08, // acima disso é padrão do piso (pedra portuguesa, ladrilho)
    COMPRIMENTO_MIN: 0.08, // diagonal mínima de um traço (fração da largura)
    ESPESSURA_MAX: 6, // área / diagonal (px): acima disso é mancha, não traço
    RETILINEIDADE_MAX: 0.95, // acima disso é junta reta
    SERRILHADO_MIN: 0.9, // vértices / 20 px de contorno: rachaduras são irregulares
    COMPRIMENTO_TOTAL_MIN: 0.5, // soma das diagonais dos traços válidos (fração da largura)
  },

  SUPERFICIE: {
    LARGURA_ANALISE: 320,
    INICIO: 0.4,
    SEMENTE_Y: 0.9,
    SEMENTES_X: [0.5, 0.3, 0.7],
    RAIO_SEMENTE: 6,
    // Tolerância em Lab: L frouxo (sombras), a/b rígidos (cor do material).
    TOL_L: 55,
    TOL_AB: 9,
    FECHAMENTO_BURACOS: 7,
    FECHAMENTO_INTRUSAO: 0.15, // kernel = 15% da largura
    ABERTURA_INTRUSAO: 5,
    MIN_SUPERFICIE: 0.12, // superfície mínima para a análise ser confiável
    INTRUSAO_MIN_RATIO: 0.04, // área mínima de uma intrusão / área da superfície
  },

  OBSTACULO: {
    LARANJA_BAIXO: [0, 130, 110, 0],
    LARANJA_ALTO: [14, 255, 255, 0],
    VERMELHO_BAIXO: [165, 130, 110, 0],
    VERMELHO_ALTO: [180, 255, 255, 0],
    AMARELO_BAIXO: [18, 150, 140, 0],
    AMARELO_ALTO: [34, 255, 255, 0],
    AREA_MIN_RATIO: 0.0008,
    UNIR_VERTICAL: 25, // une as partes de um cone separadas pelas listras
    LISTRA_MAX_COR: 0.25, // linha com menos cor que isso é candidata a listra
    LISTRA_MIN_COR: 0.45, // ... se houver linhas com mais cor acima e abaixo
    LISTRA_S_MAX: 80, // listra branca/prata: baixa saturação
    LISTRA_V_MIN: 110,
    LISTRA_PRETA_V_MAX: 70, // listra preta (sinalização amarela/preta)
    TEMPLATE_LARGURA: 40,
    TEMPLATE_ALTURA: 60,
    SILHUETA_MIN: 0.55, // matchTemplate TM_CCOEFF_NORMED da silhueta
    AFUNILAMENTO_MAX: 0.75, // largura no topo / largura na base
    ASPECTO_CONE_MIN: 0.9, // altura / largura
    ASPECTO_LISTRA_MIN: 0.3,
    ASPECTO_MAX: 4, // mais alto que isso é poste/perna, não cone
    PAR_GAP_MAX: 1.2, // faixa entre blobs: até 1,2x a altura do menor blob
    PAR_SOBREPOSICAO_MIN: 0.5,
    PAR_S_MAX: 45, // listra refletiva real é quase sem saturação
    AREA_PAR_MIN_RATIO: 0.0002,
    // Intrusão na superfície só é obstáculo se tiver textura de objeto
    // (marcações planas — faixa pintada, sombra, piso tátil — são lisas).
    INTRUSAO_DENSIDADE_MIN: 0.2,
  },

  ALAGAMENTO: {
    LARGURA_ANALISE: 512,
    INICIO: 0.4,
    JANELA_RUGOSIDADE: 9,
    // Cada faixa tem sua rugosidade máxima (|Laplaciano| médio): cores típicas
    // de água toleram ondulação/reflexos; "escuro" se confunde com asfalto e
    // exige superfície bem lisa.
    FAIXAS_HSV: [
      { nome: 'BARRO', baixo: [5, 50, 40, 0], alto: [30, 255, 220, 0], lisoMax: 28 },
      { nome: 'REFLEXO_CEU', baixo: [85, 15, 80, 0], alto: [130, 255, 255, 0], lisoMax: 28 },
      // Sem faixa "cinza claro": é indistinguível de concreto seco.
      { nome: 'ESCURO', baixo: [0, 0, 25, 0], alto: [180, 80, 120, 0], lisoMax: 16 },
    ],
    OPEN_KERNEL: 5,
    CLOSE_KERNEL: 15,
    AREA_MINIMA_RATIO: 0.12,
    LARGURA_MINIMA_RATIO: 0.35,
  },

  ACESSIBILIDADE: {
    // Interrupção da superfície caminhável (degrau, desnível, objeto bloqueando)
    // também conta como barreira de acessibilidade. Medido no dataset:
    // true = 70,6% de acerto; false = 64,7% (as escadas deixam de ser vistas).
    INCLUIR_OBSTRUCAO: true,
    LARGURA_ANALISE: 640,
    // Parâmetros rígidos de propósito: em fotos de rua, meio-fio, juntas e
    // faixas da via também geram linhas paralelas. Valores mais frouxos
    // (40 / 0,12 / 12 / 20°) dispararam em 9 de 11 calçadas sem problema.
    HOUGH_LIMIAR: 60,
    HOUGH_COMPRIMENTO_MIN: 0.25, // fração da largura
    HOUGH_GAP: 8,
    ANGULO_MAX: 18, // graus em relação à horizontal
    SEGMENTOS_BANDA: 8,
    VARIACAO_HORIZONTAL_MAX: 30,
    AGRUPAR_Y: 0.015, // linhas a menos de 1,5% da altura viram uma só
    ESPACAMENTO_MIN: 0.02,
    ESPACAMENTO_MAX: 0.15,
    MIN_DEGRAUS: 5,
    PINTURA_DELTA: 70, // faixas alternando claro/escuro forte = faixa de pedestre
    // Piso tátil
    TATIL_BAIXO: [18, 100, 100, 0],
    TATIL_ALTO: [34, 255, 255, 0],
    TATIL_PRESENCA_MIN: 0.005,
    TATIL_CLOSE_LARGURA: 15,
    TATIL_CLOSE_ALTURA: 3,
    TATIL_AREA_GRANDE: 0.02,
    TATIL_RUIDO_MIN: 50,
    TATIL_TRECHO_MIN: 0.004, // área mínima de cada trecho da faixa
    TATIL_ALONGAMENTO_MIN: 2.5,
    TATIL_LACUNA_MIN: 0.03, // lacuna entre trechos (fração da largura/altura)
    TATIL_LACUNA_MAX: 0.5,
  },
};

export const CC_STAT = Object.freeze({ LEFT: 0, TOP: 1, WIDTH: 2, HEIGHT: 3, AREA: 4 });
