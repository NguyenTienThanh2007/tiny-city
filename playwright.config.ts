import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const liveCheck=process.env.TINY_CITY_LIVE_UI==='1';
if(liveCheck && process.env.CI) throw new Error('Paid Gemini UI checks are forbidden in CI.');
const backendEnvironment:Record<string,string>={TINY_CITY_PROVIDER_MODE:liveCheck?'gemini':'mock',
  TINY_CITY_CORS_ORIGINS:'http://127.0.0.1:4173',TINY_CITY_REQUESTS_PER_MINUTE:'120',
  APP_ENV:'test',SESSION_COOKIE_SECURE:'false',SESSION_COOKIE_SAMESITE:'lax',
  DATABASE_URL:`sqlite:///${join(tmpdir(),`tiny-city-e2e-${randomUUID()}.sqlite3`)}`,
  AUTH_EMAIL_BACKEND:'disabled',DEV_EMAIL_SINK_ENABLED:'false',FRONTEND_BASE_URL:'http://127.0.0.1:4173'};
if(!liveCheck) backendEnvironment.GEMINI_API_KEY='';
const accountBackendEnvironment={...backendEnvironment,AUTH_EMAIL_BACKEND:'dev_sink',DEV_EMAIL_SINK_ENABLED:'true'};

export default defineConfig({
  testDir: './e2e',
  testMatch: liveCheck ? '**/ai-architect-live.spec.ts' : '**/*.spec.ts',
  testIgnore: liveCheck ? [] : ['**/ai-architect-live.spec.ts'],
  // SwiftShader canvas captures take 5–8s on hosted Linux runners; complete
  // build/move/history/reload workflows need a larger bounded CI deadline.
  timeout: process.env.CI ? 90_000 : 45_000,
  expect: { timeout: process.env.CI ? 20_000 : 5_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: [{
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 60_000,
    env: { VITE_AI_ARCHITECT_API_URL: 'http://127.0.0.1:8012' },
    stdout: 'pipe',
    stderr: 'pipe',
  }, {
    command: 'uv run --locked --extra dev alembic upgrade head && uv run --locked --extra dev uvicorn tiny_city_api.main:app --host 127.0.0.1 --port 8012',
    cwd: fileURLToPath(new URL('./apps/api/', import.meta.url)),
    url: 'http://127.0.0.1:8012/health',
    reuseExistingServer: false,
    timeout: 60_000,
    // Explicit test mode and an empty override prevent paid calls even if a local .env has a key.
    env: accountBackendEnvironment,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    stdout: 'pipe',
    stderr: 'pipe',
  }, {
    // AI Architect 2.0 specs: deterministic offline Vietnamese/English rules (no AI provider, no key, no paid calls).
    command: 'uv run --locked --extra dev uvicorn tiny_city_api.main:app --host 127.0.0.1 --port 8015',
    cwd: fileURLToPath(new URL('./apps/api/', import.meta.url)),
    url: 'http://127.0.0.1:8015/health',
    reuseExistingServer: false,
    timeout: 60_000,
    env: { ...backendEnvironment, TINY_CITY_PROVIDER_MODE: 'local' },
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    stdout: 'pipe',
    stderr: 'pipe',
  }],
});
