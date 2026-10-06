import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { normalizeInstallPath, comparePackageVersions, validateInstallTarget, validateInstallation } from '../installer-policy.mjs';

const temp = resolve('temp/desktop-test-installer-update-20260928/policy-tests');
await mkdir(temp, { recursive: true });
const quiet = { connectionCheck: async () => false, protectedRoots: [] };
async function fixture() {
  const root = await mkdtemp(join(temp, 'case-'));
  const targetRoot = join(root, 'app'), dataRoot = join(root, 'userdata');
  return { root, targetRoot, dataRoot, newVersion: '0.1.1-test.1' };
}
async function installed(input, changes = {}) {
  await mkdir(input.targetRoot, { recursive: true });
  await writeFile(join(input.targetRoot, 'installed-package.json'), JSON.stringify({ id: 'ai-canvas-desktop-test', port: 43129, version: '0.1.0-test.1', ...changes }));
  for (const name of ['AiCanvas.WebViewHost.exe', 'dist/index.html', 'runtime/node.exe', 'scripts/package-entry.mjs']) {
    const file = join(input.targetRoot, name); await mkdir(resolve(file, '..'), { recursive: true }); await writeFile(file, 'original');
  }
}

test('path syntax rejects roots, remote shares, traversal and reserved names', () => {
  for (const value of ['C:\\', '\\\\server\\app', 'relative', 'C:\\Apps\\..\\Other', 'C:\\Apps\\CON', 'C:\\App.']) assert.throws(() => normalizeInstallPath(value));
  assert.equal(normalizeInstallPath('D:\\Apps\\AI Canvas'), 'D:\\Apps\\AI Canvas');
});
test('versions compare numerically and prevent downgrade', () => {
  assert.equal(comparePackageVersions('0.1.0-test.1', '0.1.1-test.1'), -1);
  assert.equal(comparePackageVersions('0.1.10-test.1', '0.1.2-test.1'), 1);
  assert.equal(comparePackageVersions('0.1.1-test.1', '0.1.1-test.1'), 0);
  assert.throws(() => comparePackageVersions('unknown', '0.1.1-test.1'));
});
test('fresh install allows a new local folder and does not create files', async () => {
  const input = await fixture();
  assert.equal((await validateInstallTarget(input, quiet)).mode, 'install');
  assert.deepEqual(await readdir(input.root), []);
});
test('valid registered package updates in place and preserves user data', async () => {
  const input = await fixture(); await installed(input);
  await mkdir(input.dataRoot); await writeFile(join(input.dataRoot, 'saved.excalidraw'), 'keep');
  assert.equal((await validateInstallTarget({ ...input, previousRoot: input.targetRoot }, quiet)).mode, 'update');
  assert.equal(await readFile(join(input.dataRoot, 'saved.excalidraw'), 'utf8'), 'keep');
  assert.equal(await readFile(join(input.targetRoot, 'dist/index.html'), 'utf8'), 'original');
});
test('unknown nonempty folders are rejected without changing files', async () => {
  const input = await fixture(); await mkdir(input.targetRoot); await writeFile(join(input.targetRoot, 'mine.txt'), 'keep');
  await assert.rejects(validateInstallTarget(input, quiet), /已有文件/);
  assert.equal(await readFile(join(input.targetRoot, 'mine.txt'), 'utf8'), 'keep');
});
test('registered path mismatch and foreign package identity are rejected', async () => {
  const input = await fixture(); await installed(input, { id: 'other-app' });
  await assert.rejects(validateInstallTarget({ ...input, previousRoot: input.targetRoot }, quiet), /不是匹配/);
  await assert.rejects(validateInstallTarget({ ...input, previousRoot: join(input.root, 'elsewhere') }, quiet), /沿用原安装位置/);
});
test('newer installed version is not overwritten', async () => {
  const input = await fixture(); await installed(input, { version: '0.2.0-test.1' });
  await assert.rejects(validateInstallTarget({ ...input, previousRoot: input.targetRoot }, quiet), /不执行降级/);
});
test('damaged registered installation is rejected', async () => {
  const input = await fixture(); await mkdir(input.targetRoot);
  await writeFile(join(input.targetRoot, 'installed-package.json'), JSON.stringify({ id: 'ai-canvas-desktop-test', port: 43129, version: '0.1.0-test.1' }));
  await assert.rejects(validateInstallTarget({ ...input, previousRoot: input.targetRoot }, quiet), /文件不完整/);
});
test('missing installation identity is rejected', async () => {
  const input = await fixture(); await mkdir(input.targetRoot);
  await assert.rejects(validateInstallTarget({ ...input, previousRoot: input.targetRoot }, quiet), /缺少有效身份/);
});
test('data root, ancestors and system directories are not installation targets', async () => {
  const input = await fixture();
  await assert.rejects(validateInstallTarget({ ...input, targetRoot: input.dataRoot }, quiet), /不同目录/);
  await assert.rejects(validateInstallTarget({ ...input, targetRoot: input.root }, quiet), /不同目录/);
  await assert.rejects(validateInstallTarget(input, { ...quiet, protectedRoots: [input.root] }), /系统目录/);
});
test('junction directories are refused', async () => {
  const input = await fixture(), real = join(input.root, 'real'); await mkdir(real);
  await symlink(real, input.targetRoot, 'junction');
  await assert.rejects(validateInstallTarget(input, quiet), /目录链接/);
});
test('active connection and unknown connection state block installation', async () => {
  const input = await fixture();
  await assert.rejects(validateInstallTarget(input, { ...quiet, connectionCheck: async () => true }), /保存并关闭/);
  await assert.rejects(validateInstallTarget(input, { ...quiet, connectionCheck: async () => { throw new Error('unknown'); } }), /unknown/);
});

test('combined preflight allows a fresh install without writing either destination', async () => {
  const input = await fixture();
  const home = join(input.root, 'home');
  assert.equal((await validateInstallation(input, { ...quiet, home })).mode, 'install');
  assert.deepEqual(await readdir(input.root), []);
});

test('combined preflight rejects an unknown plugin even with an otherwise valid target', async () => {
  const input = await fixture(), home = join(input.root, 'home');
  const plugin = join(home, 'plugins', 'ai-canvas-native-trial');
  await mkdir(plugin, { recursive: true });
  await writeFile(join(plugin, 'mine.txt'), 'keep');
  await assert.rejects(validateInstallation(input, { ...quiet, home }), /不是已核验/);
  assert.equal(await readFile(join(plugin, 'mine.txt'), 'utf8'), 'keep');
  assert.deepEqual(await readdir(input.root), ['home']);
});

test('combined preflight still rejects active connections and occupied targets after plugin passes', async () => {
  const input = await fixture(), home = join(input.root, 'home');
  await assert.rejects(validateInstallation(input, { ...quiet, home, connectionCheck: async () => true }), /保存并关闭/);
  await mkdir(input.targetRoot);
  await writeFile(join(input.targetRoot, 'mine.txt'), 'keep');
  await assert.rejects(validateInstallation(input, { ...quiet, home }), /已有文件/);
  assert.equal(await readFile(join(input.targetRoot, 'mine.txt'), 'utf8'), 'keep');
});
