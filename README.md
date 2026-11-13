# Caminho Livre

Aplicação CitizenTech de acessibilidade urbana: o cidadão fotografa um problema na calçada, informa o tipo, e um módulo de **visão computacional clássica (OpenCV.js)** confirma a evidência e **anonimiza rostos e placas (LGPD)** antes de qualquer envio. Tudo roda no navegador; nenhuma foto sai do aparelho sem anonimização.

## Como rodar

Requisitos: Node 18+, Python 3 e Google Chrome (só para o teste de precisão).

```sh
npm install        # dependência de desenvolvimento (OpenCV.js para os testes)
npm run deps       # baixa opencv.js e os Haar Cascades, conferindo SHA-256
npm start          # servidor local em http://127.0.0.1:8000
```

Abra http://127.0.0.1:8000/. A câmera ao vivo exige contexto seguro (HTTPS ou `localhost`/`127.0.0.1`). Para testar num Android via USB: `adb reverse tcp:8000 tcp:8000` e abra `http://localhost:8000` no celular.

## Estrutura

```
index.html, app/          interface acessível (Foto → Tipo → Resultado → Enviado)
src/vision/
  VisionPipeline.js       ponto de entrada: reexporta a API pública
  pipeline/
    config.js             CATEGORIAS e CONFIG (todos os limiares)
    memoria.js            Rastreador (libera toda cv.Mat em finally)
    opencv.js, cascades.js  inicialização do OpenCV e dos Haar Cascades
    util.js               utilitários de imagem e desenho
    lgpd.js               rostos (Haar), placas (Haar + agrupamento de caracteres) e borrão
    prevalidacao.js       nitidez, exposição, cena, dHash
    superficie.js         estimativa do piso (usada por obstáculo e acessibilidade)
    piso.js               buraco / calçada quebrada
    rachaduras.js         rachaduras finas (black-hat + forma do traço)
    acessibilidade.js, obstaculo.js, alagamento.js   pipelines por categoria
    analise.js            orquestração e decisão em 3 níveis (sem DOM)
    navegador.js          camada com DOM (<img>, <canvas>)
  AnalisadorVisao.js      API da interface; delega o OpenCV a um Web Worker
  vision.worker.js        worker que carrega opencv.js e roda o núcleo
  useVisionPipeline.js    hook React (para a futura versão em React)
avaliacao.html            avaliação de precisão contra o dataset rotulado
dataset/                  fotos de teste (Commons), gabarito e créditos
scripts/                  download de dependências e teste de precisão
test/                     testes unitários e limites de regressão
```

## Como a validação funciona

O usuário escolhe uma de **3 categorias**: Acessibilidade (buraco, calçada quebrada, degrau, piso tátil interrompido, passagem bloqueada), Obstáculo (obra, entulho, lixo, árvore caída) e Alagamento.

1. **Pré-validação:** nitidez (variância do Laplaciano), exposição, resolução, foto fora de contexto (textura e áreas lisas), selfie (rosto dominante confirmado por 2 cascades) e reenvio (hash perceptual dHash).
2. **Pipeline da categoria:** filtros espaciais, Canny, morfologia, limiarização HSV, componentes conexos, Hough e casamento de silhueta. Nenhuma rede neural; a única IA treinada é o Haar Cascade, usado só na LGPD.
3. **Decisão em 3 níveis:** `CONFIRMADO` (evidência encontrada), `INCONCLUSIVO` (foto boa sem evidência automática → moderação humana) ou `REJEITADO` (problema claro com a foto, com orientação para tirar outra).
4. **LGPD:** rostos e placas são borrados por último, com blur proporcional ao tamanho; o usuário pode borrar áreas extras (toque, botões ou teclado). O envio usa o canvas anonimizado, sem metadados EXIF. Placas brasileiras são encontradas por agrupamento de caracteres (limiar adaptativo + cadeia de 5 ou mais componentes alinhados), porque o Haar disponível é de placa russa.

Todo `cv.Mat` é liberado em `try/finally` (classe `Rastreador`), porque o WebAssembly não tem coleta de lixo para matrizes.

## Precisão medida

Em 63 fotos distintas do Wikimedia Commons, rotuladas por categoria em `dataset/manifest.json` (35 em Acessibilidade, 29 em Obstáculo, 23 em Alagamento; uma mesma foto pode ser negativa em várias):

| Categoria | Acurácia | Falsos positivos | Fotos reais rejeitadas |
|---|---|---|---|
| Acessibilidade | 65,7% | 5 de 15 | 0 |
| Obstáculo | 89,7% | 1 de 14 | 0 |
| Alagamento | 87,0% | 0 de 14 | 0 |

O detector de rachaduras foi calibrado com poucos exemplos (4 fotos de rachadura no gabarito atual).

**Placas (LGPD):** em 21 composições (7 placas brasileiras reais coladas em fotos de rua, 3 tamanhos e ângulos), o borrão cobre 17 placas (só com o Haar russo: 7). Em compensação, nas 63 fotos de rua, a área borrada sem necessidade é em média 0,47% da imagem, em geral texto de letreiros. Placas vermelhas antigas, de letras grossas, ainda falham.

**Dataset público sem pessoas (LGPD):** o repositório é público, então fotos com pessoas (rostos, retratos, selfies e pedestres, mesmo distantes) foram retiradas do dataset versionado, embora tenham licença livre no Commons. Por isso as avaliações `LGPD` (borrão de rostos em fotos reais) e `RETRATOS` não têm mais fotos aqui, e o filtro de foto fora de contexto é medido em só 6 fotos. A função de borrão (`anonimizar`) continua coberta pelos testes unitários com imagens sintéticas; já a detecção de rostos em fotos reais só pode ser calibrada com um conjunto local, fora do git.

**Limitação importante:** os parâmetros foram calibrados e medidos no mesmo conjunto, com fotos majoritariamente estrangeiras. Os números são otimistas até existir um conjunto de teste separado com fotos de calçadas brasileiras.

### Dataset brasileiro (treino/teste)

1. Coloque as fotos em `dataset/brasil/<categoria>/positivo/` (com o problema) ou `.../negativo/` (sem o problema, por exemplo uma calçada em bom estado). Categorias: `acessibilidade`, `obstaculo`, `alagamento`. Recomendado: 40 ou mais fotos por categoria, metade de cada tipo.
2. Rode `npm run dataset:brasil`. Cerca de 30% das fotos vão para **teste**, sorteadas pelo hash do conteúdo (renomear não muda o sorteio).
3. Calibre olhando só o **treino**: `http://127.0.0.1:8000/avaliacao.html?dataset=brasil&conjunto=treino&cat=ACESSIBILIDADE&mostrar=1`.
4. No fim, meça a precisão real no **teste**: `npm run test:precisao -- --dataset=brasil --conjunto=teste`. Se ajustar os limiares olhando os erros do teste, ele deixa de medir a precisão real.

Não adicione fotos com pessoas: o repositório é público e as fotos ficam salvas no histórico do git.

## Testes

```sh
npm test                                  # unitários do núcleo, ~30 s (Node, sem navegador)
npm run test:precisao                     # regressão de precisão no Chrome headless, ~8 min
npm run test:precisao -- --so=ALAGAMENTO  # só uma avaliação
npm run test:precisao -- --completo       # inclui os filtros de qualidade, ~20 min
```

O teste de precisão falha se algum número ficar abaixo de `test/limites-precisao.json`. Ao melhorar um pipeline, atualize esses limites. Para inspecionar visualmente: `http://127.0.0.1:8000/avaliacao.html?cat=ACESSIBILIDADE&mostrar=1`. Parâmetros podem ser sobrescritos pela URL, por exemplo `&cfg={"ALAGAMENTO":{"AREA_MINIMA_RATIO":0.1}}`.

## Segurança

A validação no navegador orienta o usuário e evita envios por engano, mas **não protege o backend**: qualquer pessoa pode chamar a API diretamente. O backend (ainda não implementado; `ENDPOINT_DENUNCIAS` em `app/app.js`) precisa de autenticação, limite de envios por usuário, deduplicação pelo `hash` enviado e fila de moderação para os casos `INCONCLUSIVO`.

O servidor de desenvolvimento escuta só em `127.0.0.1`.

## Créditos

As fotos do dataset são do Wikimedia Commons, cada uma com sua licença original; autores e links em [`dataset/CREDITOS.md`](dataset/CREDITOS.md). O OpenCV é distribuído sob a licença Apache 2.0. Os Haar Cascades de rosto trazem a Intel License Agreement no cabeçalho de cada XML (licença permissiva, exige manter o aviso); eles são baixados sem alteração por `npm run deps`.
