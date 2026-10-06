import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {deflateSync,crc32} from 'node:zlib';

export function rasterMask(geometry,width,height) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>40_000_000)throw new Error('Invalid or oversized source dimensions');
  const selections=Array.isArray(geometry)?geometry:geometry.selections;
  if(!Array.isArray(selections)||!selections.length)throw new Error('Complete selection geometry is required');
  const mask=new Uint8Array(width*height),counts=[];
  for(const s of selections) {
    if(!['rectangle','ellipse','path'].includes(s.type))throw new Error('Explicit supported selection type required');
    const raw=s.points??s.normalizedCorners;
    if(!Array.isArray(raw)||raw.length>10000)throw new Error('Invalid point list');
    let p=raw.map(q=>{if(typeof q.x!=='number'||typeof q.y!=='number'||!Number.isFinite(q.x)||!Number.isFinite(q.y))throw new Error('Invalid normalized source-image point');return {x:q.x*width,y:q.y*height};});
    let ellipse;
    if(s.type==='ellipse') {
      if(p.length===2)p=[p[0],{x:p[1].x,y:p[0].y},p[1],{x:p[0].x,y:p[1].y}];
      if(p.length!==4)throw new Error('Ellipse requires two diagonal corners or four ordered affine corners');
      const a={x:(p[1].x-p[0].x)/2,y:(p[1].y-p[0].y)/2},b={x:(p[3].x-p[0].x)/2,y:(p[3].y-p[0].y)/2};
      const det=a.x*b.y-a.y*b.x;
      if(Math.abs(det)<1e-10||Math.hypot(p[2].x-p[0].x-2*a.x-2*b.x,p[2].y-p[0].y-2*a.y-2*b.y)>1e-5)throw new Error('Degenerate or ambiguous ellipse geometry');
      ellipse={a,b,det,c:{x:p[0].x+a.x+b.x,y:p[0].y+a.y+b.y}};
    } else if(p.length<(s.type==='rectangle'?4:3)||(s.type==='rectangle'&&p.length!==4))throw new Error('Incomplete polygon geometry');
    const area=p.reduce((sum,q,i)=>{const n=p[(i+1)%p.length];return sum+q.x*n.y-n.x*q.y;},0);
    if(Math.abs(area)<1e-10)throw new Error('Degenerate selection');
    const minX=Math.max(0,Math.floor(Math.min(...p.map(q=>q.x)))),maxX=Math.min(width-1,Math.ceil(Math.max(...p.map(q=>q.x))));
    const minY=Math.max(0,Math.floor(Math.min(...p.map(q=>q.y)))),maxY=Math.min(height-1,Math.ceil(Math.max(...p.map(q=>q.y))));
    let selected=0;
    for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++) {
      let inside=false;
      if(ellipse) {
        const {a,b,c,det}=ellipse,dx=x-c.x,dy=y-c.y;
        inside=((dx*b.y-dy*b.x)/det)**2+((a.x*dy-a.y*dx)/det)**2<=1;
      } else for(let i=0,j=p.length-1;i<p.length;j=i++) {
        const a=p[i],b=p[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)inside=!inside;
      }
      if(inside){mask[y*width+x]=1;selected++;}
    }
    if(!selected)throw new Error('A selection has no source pixels; do not guess another boundary');
    counts.push({id:s.id??counts.length,selectedPixels:selected});
  }
  return {mask,counts};
}
export function encodeMask(mask,width,height) {
  const raw=Buffer.alloc((width*4+1)*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*(width*4+1)+1+x*4;raw[i]=raw[i+1]=raw[i+2]=mask[y*width+x]?255:0;raw[i+3]=255;}
  const chunk=(name,data)=>{const type=Buffer.from(name),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);type.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc32(Buffer.concat([type,data])),data.length+8);return out;};
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [input,output,w,h]=process.argv.slice(2),width=Number(w),height=Number(h);
  if(!input||!output||!output.toLowerCase().endsWith('.png')||resolve(input)===resolve(output))throw new Error('Use geometry.json new-mask.png source-width source-height');
  const result=rasterMask(JSON.parse(await readFile(input,'utf8')),width,height);
  await writeFile(output,encodeMask(result.mask,width,height),{flag:'wx'});
  console.log(JSON.stringify({width,height,selections:result.counts,selectedPixels:result.mask.reduce((a,b)=>a+b,0),sampling:'source integer pixel grid; polygon even-odd; source-domain intersection'}));
}
