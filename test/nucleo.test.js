/**
 * Testes unitários do núcleo de visão (sem navegador).
 * Rodar: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { P, imagemSintetica, paraMat, heapBytes } from './ambiente.js';

const { STATUS, MENSAGENS } = P;

describe('distanciaHamming', () => {
  test('hashes iguais têm distância 0', () => {
    assert.equal(P.distanciaHamming('0bd4e1c5cd4f8f07', '0bd4e1c5cd4f8f07'), 0);
  });
  test('hashes opostos têm distância 64', () => {
    assert.equal(P.distanciaHamming('0000000000000000', 'ffffffffffffffff'), 64);
  });
  test('um bit diferente = 1', () => {
    assert.equal(P.distanciaHamming('0000000000000000', '0000000000000001'), 1);
  });
  test('entrada inválida conta como totalmente diferente', () => {
    assert.equal(P.distanciaHamming('abc', '0000000000000000'), 64);
    assert.equal(P.distanciaHamming(null, '0000000000000000'), 64);
  });
});

describe('calcularDHash', () => {
  // Gradiente com formas: tem estrutura suficiente para o hash ser estável.
  const comFormas = (semente) =>
    imagemSintetica({
      semente,
      ruido: 10,
      desenhar: (x, y, rgb) => {
        if ((x - 200) ** 2 + (y - 240) ** 2 < 80 ** 2) return [30, 30, 30];
        if (x > 420 && y < 200) return [220, 220, 220];
        return [rgb[0] + x / 8, rgb[1] + x / 8, rgb[2] + x / 8];
      },
    });

  test('retorna 16 dígitos hexadecimais (64 bits)', () => {
    const m = paraMat(comFormas(1));
    try {
      assert.match(P.calcularDHash(m), /^[0-9a-f]{16}$/);
    } finally {
      m.delete();
    }
  });

  test('a mesma cena com outro ruído e reduzida tem hash quase igual', () => {
    const a = paraMat(comFormas(1));
    const b = paraMat(comFormas(2));
    const bPequena = new cv.Mat();
    try {
      cv.resize(b, bPequena, new cv.Size(320, 240), 0, 0, cv.INTER_AREA);
      const d = P.distanciaHamming(P.calcularDHash(a), P.calcularDHash(bPequena));
      assert.ok(d <= P.CONFIG.QUALIDADE.DUPLICATA_DIST_MAX, `distância ${d}`);
    } finally {
      a.delete();
      b.delete();
      bPequena.delete();
    }
  });

  test('cenas diferentes têm hash distante', () => {
    const a = paraMat(comFormas(1));
    const espelhada = new cv.Mat();
    try {
      cv.flip(a, espelhada, 1);
      const d = P.distanciaHamming(P.calcularDHash(a), P.calcularDHash(espelhada));
      assert.ok(d > P.CONFIG.QUALIDADE.DUPLICATA_DIST_MAX, `distância ${d}`);
    } finally {
      a.delete();
      espelhada.delete();
    }
  });
});

describe('avaliarQualidade', () => {
  const avaliar = (img, dim = { largura: img.width, altura: img.height }) => {
    const m = paraMat(img);
    try {
      return P.avaliarQualidade(dim, m);
    } finally {
      m.delete();
    }
  };

  test('foto texturizada e bem exposta passa', () => {
    const r = avaliar(imagemSintetica());
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  test('foto borrada é rejeitada por NITIDEZ', () => {
    const img = imagemSintetica();
    const m = paraMat(img);
    try {
      cv.GaussianBlur(m, m, new cv.Size(0, 0), 6, 6, cv.BORDER_DEFAULT);
      const r = P.avaliarQualidade({ largura: 640, altura: 480 }, m);
      assert.deepEqual(r.motivos, ['NITIDEZ']);
    } finally {
      m.delete();
    }
  });

  test('foto escura é rejeitada por ESCURA', () => {
    assert.ok(avaliar(imagemSintetica({ cor: [15, 15, 15], ruido: 20 })).motivos.includes('ESCURA'));
  });

  test('foto estourada é rejeitada por CLARA', () => {
    assert.ok(avaliar(imagemSintetica({ cor: [235, 235, 235], ruido: 20 })).motivos.includes('CLARA'));
  });

  test('resolução original pequena é rejeitada por RESOLUCAO', () => {
    const r = avaliar(imagemSintetica(), { largura: 200, altura: 150 });
    assert.ok(r.motivos.includes('RESOLUCAO'));
  });
});

describe('anonimizar / borrarImageData', () => {
  test('borra só dentro da região informada', async () => {
    const img = imagemSintetica({ ruido: 80 });
    const antes = img.data.slice();
    const r = await P.borrarImageData(img, [{ x: 100, y: 100, width: 120, height: 80 }]);
    let dentro = 0;
    let fora = 0;
    for (let i = 0; i < antes.length; i += 4) {
      const p = i / 4;
      const x = p % 640;
      const y = Math.floor(p / 640);
      const mudou = antes[i] !== r.data[i];
      if (x >= 100 && x < 220 && y >= 100 && y < 180) dentro += mudou;
      else fora += mudou;
    }
    assert.ok(dentro > 0.9 * 120 * 80, `pixels alterados dentro: ${dentro}`);
    assert.equal(fora, 0);
  });

  test('regiões fora da imagem são recortadas sem erro', async () => {
    const img = imagemSintetica();
    const r = await P.borrarImageData(img, [{ x: 600, y: 440, width: 500, height: 500 }, { x: -50, y: -50, width: 10, height: 10 }]);
    assert.equal(r.width, 640);
    assert.equal(r.height, 480);
  });
});

describe('analisarImageData', () => {
  test('categoria inválida lança erro', async () => {
    await assert.rejects(() => P.analisarImageData(imagemSintetica(), 'NAO_EXISTE'), /Categoria inválida/);
  });

  test('aliases antigos BURACO e PISO_TATIL viram ACESSIBILIDADE', async () => {
    for (const antigo of ['BURACO', 'PISO_TATIL']) {
      const r = await P.analisarImageData(imagemSintetica(), antigo);
      assert.equal(r.detalhes.categoria, 'ACESSIBILIDADE');
    }
  });

  test('contrato do retorno', async () => {
    const r = await P.analisarImageData(imagemSintetica(), 'OBSTACULO');
    assert.ok(Object.values(STATUS).includes(r.status));
    assert.equal(r.aceitar, r.status !== STATUS.REJEITADO);
    assert.equal(r.isValid, r.status === STATUS.CONFIRMADO);
    assert.equal(typeof r.mensagem, 'string');
    assert.ok(r.mensagem.length > 0);
    assert.match(r.hash, /^[0-9a-f]{16}$/);
    assert.ok(r.imagemProcessada instanceof ImageData);
    assert.equal(r.imagemProcessada.width, 640);
  });

  test('foto borrada é REJEITADA com mensagem de nitidez', async () => {
    const img = imagemSintetica();
    const m = paraMat(img);
    try {
      cv.GaussianBlur(m, m, new cv.Size(0, 0), 6, 6, cv.BORDER_DEFAULT);
      const borrada = new ImageData(new Uint8ClampedArray(m.data), m.cols, m.rows);
      const r = await P.analisarImageData(borrada, 'ACESSIBILIDADE');
      assert.equal(r.status, STATUS.REJEITADO);
      assert.ok(r.motivos.includes('NITIDEZ'));
      assert.equal(r.mensagem, MENSAGENS.NITIDEZ);
    } finally {
      m.delete();
    }
  });

  test('reenvio da mesma foto é REJEITADO por DUPLICATA', async () => {
    const img = imagemSintetica();
    const primeira = await P.analisarImageData(img, 'ALAGAMENTO');
    const segunda = await P.analisarImageData(imagemSintetica(), 'ALAGAMENTO', { hashesAnteriores: [primeira.hash] });
    assert.equal(segunda.status, STATUS.REJEITADO);
    assert.ok(segunda.motivos.includes('DUPLICATA'));
  });

  test('buraco escuro em asfalto é CONFIRMADO em ACESSIBILIDADE', async () => {
    const img = imagemSintetica({
      desenhar: (x, y, rgb) => (((x - 320) / 110) ** 2 + ((y - 330) / 60) ** 2 < 1 ? [25, 25, 25] : rgb),
    });
    const r = await P.analisarImageData(img, 'ACESSIBILIDADE');
    assert.equal(r.status, STATUS.CONFIRMADO, JSON.stringify({ motivos: r.motivos, problemas: r.detalhes.problemas }));
    assert.ok(r.detalhes.problemas.includes('BURACO_OU_QUEBRA'));
  });

  /*
   * Detecção de vazamento (heurística, em duas camadas):
   *  1. heap do WASM não pode crescer — pega sempre vazamentos do tamanho de
   *     uma imagem (~1 MB/análise), os que travam o navegador;
   *  2. sonda do alocador: aloca/libera 64 bytes após cada análise; sem
   *     vazamento o endereço se repete. Pega boa parte dos vazamentos
   *     pequenos, mas NÃO todos: ao remover k.delete() de morfologia(), a
   *     sonda acusou em ACESSIBILIDADE e não nas outras categorias.
   * A regra que garante memória é o código: toda Mat registrada no
   * Rastreador ou liberada em finally.
   */
  for (const cat of ['ACESSIBILIDADE', 'OBSTACULO', 'ALAGAMENTO']) {
    test(`não vaza memória do WASM (${cat})`, async () => {
      const img = imagemSintetica({ largura: 480, altura: 360 });
      const sonda = () => {
        const p = cv._malloc(64);
        cv._free(p);
        return p;
      };
      for (let i = 0; i < 2; i++) await P.analisarImageData(img, cat); // aquece
      const heapInicial = heapBytes();
      const enderecos = [];
      for (let i = 0; i < 3; i++) {
        await P.analisarImageData(img, cat);
        enderecos.push(sonda());
      }
      assert.ok(
        enderecos.every((e) => e === enderecos[0]),
        `estado do alocador mudou entre análises (${enderecos}): alguma Mat não foi liberada`,
      );
      assert.equal(heapBytes(), heapInicial, 'o heap do WASM cresceu');
    });
  }
});
