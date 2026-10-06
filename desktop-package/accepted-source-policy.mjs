import { readFile, readdir } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const roots = ['src', 'webview-host/AiCanvas.WebViewHost'];
const extra = new Set(['webview-host/tests/HostContract.Tests.ps1',
  'desktop-package/tests/DocumentSessionTests/Program.cs',
  'desktop-package/tests/DocumentSessionTests/DocumentSessionTests.csproj']);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function verifyAcceptedBase(root, approval, releaseVersion) {
  if (approval.releaseVersion !== releaseVersion || !/^[a-f0-9]{40}$/.test(approval.productBase ?? ''))
    throw new Error('Accepted-source release/base mismatch');
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', approval.productBase, 'HEAD'], { cwd: root, stdio: 'ignore' });
  } catch {
    throw new Error('Accepted-source base is not in the current commit history');
  }
}

export async function verifyAcceptedSources(root, approval) {
  if (approval.schema !== 'ai-canvas-accepted-sources-v1' || !Array.isArray(approval.sources))
    throw new Error('Invalid accepted-source manifest');
  const expected = new Map();
  for (const item of approval.sources) {
    if (typeof item.path !== 'string' || item.path.includes('\\') || item.path.split('/').some(p => !p || p === '.' || p === '..') ||
        !(roots.some(base => item.path.startsWith(base + '/')) || extra.has(item.path)) ||
        !/^[a-f0-9]{64}$/.test(item.sha256) || expected.has(item.path)) throw new Error('Invalid or duplicate accepted-source path/hash');
    expected.set(item.path, item.sha256);
  }
  const actual = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Accepted sources cannot contain links');
      if (entry.isDirectory() && ['bin', 'obj'].includes(entry.name)) continue;
      const file = join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) actual.push(relative(root, file).replaceAll('\\', '/'));
    }
  }
  for (const base of roots) await walk(resolve(root, base));
  for (const path of actual) if (!expected.has(path)) throw new Error(`Unapproved source input: ${path}`);
  for (const [path, hash] of expected) {
    if (digest(await readFile(resolve(root, path))) !== hash) throw new Error(`Accepted source mismatch: ${path}`);
  }
  return Object.fromEntries(expected);
}
