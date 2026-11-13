import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Servidor só no loopback: a câmera ao vivo exige contexto seguro, e
// 127.0.0.1 já é considerado seguro pelo navegador. Para testar no celular,
// use túnel (ex.: `adb reverse tcp:8000 tcp:8000`), não exponha na rede.
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 8000, strictPort: true },
  preview: { host: '127.0.0.1', port: 8001, strictPort: true },
  worker: { format: 'es' }, // worker em módulo: o OpenCV entra pelo bundle
  build: {
    chunkSizeWarningLimit: 12000, // o OpenCV (WASM embutido) tem ~10 MB, carregado sob demanda
  },
});
