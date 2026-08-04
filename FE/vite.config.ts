import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

// The BE (NestJS) mounts its controllers at the root -- `/story/create`,
// `/tenant/init`, ... -- while the SPA always calls them under `/api`. Every
// hop that carries the SPA's request therefore has to strip that prefix: this
// proxy in dev/preview, and `location /api/` in nginx.conf in production.
const BE_TARGET = process.env.BE_PROXY_TARGET || 'http://localhost:3001';

const apiProxy = {
  '/api': {
    target: BE_TARGET,
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/api/, ''),
    // Story generation runs Engine -> LLM and can legitimately take a minute;
    // the default proxy timeout would cut it off before BE's own deadline.
    timeout: 180_000,
    proxyTimeout: 180_000,
  },
};

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 3000,
      proxy: apiProxy,
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    preview: {
      port: 3000,
      proxy: apiProxy,
    },
  };
});
