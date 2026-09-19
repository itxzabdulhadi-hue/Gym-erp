import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * The dev server proxies /api and /storage to the Express backend, so browser
 * code only ever uses relative URLs. That keeps the same code working in dev,
 * in Docker behind one origin, and on Vercel where vercel.json does the
 * equivalent rewrite - and it means no API origin is baked into the bundle.
 */
const API_TARGET = process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:4000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // The sandbox preview is served from a generated host; anything else is
    // still rejected rather than opening the dev server to any origin.
    allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'],
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/storage': { target: API_TARGET, changeOrigin: true },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'],
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/storage': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Route level code splitting keeps the initial bundle small; the ERP has
    // far too many screens to ship in one file.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
          charts: ['recharts'],
        },
      },
    },
  },
});
