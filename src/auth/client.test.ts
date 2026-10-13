import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountApi, clearCsrfMemory } from './client';

afterEach(() => {
  vi.unstubAllGlobals();
  clearCsrfMemory();
});

describe('account API transport', () => {
  it('bootstraps CSRF, sends cookies and keeps the opaque session out of browser storage', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'a'.repeat(43) }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: '1' }, csrfToken: 'b'.repeat(43) }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    await accountApi.login('city@example.com', 'long enough passphrase');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include' });
    const [url, request] = fetcher.mock.calls[1]!;
    expect(String(url)).toContain('/v1/auth/login');
    expect(request?.credentials).toBe('include');
    expect(new Headers(request?.headers).get('X-CSRF-Token')).toBe('a'.repeat(43));
    expect(JSON.parse(String(request?.body))).toEqual({ email: 'city@example.com', password: 'long enough passphrase' });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('surfaces structured API errors without exposing raw response internals', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'INVALID_CREDENTIALS', message: 'Sign-in failed.' } }), { status: 401 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(accountApi.me()).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS', message: 'Sign-in failed.' });
  });

  it('checks the session with cookies and no CSRF bootstrap; a guest is a successful answer', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ authenticated: false, user: null }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(accountApi.session()).resolves.toEqual({ authenticated: false, user: null });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, request] = fetcher.mock.calls[0]!;
    expect(String(url)).toMatch(/\/v1\/auth\/session$/);
    expect(request).toMatchObject({ method: 'GET', credentials: 'include' });
    expect(new Headers(request?.headers).has('X-CSRF-Token')).toBe(false);
  });

  it('rebootstraps the CSRF cookie after password reset clears browser cookies', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'a'.repeat(43) }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Password changed.' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'b'.repeat(43) }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: '1' }, csrfToken: 'c'.repeat(43) }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    await accountApi.resetPassword('one-time-token-that-is-long-enough', 'a secure new passphrase');
    await accountApi.login('city@example.com', 'a secure new passphrase');
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[3]?.[1]).toMatchObject({ credentials: 'include' });
    expect(new Headers(fetcher.mock.calls[3]?.[1]?.headers).get('X-CSRF-Token')).toBe('b'.repeat(43));
  });
});
