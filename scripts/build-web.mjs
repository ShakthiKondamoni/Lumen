import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Production web build. Invoked via `pnpm build:web`.
// Vite is loaded from the workspace root; the config pins the web root.
// On hosts where the esbuild binary is blocked from file operations this
// still works: SWC + terser + target esnext never invoke esbuild for output.
const root = fileURLToPath(new URL('..', import.meta.url));
const result = spawnSync(
  process.execPath,
  [resolve(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', resolve(root, 'apps', 'web', 'vite.config.ts')],
  { cwd: root, stdio: 'inherit' },
);
process.exit(result.status ?? 1);
