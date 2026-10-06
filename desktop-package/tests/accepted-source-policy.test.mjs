import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { verifyAcceptedBase, verifyAcceptedSources } from '../accepted-source-policy.mjs';

async function fixture() {
  const parent=resolve('temp/release-1.0.4-build-027-20261005/source-policy-tests');await mkdir(parent,{recursive:true});
  const root=await mkdtemp(join(parent,'case-'));
  await mkdir(join(root,'src'));await mkdir(join(root,'webview-host/AiCanvas.WebViewHost'),{recursive:true});
  await writeFile(join(root,'src/example.ts'),'accepted');
  return {root,approval:{schema:'ai-canvas-accepted-sources-v1',sources:[{path:'src/example.ts',sha256:createHash('sha256').update('accepted').digest('hex')}]}};
}
test('records an exact accepted input',async()=>{const {root,approval}=await fixture();assert.deepEqual(Object.keys(await verifyAcceptedSources(root,approval)),['src/example.ts']);});
test('rejects changed bytes',async()=>{const {root,approval}=await fixture();await writeFile(join(root,'src/example.ts'),'changed');await assert.rejects(verifyAcceptedSources(root,approval),/mismatch/);});
test('rejects a missing accepted input',async()=>{const {root,approval}=await fixture();await unlink(join(root,'src/example.ts'));await assert.rejects(verifyAcceptedSources(root,approval));});
test('rejects an added untracked production input',async()=>{const {root,approval}=await fixture();await writeFile(join(root,'src/extra.ts'),'extra');await assert.rejects(verifyAcceptedSources(root,approval),/Unapproved/);});
test('rejects traversal and duplicates before reading',async()=>{const {root,approval}=await fixture();approval.sources.push({...approval.sources[0]});await assert.rejects(verifyAcceptedSources(root,approval),/duplicate/);approval.sources=[{...approval.sources[0],path:'src/../../outside'}];await assert.rejects(verifyAcceptedSources(root,approval),/Invalid/);});

test('accepted inputs remain usable after committing without relaxing their hashes',async()=>{
  const {root,approval}=await fixture();
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
  git('init','--quiet');
  const commit=()=>git('-c','user.name=Source gate test','-c','user.email=source-gate@example.invalid','-c','commit.gpgsign=false','commit','--allow-empty','--quiet','-m','test');
  commit();approval.productBase=git('rev-parse','HEAD');approval.releaseVersion='1.0.4';
  verifyAcceptedBase(root,approval,'1.0.4');
  commit();verifyAcceptedBase(root,approval,'1.0.4');
  await verifyAcceptedSources(root,approval);
  await writeFile(join(root,'src/example.ts'),'unapproved');
  await assert.rejects(verifyAcceptedSources(root,approval),/mismatch/);
  assert.throws(()=>verifyAcceptedBase(root,approval,'1.0.5'),/mismatch/);
  const newer=git('rev-parse','HEAD');git('checkout','--detach','--quiet',approval.productBase);
  assert.throws(()=>verifyAcceptedBase(root,{...approval,productBase:newer},'1.0.4'),/history/);
});
