import { spawn } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
const mode = process.argv[2] ?? 'web';
if (!existsSync('.env') && existsSync('.env.example')) copyFileSync('.env.example', '.env');
process.loadEnvFile('.env');

const serverEntry = resolve(root, 'apps/server/src/main.ts');
const webPort = process.env.LUMEN_WEB_PORT ?? '5173';
// The vite dev/preview server (this process) proxies /api to the API child.
process.env.LUMEN_API_URL = 'http://127.0.0.1:' + (process.env.LUMEN_PORT ?? '8687');

let server, web, desktop;
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  try {
    if (desktop && !desktop.killed) desktop.kill();
    await web?.close();
    server?.kill();
  } catch {
    // best effort
  }
  process.exit(code);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());

server = spawn(process.execPath, ['--experimental-transform-types', serverEntry], { stdio: 'inherit' });
server.on('exit', (code) => {
  if (!stopping) {
    console.error(`API exited unexpectedly (${code})`);
    void stop(1);
  }
});

if (mode === 'server') {
  // Keep the process alive while the API runs.
} else if (mode === 'desktop') {
  const { default: electron } = await import(resolve(root, 'apps/desktop/node_modules/electron/index.js'));
  desktop = spawn(electron, [resolve(root, 'apps/desktop')], { stdio: 'inherit', env: { ...process.env, LUMEN_DEV_URL: `http://localhost:${webPort}` } });
  desktop.on('exit', (code) => void stop(code ?? 0));
} else {
  const { createServer, preview } = await import('vite');
  if (mode === 'preview') {
    web = await preview({ configFile: resolve(root, 'apps/web/vite.config.ts') });
    web.printUrls();
    console.log(`Lumen web (preview, built dist): http://localhost:${webPort}`);
  } else {
    web = await createServer({ configFile: resolve(root, 'apps/web/vite.config.ts') });
    await web.listen();
    console.log(`Lumen web: http://localhost:${webPort}`);
    console.log('Lumen API: http://127.0.0.1:' + (process.env.LUMEN_PORT ?? '8687'));
  }
}
