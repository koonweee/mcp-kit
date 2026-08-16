import { copyFile, mkdir } from 'node:fs/promises';

const source = new URL('../src/shared/jose-loader.cjs', import.meta.url);
for (const format of ['esm', 'cjs']) {
  const directory = new URL(`../dist/${format}/shared/`, import.meta.url);
  await mkdir(directory, { recursive: true });
  await copyFile(source, new URL('jose-loader.cjs', directory));
}
