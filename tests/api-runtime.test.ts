import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

it('loads both API routes in Node without Vite or browser globals', () => {
  const cache = join(root, 'node_modules', '.cache');
  mkdirSync(cache, { recursive: true });
  const output = mkdtempSync(join(cache, 'poleline-api-'));
  try {
    writeFileSync(join(output, 'package.json'), JSON.stringify({ type: 'module' }));
    const compiled = spawnSync(process.execPath, [
      join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
      '--ignoreConfig',
      '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022',
      '--strict', '--esModuleInterop', '--skipLibCheck', '--rootDir', root, '--outDir', output,
      'api/leaderboard.ts', 'api/push.ts',
    ], { cwd: root, encoding: 'utf8', timeout: 20000 });
    expect(compiled.status, compiled.stdout + compiled.stderr).toBe(0);
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      const { default: leaderboard } = await import(${JSON.stringify(join(output, 'api/leaderboard.js'))});
      const { default: push } = await import(${JSON.stringify(join(output, 'api/push.js'))});
      async function call(route, method, query = {}) {
        let status;
        const res = {
          setHeader() {},
          status(code) { status = code; return res; },
          json() { return res; },
          end() { return res; },
        };
        await route({ method, query, headers: {} }, res);
        return status;
      }
      console.log(JSON.stringify({
        leaderboard: await call(leaderboard, 'OPTIONS'),
        push: await call(push, 'OPTIONS'),
        badTrack: await call(leaderboard, 'GET', { track: 'not-a-circuit' }),
      }));
    `], { cwd: root, encoding: 'utf8', timeout: 10000 });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ leaderboard: 200, push: 405, badTrack: 400 });
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
