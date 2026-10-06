import { readFile, access } from 'node:fs/promises';
import { dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

export const PACKAGE_ID = 'ai-canvas-desktop-test';
export const PORT = 43129;
export const BASE_URL = `http://127.0.0.1:${PORT}`;

export async function packageProfile(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const manifest = JSON.parse(await readFile(resolve(root, 'installed-package.json'), 'utf8'));
  if (manifest.id !== PACKAGE_ID || manifest.port !== PORT) throw new Error('安装包身份无效。');
  if (!process.env.LOCALAPPDATA || !isAbsolute(process.env.LOCALAPPDATA)) throw new Error('当前用户数据目录不可用。');
  const data = resolve(process.env.LOCALAPPDATA, 'AI Canvas Test');
  return { root, data, capability: resolve(data, 'bridge/capability.json'), control: resolve(data, 'bridge/control.json') };
}

export function applyPackageEnvironment(profile) {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('AI_CANVAS_') || key === 'NODE_OPTIONS' || key === 'NODE_PATH') delete process.env[key];
  }
  process.env.AI_CANVAS_BRIDGE_PORT = String(PORT);
  process.env.AI_CANVAS_BRIDGE_CAPABILITY_FILE = profile.capability;
  process.env.AI_CANVAS_BRIDGE_CONTROL_FILE = profile.control;
  process.env.AI_CANVAS_ALLOWED_ORIGINS = 'https://appassets.local';
  process.chdir(profile.root);
}

export async function readOwnedCapability(file, tokenName = 'readToken') {
  const value = JSON.parse(await readFile(file, 'utf8'));
  if (value.version !== 1 || value.baseUrl !== BASE_URL ||
      typeof value.sessionId !== 'string' || !value.sessionId ||
      typeof value[tokenName] !== 'string' || !value[tokenName]) throw new Error('画布连接身份不匹配。');
  return value;
}

export function portListening() {
  return new Promise((resolveResult, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: PORT });
    socket.once('connect', () => { socket.destroy(); resolveResult(true); });
    socket.once('error', error => error.code === 'ECONNREFUSED' ? resolveResult(false) : reject(error));
    socket.setTimeout(2000, () => { socket.destroy(); reject(new Error('无法确认连接端口状态。')); });
  });
}
async function exists(file) {
  try { await access(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
export async function packageInactive(profile) {
  // Refuse stale descriptors as well as occupied endpoints. Never guess ownership or delete on a status check.
  return !(await portListening()) && !(await exists(profile.capability)) && !(await exists(profile.control));
}

export async function stopPackageBridge(profile) {
  if (await packageInactive(profile)) return;
  const control = await readOwnedCapability(profile.control, 'controlToken');
  const capability = await readOwnedCapability(profile.capability);
  if (control.sessionId !== capability.sessionId) throw new Error('画布连接会话不匹配，未执行停止。');
  const probe = await fetch(`${BASE_URL}/session`, { method: 'POST', headers: { Origin: 'https://appassets.local', 'Content-Type': 'application/json' }, body: '{"version":1}', signal: AbortSignal.timeout(3000), redirect: 'error' });
  if (!probe.ok || (await probe.json()).sessionId !== control.sessionId) throw new Error('连接服务不属于当前应用，未执行停止。');
  const response = await fetch(`${BASE_URL}/control/shutdown`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
    headers: { Authorization: `Bearer ${control.controlToken}`, 'Content-Type': 'application/json' }, body: '{"version":1}',
  });
  if (!response.ok) throw new Error('受控停止失败。');
  await response.text();
  for (let i = 0; i < 60; i++) {
    if (await packageInactive(profile)) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('连接服务尚未完成停止，请稍后重试。');
}
