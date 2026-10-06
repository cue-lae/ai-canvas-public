"""Isolated image-tool verification; never calls a model or a live Canvas."""
from pathlib import Path
from PIL import Image
import json, subprocess, sys, uuid

root = Path.cwd()
node, tool = sys.argv[1:3]
run = root / 'temp/ai-canvas-v1-unified-20260929/tests' / ('images-' + uuid.uuid4().hex)
run.mkdir(parents=True)
mask_tool = root / 'desktop-package/plugin/ai-canvas-native-trial/skills/canvas-visual-execution/scripts/make-mask.mjs'
source = Image.new('RGBA', (24, 16))
for y in range(16):
    for x in range(24): source.putpixel((x,y),(30+x*4,40+y*5,80,(0,127,255)[(x+y)%3]))
source.save(run/'source.png')
Image.new('RGBA',(12,8),(200,50,30,180)).save(run/'candidate.png')
geometry={'selections':[{'type':'rectangle','points':[{'x':.25,'y':.25},{'x':.75,'y':.25},{'x':.75,'y':.75},{'x':.25,'y':.75}]}]}
(run/'geometry.json').write_text(json.dumps(geometry),encoding='utf-8')
subprocess.run([node,str(mask_tool),str(run/'geometry.json'),str(run/'mask.png'),'24','16'],check=True,capture_output=True)
mask=Image.open(run/'mask.png').convert('RGBA')
checks=[]
def execute(args,ok=True):
    r=subprocess.run([tool,*map(str,args)],capture_output=True,timeout=15)
    if ok: assert r.returncode==0,r.stderr.decode(errors='replace')
    else: assert r.returncode!=0
    return r
def verify(name):
    result=Image.open(run/name).convert('RGBA')
    assert result.size==source.size
    outside=0;changed=0
    for y in range(16):
        for x in range(24):
            if mask.getpixel((x,y))[0]==0:
                outside+=source.getpixel((x,y))!=result.getpixel((x,y))
            else: changed+=source.getpixel((x,y))!=result.getpixel((x,y))
    assert outside==0,(name,outside)
    assert changed>0,name
    checks.append(name+': exact outside RGBA and changed selected pixels')
execute(['composite',run/'source.png',run/'candidate.png',run/'mask.png',run/'composite.png']);verify('composite.png')
execute(['tint',run/'source.png',run/'mask.png','408080',run/'tint.png']);verify('tint.png')
mapping={'normalizedCorners':geometry['selections'][0]['points']}
(run/'mapping.json').write_text(json.dumps(mapping),encoding='utf-8')
execute(['material',run/'source.png',run/'candidate.png',run/'mask.png',run/'mapping.json',run/'material.png']);verify('material.png')
execute(['composite',run/'source.png',run/'candidate.png',run/'mask.png',run/'composite.png'],False);checks.append('existing output not overwritten')
execute(['tint',run/'source.png',run/'mask.png','408080',run/'source.png'],False);checks.append('original not overwritten')
Image.new('RGBA',(5,5),(255,255,255,255)).save(run/'wrong-mask.png')
execute(['composite',run/'source.png',run/'candidate.png',run/'wrong-mask.png',run/'bad.png'],False);checks.append('mask dimensions rejected')
Image.new('RGBA',(24,16),(100,100,100,255)).save(run/'soft-mask.png')
execute(['composite',run/'source.png',run/'candidate.png',run/'soft-mask.png',run/'bad-soft.png'],False);checks.append('non-binary mask rejected')
source.convert('RGB').save(run/'source.jpg')
assert json.loads(execute(['info',run/'source.jpg']).stdout)['width']==24;checks.append('JPEG decoded')
exif=Image.Exif();exif[274]=6;source.convert('RGB').save(run/'rotated.jpg',exif=exif)
execute(['info',run/'rotated.jpg'],False);checks.append('ambiguous EXIF orientation rejected')
result={'checks':len(checks),'passed':True,'details':checks,'realImageGeneration':False}
(run/'result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False))
