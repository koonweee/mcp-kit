import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { root } from './package-utils.mjs';

const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const version = packageJson.version;
if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
  throw new Error('package.json must contain a valid release version');
}

const tag =
  process.argv.slice(2).find((argument) => argument !== '--') ?? process.env['GITHUB_REF_NAME'];
if (tag && tag !== `v${version}`) {
  throw new Error(`Release tag ${tag} does not match package version v${version}`);
}

const changelog = await readFile(resolve(root, 'CHANGELOG.md'), 'utf8');
const escapedVersion = version.replaceAll('.', '\\.');
if (!new RegExp(`^## ${escapedVersion} - \\d{4}-\\d{2}-\\d{2}$`, 'mu').test(changelog)) {
  throw new Error(`CHANGELOG.md has no dated entry for ${version}`);
}

console.log(`release metadata is consistent for v${version}`);
