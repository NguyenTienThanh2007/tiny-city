#!/usr/bin/env node
// Starts the TINY CITY planning API for development: npm run dev:api
// Uses TINY_CITY_API_PORT (default 8787, the Vite proxy's default target). If the port is already taken it says what
// is listening there instead of failing later with confusing 404s in the game.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.TINY_CITY_API_PORT ?? 8787);
const free = (p) => new Promise((resolve) => {
  const server = net.createServer().once('error', () => resolve(false)).once('listening', () => server.close(() => resolve(true)));
  server.listen(p, '127.0.0.1');
});
async function identify(p) {
  const get = async (path) => { try { const r = await fetch(`http://127.0.0.1:${p}${path}`, { signal: AbortSignal.timeout(1500) }); return await r.json(); } catch { return null; } };
  const health = await get('/health');
  if (health?.service === 'tiny-city-api') return 'tiny-city';
  const docs = await get('/openapi.json');
  return typeof docs?.info?.title === 'string' ? docs.info.title : 'an unknown program';
}

if (!existsSync(`${root}packages/ai-architect/dist/worker.js`)) {
  console.error('The planning workspace is not built. Run: npm run build:architect');
  process.exit(1);
}
if (!(await free(port))) {
  const who = await identify(port);
  if (who === 'tiny-city') {
    console.log(`The TINY CITY API is already running on http://127.0.0.1:${port}.`);
    process.exit(0);
  }
  let suggestion = port + 1;
  while (!(await free(suggestion)) && suggestion < port + 50) suggestion += 1;
  console.error(`Port ${port} is used by ${who === 'an unknown program' ? who : `“${who}”`}, not the TINY CITY API.`);
  console.error(`Use a free port for the planner and point the dev proxy at it:`);
  console.error(`  TINY_CITY_API_PORT=${suggestion} npm run dev:api`);
  console.error(`  TINY_CITY_API_PORT=${suggestion} npm run dev`);
  process.exit(1);
}
console.log(`Starting the TINY CITY API on http://127.0.0.1:${port} (provider mode from apps/api/.env; keys are never printed).`);
const child = spawn('uv', ['run', '--locked', 'uvicorn', 'tiny_city_api.main:app', '--host', '127.0.0.1', '--port', String(port)], { cwd: `${root}apps/api`, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 0));
