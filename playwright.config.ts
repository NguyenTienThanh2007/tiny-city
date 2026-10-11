import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const liveCheck=process.env.TINY_CITY_LIVE_UI==='1';
if(liveCheck && process.env.CI) throw new Error('Paid Gemini UI checks are forbidden in CI.');
const backendEnvironment:Record<string,string>={TINY_CITY_PROVIDER_MODE:liveCheck?'gemini':'mock',
  TINY_CITY_CORS_ORIGINS:'http://127.0.0.1:4173',TINY_CITY_REQUESTS_PER_MINUTE:'120'};
if(!liveCheck) backendEnvironment.GEMINI_API_KEY='';

export default defineConfig({
  testDir: './e2e',
  testMatch: liveCheck ? '**/ai-architect-live.spec.ts' : '**/*.spec.ts',
  testIgnore: liveCheck ? [] : ['**/ai-architect-live.spec.ts'],
  timeout: 45_000,
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
    command: 'uv run --locked --extra dev uvicorn tiny_city_api.main:app --host 127.0.0.1 --port 8012',
    cwd: fileURLToPath(new URL('./apps/api/', import.meta.url)),
    url: 'http://127.0.0.1:8012/health',
    reuseExistingServer: false,
    timeout: 60_000,
    // Explicit test mode and an empty override prevent paid calls even if a local .env has a key.
    env: backendEnvironment,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    stdout: 'pipe',
    stderr: 'pipe',
  }],
});
