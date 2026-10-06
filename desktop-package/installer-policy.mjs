import { access, lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { win32, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { homedir } from 'node:os';
import { preflight as preflightPlugin } from './plugin-install.mjs';

const packageId = 'ai-canvas-desktop-test';
const port = 43129;
const requiredFiles = ['AiCanvas.WebViewHost.exe', 'dist/index.html', 'runtime/node.exe', 'scripts/package-entry.mjs'];
const samePath = (a, b) => a.toLowerCase() === b.toLowerCase();
const inside = (file, folder) => samePath(file, folder) || file.toLowerCase().startsWith(folder.toLowerCase() + '\\');

export function normalizeInstallPath(value) {
  if (typeof value !== 'string' || !/^[a-z]:[\\/]/i.test(value) || /[<>"|?*\x00-\x1f]/.test(value))
    throw new Error('请选择本地磁盘上的完整安装目录。');
  const normalized = win32.normalize(value);
  if (normalized.length <= 3 || normalized.slice(2).includes(':')) throw new Error('请为应用选择单独的文件夹，不要选择磁盘根目录。');
  const parts = value.slice(3).split(/[\\/]/).filter(Boolean);
  if (parts.some(part => part === '..' || part === '.' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))
    throw new Error('安装目录名称无效，请使用普通文件夹名称。');
  return normalized.replace(/\\+$/, '');
}

async function exists(file) {
  try { await access(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function rejectLinks(file) {
  for (let current = file; current.length > 3; current = win32.dirname(current)) {
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error('安装目录包含目录链接，请选择普通本地目录。');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

export function comparePackageVersions(left, right) {
  const parse = value => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-test\.(\d+))?$/.exec(value);
    if (!match) throw new Error('无法确认已安装版本，请保留现有文件并联系支持。');
    return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ? Number(match[4]) : Number.MAX_SAFE_INTEGER];
  };
  const a = parse(left), b = parse(right);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

export async function connectionIsActive(dataRoot) {
  if (await exists(win32.join(dataRoot, 'bridge/capability.json')) || await exists(win32.join(dataRoot, 'bridge/control.json'))) return true;
  return new Promise((done, fail) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); done(true); });
    socket.once('error', error => error.code === 'ECONNREFUSED' ? done(false) : fail(new Error('无法确认连接状态，请关闭画布连接后重试。')));
    socket.setTimeout(2000, () => { socket.destroy(); fail(new Error('检查连接超时，请稍后重试。')); });
  });
}

/** Read-only preflight. Tests inject a connection probe; the CLI always uses the real probe. */
export async function validateInstallTarget({ targetRoot, previousRoot = '', dataRoot, newVersion }, {
  connectionCheck = connectionIsActive,
  protectedRoots = [process.env.WINDIR, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData].filter(Boolean),
} = {}) {
  const target = normalizeInstallPath(targetRoot);
  const data = normalizeInstallPath(dataRoot);
  if (inside(target, data) || inside(data, target)) throw new Error('安装文件与画布数据必须放在不同目录，请另选安装位置。');
  if (protectedRoots.some(folder => inside(target, win32.normalize(folder).replace(/\\+$/, ''))))
    throw new Error('当前用户安装不使用系统目录，请选择用户目录或其他本地应用目录。');
  try { if (!(await lstat(win32.parse(target).root)).isDirectory()) throw new Error(); }
  catch { throw new Error('所选磁盘不可用，请选择当前可用的本地磁盘。'); }
  await rejectLinks(target);
  const previous = previousRoot ? normalizeInstallPath(previousRoot) : '';
  let mode = 'install';
  if (previous) {
    if (!samePath(target, previous)) throw new Error('更新必须沿用原安装位置；本次不会搬移已有安装。');
    await rejectLinks(previous);
    let manifest;
    try { await rejectLinks(win32.join(target, 'installed-package.json')); manifest = JSON.parse(await readFile(win32.join(target, 'installed-package.json'), 'utf8')); }
    catch { throw new Error('已有安装缺少有效身份记录，未覆盖任何文件。'); }
    if (manifest.id !== packageId || manifest.port !== port) throw new Error('该目录不是匹配的 AI Canvas 安装，未覆盖任何文件。');
    if (comparePackageVersions(manifest.version, newVersion) > 0) throw new Error('已安装版本较新，本安装包不执行降级。');
    for (const relative of requiredFiles) {
      const file = win32.join(target, relative);
      await rejectLinks(file);
      try { if (!(await lstat(file)).isFile()) throw new Error(); }
      catch { throw new Error('已有安装文件不完整，请先恢复完整安装后再更新。'); }
    }
    mode = 'update';
  } else if (await exists(target)) {
    if (!(await lstat(target)).isDirectory() || (await readdir(target)).length !== 0)
      throw new Error('此目录已有文件，且没有匹配的安装记录；请选择新的空目录。');
  }
  if (await connectionCheck(data))
    throw new Error('请先保存并关闭全部画布，等待连接自动结束后重试；若 Codex 读取组件仍占用文件，请在 Codex 停用 AI Canvas 插件或旧读取连接。');
  return { mode, targetRoot: target, dataRoot: data };
}

// Both read-only gates must pass before Inno can start writing application files.
export async function validateInstallation(options, { home = homedir(), ...targetChecks } = {}) {
  await preflightPlugin(home);
  return validateInstallTarget(options, targetChecks);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [targetRoot, previousRoot, newVersion, dataRoot, report] = process.argv.slice(2);
  if (process.argv.length !== 7 || !report) process.exitCode = 2;
  else {
    try {
      await validateInstallation({ targetRoot, previousRoot, newVersion, dataRoot });
      await writeFile(report, '', 'utf8');
      process.exitCode = 0;
    } catch (error) {
      await writeFile(report, error.message || '安装位置或连接状态无法确认，请重试。', 'utf8');
      process.exitCode = 1;
    }
  }
}
