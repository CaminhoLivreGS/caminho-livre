import { Icone } from './Icones.jsx';

const PASSOS = [
  { id: 'foto', nome: 'Foto' },
  { id: 'tipo', nome: 'Tipo' },
  { id: 'resultado', nome: 'Enviar' },
];

/** Marca e progresso (aria-current marca o passo atual). */
export function Topo({ passo }) {
  const atual = passo === 'enviado' ? 3 : PASSOS.findIndex((p) => p.id === passo);
  return (
    <header className="topo">
      <p className="marca">
        <Icone nome="acessibilidade" />
        Caminho Livre
      </p>
      <nav aria-label="Progresso">
        <ol className="passos">
          {PASSOS.map((p, i) => (
            <li key={p.id} aria-current={i === atual ? 'step' : undefined} className={i < atual ? 'feito' : undefined}>
              <span className="rotulo-passo">{p.nome}</span>
            </li>
          ))}
        </ol>
      </nav>
    </header>
  );
}
