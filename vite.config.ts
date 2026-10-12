import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createDevApiProxy } from './src/aiArchitect/devProxy';

export default defineConfig({
  plugins: [react()],
  // LAN devices reach the planning API through the same-origin /api proxy (dev server only).
  // TINY_CITY_API_PORT matches `npm run dev:api`; an explicit proxy target wins.
  server: { host: '0.0.0.0', proxy: createDevApiProxy(process.env.TINY_CITY_API_PROXY_TARGET ??
    (process.env.TINY_CITY_API_PORT ? `http://127.0.0.1:${process.env.TINY_CITY_API_PORT}` : undefined)) },
});
