// Character review sheet: node scripts/art/character-review.mjs [atlasDir] [out.png] [zoom]
// Composes sample looks from the baked character layers (multiply tint, like Pixi) in every pose and both facings.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? 'public/art/vw3');
const out = process.argv[3] ?? 'tmp-art-preview/_characters.png';
const zoom = Number(process.argv[4] ?? 3);
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
const sheets = manifest.characters.sheets.map((s) => ({ data: JSON.parse(readFileSync(join(dir, s.file), 'utf8')), image: `data:image/webp;base64,${readFileSync(join(dir, s.image)).toString('base64')}` }));
const order = manifest.characters.order;
// Sample looks: [skin, hair, outfit, legs, shoes, hairStyle, outfitKind, accessory]
const pick = process.argv[6] ? process.argv[6].split(',').map(Number) : null;
const allLooks = [
  [0xeec19b, 0x5a3a28, 0xc8714f, 0x3d4f66, 0xf3efe6, 'short', 'tee', 'none'],
  [0xd9a174, 0x2b1f1a, 0x5fa7a8, 0xd9a174, 0xc8714f, 'long', 'dress', 'sunhat'],
  [0x8c5a3a, 0x2b1f1a, 0xd5a33f, 0x4a4440, 0x3a3532, 'curly', 'jacket', 'glasses'],
  [0xf6d7bd, 0xe3c27a, 0x7f9f6f, 0x7f9f6f, 0xf3efe6, 'bun', 'overalls', 'backpack'],
  [0xb87a50, 0xb14a3a, 0x3f5d7a, 0x3d4f66, 0xe8e2d6, 'cap', 'hoodie', 'scarf'],
  [0x5e3b26, 0x9a9a96, 0xa2475e, 0x34495e, 0xf3efe6, 'buzz', 'tee', 'none'],
];
const looks = pick ? pick.map((i) => allLooks[i]) : allLooks;
const html = `<!doctype html><body style="margin:0;background:#a8c48f"><canvas id=c></canvas><script>
const sheets=${JSON.stringify(sheets.map((s) => ({ frames: s.data.frames })))}, images=${JSON.stringify(sheets.map((s) => s.image))};
const order=${JSON.stringify(order)}, looks=${JSON.stringify(looks)};
const CREAM=0xf4ecdc;
function layers(l, facing, pose){const [skin,hair,outfit,legs,shoes,hs,of,acc]=l;
 const sleeve=of==='tee'||of==='overalls'?'short':of==='jacket'||of==='hoodie'?'long':null;
 const torso=of==='overalls'||of==='jacket'?'shirt':of; const overlay=of==='overalls'?'overalls':of==='jacket'?'jacket':null;
 const list=pose==='sit'&&facing==='front'?order.sitFront:order[facing]; const r=[];
 for(const slot of list){const [n,side='-']=slot.split(':');
  if(n==='armSkin')r.push(['armSkin','base',side,skin]); if(n==='sleeve'&&sleeve)r.push(['sleeve',sleeve,side,of==='overalls'?CREAM:outfit]);
  if(n==='legs')r.push(['legs',of==='dress'?'bare':'pants',side,legs]); if(n==='shoes')r.push(['shoes','sneaker',side,shoes]);
  if(n==='torso')r.push(['torso',torso,'-',torso==='shirt'?CREAM:outfit]); if(n==='overlay'&&overlay)r.push(['torso',overlay,'-',outfit]);
  if(n==='head')r.push(['head','base','-',skin]); if(n==='face')r.push(['face','base','-',null]); if(n==='hair')r.push(['hair',hs,'-',hair]);
  if(n==='hairLong'&&hs==='long')r.push(['hairLong','long','-',hair]); if(n==='cap'&&hs==='cap')r.push(['cap','base','-',0x3f5d7a]);
  if(n==='glasses'&&acc==='glasses')r.push(['glasses','base','-',null]); if(n==='sunhat'&&acc==='sunhat')r.push(['sunhat','base','-',null]);
  if(n==='scarf'&&acc==='scarf')r.push(['scarf','base','-',0xe0b45a]); if(n==='backpack'&&acc==='backpack')r.push(['backpack','base','-',null]);}
 return r;}
(async()=>{const imgs=await Promise.all(images.map(src=>new Promise(res=>{const i=new Image();i.onload=()=>res(i);i.src=src;})));
 const find=(name)=>{for(let k=0;k<sheets.length;k++){const f=sheets[k].frames[name];if(f)return[imgs[k],f];}return null;};
 const poses=[['idle',0],['walk',0],['walk',2],['walk',4],['walk',6],['wave',1],['talk',1],['sit',0]];
 const K=${Number(process.argv[5] ?? 0.75)},cw=150*K,ch=240*K,c=document.getElementById('c');c.width=cw*poses.length*2+20;c.height=ch*looks.length+20;const ctx=c.getContext('2d');
 const tmp=document.createElement('canvas');tmp.width=cw*2;tmp.height=ch*2;const t=tmp.getContext('2d');
 looks.forEach((l,row)=>{['front','back'].forEach((facing,fi)=>poses.forEach(([pose,frame],pi)=>{
  const ox=10+(fi*poses.length+pi)*cw+cw/2, oy=10+row*ch+ch-12;
  ctx.fillStyle='rgba(20,34,26,.3)';ctx.beginPath();ctx.ellipse(ox,oy,36,15,0,0,7);ctx.fill();
  for(const [layer,variant,side,tint] of layers(l,facing,pose)){const hit=find('ch:'+layer+':'+variant+':'+side+':'+facing+':'+pose+':'+frame);if(!hit)continue;
   const [img,f]=hit;const w=f.frame.w*K,h=f.frame.h*K;const x=ox-f.anchor.x*w,y=oy-f.anchor.y*h;
   t.clearRect(0,0,tmp.width,tmp.height);t.globalCompositeOperation='source-over';t.drawImage(img,f.frame.x,f.frame.y,f.frame.w,f.frame.h,0,0,w,h);
   if(tint!==null){t.globalCompositeOperation='multiply';t.fillStyle='#'+tint.toString(16).padStart(6,'0');t.fillRect(0,0,w,h);t.globalCompositeOperation='destination-in';t.drawImage(img,f.frame.x,f.frame.y,f.frame.w,f.frame.h,0,0,w,h);}
   ctx.drawImage(tmp,0,0,w,h,x,y,w,h);}}));});
 document.body.dataset.done='1';})();
</script>`;
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: zoom });
await page.setContent(html);
await page.waitForFunction(() => document.body.dataset.done === '1');
await page.locator('#c').screenshot({ path: out });
await browser.close();
console.log('character sheet', out);
