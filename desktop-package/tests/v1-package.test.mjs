import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,cp,readdir,symlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {preflight,register,unregister,pluginName} from '../plugin-install.mjs';
import {rasterMask} from '../plugin/ai-canvas-native-trial/skills/canvas-visual-execution/scripts/make-mask.mjs';

const base=resolve('temp/ai-canvas-v1-unified-20260929/tests');await mkdir(base,{recursive:true});
async function fixture(){const dir=await mkdtemp(join(base,'case-'));const home=join(dir,'home'),app=join(dir,'app');await mkdir(home);await mkdir(app);await cp(resolve('desktop-package/plugin/ai-canvas-native-trial'),join(app,'plugin'),{recursive:true});await writeFile(join(app,'installed-package.json'),JSON.stringify({id:'ai-canvas-desktop-test',port:43129}));return {dir,home,app,catalog:join(home,'.agents/plugins/marketplace.json')};}
test('fresh plugin registration and repeated update preserve one source',async()=>{
 const f=await fixture();await register(f.app,f.home);await register(f.app,f.home);
 const catalog=JSON.parse(await readFile(f.catalog));assert.equal(catalog.plugins.length,1);assert.equal(catalog.plugins[0].name,pluginName);
 assert.equal(JSON.parse(await readFile(join(f.home,'plugins',pluginName,'.codex-plugin/plugin.json'))).interface.displayName,'AI Canvas');
});
test('foreign catalog metadata and plugins survive register/unregister',async()=>{
 const f=await fixture();await mkdir(join(f.home,'.agents/plugins'),{recursive:true});
 const other={name:'other',source:{source:'local',path:'./plugins/other'}};
 await writeFile(f.catalog,JSON.stringify({name:'mine',interface:{displayName:'My plugins'},plugins:[other],extra:42}));
 await register(f.app,f.home);await unregister(f.app,f.home);const c=JSON.parse(await readFile(f.catalog));assert.deepEqual(c.plugins,[other]);assert.equal(c.extra,42);assert.equal(c.name,'mine');assert.equal(c.interface.displayName,'My plugins');
 assert.ok((await readdir(join(f.home,'plugins',pluginName))).length>0,'source retained, no cache deletion');
});
test('unknown same-name source and modified owned files are never overwritten',async()=>{
 const f=await fixture();const target=join(f.home,'plugins',pluginName);await mkdir(target,{recursive:true});await writeFile(join(target,'user.txt'),'preserve');
 await assert.rejects(register(f.app,f.home));assert.equal(await readFile(join(target,'user.txt'),'utf8'),'preserve');
 const g=await fixture();await register(g.app,g.home);const script=join(g.home,'plugins',pluginName,'scripts/launch-reader.ps1');await writeFile(script,'user edit');const before=await readFile(g.catalog,'utf8');
 await assert.rejects(register(g.app,g.home));await assert.rejects(unregister(g.app,g.home));assert.equal(await readFile(script,'utf8'),'user edit');assert.equal(await readFile(g.catalog,'utf8'),before);
});
test('verified trial source upgrades without a second identity',async()=>{
 const f=await fixture();const source=resolve('working/canvas-plugin-native-trial-20260929/bundle/plugins/ai-canvas-native-trial');await cp(source,join(f.home,'plugins',pluginName),{recursive:true});
 await register(f.app,f.home);const c=JSON.parse(await readFile(f.catalog));assert.equal(c.plugins.length,1);assert.equal(c.plugins[0].name,pluginName);
});
test('catalog conflicts and path links stop before mutation',async()=>{
 const f=await fixture();await mkdir(join(f.home,'.agents/plugins'),{recursive:true});const text=JSON.stringify({name:'personal',plugins:[{name:pluginName,source:{source:'local',path:'./other'}}]});await writeFile(f.catalog,text);
 await assert.rejects(preflight(f.home));assert.equal(await readFile(f.catalog,'utf8'),text);
 const g=await fixture();await mkdir(join(g.home,'plugins'));await symlink(g.app,join(g.home,'plugins',pluginName),'junction');await assert.rejects(register(g.app,g.home));
});
test('rectangle, path, multiple selections and source-domain intersection',()=>{
 const rectangle={type:'rectangle',points:[{x:.1,y:.1},{x:.5,y:.1},{x:.5,y:.5},{x:.1,y:.5}]};
 const first=rasterMask([rectangle],10,10);assert.equal(first.counts[0].selectedPixels,16);assert.equal(first.mask[11],1);assert.equal(first.mask[55],0);
 const triangle={type:'path',points:[{x:.6,y:.6},{x:.9,y:.6},{x:.6,y:.9}]};const union=rasterMask([rectangle,triangle],10,10);assert.equal(union.counts.length,2);assert.ok(union.counts[1].selectedPixels>0);assert.equal(union.mask[99],0);
 const clipped=rasterMask([{type:'rectangle',points:[{x:-.2,y:-.2},{x:.2,y:-.2},{x:.2,y:.2},{x:-.2,y:.2}]}],10,10);assert.equal(clipped.counts[0].selectedPixels,4);
});
test('ellipses use ordered axes and preserve rotation',()=>{
 const ellipse={type:'ellipse',points:[{x:.2,y:.2},{x:.8,y:.8}]};const m=rasterMask([ellipse],10,10).mask;assert.equal(m[55],1);assert.equal(m[22],0);
 const rotated={type:'ellipse',points:[{x:.5,y:.1},{x:.9,y:.5},{x:.5,y:.9},{x:.1,y:.5}]};const r=rasterMask([rotated],20,20).mask;assert.equal(r[10*20+10],1);assert.equal(r[2*20+10],0);
});
test('missing, ambiguous and zero-area geometry fail closed',()=>{
 for(const g of [[],[{type:'unknown',points:[]}],[{type:'path',points:[{x:0,y:0},{x:NaN,y:1},{x:1,y:0}]}],[{type:'ellipse',points:[{x:.2,y:.2},{x:.2,y:.2}]}]])assert.throws(()=>rasterMask(g,10,10));
 assert.throws(()=>rasterMask([{type:'path',points:[{x:2,y:2},{x:3,y:2},{x:2,y:3}]}],10,10));
});
