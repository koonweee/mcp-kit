import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { root } from './package-utils.mjs';

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (['node_modules', '.git', '.tmp', 'dist'].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) results.push(...(await markdownFiles(path)));
    else if (extname(entry.name) === '.md') results.push(path);
  }
  return results;
}

const failures = [];
for (const file of await markdownFiles(root)) {
  const source = await readFile(file, 'utf8');
  if (!file.endsWith('/AGENTS.md') && !/^## Agent guidance$/mu.test(source)) {
    failures.push(`${file}: missing Agent guidance section`);
  }
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
    const link = match[1]?.split('#', 1)[0];
    if (!link || /^(?:https?:|mailto:)/u.test(link)) continue;
    try {
      await access(resolve(dirname(file), decodeURIComponent(link)));
    } catch {
      failures.push(`${file}: broken link ${link}`);
    }
  }
}
if (failures.length > 0) throw new Error(failures.join('\n'));
console.log('all local documentation links and Agent guidance sections are valid');
