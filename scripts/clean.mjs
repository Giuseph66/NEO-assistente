#!/usr/bin/env node
// Removes installed dependencies and build output so the next `pnpm install`
// starts from scratch. Keeps pnpm-lock.yaml and user data untouched.
// Usage: pnpm clean   |   pnpm reinstall
import { rmSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspaces = ['apps', 'packages', 'services'].flatMap((group) => {
  const dir = join(root, group);
  return existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(dir, entry.name))
    : [];
});

const targets = [
  join(root, 'node_modules'),
  ...workspaces.flatMap((ws) => [join(ws, 'node_modules'), join(ws, 'dist')]),
];

for (const target of targets) {
  if (!existsSync(target)) continue;
  rmSync(target, { recursive: true, force: true });
  console.log(`removido ${relative(root, target)}`);
}
console.log('Limpo. Rode: pnpm install');
