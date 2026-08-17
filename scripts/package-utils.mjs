import { rm, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: { ...process.env, ...options.env },
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(' ')} failed (${code})\n${stdout}${stderr}`));
    });
  });
}

export async function createTarball(destination) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  const packed = await run(
    'npm',
    ['pack', '--ignore-scripts', '--json', '--pack-destination', destination],
    { capture: true, env: { npm_config_cache: resolve(root, '.tmp/npm-cache') } },
  );
  const output = JSON.parse(packed.stdout);
  const filename = output[0]?.filename;
  if (typeof filename !== 'string') throw new Error('npm pack did not report a tarball');
  return resolve(destination, filename);
}

export async function pnpmStoreDir() {
  const result = await run('pnpm', ['store', 'path'], { capture: true });
  const path = result.stdout.trim();
  if (!path) throw new Error('pnpm store path returned no location');
  return path;
}

export async function installOffline(directory) {
  await run(
    'pnpm',
    [
      'install',
      '--offline',
      '--ignore-scripts',
      '--config.auto-install-peers=false',
      '--frozen-lockfile=false',
      '--store-dir',
      await pnpmStoreDir(),
    ],
    { cwd: directory },
  );
}

export const fileDependency = (path) => pathToFileURL(path).href;
