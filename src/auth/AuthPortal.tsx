import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { SAVE_KEY, loadCitySaveValue } from '../simulation/citySave';
import { accountApi } from './client';
import type { AccountSession, AccountUser, CitySaveSummary } from './client';
import { navigate } from './navigation';
import { useAuth } from './AuthProvider';

function Brand() {
  return <span className="auth-brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span><span><strong>TINY CITY</strong><small>IMAGINE · BUILD · LIVE</small></span></span>;
}

function PortalFrame({ title, subtitle, children, back = true }: { title: string; subtitle?: string; children: ReactNode; back?: boolean }) {
  return <div className="account-portal" role="dialog" aria-modal="true" aria-labelledby="portal-title">
    <header className="account-portal-header"><Brand />{back && <button className="portal-back" onClick={() => navigate('/')}>← <span>Back to city</span></button>}</header>
    <main className="account-page-wrap"><section className="account-card">
      <div className="account-eyebrow">TINY CITY ACCOUNT</div><h1 id="portal-title">{title}</h1>{subtitle && <p className="account-subtitle">{subtitle}</p>}
      {children}
    </section></main>
  </div>;
}

function Field({ label, type = 'text', name, value, onChange, autoComplete, required = true, maxLength }: {
  label: string; type?: string; name: string; value: string; onChange: (value: string) => void;
  autoComplete?: string; required?: boolean; maxLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  const password = type === 'password';
  const id = `account-field-${name.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  return <div className="account-field"><label htmlFor={id}>{label}</label><span className="account-input-wrap">
    <input id={id} name={name} type={password && visible ? 'text' : type} value={value} onChange={(event) => onChange(event.target.value)}
      autoComplete={autoComplete} required={required} maxLength={maxLength} />
    {password && <button type="button" className="password-toggle" onClick={() => setVisible((current) => !current)}
      aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} aria-pressed={visible}>{visible ? 'Hide' : 'Show'}</button>}
  </span></div>;
}

function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' | 'success' }) {
  return <div className={`account-notice tone-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}

function FormActions({ busy, children }: { busy: boolean; children: ReactNode }) {
  return <button className="account-primary" disabled={busy}>{busy ? <><span className="account-spinner" /> Working…</> : children}</button>;
}

function LoginPage({ onLogin }: { onLogin: (email: string, password: string) => Promise<AccountUser> }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const user = await onLogin(email.trim(), password);
      const returnTo = new URLSearchParams(window.location.search).get('returnTo');
      navigate(returnTo?.startsWith('/') ? returnTo : '/');
      if (!user.emailVerified) setError('Verify your email before signing in.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not sign in. Try again.'); }
    finally { setBusy(false); }
  };
  return <PortalFrame title="Welcome back" subtitle="Sign in to continue your city across devices.">
    <form className="account-form" onSubmit={submit}>
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="Email" name="email" type="email" value={email} onChange={setEmail} autoComplete="email" maxLength={320} />
      <Field label="Password" name="password" type="password" value={password} onChange={setPassword} autoComplete="current-password" maxLength={128} />
      <button className="forgot-link" type="button" onClick={() => navigate('/forgot-password')}>Forgot password?</button>
      <FormActions busy={busy}>Sign in</FormActions>
    </form>
    <p className="account-switch">New to TINY CITY? <button onClick={() => navigate('/register')}>Create an account</button></p>
    <p className="guest-note">You can keep building as a guest. Your local city stays on this device.</p>
  </PortalFrame>;
}

function RegisterPage() {
  const [name, setName] = useState(''); const [email, setEmail] = useState('');
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [sent, setSent] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    if (password !== confirm) { setError('The passwords do not match.'); return; }
    if (password.length < 12) { setError('Use at least 12 characters. A longer passphrase is easier to remember.'); return; }
    setBusy(true);
    try { await accountApi.register(name.trim(), email.trim(), password); setSent(true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create your account.'); }
    finally { setBusy(false); }
  };
  if (sent) return <PortalFrame title="Check your inbox" subtitle="Your local city is still safe on this device.">
    <Notice tone="success">If this address can be registered, a verification link has been sent. Open it to activate your account, then sign in.</Notice>
    <ResendVerification initialEmail={email} />
    <button className="account-primary secondary" onClick={() => navigate('/login')}>Go to sign in</button>
  </PortalFrame>;
  return <PortalFrame title="Create your account" subtitle="Save your cities and continue building on another device.">
    <form className="account-form" onSubmit={submit}>
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="Display name" name="name" value={name} onChange={setName} autoComplete="name" maxLength={48} />
      <Field label="Email" name="email" type="email" value={email} onChange={setEmail} autoComplete="email" maxLength={320} />
      <Field label="Password" name="new-password" type="password" value={password} onChange={setPassword} autoComplete="new-password" maxLength={128} />
      <p className="field-hint">At least 12 characters. Passphrases and Unicode are supported.</p>
      <Field label="Confirm password" name="confirm-password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" maxLength={128} />
      <FormActions busy={busy}>Create account</FormActions>
    </form>
    <p className="account-switch">Already have an account? <button onClick={() => navigate('/login')}>Sign in</button></p>
    <p className="guest-note">No legal terms have been published for this prototype yet. Creating an account is optional.</p>
  </PortalFrame>;
}

function ResendVerification({ initialEmail = '' }: { initialEmail?: string }) {
  const [email, setEmail] = useState(initialEmail); const [message, setMessage] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try { const result = await accountApi.resendVerification(email.trim()); setMessage(result.message); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not send the email.'); }
    finally { setBusy(false); }
  };
  return <form className="account-inline-form" onSubmit={submit}>
    <Field label="Resend verification email" name="resend-email" type="email" value={email} onChange={setEmail} autoComplete="email" maxLength={320} />
    {error && <Notice tone="error">{error}</Notice>}{message && <Notice tone="success">{message}</Notice>}
    <button className="account-primary secondary" disabled={busy}>{busy ? 'Sending…' : 'Send a new link'}</button>
  </form>;
}

function ForgotPasswordPage() {
  const [email, setEmail] = useState(''); const [message, setMessage] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try { setMessage((await accountApi.forgotPassword(email.trim())).message); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not request a reset link.'); }
    finally { setBusy(false); }
  };
  return <PortalFrame title="Reset your password" subtitle="Enter the email used for your TINY CITY account.">
    <form className="account-form" onSubmit={submit}>
      {error && <Notice tone="error">{error}</Notice>}{message && <Notice tone="success">{message}</Notice>}
      <Field label="Email" name="email" type="email" value={email} onChange={setEmail} autoComplete="email" maxLength={320} />
      <FormActions busy={busy}>Send reset instructions</FormActions>
    </form><p className="account-switch"><button onClick={() => navigate('/login')}>Back to sign in</button></p>
  </PortalFrame>;
}

function TokenPage({ kind }: { kind: 'verify' | 'reset' }) {
  const [token, setToken] = useState(''); const [status, setStatus] = useState<'loading' | 'ready' | 'done' | 'error'>('loading');
  const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const value = fragment.get('token') ?? '';
    window.history.replaceState({}, '', window.location.pathname + window.location.search);
    setToken(value);
    if (!value) { setStatus('error'); setError('This link is missing its one-time security token. Request a new email.'); return; }
    if (kind === 'verify') {
      void accountApi.verifyEmail(value).then((result) => { setMessage(result.message); setStatus('done'); })
        .catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : 'This link could not be verified.'); setStatus('error'); });
    } else setStatus('ready');
  }, [kind]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    if (password !== confirm) { setError('The passwords do not match.'); return; }
    if (password.length < 12) { setError('Use at least 12 characters.'); return; }
    setBusy(true);
    try { const result = await accountApi.resetPassword(token, password); setMessage(result.message); setStatus('done'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'This reset link could not be used.'); }
    finally { setBusy(false); }
  };
  const title = kind === 'verify' ? 'Verify your email' : 'Choose a new password';
  return <PortalFrame title={title} subtitle={kind === 'verify' ? 'This one-time link activates your account.' : 'Choose a new password for your account.'}>
    {status === 'loading' && <Notice>Checking your verification link…</Notice>}
    {status === 'error' && <Notice tone="error">{error}</Notice>}
    {status === 'done' && <Notice tone="success">{message}</Notice>}
    {status === 'ready' && <form className="account-form" onSubmit={submit}>
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="New password" name="new-password" type="password" value={password} onChange={setPassword} autoComplete="new-password" maxLength={128} />
      <Field label="Confirm new password" name="confirm-password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" maxLength={128} />
      <FormActions busy={busy}>Reset password</FormActions>
    </form>}
    <p className="account-switch"><button onClick={() => navigate('/login')}>Continue to sign in</button></p>
  </PortalFrame>;
}

function AccountNav({ active, user, onLogout }: { active: string; user: AccountUser; onLogout: () => Promise<void> }) {
  return <aside className="account-sidebar">
    <div className="account-user-chip"><span className="account-avatar">{user.displayName.trim().slice(0, 1).toUpperCase()}</span><span><strong>{user.displayName}</strong><small>{user.email}</small></span></div>
    <nav aria-label="Account navigation">
      {[['/account', 'Profile'], ['/account/sessions', 'Sessions'], ['/account/saves', 'My cities']].map(([path, label]) =>
        <button key={path} className={active === path ? 'active' : ''} onClick={() => navigate(path)}>{label}</button>)}
    </nav>
    <button className="account-sidebar-logout" onClick={() => void onLogout()}>Sign out</button>
  </aside>;
}

function AccountLayout({ path, title, children }: { path: string; title: string; children: ReactNode }) {
  const { user, signOut } = useAuth();
  if (!user) return null;
  return <div className="account-portal account-dashboard" role="dialog" aria-modal="true" aria-labelledby="portal-title">
    <header className="account-portal-header"><Brand /><button className="portal-back" onClick={() => navigate('/')}>← <span>Back to city</span></button></header>
    <main className="dashboard-wrap"><AccountNav active={path} user={user} onLogout={signOut} /><section className="dashboard-content">
      <div className="dashboard-heading"><div><div className="account-eyebrow">ACCOUNT SETTINGS</div><h1 id="portal-title">{title}</h1></div></div>{children}
    </section></main>
  </div>;
}

function AccountPage() {
  const { user, setUser, refresh } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [currentPassword, setCurrentPassword] = useState(''); const [newPassword, setNewPassword] = useState('');
  const [deletePassword, setDeletePassword] = useState(''); const [deleteWord, setDeleteWord] = useState('');
  const [profileMessage, setProfileMessage] = useState(''); const [passwordMessage, setPasswordMessage] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  if (!user) return null;
  const submitProfile = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setProfileMessage('');
    try { const result = await accountApi.updateProfile(displayName.trim()); setUser(result.user); setProfileMessage('Your profile has been saved.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save your profile.'); }
    finally { setBusy(false); }
  };
  const submitPassword = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setPasswordMessage('');
    try { const result = await accountApi.changePassword(currentPassword, newPassword); setUser(result.user); setCurrentPassword(''); setNewPassword(''); setPasswordMessage(result.message); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update your password.'); }
    finally { setBusy(false); }
  };
  const submitDelete = async (event: FormEvent) => {
    event.preventDefault(); if (deleteWord !== 'DELETE') { setError('Type DELETE exactly to confirm.'); return; }
    if (!window.confirm('Permanently delete this account and all cloud city saves? This cannot be undone.')) return;
    setBusy(true); setError('');
    try { await accountApi.deleteAccount(deletePassword); await refresh(); navigate('/'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not delete your account.'); }
    finally { setBusy(false); }
  };
  return <AccountLayout path="/account" title="Profile & security">
    {error && <Notice tone="error">{error}</Notice>}
    <div className="account-summary"><span className="account-avatar large">{user.displayName.trim().slice(0, 1).toUpperCase()}</span><div><strong>{user.email}</strong><span>{user.emailVerified ? 'Verified email' : 'Email not verified'}</span></div><time>{new Date(user.createdAt).toLocaleDateString()}</time></div>
    {!user.emailVerified && <section className="account-section"><h2>Verify your email</h2><p>Verified accounts can use cloud saves.</p><ResendVerification initialEmail={user.email} /></section>}
    <section className="account-section"><h2>Profile</h2><form className="account-form compact-form" onSubmit={submitProfile}>
      <Field label="Display name" name="display-name" value={displayName} onChange={setDisplayName} autoComplete="name" maxLength={48} />
      {profileMessage && <Notice tone="success">{profileMessage}</Notice>}<button className="account-primary secondary" disabled={busy}>Save profile</button>
    </form></section>
    <section className="account-section"><h2>Change password</h2><form className="account-form compact-form" onSubmit={submitPassword}>
      <Field label="Current password" name="current-password" type="password" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" maxLength={128} />
      <Field label="New password" name="account-new-password" type="password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" maxLength={128} />
      {passwordMessage && <Notice tone="success">{passwordMessage}</Notice>}<button className="account-primary secondary" disabled={busy}>Update password</button>
    </form></section>
    <section className="account-section danger-section"><h2>Delete account</h2><p>This permanently removes your profile, sessions, tokens and cloud cities. Your browser-only guest save stays on this device.</p>
      <form className="account-form compact-form" onSubmit={submitDelete}>
        <Field label="Password" name="delete-password" type="password" value={deletePassword} onChange={setDeletePassword} autoComplete="current-password" maxLength={128} />
        <Field label="Type DELETE to confirm" name="delete-confirm" value={deleteWord} onChange={setDeleteWord} autoComplete="off" maxLength={6} />
        <button className="account-primary destructive" disabled={busy}>Delete account and cloud cities</button>
      </form>
    </section>
  </AccountLayout>;
}

function SessionsPage() {
  const [sessions, setSessions] = useState<AccountSession[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(true);
  const { signOut, refresh: refreshAuth } = useAuth();
  const refresh = async () => { setBusy(true); setError(''); try { setSessions((await accountApi.sessions()).sessions); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load sessions.'); } finally { setBusy(false); } };
  useEffect(() => { void refresh(); }, []);
  const revoke = async (session: AccountSession) => {
    try { await accountApi.revokeSession(session.id); if (session.current) { await signOut(); navigate('/login'); } else await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not revoke that session.'); }
  };
  const revokeAll = async () => {
    if (!window.confirm('Sign out every active device, including this one?')) return;
    try { await accountApi.revokeAllSessions(); await refreshAuth(); navigate('/login'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not revoke sessions.'); }
  };
  return <AccountLayout path="/account/sessions" title="Active sessions">
    <p className="dashboard-intro">Review and sign out browsers that can access your account. Device details are limited to the browser's user-agent string.</p>
    {error && <Notice tone="error">{error}</Notice>}
    {busy ? <div className="account-loading"><span className="account-spinner" /> Loading sessions…</div> : sessions.length === 0 ? <Notice>No active sessions.</Notice> : <div className="session-list">
      {sessions.map((session) => <article className="session-card" key={session.id}><div><strong>{session.current ? 'This device' : session.device}</strong><p>{session.current ? session.device : `Last active ${new Date(session.lastSeenAt).toLocaleString()}`}</p><small>Expires {new Date(session.expiresAt).toLocaleDateString()}</small></div>
        {session.current ? <span className="current-session">Current</span> : <button className="outline-action" onClick={() => void revoke(session)}>Sign out</button>}</article>)}
    </div>}
    <button className="account-primary secondary revoke-all" disabled={sessions.length === 0} onClick={() => void revokeAll()}>Sign out all devices</button>
  </AccountLayout>;
}

interface LocalSave { snapshot: unknown; name: string; valid: boolean; error?: string }
function readLocalSave(): LocalSave | null {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const snapshot: unknown = JSON.parse(raw);
    const decoded = loadCitySaveValue(snapshot);
    if (decoded.notice || !snapshot || typeof snapshot !== 'object' || !('saveVersion' in snapshot) || snapshot.saveVersion !== 3) {
      return { snapshot, name: 'On-device city', valid: false, error: decoded.notice ?? 'This device save needs to be opened in the game and saved again before cloud upload.' };
    }
    const record = snapshot as { simulation?: { plan?: { name?: unknown } } };
    return { snapshot, name: typeof record.simulation?.plan?.name === 'string' ? record.simulation.plan.name : 'Villa Gardens', valid: true };
  } catch { return { snapshot: null, name: 'On-device city', valid: false, error: 'The local save could not be read safely.' }; }
}

function CloudSavesPage() {
  const { user } = useAuth();
  const localSave = useMemo(readLocalSave, []);
  const [saves, setSaves] = useState<CitySaveSummary[]>([]); const [name, setName] = useState(localSave?.name ?? 'Villa Gardens');
  const [busy, setBusy] = useState(true); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const refresh = async () => { setBusy(true); setError(''); try { setSaves((await accountApi.cities()).saves); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load cloud cities.'); } finally { setBusy(false); } };
  useEffect(() => { void refresh(); }, []);
  const uploadNew = async () => {
    if (!localSave?.valid || !window.confirm('Upload a new cloud copy of the last city saved on this device? Existing cloud cities will remain unchanged.')) return;
    setBusy(true); setError(''); setMessage('');
    try { await accountApi.createCity(name.trim() || localSave.name, localSave.snapshot); setMessage('A new cloud copy was created.'); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not upload this city.'); setBusy(false); }
  };
  const updateFromDevice = async (save: CitySaveSummary) => {
    if (!localSave?.valid || !window.confirm(`Replace “${save.name}” in the cloud with the last city saved on this device?`)) return;
    setBusy(true); setError(''); setMessage('');
    try { await accountApi.updateCity(save.id, save.name, localSave.snapshot, save.revision); setMessage('Cloud city updated.'); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update this city.'); setBusy(false); }
  };
  const loadToDevice = async (save: CitySaveSummary) => {
    if (!window.confirm(`Load “${save.name}” to this device? This replaces its saved local city. You can keep your local city by canceling and uploading it as a separate cloud save first.`)) return;
    setBusy(true); setError('');
    try {
      const record = await accountApi.city(save.id);
      const decoded = loadCitySaveValue(record.snapshot);
      if (decoded.notice || decoded.world.schemaVersion !== 2) throw new Error(decoded.notice ?? 'This snapshot version is not supported by this game build.');
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(record.snapshot));
      window.location.assign('/');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load this city.'); setBusy(false); }
  };
  const deleteSave = async (save: CitySaveSummary) => {
    if (!window.confirm(`Delete “${save.name}” from your account? This cannot be undone.`)) return;
    setBusy(true); setError(''); setMessage('');
    try { await accountApi.deleteCity(save.id); setMessage('Cloud city deleted.'); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not delete this city.'); setBusy(false); }
  };
  return <AccountLayout path="/account/saves" title="My cities">
    <p className="dashboard-intro">Cloud cities are separate from the guest save on this device. Nothing is uploaded, loaded or replaced until you choose an action.</p>
    {error && <Notice tone="error">{error}</Notice>}{message && <Notice tone="success">{message}</Notice>}
    <section className="cloud-device-card"><div><span className="account-eyebrow">THIS DEVICE</span><h2>{localSave?.name ?? 'No saved city found'}</h2><p>{localSave?.valid ? 'Last browser save · ready to copy to your account.' : localSave?.error ?? 'Save a city in the game first.'}</p></div>
      {localSave?.valid && <div className="cloud-upload-controls"><div className="account-field"><label htmlFor="cloud-save-name">Name for cloud copy</label><input id="cloud-save-name" value={name} maxLength={64} onChange={(event) => setName(event.target.value)} /></div>
        <button className="account-primary secondary" disabled={busy || !user?.emailVerified} onClick={() => void uploadNew()}>Upload as a new cloud city</button></div>}
    </section>
    {!user?.emailVerified && <Notice tone="error">Verify your email in Profile before using cloud saves.</Notice>}
    <div className="section-heading cloud-heading"><div><h2>Saved to your account</h2><span>{saves.length} {saves.length === 1 ? 'city' : 'cities'}</span></div><button className="outline-action" disabled={busy} onClick={() => void refresh()}>Refresh</button></div>
    {busy && saves.length === 0 ? <div className="account-loading"><span className="account-spinner" /> Loading cloud cities…</div> : saves.length === 0 ? <div className="cloud-empty"><span>✦</span><strong>Your city collection is ready</strong><p>Upload a copy from this device to continue your world on another device.</p></div> : <div className="cloud-save-list">
      {saves.map((save) => <article className="cloud-save-card" key={save.id}><div className="cloud-save-icon" aria-hidden="true">▦</div><div className="cloud-save-info"><strong>{save.name}</strong><span>Updated {new Date(save.updatedAt).toLocaleString()} · revision {save.revision}</span></div>
        <div className="cloud-save-actions"><button className="account-primary secondary" disabled={busy || !user?.emailVerified} onClick={() => void loadToDevice(save)}>Load to this device</button>
          {localSave?.valid && <button className="outline-action" disabled={busy || !user?.emailVerified} onClick={() => void updateFromDevice(save)}>Update from device</button>}
          <button className="danger-link" disabled={busy} onClick={() => void deleteSave(save)}>Delete</button></div></article>)}
    </div>}
    <p className="cloud-footnote">Cloud snapshots use the supported game save schema. The simulation validates the snapshot again when the city opens.</p>
  </AccountLayout>;
}

export default function AuthPortal({ path }: { path: string }) {
  const auth = useAuth();
  const validPath = ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email', '/account', '/account/sessions', '/account/saves'].includes(path);
  useEffect(() => {
    if (path.startsWith('/account') && auth.status === 'guest') navigate(`/login?returnTo=${encodeURIComponent(path)}`);
  }, [path, auth.status]);
  if (!validPath) return <PortalFrame title="Page not found" subtitle="That TINY CITY account page does not exist."><button className="account-primary" onClick={() => navigate('/')}>Return to city</button></PortalFrame>;
  if (path.startsWith('/account') && auth.status === 'loading') return <PortalFrame title="Loading account" subtitle="Checking your secure session…" back={false}><div className="account-loading"><span className="account-spinner" /> Loading…</div></PortalFrame>;
  if (path.startsWith('/account') && auth.status === 'guest') return <PortalFrame title="Sign in to your account" subtitle="Your city stays unchanged while you sign in."><button className="account-primary" onClick={() => navigate(`/login?returnTo=${encodeURIComponent(path)}`)}>Continue to sign in</button></PortalFrame>;
  if (path === '/login') return <LoginPage onLogin={auth.signIn} />;
  if (path === '/register') return <RegisterPage />;
  if (path === '/forgot-password') return <ForgotPasswordPage />;
  if (path === '/verify-email') return <TokenPage kind="verify" />;
  if (path === '/reset-password') return <TokenPage kind="reset" />;
  if (path === '/account') return <AccountPage />;
  if (path === '/account/sessions') return <SessionsPage />;
  return <CloudSavesPage />;
}
