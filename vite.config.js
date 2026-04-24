import { defineConfig } from 'vite';

// In dev, Vite serves the client on :5173 and proxies /api and /ws to the
// Node game server on :3000. In production a single Node process serves both
// the built client (dist/) and the WebSocket endpoint on one port.
export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
