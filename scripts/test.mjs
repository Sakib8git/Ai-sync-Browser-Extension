import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';

const sources = readdirSync('tests').filter((f) => f.endsWith('.test.ts'));
await build({
  entryPoints: sources.map((f) => `tests/${f}`),
  outdir: '.test-dist',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['jsdom'],
  logLevel: 'warning',
});
const outputs = sources.map((f) => `.test-dist/${f.replace(/\.ts$/, '.js')}`);
const result = spawnSync(process.execPath, ['--test', ...outputs], { stdio: 'inherit' });
rmSync('.test-dist', { recursive: true, force: true });
process.exit(result.status ?? 1);
