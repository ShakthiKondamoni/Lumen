import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const projects = ['packages/shared', 'apps/server', 'apps/web'];
let failed = false;
for (const project of projects) {
  const result = spawnSync(process.execPath, [resolve(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', resolve(root, project)], {
    stdio: 'inherit',
  });
  if (result.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
