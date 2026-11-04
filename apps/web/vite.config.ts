import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwind from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// Build notes for this project: the toolchain deliberately avoids esbuild.
// SWC transforms JSX/TS in-process (a native addon inside node.exe), terser
// minifies (pure JS), and target esnext skips esbuild-based transpilation.
// This makes `vite build` work on machines where the esbuild binary is
// blocked from file operations.

const webPort = Number(process.env.LUMEN_WEB_PORT ?? 5173);

const apiProxy = (): Record<string, ProxyOptions> =>
  process.env.LUMEN_API_URL
    ? {
        '/api': {
          target: process.env.LUMEN_API_URL,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (request) => {
              request.removeHeader('origin');
            });
          },
        },
      }
    : {};

export default defineConfig({
  // Use a cache directory outside node_modules to avoid permission issues on Windows
  cacheDir: '../../.vite',
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/',
  plugins: [react(), tailwind()],
  resolve: {
    alias: {
      '@lumen/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: { host: '127.0.0.1', port: webPort, strictPort: true, proxy: apiProxy() },
  preview: { host: '127.0.0.1', port: webPort, strictPort: true, proxy: apiProxy() },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    minify: 'terser',
    terserOptions: { compress: { passes: 1 }, mangle: true },
    chunkSizeWarningLimit: 1600,
  },
});
