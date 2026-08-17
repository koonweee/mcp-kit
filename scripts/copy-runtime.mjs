import { copyFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

const source = new URL('../src/shared/jose-loader.cjs', import.meta.url);
const joseLicense = new URL('../node_modules/jose/LICENSE.md', import.meta.url);
const cjsRuntime = new URL('../dist/cjs/shared/jose-runtime.cjs', import.meta.url);
for (const format of ['esm', 'cjs']) {
  const directory = new URL(`../dist/${format}/shared/`, import.meta.url);
  await mkdir(directory, { recursive: true });
  await copyFile(source, new URL('jose-loader.cjs', directory));
}

await build({
  entryPoints: [new URL('./jose-runtime-entry.mjs', import.meta.url).pathname],
  outfile: cjsRuntime.pathname,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  legalComments: 'inline',
});
await copyFile(cjsRuntime, new URL('../dist/esm/shared/jose-runtime.cjs', import.meta.url));
await copyFile(joseLicense, new URL('../dist/JOSE-LICENSE.md', import.meta.url));
