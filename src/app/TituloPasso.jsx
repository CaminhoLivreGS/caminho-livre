import { useEffect, useRef } from 'react';

/**
 * Título de passo: recebe o foco ao aparecer, para o leitor de tela começar
 * a leitura pelo novo passo (o contorno é escondido via CSS: não é interativo).
 */
export function TituloPasso({ children, id, className }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, []);
  return (
    <h1 ref={ref} id={id} tabIndex={-1} className={className}>
      {children}
    </h1>
  );
}
