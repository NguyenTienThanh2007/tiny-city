import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AuthPortal from './AuthPortal';
import { AuthProvider } from './AuthProvider';
import { accountApi } from './client';

vi.mock('./client', () => ({
  AccountApiError: class AccountApiError extends Error { constructor(readonly status: number, message: string) { super(message); } },
  clearCsrfMemory: vi.fn(),
  accountApi: {
    me: vi.fn(), session: vi.fn(), login: vi.fn(), register: vi.fn(), logout: vi.fn(), verifyEmail: vi.fn(),
    resendVerification: vi.fn(), forgotPassword: vi.fn(), resetPassword: vi.fn(), updateProfile: vi.fn(),
    changePassword: vi.fn(), deleteAccount: vi.fn(), sessions: vi.fn(), revokeSession: vi.fn(),
    revokeAllSessions: vi.fn(), cities: vi.fn(), city: vi.fn(), createCity: vi.fn(), updateCity: vi.fn(), deleteCity: vi.fn(),
  },
}));

const user = { id: 'user-1', displayName: 'Huy', email: 'huy@example.com', emailVerified: true,
  createdAt: '2026-10-12T00:00:00Z', lastLoginAt: null };

function renderPortal(path: string) {
  return render(<AuthProvider><AuthPortal path={path} /></AuthProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(accountApi.me).mockRejectedValue(Object.assign(new Error('Sign in to continue.'), { status: 401 }));
  vi.mocked(accountApi.session).mockResolvedValue({ authenticated: false, user: null });
  vi.mocked(accountApi.cities).mockResolvedValue({ saves: [] });
  vi.mocked(accountApi.sessions).mockResolvedValue({ sessions: [] });
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

describe('session start-up', () => {
  it('checks a guest through the session status endpoint, never the protected /me endpoint', async () => {
    renderPortal('/login');
    await waitFor(() => expect(accountApi.session).toHaveBeenCalledTimes(1));
    expect(accountApi.me).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('account entry flows', () => {
  it('validates confirmation and password length before making a register request', async () => {
    renderPortal('/register');
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Huy' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'huy@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'different' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('passwords do not match');
    expect(accountApi.register).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('at least 12 characters');
    expect(accountApi.register).not.toHaveBeenCalled();
  });

  it('shows the email delivery result instead of signing a new account in automatically', async () => {
    vi.mocked(accountApi.register).mockResolvedValue({ message: 'If the address can be registered, we will send a verification email.' });
    renderPortal('/register');
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Huy' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'huy@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a sufficiently long passphrase' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'a sufficiently long passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('heading', { name: 'Check your inbox' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('verification link has been sent');
    expect(accountApi.register).toHaveBeenCalledWith('Huy', 'huy@example.com', 'a sufficiently long passphrase');
  });

  it('supports password visibility and signs in through the server-backed provider', async () => {
    vi.mocked(accountApi.login).mockResolvedValue({ user, csrfToken: 'csrf' });
    renderPortal('/login');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: user.email } });
    const password = screen.getByLabelText('Password');
    fireEvent.change(password, { target: { value: 'a secure passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(accountApi.login).toHaveBeenCalledWith(user.email, 'a secure passphrase'));
  });

  it('shows the generic forgot-password response and does not ask whether the account exists', async () => {
    vi.mocked(accountApi.forgotPassword).mockResolvedValue({ message: 'If this email has an eligible account, password reset instructions will be sent.' });
    renderPortal('/forgot-password');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: user.email } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset instructions' }));
    expect(await screen.findByRole('status')).toHaveTextContent('If this email has an eligible account');
  });

  it('does not upload or load cloud data until the player chooses an action', async () => {
    vi.mocked(accountApi.session).mockResolvedValue({ authenticated: true, user });
    renderPortal('/account/saves');
    expect(await screen.findByText('Your city collection is ready')).toBeInTheDocument();
    expect(accountApi.cities).toHaveBeenCalledTimes(1);
    expect(accountApi.createCity).not.toHaveBeenCalled();
    expect(accountApi.updateCity).not.toHaveBeenCalled();
    expect(accountApi.city).not.toHaveBeenCalled();
    expect(accountApi.deleteCity).not.toHaveBeenCalled();
  });
});
