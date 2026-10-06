import { readFile, writeFile, readdir, lstat, mkdir, rename, cp } from 'node:fs/promises';
import { resolve, join, dirname, relative, isAbsolute, sep } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const pluginName = 'ai-canvas-native-trial'; // Stable identity upgrades the verified trial in place.
const packageId = 'ai-canvas-desktop-test';
const ownerFile = '.ai-canvas-owner.json';
const legacy = JSON.parse(await readFile(new URL('./plugin-legacy-hashes.json', import.meta.url), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a,b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
async function exists(path) { try { await lstat(path); return true; } catch(e) { if(e.code==='ENOENT') return false; throw e; } }
async function noLinks(path) {
  for(let p=resolve(path);;p=dirname(p)) {
    try { if((await lstat(p)).isSymbolicLink()) throw new Error('插件路径包含链接，未修改。'); }
    catch(e) { if(e.code!=='ENOENT') throw e; }
    if(dirname(p)===p) break;
  }
}
async function hashes(root) {
  const result={};
  async function visit(folder) {
    for(const entry of await readdir(folder,{withFileTypes:true})) {
      const file=join(folder,entry.name); await noLinks(file);
      if(entry.isDirectory()) await visit(file);
      else if(entry.isFile() && relative(root,file)!==ownerFile) result[relative(root,file).split(sep).join('/')]=hash(await readFile(file));
      else if(!entry.isFile()) throw new Error('插件来源包含不支持的文件。');
    }
  }
  await visit(root); return result;
}
const equalHashes = (a,b) => Object.keys(a).length===Object.keys(b).length && Object.entries(a).every(([k,v])=>b[k]===v);
function paths(home) {
  const root=resolve(home), target=join(root,'plugins',pluginName), catalog=join(root,'.agents/plugins/marketplace.json');
  if(!target.startsWith(root+sep) || !catalog.startsWith(root+sep)) throw new Error('插件路径越界。');
  return {target,catalog};
}
async function readCatalog(file) {
  if(!await exists(file)) return {before:null,value:{name:'personal',interface:{displayName:'Personal'},plugins:[]}};
  await noLinks(file);
  if((await lstat(file)).size>1024*1024) throw new Error('已有插件来源文件过大，未修改。');
  const before=await readFile(file,'utf8'), value=JSON.parse(before.replace(/^\uFEFF/,''));
  if(!/^[A-Za-z0-9_-]+$/.test(value.name) || !Array.isArray(value.plugins) || value.plugins.some(x=>!x || typeof x.name!=='string')) throw new Error('已有插件来源格式无法确认。');
  return {before,value};
}
async function ownedTarget(target, appRoot=null) {
  if(!await exists(target)) return;
  await noLinks(target);
  const actual=await hashes(target);
  if(await exists(join(target,ownerFile))) {
    const owner=JSON.parse(await readFile(join(target,ownerFile),'utf8'));
    if(owner.packageId!==packageId || owner.plugin!==pluginName || !owner.files || !equalHashes(actual,owner.files) || (appRoot && !same(owner.appRoot,appRoot)))
      throw new Error('现有插件内容或归属已变化，未覆盖。');
  } else if(!equalHashes(actual,legacy)) throw new Error('同名插件目录不是已核验的试验版，未覆盖。');
}
export async function preflight(home, appRoot=null) {
  const p=paths(home); await noLinks(p.target); await noLinks(p.catalog);
  const c=await readCatalog(p.catalog), entries=c.value.plugins.filter(x=>x.name===pluginName);
  if(entries.length>1 || entries.some(x=>x.source?.source!=='local' || x.source?.path!=='./plugins/'+pluginName)) throw new Error('同名插件来源存在冲突，未修改。');
  await ownedTarget(p.target,appRoot);
  return {...p,...c};
}
async function replaceCatalog(file, before, value) {
  await mkdir(dirname(file),{recursive:true}); await noLinks(file);
  const now=await exists(file)?await readFile(file,'utf8'):null;
  if(now!==before) throw new Error('插件来源刚刚被其他程序修改，请重试。');
  const suffix=randomUUID(), temporary=file+'.canvas-'+suffix+'.tmp';
  await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  if(before!==null) await writeFile(file+'.canvas-'+suffix+'.bak',before,{flag:'wx'});
  await rename(temporary,file);
}
export async function register(appRoot,home) {
  appRoot=resolve(appRoot); await noLinks(appRoot);
  const identity=JSON.parse(await readFile(join(appRoot,'installed-package.json'),'utf8'));
  if(identity.id!==packageId || identity.port!==43129) throw new Error('安装包身份不匹配，未登记插件。');
  const source=join(appRoot,'plugin'), sourceManifest=JSON.parse(await readFile(join(source,'.codex-plugin/plugin.json'),'utf8'));
  if(sourceManifest.name!==pluginName || sourceManifest.version!=='1.0.0') throw new Error('插件版本或身份不匹配。');
  const files=await hashes(source), state=await preflight(home);
  await mkdir(dirname(state.target),{recursive:true}); await noLinks(state.target);
  const staged=join(dirname(state.target),'.ai-canvas-new-'+randomUUID());
  await cp(source,staged,{recursive:true,errorOnExist:true,force:false});
  await writeFile(join(staged,ownerFile),JSON.stringify({packageId,plugin:pluginName,appRoot,files},null,2)+'\n',{flag:'wx'});
  const backup=state.target+'.backup-'+randomUUID(); let moved=false;
  if(await exists(state.target)) { await rename(state.target,backup); moved=true; }
  try {
    await rename(staged,state.target);
    const entry={name:pluginName,source:{source:'local',path:'./plugins/'+pluginName},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'};
    const index=state.value.plugins.findIndex(x=>x.name===pluginName);
    if(index>=0) state.value.plugins[index]=entry; else state.value.plugins.push(entry);
    await replaceCatalog(state.catalog,state.before,state.value);
  } catch(error) {
    // Preserve every version. Restore the old source without recursive deletion.
    if(await exists(state.target)) await rename(state.target,state.target+'.incomplete-'+randomUUID());
    if(moved) await rename(backup,state.target);
    throw error;
  }
  return {registered:true,plugin:pluginName,version:sourceManifest.version};
}
export async function unregister(appRoot,home) {
  const state=await preflight(home,appRoot);
  const index=state.value.plugins.findIndex(x=>x.name===pluginName);
  if(index<0) return {removed:false};
  if(!await exists(join(state.target,ownerFile))) throw new Error('没有本安装包的插件所有权记录，未清理。');
  state.value.plugins.splice(index,1);
  await replaceCatalog(state.catalog,state.before,state.value);
  // Retain the source and backups as user-local files; Codex manages its own cache.
  return {removed:true,sourceRetained:true};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [action,appRoot,report]=process.argv.slice(2);
  try {
    let result;
    if(report && !isAbsolute(report)) throw new Error('检查报告路径必须为绝对路径。');
    if(action==='preflight' && [3,5].includes(process.argv.length)) result=await preflight(homedir());
    else if(action==='register' && [4,5].includes(process.argv.length) && isAbsolute(appRoot)) result=await register(appRoot,homedir());
    else if(action==='unregister' && [4,5].includes(process.argv.length) && isAbsolute(appRoot)) result=await unregister(appRoot,homedir());
    else throw new Error('不支持的插件安装操作。');
    if(report) await writeFile(report,'','utf8');
    console.log(JSON.stringify({ok:true,registered:result.registered,removed:result.removed}));
  } catch(error) { if(report && isAbsolute(report)) await writeFile(report,error.message,'utf8'); console.error(error.message); process.exitCode=1; }
}
