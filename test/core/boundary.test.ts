import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

describe('portable core boundary', () => {
  it('does not import runtime, auth, environment, Cloudflare, or service modules', async () => {
    const directory = resolve(import.meta.dirname, '../../src/core');
    const files = (await readdir(directory)).filter((file) => file.endsWith('.ts'));
    const source = await Promise.all(
      files.map((file) => readFile(resolve(directory, file), 'utf8')),
    );
    const joined = source.join('\n');
    expect(joined).not.toMatch(/from ['"]node:/u);
    expect(joined).not.toMatch(/from ['"].*(auth0|cloudflare|\/node\/)/u);
    expect(joined).not.toMatch(/process\.env/u);
  });
});
