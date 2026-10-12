import type { PlannerConnection } from '../aiArchitect/client';
import { Icon } from './Icon';

export type ConnectionView = { readonly state: 'idle' | 'checking' } | PlannerConnection;

/** Human summary of backend reachability versus provider readiness; never claims Gemini works from /status alone. */
export function connectionSummary(connection: ConnectionView): { tone: 'ok' | 'warn' | 'bad' | 'pending'; title: string; detail: string } {
  switch (connection.state) {
    case 'idle': return { tone: 'pending', title: 'Planner not checked yet', detail: 'The connection is checked when you open the AI Architect.' };
    case 'checking': return { tone: 'pending', title: 'Checking the planning server…', detail: 'A lightweight status request; no AI call is made.' };
    case 'unavailable': return { tone: 'bad', title: 'Planner unreachable', detail: connection.reason };
    case 'wrong-service': return { tone: 'bad', title: connection.serviceName ? `Wrong service on the planner port (${connection.serviceName})` : 'Wrong service on the planner port', detail: connection.reason };
    case 'reachable': return { tone: 'warn', title: 'Planner online · readiness unknown', detail: connection.reason };
    case 'connected':
      if (!connection.plannerReady) return { tone: 'warn', title: 'Planner online · planning engine not built', detail: 'Run npm run build:architect, then restart the API.' };
      if (connection.providerMode === 'mock') return { tone: 'warn', title: 'Planner online · offline demo mode', detail: 'The server is in mock mode and returns a fixed sample plan; prompts are not interpreted.' };
      if (connection.providerMode === 'local') return { tone: 'warn', title: 'Planner online · offline rules interpreter', detail: 'Common Vietnamese and English commands are interpreted by deterministic rules; no Gemini call is made.' };
      if (!connection.providerConfigured) return { tone: 'warn', title: 'Planner online · Gemini key missing', detail: 'Add the Gemini key to the backend file apps/api/.env (see .env.example there) and restart the API.' };
      return { tone: 'ok', title: 'Planner online · Gemini configured', detail: `The server is reachable and has a provider key${connection.model ? ` (model ${connection.model})` : ''}. Individual requests can still fail.` };
  }
}

export function ConnectionBadge({ connection, onRetry }: { connection: ConnectionView; onRetry: () => void }) {
  const summary = connectionSummary(connection);
  return <div className={`connection-badge tone-${summary.tone}`} role="status" aria-label="Planner connection">
    <span className="connection-dot" aria-hidden="true" />
    <span className="connection-copy"><strong>{summary.title}</strong><small>{summary.detail}</small></span>
    <button type="button" className="text-button" onClick={onRetry} disabled={connection.state === 'checking'}>
      {connection.state === 'checking' ? 'Checking…' : 'Check again'}</button>
  </div>;
}

const RECOVERABLE = new Set(['PLANNER_NOT_FOUND', 'PLANNER_HTTP_ERROR', 'INTERNAL_ERROR', 'PROVIDER_AUTH', 'PROVIDER_UNAVAILABLE', 'PROVIDER_TIMEOUT', 'PROVIDER_NOT_CONFIGURED', 'SERVER_BUSY', 'PROVIDER_RATE_LIMIT', 'PLANNER_UNAVAILABLE', 'PROVIDER_INVALID_RESPONSE']);
export const isRecoverablePlannerError = (code: string | undefined) => code !== undefined && RECOVERABLE.has(code);

export function PlannerRecovery({ code, connection, prompt, dev, onRetry, onCheck }: {
  code: string;
  connection: ConnectionView;
  prompt: string;
  dev: boolean;
  onRetry: () => void;
  onCheck: () => void;
}) {
  const unreachable = code === 'PROVIDER_UNAVAILABLE' && (connection.state === 'unavailable' || connection.state === 'idle');
  const wrongPort = code === 'PLANNER_NOT_FOUND' || connection.state === 'wrong-service';
  const title = wrongPort ? 'Another service is answering on the planner port'
    : code === 'PROVIDER_AUTH' ? 'Gemini rejected the API key'
    : code === 'INTERNAL_ERROR' ? 'The planner hit an unexpected error'
    : code === 'PROVIDER_NOT_CONFIGURED' ? 'Gemini is not configured on the server'
    : code === 'PROVIDER_TIMEOUT' ? 'The planner took too long'
    : code === 'SERVER_BUSY' || code === 'PROVIDER_RATE_LIMIT' ? 'The planner is busy'
    : code === 'PLANNER_UNAVAILABLE' ? 'The planning engine is not built'
    : unreachable ? 'Can’t reach the planning server' : 'The planning request failed';
  return <div className="recovery-card" role="region" aria-label="Planner recovery">
    <div className="recovery-head"><Icon name="warning" size={16} /><strong>{title}</strong></div>
    <p>Nothing was built and your city is unchanged.{prompt.trim() ? ' Your prompt is still in the composer.' : ''}</p>
    {dev && (unreachable || wrongPort) && <div className="recovery-steps">
      {wrongPort && <small>{connection.state === 'wrong-service' && connection.serviceName ? `“${connection.serviceName}”` : 'A different app'} answered with HTTP 404, so the planner never received your request.</small>}
      <small>Start the TINY CITY planner (the dev proxy at /api forwards to it; it checks that the port is free):</small>
      <code>npm run dev:api</code>
      <small>Running it yourself on another port? Set TINY_CITY_API_PROXY_TARGET to its address before npm run dev.</small>
    </div>}
    {dev && code === 'PROVIDER_AUTH' && <div className="recovery-steps"><small>Check the Gemini key in the backend file apps/api/.env (see .env.example there), then restart the API.</small></div>}
    {dev && code === 'PROVIDER_NOT_CONFIGURED' && <div className="recovery-steps"><small>Add the Gemini key to the backend file apps/api/.env (see .env.example there; never put it in frontend configuration), then restart the API.</small></div>}
    {dev && code === 'PLANNER_UNAVAILABLE' && <div className="recovery-steps"><code>npm run build:architect</code></div>}
    <div className="recovery-actions">
      <button type="button" className="approve-plan" onClick={onRetry} disabled={!prompt.trim()}>Retry request</button>
      <button type="button" className="reject-plan" onClick={onCheck}>Check connection</button>
    </div>
  </div>;
}
