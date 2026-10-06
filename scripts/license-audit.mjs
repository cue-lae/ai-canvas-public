import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root=process.cwd();
const entries=JSON.parse(await readFile(resolve(root,'third-party-licenses/INDEX.json'),'utf8'));
const fonts=JSON.parse(await readFile(resolve(root,'third-party-licenses/fonts/INDEX.json'),'utf8'));
const groups={};for(const x of entries){const key=typeof x.license==='string'?x.license:'see-original-notice';groups[key]=(groups[key]??0)+1;}
console.log(JSON.stringify({basis:'bundled over-inclusive notices; not a production-only SBOM or a compatibility approval',groups,fontEvidence:fonts,projectLicenseSelected:false},null,2));
