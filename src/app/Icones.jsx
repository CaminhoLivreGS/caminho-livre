/**
 * Ícones em SVG sprite. São sempre decorativos (aria-hidden): o nome
 * acessível vem do texto do botão ou de aria-label.
 */
const SIMBOLOS = {
  camera: <><path d="M3 8h4l2-3h6l2 3h4v11H3z" /><circle cx="12" cy="13" r="3.5" /></>,
  galeria: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" /><path d="M21 16l-5-5-9 9" /></>,
  acessibilidade: <><circle cx="11" cy="4" r="1.8" /><path d="M11 7v6h5l2.5 5.5" /><path d="M11 10h5" /><path d="M8 10.5a5.5 5.5 0 1 0 7.5 7" /></>,
  obstaculo: <><path d="M10 3h4l4.5 16h-13z" /><path d="M8.3 9h7.4M7 14h10" /><path d="M3 21h18" /></>,
  alagamento: <><path d="M12 2.5s-4.5 5.2-4.5 8.3a4.5 4.5 0 0 0 9 0C16.5 7.7 12 2.5 12 2.5z" /><path d="M2.5 19c2 0 2.3-1.5 4.7-1.5S9.6 19 12 19s2.4-1.5 4.8-1.5S19.5 19 21.5 19" /></>,
  voltar: <path d="M15 18l-6-6 6-6" />,
  borrar: <><circle cx="12" cy="12" r="8.5" strokeDasharray="2.5 2.5" /><path d="M8 9.5h8M7 12.5h10M8.5 15.5h7" /></>,
  desfazer: <><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>,
  enviar: <><path d="M21.5 2.5L10.5 13.5" /><path d="M21.5 2.5l-7 19-4-8-8-4z" /></>,
  ok: <><circle cx="12" cy="12" r="9.5" /><path d="M7.5 12.5l3 3 6-6.5" /></>,
  revisao: <><circle cx="12" cy="12" r="9.5" /><path d="M12 6.5V12l3.5 3" /></>,
  erro: <><circle cx="12" cy="12" r="9.5" /><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" /></>,
  mais: <path d="M12 5v14M5 12h14" />,
  menos: <path d="M5 12h14" />,
  cima: <path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" />,
  baixo: <path d="M12 5v14M5.5 12.5L12 19l6.5-6.5" />,
  esquerda: <path d="M19 12H5M11.5 5.5L5 12l6.5 6.5" />,
  direita: <path d="M5 12h14M12.5 5.5L19 12l-6.5 6.5" />,
  concluir: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  trocar: <><path d="M4 12a8 8 0 0 1 13.7-5.6L20 9" /><path d="M20 4v5h-5" /><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15" /><path d="M4 20v-5h5" /></>,
  fechar: <path d="M6 6l12 12M18 6L6 18" />,
};

/** Definições do sprite; renderizar uma vez no topo do app. */
export function SpriteIcones() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" hidden>
      {Object.entries(SIMBOLOS).map(([nome, conteudo]) => (
        <symbol key={nome} id={`i-${nome}`} viewBox="0 0 24 24">
          {conteudo}
        </symbol>
      ))}
    </svg>
  );
}

export function Icone({ nome, className = '' }) {
  return (
    <svg className={`icone ${className}`.trim()} aria-hidden="true" focusable="false">
      <use href={`#i-${nome}`} />
    </svg>
  );
}
