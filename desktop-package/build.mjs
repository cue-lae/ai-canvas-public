import { readFile, writeFile, mkdir, cp, readdir, stat } from 'node:fs/promises';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { verifyAcceptedSources } from './accepted-source-policy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.cwd().toLowerCase() !== root.toLowerCase()) throw new Error('Build must run in the canonical repository root.');
const buildId = process.argv[2];
if (!/^build-[0-9]{3}$/.test(buildId ?? '')) throw new Error('Supply a new build-NNN identifier.');
const timingDiagnostics = process.argv[3] === '--timing';
if (process.argv.length > (timingDiagnostics ? 4 : 3)) throw new Error('Only the explicit --timing diagnostic build option is supported.');
const task = resolve(process.env.CANVAS_BUILD_ROOT ?? join(root, '.build'));
await mkdir(task, { recursive: true });
const release = JSON.parse(await readFile(join(root, 'desktop-package/release.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(release.version) || release.packageVersion !== release.version) throw new Error('Invalid release version');
const productBase = 'public-source-snapshot';
const sourceDirtyPaths = [];
// The frozen release manifest rejects runtime source changes and additions.
// A derived release must deliberately replace that manifest after validation.
const sourceApproval = JSON.parse(await readFile(join(root, 'desktop-package/accepted-source-inputs.json'), 'utf8'));
if (sourceApproval.releaseVersion !== release.version) throw new Error('Approved source version mismatch');
const acceptedSources = await verifyAcceptedSources(root, sourceApproval);
const documentOpenAssets = {
  'webview-host/AiCanvas.WebViewHost/Assets/AI-Canvas-Document-A.ico': '74b43c1b8e9bb14e04489296c28a75eb7a2f268ecce64d103199cf663097b31e',
  'webview-host/AiCanvas.WebViewHost/Assets/AI-Canvas-Document-A.svg': '6932d2433e3a0919319dd765ae076d5c787e5cbc933cf711be86ad6defbe990e',
};
const documentOpenSources = {
  'webview-host/AiCanvas.WebViewHost/DocumentOpenRequest.cs': acceptedSources['webview-host/AiCanvas.WebViewHost/DocumentOpenRequest.cs'],
  'desktop-package/file-association.ps1': 'ab541ba0eb04739b376ae005a74ee096d19c7eff933de4aadc5005b2598a6876',
  'desktop-package/tests/file-association.test.ps1': 'de3a45f98d14998e14a5da74b808c2660c4b5153ecea28ac43bd9185d14f29d5',
  'desktop-package/installer-file-association.ps1': '96d555f60bd095793424d883b7814333f85bba3474f517d924e218ff006b892d',
  'desktop-package/installer-file-association.iss': '97846317832a867fc76afa2970f8a9edeccd1dd7092f8ef35be00bbb337dee57',
  'desktop-package/tests/installer-file-association.test.ps1': 'bdf4e9cca95f8bd29d4614c10515776f2cd99afd7aa3a5bbaa5c8b4bc7b94337',
};
for (const [path, expected] of Object.entries(documentOpenAssets))
  if (createHash('sha256').update(await readFile(join(root, path))).digest('hex') !== expected) throw new Error(`Document icon approval mismatch: ${path}`);
for (const [path, expected] of Object.entries(documentOpenSources))
  if (createHash('sha256').update(await readFile(join(root, path))).digest('hex') !== expected) throw new Error(`Document open source approval mismatch: ${path}`);
const run = join(task, buildId), payload = join(run, 'payload');
await mkdir(run); // Never overwrite a candidate or previous build.
await mkdir(payload);
const node = process.execPath;
const modulesRoot = resolve(process.env.CANVAS_DEPS_ROOT ?? join(root, 'node_modules')); // Explicit warmed-build input only.
const dotnet = process.env.CANVAS_DOTNET ?? 'dotnet';
const nuget = resolve(process.env.CANVAS_NUGET_CACHE ?? join(task, 'nuget'));
const nugetFeed = process.env.CANVAS_NUGET_SOURCE;
const dotnetEnvironment = { NUGET_PACKAGES: nuget, DOTNET_CLI_TELEMETRY_OPTOUT: '1', ...(process.env.CANVAS_DOTNET ? { DOTNET_ROOT: dirname(dotnet) } : {}) }; 
const iscc = process.env.CANVAS_ISCC ?? resolve(process.env.LOCALAPPDATA, 'Programs/Inno Setup 7/ISCC.exe');
const commands = [];
async function command(exe, args, env = {}) {
  commands.push({ executable: relative(root, exe), args });
  await new Promise((done, fail) => {
    const child = spawn(exe, args, { cwd: root, env: { ...process.env, ...env }, windowsHide: true, stdio: 'inherit' });
    child.once('error', fail); child.once('exit', code => code === 0 ? done() : fail(new Error(`${exe} failed: ${code}`)));
  });
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const version = '24.19.0';
const deps = resolve(root, 'third-party-licenses');
const nodeArchive = resolve(process.env.CANVAS_NODE_ARCHIVE ?? join(task, 'downloads', `node-v${version}-win-x64.zip`));
const verifiedNode = join(run, 'verified-node');
const nodeFolder = join(verifiedNode, `node-v${version}-win-x64`);
const expectedNodeZip = '57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73';
if (digest(await readFile(nodeArchive)) !== expectedNodeZip) throw new Error('Node archive hash mismatch');
await mkdir(verifiedNode);
await command(resolve(process.env.SystemRoot, 'System32/tar.exe'), ['-xf', nodeArchive, '-C', verifiedNode]);

await command(node, [resolve(modulesRoot, 'typescript/bin/tsc'), '--noEmit']);
await command(node, [resolve(modulesRoot, 'vite/bin/vite.js'), 'build', '--config', 'desktop-package/vite.package.config.ts', '--outDir', join(payload, 'dist')], { VITE_AI_CANVAS_BRIDGE_URL: 'http://127.0.0.1:43129' });
await command(dotnet, ['publish', 'webview-host/AiCanvas.WebViewHost/AiCanvas.WebViewHost.csproj', '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true', '--artifacts-path', join(run, 'dotnet'), '-o', payload, '-p:CanvasInstalledPackage=true', `-p:CanvasTimingDiagnostics=${timingDiagnostics}`, `-p:Version=${release.packageVersion}`, '-p:PublishSingleFile=false', '-p:PublishTrimmed=false', `-p:RestorePackagesPath=${nuget}`, '-p:NuGetAudit=false', ...(nugetFeed ? [`-p:RestoreSources=${nugetFeed}`] : [])], dotnetEnvironment);
await command(dotnet, ['publish', 'desktop-package/image-tools/AiCanvas.ImageTools.csproj', '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true', '--artifacts-path', join(run, 'image-tools-dotnet'), '-o', payload, '-p:PublishSingleFile=false', '-p:RuntimeFrameworkVersion=8.0.31', `-p:RestorePackagesPath=${nuget}`, '-p:NuGetAudit=false', ...(nugetFeed ? [`-p:RestoreSources=${nugetFeed}`] : [])], dotnetEnvironment);
await cp(join(root, 'desktop-package/plugin/ai-canvas-native-trial'), join(payload, 'plugin'), { recursive: true });
await mkdir(join(payload, 'runtime'));
await cp(join(nodeFolder, 'node.exe'), join(payload, 'runtime/node.exe'));
await mkdir(join(payload, 'scripts'));
for (const name of ['canvas-context-bridge.mjs', 'canvas-context-bridge-runtime.mjs', 'canvas-context-mcp-core.mjs'])
  await cp(join(root, 'scripts', name), join(payload, 'scripts', name));
for (const name of ['package-policy.mjs', 'package-entry.mjs', 'plugin-install.mjs', 'plugin-legacy-hashes.json'])
  await cp(join(root, 'desktop-package', name), join(payload, 'scripts', name));
await cp(join(root, 'desktop-package/installer-file-association.ps1'), join(payload, 'scripts/installer-file-association.ps1'));
await writeFile(join(payload, 'README-ZH.txt'), (await readFile(join(root, 'desktop-package/README-ZH.txt'), 'utf8')).replaceAll('{{PACKAGE_VERSION}}', release.packageVersion));
await writeFile(join(payload, 'AI Canvas 安装说明.txt'), '\uFEFF' + (await readFile(join(root, 'desktop-package/CONNECTION-GUIDE-ZH.md'), 'utf8')).replaceAll('{{PACKAGE_VERSION}}', release.packageVersion));
await writeFile(join(payload, 'installed-package.json'), JSON.stringify({ id: 'ai-canvas-desktop-test', version: release.packageVersion, buildId, timingDiagnostics, port: 43129, nodeVersion: version, dotnetVersion: '8.0.31', productBase }, null, 2));

// Preserve third-party license originals; never synthesize license grants.
const licenses = join(payload, 'licenses'); await mkdir(licenses);
await cp(join(nodeFolder, 'LICENSE'), join(licenses, 'Node-LICENSE.txt'));
await cp(resolve(dirname(iscc), 'license.txt'), join(licenses, 'Inno-Setup-LICENSE.txt'));
const notices = [];
const licenseName = /^(licen[cs]e|notice|copying|third[-_]?party)/i;
async function collectPackage(folder, label) {
  let entries; try { entries = await readdir(folder, { withFileTypes: true }); } catch { return; }
  let meta; try { meta = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8')); } catch { meta = {}; }
  const selected = [];
  for (const entry of entries)
    if (licenseName.test(entry.name) && (await stat(join(folder, entry.name))).isFile()) selected.push(entry);
  for (const e of selected) {
    const out = `${label.replace(/[^a-zA-Z0-9._-]/g, '_')}--${e.name}`;
    await writeFile(join(licenses, out), await readFile(join(folder, e.name)));
  }
  if (selected.length) notices.push({ name: meta.name ?? label, version: meta.version, license: meta.license, files: selected.map(e => e.name) });
}
// An over-inclusive license set is safe; no module code or package credentials enter the payload.
for (const entry of await readdir(join(modulesRoot, '.pnpm'), { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === 'node_modules') continue;
  const modules = join(modulesRoot, '.pnpm', entry.name, 'node_modules');
  let packages; try { packages = await readdir(modules, { withFileTypes: true }); } catch { continue; }
  for (const pkg of packages) {
    if (!pkg.isDirectory()) continue;
    if (pkg.name.startsWith('@')) {
      for (const scoped of await readdir(join(modules, pkg.name), { withFileTypes: true }))
        if (scoped.isDirectory()) await collectPackage(join(modules, pkg.name, scoped.name), `${entry.name}-${scoped.name}`);
    } else await collectPackage(join(modules, pkg.name), entry.name);
  }
}
for (const pkg of ['microsoft.netcore.app.runtime.win-x64', 'microsoft.windowsdesktop.app.runtime.win-x64', 'microsoft.web.webview2']) {
  const packageRoot = join(nuget, pkg);
  for (const v of await readdir(packageRoot)) await collectPackage(join(packageRoot, v), `${pkg}-${v}`);
}
await writeFile(join(licenses, 'INDEX.json'), JSON.stringify(notices, null, 2));
if (!notices.some(x => x.name.includes('microsoft.netcore.app.runtime'))) throw new Error('.NET license missing');
const excalidrawLicense = await readFile(join(deps, 'Excalidraw-0.18.1-LICENSE.txt'));
if (!excalidrawLicense.toString('utf8').includes('Copyright (c) 2020 Excalidraw')) throw new Error('Canvas engine license missing');
await writeFile(join(licenses, 'Excalidraw-0.18.1-LICENSE.txt'), excalidrawLicense);
const assistantLicense = await readFile(join(deps, 'Assistant-OFL.txt'));
if (!assistantLicense.toString('utf8').includes('SIL OPEN FONT LICENSE')) throw new Error('Assistant font license missing');
await writeFile(join(licenses, 'Assistant-OFL.txt'), assistantLicense);
await cp(join(deps, 'fonts'), join(licenses, 'fonts'), { recursive: true });
notices.push({ name: '@excalidraw/excalidraw', version: '0.18.1', license: 'MIT', source: 'https://raw.githubusercontent.com/excalidraw/excalidraw/v0.18.1/LICENSE', sha256: digest(excalidrawLicense) });
await writeFile(join(licenses, 'INDEX.json'), JSON.stringify(notices, null, 2));

async function walk(folder) {
  const found = [];
  for (const e of await readdir(folder, { withFileTypes: true })) {
    const p = join(folder, e.name);
    if (e.isSymbolicLink()) throw new Error('Payload contains a link');
    if (e.isDirectory()) found.push(...await walk(p)); else if (e.isFile()) found.push(p);
  }
  return found;
}
const hashes = [];
for (const file of await walk(payload)) {
  const rel = relative(payload, file).replaceAll('\\', '/');
  if (/(^|\/)(tests?|node_modules|\.git|\.codex|inbox|working|temp)(\/|$)|\.(map|pdb|test\.[^/]+|spec\.[^/]+)$|(^|\/)\.env|capability\.json|control\.json/i.test(rel)) throw new Error(`Forbidden payload file: ${rel}`);
  const bytes = await readFile(file);
  if (/\.(js|mjs|json|html|css|txt)$/i.test(rel) && !rel.startsWith('licenses/')) {
    const content = bytes.toString('utf8').toLowerCase();
    if (content.includes(root.toLowerCase()) || content.includes(root.replaceAll('\\', '/').toLowerCase()) || /[a-z]:[\\/]+users[\\/]/i.test(content)) throw new Error(`Developer path leaked: ${rel}`);
  }
  hashes.push({ path: rel, size: (await stat(file)).size, sha256: digest(bytes) });
}
await writeFile(join(payload, 'FILES.sha256.json'), JSON.stringify(hashes, null, 2));
const excludedRoots = new Set(['.git', '.build', 'node_modules', 'runtime', '.pnpm-store', 'temp', 'dist', 'coverage']);
async function sourceWalk(folder) {
  const files = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Source snapshot contains a link');
    if (entry.isDirectory() && (excludedRoots.has(entry.name) || ['bin','obj'].includes(entry.name))) continue;
    const path = join(folder, entry.name);
    if (entry.isDirectory()) files.push(...await sourceWalk(path));
    else if (entry.isFile()) files.push(relative(root,path).replaceAll('\\','/'));
  }
  return files;
}
const sourceFiles = (await sourceWalk(root)).sort();
const sourceInputs = await Promise.all(sourceFiles.map(async path => ({ path, sha256: digest(await readFile(join(root, path))) })));
const trackedSourcePaths = new Set(sourceFiles);
const sourceUntrackedPaths = sourceFiles.filter(path => !trackedSourcePaths.has(path));
const installerName = `AI-Canvas-${release.version}-Setup.exe`;
await command(iscc, [...(timingDiagnostics ? ['/DTimingDiagnostics'] : []), `/DPayload=${payload}`, `/DOutput=${join(run, 'engine')}`, `/DProductVersion=${release.version}`, `/DPackageVersion=${release.packageVersion}`, resolve(root, 'desktop-package/installer.iss')]);
const engine = join(run, 'engine', installerName);
const engineSha256 = digest(await readFile(engine));
await command(dotnet, ['publish', 'desktop-package/installer-shell/InstallerShell.csproj', '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true', '--artifacts-path', join(run, 'shell-dotnet'), '-o', join(run, 'shell'), `-p:InstallerEnginePath=${engine}`, `-p:CanvasTimingDiagnostics=${timingDiagnostics}`,  `-p:Version=${release.packageVersion}`, `-p:RestorePackagesPath=${nuget}`, '-p:NuGetAudit=false', ...(nugetFeed ? [`-p:RestoreSources=${nugetFeed}`] : [])], dotnetEnvironment);
await mkdir(join(run, 'installer'));
await writeFile(join(run, 'installer/AI Canvas 安装说明.md'), (await readFile(join(root, 'desktop-package/CONNECTION-GUIDE-ZH.md'), 'utf8')).replaceAll('{{PACKAGE_VERSION}}', release.packageVersion));
await cp(join(run, 'shell/AI-Canvas-Setup.exe'), join(run, 'installer', installerName));
const installer = join(run, 'installer', installerName);
const installerSha256 = digest(await readFile(installer));
await verifyAcceptedSources(root, sourceApproval);
for (const input of sourceInputs)
  if (digest(await readFile(join(root, input.path))) !== input.sha256) throw new Error(`Source changed during packaging: ${input.path}`);
await writeFile(join(run, 'BUILD-REPORT.json'), JSON.stringify({ productBase, packageVersion: release.packageVersion, buildId, timingDiagnostics, sourceDirtyPaths, sourceUntrackedPaths, sourceInputs, dependencyInput: process.env.CANVAS_DEPS_ROOT ? 'explicit-existing-dependencies' : 'checkout-node_modules', nodeSource: `https://nodejs.org/dist/v${version}/`, expectedNodeZip, commands, fileCount: hashes.length, files: hashes, engine: { name: installerName, sha256: engineSha256 }, installer: { name: installerName, sha256: installerSha256 } }, null, 2));
await writeFile(join(run, 'installer/SHA256.txt'), `${installerSha256}  ${installerName}\n`);
console.log(`TEST_INSTALLER_READY: ${installer}`);
