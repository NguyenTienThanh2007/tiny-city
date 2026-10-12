/**
 * Dev-server-only same-origin proxy for the planning API.
 *
 * `npm run dev` listens on all interfaces so phones and tablets on the LAN can open the game. Calling
 * `http://127.0.0.1:8787` from those devices targets the device itself and fails CORS, which surfaced as
 * PROVIDER_UNAVAILABLE. Routing `/api/*` through Vite keeps requests same-origin in development without
 * widening the backend's CORS allowlist. Production builds never use this proxy.
 */

import type { ProxyOptions } from 'vite';

export const DEV_API_PREFIX = '/api';
/** Dedicated default port: 8000 is commonly taken by other local tools, which made the planner appear broken. */
export const DEFAULT_API_PORT = 8787;
export const DEFAULT_API_TARGET = `http://127.0.0.1:${DEFAULT_API_PORT}`;

interface HttpResponseLike {
  headersSent: boolean;
  writeHead: (status: number, headers: Record<string, string>) => unknown;
  end: (body?: string) => unknown;
}
const isHttpResponse = (value: unknown): value is HttpResponseLike =>
  typeof value === 'object' && value !== null && 'writeHead' in value && 'headersSent' in value;

/** The JSON body the client already understands as a retryable architect error. */
export function proxyUnavailableBody(target: string): string {
  return JSON.stringify({
    requestId: 'dev-proxy',
    error: {
      code: 'PROVIDER_UNAVAILABLE',
      message: `The local planning API is not reachable at ${target}. Start it with npm run dev:api, then retry.`,
      retryable: true,
    },
  });
}

export function createDevApiProxy(target = DEFAULT_API_TARGET): Record<string, ProxyOptions> {
  return {
    [DEV_API_PREFIX]: {
      target,
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/api(?=\/|$)/, '') || '/',
      configure: (proxy) => {
        proxy.on('error', (_error, _request, response) => {
          // WebSocket upgrades hand over a raw socket; only HTTP responses get the JSON error.
          if (!isHttpResponse(response)) { response.end(); return; }
          if (!response.headersSent) response.writeHead(503, { 'Content-Type': 'application/json' });
          response.end(proxyUnavailableBody(target));
        });
      },
    },
  };
}

/** Explicit VITE_AI_ARCHITECT_API_URL wins; dev uses the same-origin proxy; builds default to the local API. */
export function resolveApiBaseUrl(configured: string | undefined, dev: boolean): string {
  const base = configured?.trim() || (dev ? DEV_API_PREFIX : DEFAULT_API_TARGET);
  return base.replace(/\/+$/, '');
}
