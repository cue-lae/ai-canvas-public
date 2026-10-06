import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { packageProfile, readOwnedCapability, BASE_URL } from '../package-policy.mjs';

const task = resolve('temp/desktop-test-installer-20260927');
await mkdir(task, { recursive: true });
test('native MCP entry relays stdio and does not inherit NODE_OPTIONS', { skip: !process.env.CANVAS_TEST_PAYLOAD }, async () => {
  const exe = resolve(process.env.CANVAS_TEST_PAYLOAD, 'AiCanvas.WebViewHost.exe');
  const result = await new Promise((done, fail) => {
    const child = spawn(exe, ['--mcp'], { windowsHide: true, env: { ...process.env, NODE_OPTIONS: '--require=Z:/definitely-not-a-real-developer-module.cjs' } });
    let output = '', error = '';
    const limit = setTimeout(() => { child.kill(); fail(new Error('Native MCP test timed out')); }, 15000);
    child.stdout.on('data', b => output += b); child.stderr.on('data', b => error += b);
    child.on('error', e => { clearTimeout(limit); fail(e); });
    child.on('exit', code => { clearTimeout(limit); done({ code, output, error }); });
    child.stdin.end(JSON.stringify({ jsonrpc: '2.0', id: 999, method: 'tools/list' }) + '\n');
  });
  assert.equal(result.code, 0, result.error);
  const response = JSON.parse(result.output.trim());
  assert.equal(response.id, 999);
  assert.equal(response.result.tools[0].name, 'get_canvas_context');
});
test('profile requires package identity; capability rejects a development port', async () => {
  const root = await mkdtemp(join(task, 'node-policy-'));
  await assert.rejects(packageProfile(root));
  await writeFile(join(root, 'installed-package.json'), JSON.stringify({ id: 'wrong', port: 43129 }));
  await assert.rejects(packageProfile(root));
  await writeFile(join(root, 'installed-package.json'), JSON.stringify({ id: 'ai-canvas-desktop-test', port: 43129 }));
  const profile = await packageProfile(root);
  assert.ok(profile.data.endsWith('AI Canvas Test'));
  const cap = join(root, 'cap.json');
  await writeFile(cap, JSON.stringify({ version: 1, sessionId: 'test', readToken: 'test', baseUrl: 'http://127.0.0.1:43127' }));
  await assert.rejects(readOwnedCapability(cap));
  await writeFile(cap, JSON.stringify({ version: 1, sessionId: 'test', readToken: 'test', baseUrl: BASE_URL }));
  assert.equal((await readOwnedCapability(cap)).sessionId, 'test');
});

test('package integration: missing bridge, startup, isolated read, stop, no fallback', { skip: !process.env.CANVAS_TEST_PAYLOAD }, async () => {
  const payload = resolve(process.env.CANVAS_TEST_PAYLOAD);
  const data = await mkdtemp(join(task, 'integration-'));
  const node = join(payload, 'runtime/node.exe'), entry = join(payload, 'scripts/package-entry.mjs');
  const env = { ...process.env, LOCALAPPDATA: data, AI_CANVAS_BRIDGE_PORT: '43127', AI_CANVAS_BRIDGE_CAPABILITY_FILE: resolve('temp/nonexistent-development-capability.json') };
  const command = mode => new Promise((done, fail) => {
    const child = spawn(node, [entry, mode], { env, windowsHide: true }); let output = '';
    child.stderr.on('data', b => output += b); child.on('error', fail);
    child.on('exit', code => done({ code, output }));
  });
  const nativeStatus = () => new Promise((done, fail) => {
    const child = spawn(join(payload, 'AiCanvas.WebViewHost.exe'), ['--package-status'], { env: { ...env, NODE_OPTIONS: '--require=Z:/missing-dev-module.cjs' }, windowsHide: true });
    const limit = setTimeout(() => { child.kill(); fail(new Error('Native status timed out')); }, 20000);
    child.on('error', error => { clearTimeout(limit); fail(error); });
    child.on('exit', code => { clearTimeout(limit); done(code); });
  });
  assert.equal((await command('status')).code, 0, 'do not start when checking status');
  assert.equal(await nativeStatus(), 0, 'native uninstall status ignores developer options');
  async function mcpRead() {
    const child = spawn(node, [entry], { env, windowsHide: true }); let output = '';
    child.stdout.on('data', b => output += b);
    const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_canvas_context', arguments: { includeImage: false } } };
    child.stdin.end(JSON.stringify(request) + '\n');
    await new Promise((done, fail) => { child.on('error', fail); child.on('exit', code => code === 0 ? done() : fail(new Error('MCP exit ' + code))); });
    return JSON.parse(output.trim());
  }
  const unavailable = await mcpRead();
  assert.match(JSON.stringify(unavailable), /BRIDGE_UNAVAILABLE/);
  const bridge = spawn(node, [entry, 'bridge'], { env, windowsHide: true, stdio: 'ignore' });
  let started = false;
  try {
    const cap = join(data, 'AI Canvas Test/bridge/capability.json');
    for (let i = 0; i < 60; i++) {
      try { await readOwnedCapability(cap); started = true; break; } catch { await new Promise(r => setTimeout(r, 100)); }
    }
    assert.ok(started, 'owned capability was written');
    assert.equal((await command('status')).code, 1, 'active package blocks uninstall');
    assert.equal(await nativeStatus(), 1, 'native uninstall refuses an occupied endpoint');
    const capability = await readOwnedCapability(cap);
    assert.equal(capability.baseUrl, BASE_URL);
    const result = await mcpRead();
    assert.doesNotMatch(JSON.stringify(result), /BRIDGE_UNAVAILABLE/);
    assert.equal((await command('guide')).code, 1, 'connection guide is external, not a runtime entry');
    await assert.rejects(readFile(join(data, 'AI Canvas Test/Codex-Setup.txt'), 'utf8'), { code: 'ENOENT' });
    assert.equal((await command('stop')).code, 0, 'authenticated stop succeeds');
    assert.equal((await command('status')).code, 0);
    assert.match(JSON.stringify(await mcpRead()), /BRIDGE_UNAVAILABLE/, 'no fallback after stopping owned service');
  } finally {
    if (started) await command('stop');
    await new Promise(done => bridge.exitCode !== null ? done() : bridge.once('exit', done));
  }
});
