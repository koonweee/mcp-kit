import { cp, mkdtemp, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createTarball, root, run } from './package-utils.mjs';

const workspace = await mkdtemp(join(tmpdir(), 'mcp-kit-container-'));
const tag = `mcp-kit-consumer-smoke:${process.pid}`;
let imageCreated = false;
try {
  const tarball = await createTarball(resolve(root, '.tmp/container-pack'));
  await Promise.all([
    cp(resolve(root, 'examples/basic-node/src'), join(workspace, 'src'), { recursive: true }),
    copyFile(resolve(root, 'examples/basic-node/package.json'), join(workspace, 'package.json')),
    copyFile(resolve(root, 'examples/basic-node/tsconfig.json'), join(workspace, 'tsconfig.json')),
    copyFile(
      resolve(root, 'examples/basic-node/commonjs-smoke.cjs'),
      join(workspace, 'commonjs-smoke.cjs'),
    ),
    copyFile(
      resolve(root, 'examples/basic-node/commonjs-jest.test.cjs'),
      join(workspace, 'commonjs-jest.test.cjs'),
    ),
    copyFile(
      resolve(root, 'examples/basic-node/jest.config.cjs'),
      join(workspace, 'jest.config.cjs'),
    ),
    copyFile(
      resolve(root, 'examples/basic-node/pnpm-workspace.yaml'),
      join(workspace, 'pnpm-workspace.yaml'),
    ),
    copyFile(resolve(root, 'examples/basic-node/Dockerfile'), join(workspace, 'Dockerfile')),
    copyFile(tarball, join(workspace, 'mcp-kit.tgz')),
  ]);
  await run('docker', ['build', '--tag', tag, '.'], { cwd: workspace });
  imageCreated = true;
  console.log('basic Node container built from the packed artifact');
} finally {
  if (imageCreated) {
    await run('docker', ['image', 'rm', '--force', tag]);
  }
  await rm(workspace, { recursive: true, force: true });
}
