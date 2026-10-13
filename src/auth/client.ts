import { apiBaseUrl } from '../aiArchitect/client';

export interface AccountUser {
  id: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface LoginResponse { user: AccountUser; csrfToken: string }
export interface CitySaveSummary {
  id: string;
  name: string;
  schemaVersion: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface CitySaveRecord { save: CitySaveSummary; snapshot: unknown }
export interface AccountSession {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  device: string;
}

export class AccountApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'AccountApiError';
  }
}

let csrfToken: string | null = null;

async function parseResponse<T>(response: Response): Promise<T> {
  const value: unknown = response.status === 204 ? undefined : await response.json().catch(() => null);
  if (!response.ok) {
    const error = typeof value === 'object' && value !== null && 'error' in value ? value.error : null;
    const record = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
    throw new AccountApiError(response.status, typeof record.code === 'string' ? record.code : 'REQUEST_FAILED',
      typeof record.message === 'string' ? record.message : 'The account service could not complete this request.');
  }
  if (typeof value === 'object' && value !== null && 'csrfToken' in value && typeof value.csrfToken === 'string') {
    csrfToken = value.csrfToken;
  }
  return value as T;
}

async function getCsrf(): Promise<string> {
  if (csrfToken) return csrfToken;
  const response = await fetch(`${apiBaseUrl()}/v1/auth/csrf`, { credentials: 'include' });
  const value = await parseResponse<{ csrfToken: string }>(response);
  csrfToken = value.csrfToken;
  return csrfToken;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers.set('X-CSRF-Token', await getCsrf());
  }
  const response = await fetch(`${apiBaseUrl()}${path}`, { ...init, method, headers, credentials: 'include' });
  return parseResponse<T>(response);
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const accountApi = {
  me: () => request<{ user: AccountUser }>('/v1/auth/me'),
  /** Who is signed in. Answers 200 for guests too, so the start-up check never logs a failed request. */
  session: () => request<{ authenticated: boolean; user: AccountUser | null }>('/v1/auth/session'),
  login: (email: string, password: string) => request<LoginResponse>('/v1/auth/login', json('POST', { email, password })),
  register: (displayName: string, email: string, password: string) => request<{ message: string }>('/v1/auth/register', json('POST', { display_name: displayName, email, password })),
  logout: () => request<void>('/v1/auth/logout', { method: 'POST' }),
  verifyEmail: (token: string) => request<{ verified: boolean; message: string }>('/v1/auth/verify-email', json('POST', { token })),
  resendVerification: (email: string) => request<{ message: string }>('/v1/auth/resend-verification', json('POST', { email })),
  forgotPassword: (email: string) => request<{ message: string }>('/v1/auth/forgot-password', json('POST', { email })),
  resetPassword: async (token: string, newPassword: string) => {
    const result = await request<{ message: string }>('/v1/auth/reset-password', json('POST', { token, new_password: newPassword }));
    csrfToken = null; // Reset revokes cookies; bootstrap a fresh anonymous CSRF cookie before the next sign-in.
    return result;
  },
  updateProfile: (displayName: string) => request<{ user: AccountUser }>('/v1/users/me', json('PUT', { display_name: displayName })),
  changePassword: (currentPassword: string, newPassword: string) => request<{ user: AccountUser; csrfToken: string; message: string }>('/v1/users/me/password', json('POST', { current_password: currentPassword, new_password: newPassword })),
  deleteAccount: async (password: string) => {
    const result = await request<void>('/v1/users/me', { ...json('DELETE', { password }) });
    csrfToken = null;
    return result;
  },
  sessions: () => request<{ sessions: AccountSession[] }>('/v1/users/me/sessions'),
  revokeSession: (id: string) => request<{ revoked: boolean; current: boolean }>(`/v1/users/me/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  revokeAllSessions: async () => {
    const result = await request<void>('/v1/users/me/sessions', { method: 'DELETE' });
    csrfToken = null;
    return result;
  },
  cities: () => request<{ saves: CitySaveSummary[] }>('/v1/users/me/cities'),
  city: (id: string) => request<CitySaveRecord>(`/v1/users/me/cities/${encodeURIComponent(id)}`),
  createCity: (name: string, snapshot: unknown) => request<CitySaveSummary>('/v1/users/me/cities', json('POST', { name, snapshot })),
  updateCity: (id: string, name: string, snapshot: unknown, expectedRevision: number) => request<CitySaveSummary>(
    `/v1/users/me/cities/${encodeURIComponent(id)}`, json('PUT', { name, snapshot, expected_revision: expectedRevision })),
  deleteCity: (id: string) => request<void>(`/v1/users/me/cities/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

export function clearCsrfMemory(): void { csrfToken = null; }
