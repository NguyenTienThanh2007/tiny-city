import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createDevApiProxy } from './src/aiArchitect/devProxy';

export default defineConfig({
  plugins: [react()],
  // LAN devices reach the planning API through the same-origin /api proxy (dev server only).
  server: { host: '0.0.0.0', proxy: createDevApiProxy(process.env.TINY_CITY_API_PROXY_TARGET) },
});
