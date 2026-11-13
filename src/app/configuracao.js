/** Configuração da interface. */

// Endpoint do backend. null = modo demonstração (nada sai do aparelho).
export const ENDPOINT_DENUNCIAS = null;

// Sobrescritas do CONFIG do pipeline (arquivos em public/ ficam na raiz do site).
export const CONFIG_VISAO = { LGPD: { CASCADE_BASE_URL: '/cascades/' } };

// Lista de fotos já enviadas nesta aba (recusa reenvios). ?limpar apaga.
export const CHAVE_HASHES = 'hashesEnviados';

export const STATUS_UI = {
  CONFIRMADO: { icone: 'ok', titulo: 'Problema identificado' },
  INCONCLUSIVO: { icone: 'revisao', titulo: 'Vamos revisar' },
  REJEITADO: { icone: 'erro', titulo: 'Tire outra foto' },
};

// Nomes curtos das evidências, para dizer ao usuário o que foi encontrado.
export const NOMES_EVIDENCIA = {
  BURACO_OU_QUEBRA: 'buraco ou calçada quebrada',
  RACHADURA: 'rachaduras',
  TATIL_INTERROMPIDO: 'piso tátil interrompido',
  DEGRAUS: 'degraus',
  PASSAGEM_INTERROMPIDA: 'passagem bloqueada',
  SINALIZACAO: 'sinalização de obra',
  OBSTRUCAO: 'objeto no caminho',
  AGUA: 'água acumulada',
};

export const TIPOS = [
  { categoria: 'ACESSIBILIDADE', icone: 'acessibilidade', titulo: 'Calçada', exemplo: 'buraco, degrau, piso tátil' },
  { categoria: 'OBSTACULO', icone: 'obstaculo', titulo: 'Obstáculo', exemplo: 'obra, entulho, árvore' },
  { categoria: 'ALAGAMENTO', icone: 'alagamento', titulo: 'Alagamento', exemplo: 'água parada' },
];

export const lerHashes = () => JSON.parse(sessionStorage.getItem(CHAVE_HASHES) ?? '[]');
export const salvarHash = (hash) => sessionStorage.setItem(CHAVE_HASHES, JSON.stringify([...lerHashes(), hash].slice(-50)));
