import { describe, expect, it, vi } from 'vitest';
import { checkPlannerConnection, apiBaseUrl } from './client';
import { createDevApiProxy, DEFAULT_API_TARGET, proxyUnavailableBody, resolveApiBaseUrl } from './devProxy';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('planner base URL and dev proxy', () => {
  it('prefers an explicit URL, uses the same-origin proxy in dev and the local API in builds', () => {
    expect(resolveApiBaseUrl('https://planner.example/', true)).toBe('https://planner.example');
    expect(resolveApiBaseUrl('  ', true)).toBe('/api');
    expect(resolveApiBaseUrl(undefined, true)).toBe('/api');
    expect(resolveApiBaseUrl(undefined, false)).toBe(DEFAULT_API_TARGET);
    expect(apiBaseUrl()).toBe('/api');
  });

  it('rewrites only the /api prefix and targets a configurable backend', () => {
    const proxy = createDevApiProxy('http://127.0.0.1:9100')['/api']!;
    expect(proxy.target).toBe('http://127.0.0.1:9100');
    expect(proxy.changeOrigin).toBe(true);
    expect(proxy.rewrite!('/api/v1/city/plan')).toBe('/v1/city/plan');
    expect(proxy.rewrite!('/api')).toBe('/');
    expect(proxy.rewrite!('/apiary')).toBe('/apiary');
    expect(createDevApiProxy()['/api']!.target).toBe(DEFAULT_API_TARGET);
  });

  it('answers proxy failures with a retryable architect error instead of an HTML page', () => {
    const proxy = createDevApiProxy('http://127.0.0.1:9100')['/api']!;
    let onError: ((error: Error, request: unknown, response: unknown) => void) | undefined;
    proxy.configure!({ on: (event: string, listener: typeof onError) => { if (event === 'error') onError = listener; } } as never, proxy);
    const response = { headersSent: false, writeHead: vi.fn(), end: vi.fn() };
    onError!(new Error('ECONNREFUSED'), {}, response);
    expect(response.writeHead).toHaveBeenCalledWith(503, { 'Content-Type': 'application/json' });
    const body = JSON.parse(response.end.mock.calls[0]![0] as string);
    expect(body).toEqual(JSON.parse(proxyUnavailableBody('http://127.0.0.1:9100')));
    expect(body.error).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retryable: true });
    const socket = { end: vi.fn() };
    onError!(new Error('ECONNRESET'), {}, socket);
    expect(socket.end).toHaveBeenCalledWith();
  });
});

describe('planner connection status', () => {
  it('reports provider readiness from the status endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ status: 'ok', provider: { mode: 'gemini', configured: false }, planner: 'ready' }));
    await expect(checkPlannerConnection(fetcher)).resolves.toEqual({ state: 'connected', providerMode: 'gemini', providerConfigured: false, plannerReady: true });
    expect(String(fetcher.mock.calls[0]![0])).toBe('/api/v1/city/status');
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: 'GET' });
  });

  it('distinguishes network failure, proxy errors and foreign services', async () => {
    await expect(checkPlannerConnection(vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'))))
      .resolves.toEqual({ state: 'unavailable', reason: 'Could not reach the planning service.' });
    const proxied = await checkPlannerConnection(vi.fn<typeof fetch>().mockResolvedValue(json(JSON.parse(proxyUnavailableBody('http://127.0.0.1:8000')), 503)));
    expect(proxied).toMatchObject({ state: 'unavailable', reason: expect.stringContaining('not reachable at http://127.0.0.1:8000') });
    await expect(checkPlannerConnection(vi.fn<typeof fetch>().mockResolvedValue(json({ hello: 'world' }))))
      .resolves.toMatchObject({ state: 'unavailable', reason: expect.stringContaining('not the TINY CITY planning API') });
    await expect(checkPlannerConnection(vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>', { status: 502 }))))
      .resolves.toMatchObject({ state: 'unavailable', reason: expect.stringContaining('HTTP 502') });
    // An older API without the status route still answered: reachable, readiness unknown.
    await expect(checkPlannerConnection(vi.fn<typeof fetch>().mockResolvedValue(json({ detail: 'Not Found' }, 404))))
      .resolves.toMatchObject({ state: 'reachable', reason: expect.stringContaining('readiness is unknown') });
  });

  it('times out instead of hanging', async () => {
    const hanging = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    await expect(checkPlannerConnection(hanging, 20)).resolves.toEqual({ state: 'unavailable', reason: 'The planning service did not answer in time.' });
  });
});
