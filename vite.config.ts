import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { target: 'es2022' },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (outgoing, incoming) => {
            // Preserve the same-origin boundary through the local development proxy.
            if (incoming.headers.origin === `http://${incoming.headers.host}`)
              outgoing.setHeader('Origin', 'http://127.0.0.1:8787');
          });
        },
      },
    },
  },
});
