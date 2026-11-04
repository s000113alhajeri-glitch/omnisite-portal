# 3D twin sample (Chemex)

Scene used for the standalone sample.

## `scene.js`

```javascript
const T=THREE;
const R=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
R.setPixelRatio(Math.min(devicePixelRatio,2));R.shadowMap.enabled=true;R.shadowMap.type=T.PCFSoftShadowMap;
R.toneMapping=T.ACESFilmicToneMapping;R.toneMappingExposure=0.82;R.outputEncoding=T.sRGBEncoding;
document.getElementById('v').appendChild(R.domElement);
const S=new T.Scene();S.background=new T.Color(0xb9c2c9);S.fog=new T.Fog(0xb9c2c9,45,90);
S.environment=new T.PMREMGenerator(R).fromScene(new T.RoomEnvironment(),0.04).texture;S.background=new T.Color(0x9aa3ab);
const C=new T.PerspectiveCamera(42,1,0.1,200);
const O=new T.OrbitControls(C,R.domElement);O.enableDamping=true;O.maxPolarAngle=Math.PI*0.495;O.minDistance=2;O.maxDistance=60;
const HL=24,HD=14,HH=7;
S.add(new T.HemisphereLight(0xffffff,0x6b5d48,0.35));
const sun=new T.DirectionalLight(0xfff3e0,1.5);sun.position.set(20,22,10);sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-18,right:18,top:14,bottom:-14,near:1,far:70});sun.shadow.bias=-0.0004;
sun.target.position.set(HL/2,0,HD/2);S.add(sun,sun.target);
function tex(w,h,f,rx,ry){const c=document.createElement('canvas');c.width=w;c.height=h;f(c.getContext('2d'),w,h);const t=new T.CanvasTexture(c);t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(rx,ry);t.encoding=T.sRGBEncoding;t.anisotropy=8;return t}
function noise(g,w,h,base,n,a){g.fillStyle=base;g.fillRect(0,0,w,h);for(let i=0;i<n;i++){const v=Math.random()*60-30|0;g.fillStyle=`rgba(${v>0?255:0},${v>0?255:0},${v>0?255:0},${Math.abs(v)/255*a})`;g.fillRect(Math.random()*w,Math.random()*h,1+Math.random()*3,1+Math.random()*3)}}
const floorT=tex(512,512,(g,w,h)=>{noise(g,w,h,'#7f786b',12000,1.6);for(let i=0;i<14;i++){g.fillStyle=`rgba(70,55,35,${Math.random()*0.12})`;g.beginPath();g.ellipse(Math.random()*w,Math.random()*h,20+Math.random()*80,10+Math.random()*40,Math.random()*3,0,7);g.fill()}g.strokeStyle='rgba(60,55,45,.35)';g.lineWidth=2;g.strokeRect(0,0,w,h)},6,3.5);
const wallT=tex(256,256,(g,w,h)=>noise(g,w,h,'#c9a24e',6000,1.6),10,1.2);
const corrT=tex(256,64,(g,w,h)=>{for(let x=0;x<w;x++){const v=200+40*Math.sin(x/w*Math.PI*16);g.fillStyle=`rgb(${v-8},${v-4},${v})`;g.fillRect(x,0,1,h)}},14,1);
const M=(c,m=0,r=0.6,o={})=>new T.MeshStandardMaterial(Object.assign({color:c,metalness:m,roughness:r},o));
const steel=M(0xb8bfc6,1,0.18,{envMapIntensity:0.9}),brushed=M(0xa9b0b6,1,0.34,{envMapIntensity:0.8}),dark=M(0x3a3f44,0.4,0.5),teal=M(0x2f7f86,0.3,0.45),grey=M(0x8f9599,0.5,0.45),
red=M(0x8b2f1c,0.4,0.55),blue=M(0x1f5fbf,0.1,0.45),white=M(0xf2f2ee,0,0.35),pink=M(0xd9468f,0,0.5),black=M(0x1b1d20,0.2,0.6),
glass=new T.MeshPhysicalMaterial({color:0xddeeff,metalness:0,roughness:0.05,transparent:true,opacity:0.22,side:T.DoubleSide}),
yellow=M(0xf0b82a,0.2,0.5),green=M(0x2fa84f,0.1,0.4);
function mesh(g,m,x=0,y=0,z=0,p=S){const o=new T.Mesh(g,m);o.position.set(x,y,z);o.castShadow=o.receiveShadow=true;p.add(o);return o}
const box=(w,h,d,m,x,y,z,p)=>mesh(new T.BoxGeometry(w,h,d),m,x,y+h/2,z,p);
const cyl=(r1,r2,h,m,x,y,z,p,s=40)=>mesh(new T.CylinderGeometry(r1,r2,h,s),m,x,y+h/2,z,p);
function pipe(pts,r,m,p=S){const c=new T.CatmullRomCurve3(pts.map(a=>new T.Vector3(...a)),false,'catmullrom',0.08);return mesh(new T.TubeGeometry(c,64,r,12),m,0,0,0,p)}
// hall
const fl=mesh(new T.PlaneGeometry(HL,HD),M(0xffffff,0,0.85,{map:floorT}),HL/2,0,HD/2);fl.rotation.x=-Math.PI/2;fl.castShadow=false;
function wall(len,x,z,ry){const g=new T.Group();g.position.set(x,0,z);g.rotation.y=ry;S.add(g);
 const a=mesh(new T.PlaneGeometry(len,2.6),M(0xffffff,0,0.95,{map:wallT}),len/2,1.3,0,g);a.castShadow=false;
 const b=mesh(new T.PlaneGeometry(len,HH-2.6),M(0xffffff,0.3,0.6,{map:corrT}),len/2,2.6+(HH-2.6)/2,0,g);b.castShadow=false;
 box(len,0.08,0.35,grey,len/2,3.2,0.2,g);for(let i=0;i<4;i++)pipe([[0,3.32,0.12+i*0.06],[len,3.32,0.12+i*0.06]],0.018,black,g);}
wall(HL,0,0,0);wall(HD,0,HD,Math.PI/2);wall(HD,HL,0,-Math.PI/2);
for(let x=0;x<=HL;x+=6){box(0.3,HH,0.3,red,x,0,0.15);box(0.3,HH,0.3,red,x,0,HD-0.15);
 const tr=box(0.14,0.22,HD,red,x,HH-0.25,HD/2);tr.castShadow=false;}
for(let x=3;x<HL;x+=6)for(let z=3.5;z<HD;z+=7){cyl(0.18,0.25,0.15,M(0x444444,0.5,0.4,{emissive:0xfff6dd,emissiveIntensity:0.9}),x,HH-0.6,z);const pl=new T.PointLight(0xfff1d6,0.25,14);pl.position.set(x,HH-1.2,z);S.add(pl)}
// big door on front wall area (open side indicator) + lab room
box(4,4.2,0.1,M(0xb7bcc0,0.6,0.4),20,0,HD-0.06);
const lab=new T.Group();S.add(lab);const lw=M(0xe9e4d6,0,0.8);box(5,1,0.1,lw,4.5,0,HD-3.2,lab);box(0.1,1,3.1,lw,2,0,HD-1.65,lab);mesh(new T.PlaneGeometry(5,1.6),glass,4.5,1.8,HD-3.2,lab);mesh(new T.PlaneGeometry(3.1,1.6),glass,2,1.8,HD-1.65,lab).rotation.y=Math.PI/2;box(5,0.08,0.12,grey,4.5,2.6,HD-3.2,lab);
box(1,2.2,0.06,white,5.5,0,HD-3.28,lab);box(0.7,0.25,0.03,M(0xc62828,0,0.5),5.5,2.4,HD-3.3,lab);
// A1 corner
cyl(0.08,0.08,0.02,M(0xe53935,0,0.4,{emissive:0xe53935,emissiveIntensity:0.6}),0.35,0.001,0.35,S);
// ---------- equipment builders
function g0(x,z,ry=0){const g=new T.Group();g.position.set(x,0,z);g.rotation.y=ry;S.add(g);return g}
function motor(p,x,y,z,s=1,col=teal){const m=new T.Group();m.position.set(x,y,z);m.scale.setScalar(s);p.add(m);
 cyl(0.16,0.16,0.3,grey,0,0,0,m);cyl(0.2,0.2,0.04,grey,0,0.3,0,m);cyl(0.17,0.17,0.42,col,0,0.34,0,m);
 for(let i=0;i<18;i++){const a=i/18*Math.PI*2;const f=box(0.02,0.38,0.05,col,Math.cos(a)*0.18,0.36,Math.sin(a)*0.18,m);f.rotation.y=-a}
 cyl(0.19,0.19,0.1,col,0,0.76,0,m);box(0.12,0.1,0.1,col,0.2,0.55,0,m);return m}
function tank(x,z,r,h,withMotor){const g=g0(x,z);
 cyl(r,r,h,steel,0,0,0,g,64);const top=mesh(new T.SphereGeometry(r,64,16,0,Math.PI*2,0,Math.PI/2),steel,0,h,0,g);top.scale.y=0.12;
 mesh(new T.TorusGeometry(r*0.36,0.025,10,48),pink,r*0.38,h+0.1,0.1,g).rotation.x=Math.PI/2;
 const lid=mesh(new T.SphereGeometry(r*0.36,40,10,0,Math.PI*2,0,Math.PI/2),brushed,r*0.38,h+0.1,0.1,g);lid.scale.y=0.25;
 box(r*0.75,0.03,0.04,grey,r*0.38,h+0.18,0.1,g);
 mesh(new T.TorusGeometry(r,0.03,10,64),brushed,0,0.03,0,g).rotation.x=Math.PI/2;
 if(withMotor){for(let i=0;i<4;i++){const a=i*Math.PI/2+0.4;const pl=box(0.02,0.35,0.3,brushed,Math.cos(a)*0.12,h+0.08,Math.sin(a)*0.12,g);pl.rotation.y=-a}
  cyl(0.1,0.1,0.35,brushed,0,h+0.08,0,g);cyl(0.2,0.2,0.05,pink,0,h+0.42,0,g);box(0.28,0.3,0.28,grey,0,h+0.47,0,g);motor(g,0,h+0.77,0,1);
  pipe([[-0.55*r,h+0.1,-0.4*r],[-0.6*r,h+0.6,-0.45*r],[-0.2*r,h+0.75,-0.55*r],[0.25*r,h+0.6,-0.55*r],[0.3*r,h+0.1,-0.5*r]],0.035,steel,g);
  pipe([[-0.7*r,h+0.1,0.3*r],[-0.75*r,h+0.9,0.35*r],[-0.75*r,2.9,-r-0.4],[-0.75*r,2.9,-r-1.5]],0.035,steel,g);}
 pipe([[r*0.8,0.25,0],[r+0.25,0.25,0],[r+0.35,0.12,0.6]],0.04,steel,g);return g}
function conveyor(p,x0,x1,z,y=0.85){const L=x1-x0;box(L,0.06,0.32,brushed,x0+L/2,y,z,p);box(L,0.12,0.03,steel,x0+L/2,y,z-0.17,p);box(L,0.12,0.03,steel,x0+L/2,y,z+0.17,p);
 for(let x=x0+0.3;x<x1;x+=1.2){box(0.04,y,0.04,brushed,x,0,z-0.14,p);box(0.04,y,0.04,brushed,x,0,z+0.14,p)}
 for(let x=x0+0.15;x<x1-0.1;x+=0.32){cyl(0.06,0.065,0.24,white,x,y+0.06,z,p,20);cyl(0.025,0.025,0.04,blue,x,y+0.3,z,p,12)}}
function filler(x,z,n,w=2.2){const g=g0(x,z);box(w,0.75,1.1,brushed,0,0,0,g);box(w,0.03,1.1,steel,0,0.75,0,g);
 for(const sx of[-1,1])for(const sz of[-1,1])box(0.06,1.3,0.06,steel,sx*(w/2-0.03),0.78,sz*0.52,g);box(w,0.08,1.1,steel,0,2.08,0,g);
 for(const sz of[-1,1])mesh(new T.PlaneGeometry(w-0.1,1.25),glass,0,1.43,sz*0.53,g);for(const sx of[-1,1]){const q=mesh(new T.PlaneGeometry(1.0,1.25),glass,sx*(w/2-0.01),1.43,0,g);q.rotation.y=Math.PI/2}
 const sp=(w-0.5)/(n-1);for(let i=0;i<n;i++){const xx=-w/2+0.25+i*sp;cyl(0.025,0.012,0.35,steel,xx,1.15,0,g,16);cyl(0.04,0.04,0.12,dark,xx,1.5,0,g,16);pipe([[xx,1.62,0],[xx,1.9,0],[0,2.3,0]],0.012,M(0xe8e8e8,0,0.2,{transparent:true,opacity:0.7}),g)}
 cyl(0.35,0.3,0.55,steel,0,2.16,0,g);box(0.35,0.5,0.12,grey,w/2+0.2,1.1,0.4,g);box(0.3,0.22,0.02,M(0x1e88e5,0,0.2,{emissive:0x0d47a1,emissiveIntensity:0.7}),w/2+0.2,1.3,0.47,g);return g}
function labeller(x,z){const g=g0(x,z);box(1.4,0.8,0.8,brushed,0,0,0,g);box(0.5,0.9,0.4,steel,0,0.8,-0.25,g);
 const rl=mesh(new T.CylinderGeometry(0.22,0.22,0.12,40),white,0,1.4,-0.22,g);rl.rotation.x=Math.PI/2;const rc=mesh(new T.CylinderGeometry(0.07,0.07,0.14,20),dark,0,1.4,-0.22,g);rc.rotation.x=Math.PI/2;
 box(0.6,0.08,0.08,grey,0.1,1.0,-0.02,g);box(0.3,0.25,0.06,M(0x1e88e5,0,0.2,{emissive:0x0d47a1,emissiveIntensity:0.6}),0.55,1.1,-0.1,g);return g}
function coder(x,z){const g=g0(x,z);box(0.5,0.6,0.42,M(0xf4f4f0,0.1,0.4),0,0.22,0,g);for(const sx of[-1,1])for(const sz of[-1,1])cyl(0.04,0.04,0.06,black,sx*0.2,0.06,sz*0.16,g,12);
 box(0.5,0.12,0.42,M(0x1565c0,0.1,0.4),0,0.82,0,g);box(0.22,0.15,0.02,M(0x90caf9,0,0.2,{emissive:0x1e88e5,emissiveIntensity:0.6}),0,0.6,0.22,g);
 pipe([[0,0.9,0],[0,1.3,0.3],[0,1.0,0.75]],0.02,black,g);box(0.08,0.08,0.2,dark,0,0.92,0.75,g);return g}
// ---------- the 15 Chemex items (example positions)
const items=[
 {n:'Mixing tank motor (Mixer 1)',b:'Brook Crompton Huddersfield UK',m:'B-DA112MA-D',k:'Machine',f:()=>{const g=tank(3,3.2,1.0,1.7,true);const p=new T.Group();p.position.set(4.4,0,4.6);S.add(p);box(0.06,1.3,0.06,grey,0,0,0,p);box(0.45,0.55,0.22,M(0xd4d7d9,0.3,0.4),0,1.3,0,p);cyl(0.035,0.035,0.04,green,-0.1,1.65,0.12,p,16).rotation.x=Math.PI/2;cyl(0.035,0.035,0.04,M(0xe53935,0,0.4),0.1,1.65,0.12,p,16).rotation.x=Math.PI/2;return g},s:'Tank Ø200 × 170 cm'},
 {n:'8 nozzle filling machine',b:'KWT Machine System Co',m:'KWT-880R',k:'Machine',f:()=>filler(6,7.5,8,2.4),s:'240 × 110 × 230 cm'},
 {n:'8 nozzle date coding printer',b:'Linx Printer',m:'8910IP55',k:'Machine',f:()=>coder(8.8,6.85),s:'50 × 42 × 95 cm'},
 {n:'8 nozzle labelling machine',b:'KWT Machine System Co',m:'KWT-620D-R',k:'Machine',f:()=>labeller(11,6.75),s:'140 × 80 × 165 cm'},
 {n:'4 nozzle filling machine',b:'KWT Machine System Co',m:'KWT-840R',k:'Machine',f:()=>filler(6,10.8,4,1.6),s:'160 × 110 × 230 cm'},
 {n:'4 nozzle date coding printer',b:'Linx Printer',m:'8910IP55',k:'Machine',f:()=>coder(8.6,10.15),s:'50 × 42 × 95 cm'},
 {n:'4 nozzle labelling machine',b:'KWT Machine System Co',m:'KWT-620D',k:'Machine',f:()=>labeller(10.6,10.05),s:'140 × 80 × 165 cm'},
 {n:'Bleach machine motor (pump)',b:'Taidel Pump',m:'MKK-P441-2CSSE',k:'Machine',f:()=>{const g=g0(16,4.2);box(0.9,0.12,0.45,grey,0,0,0,g);const mm=motor(g,-0.15,0.12,0,0.8,M(0x5b6670,0.4,0.45));mm.rotation.z=Math.PI/2;mm.position.set(0.2,0.3,0);cyl(0.16,0.16,0.18,brushed,0.38,0.12,0,g);tank(14.5,3.2,0.8,1.5,false);pipe([[15.3,0.25,3.2],[15.8,0.3,4.2],[16.4,0.3,4.2]],0.035,steel);pipe([[16.4,0.45,4.2],[16.6,0.9,6.4],[16.6,0.9,7.6]],0.03,M(0xffffff,0,0.4));return g},s:'90 × 45 × 45 cm'},
 {n:'Bleach filling machine',b:'Ideas Packaging Machinery',m:'SIM-4N-CXFS-92',k:'Machine',f:()=>filler(17,8.1,4,1.6),s:'160 × 110 × 230 cm'},
 {n:'Bleach labelling machine',b:'KWT Machine System Co',m:'KWT-515C',k:'Machine',f:()=>labeller(21.6,7.35),s:'140 × 80 × 165 cm'},
 {n:'Bleach date coding printer',b:'Linx Printer',m:'8910IP55',k:'Machine',f:()=>coder(19.6,7.45),s:'50 × 42 × 95 cm'},
 {n:'Air compressor',b:'Power King Pump',m:'LB-40A',k:'Machine',f:()=>{const g=g0(21.8,1.6);const t=mesh(new T.CylinderGeometry(0.3,0.3,1.4,40),M(0xc62828,0.3,0.4),0,0.5,0,g);t.rotation.z=Math.PI/2;for(const sx of[-0.5,0.5])box(0.08,0.2,0.5,dark,sx,0,0,g);box(0.9,0.05,0.5,dark,0,0.82,0,g);motor(g,0.25,0.85,0,0.6,M(0x37474f,0.4,0.5)).rotation.z=Math.PI/2;cyl(0.14,0.14,0.3,dark,-0.25,0.87,0,g);box(0.12,0.4,0.5,M(0xc62828,0.3,0.4),0,0.87,0.27,g);return g},s:'140 × 60 × 110 cm'},
 {n:'Viscometer',b:'Brookfield',m:'DV2TRVTJO',k:'Tool',f:()=>{const g=g0(3.2,HD-1.1);box(2.2,0.04,0.7,M(0xeceff1,0,0.3),0.4,0.88,0,g);for(const sx of[-0.6,1.4])for(const sz of[-0.3,0.3])box(0.04,0.88,0.04,grey,sx,0,sz,g);box(0.25,0.03,0.2,dark,0,0.92,0,g);cyl(0.015,0.015,0.45,steel,0,0.92,-0.06,g,10);box(0.22,0.16,0.18,M(0xfafafa,0,0.3),0,1.25,0,g);cyl(0.01,0.01,0.15,steel,0,1.1,0.03,g,8);return g},s:'25 × 20 × 50 cm'},
 {n:'pH / ORP meter',b:'Hanna',m:'HI2211',k:'Tool',f:()=>{const g=g0(4.0,HD-1.1);box(0.22,0.08,0.18,M(0x37474f,0,0.4),0,0.92,0,g);box(0.12,0.01,0.06,M(0x90caf9,0,0.2,{emissive:0x1e88e5,emissiveIntensity:0.5}),0,1.0,0.02,g);cyl(0.008,0.008,0.25,M(0x263238,0,0.4),0.15,0.92,0,g,8);return g},s:'22 × 18 × 8 cm'},
 {n:'Weighing balance (1 t)',b:'Adler',m:'ASI101P-1T',k:'Machine',f:()=>{const g=g0(13.2,5);box(1.2,0.08,1.2,M(0x546e7a,0.6,0.4),0,0,0,g);box(0.05,1.1,0.05,grey,0.7,0,0.55,g);box(0.3,0.2,0.08,M(0xeceff1,0,0.4),0.7,1.1,0.55,g);box(0.2,0.06,0.01,M(0x00e676,0,0.2,{emissive:0x00c853,emissiveIntensity:1}),0.7,1.17,0.6,g);return g},s:'120 × 120 cm platform'}];
// conveyors + extras
conveyor(S,3.5,13,6.75);conveyor(S,4,12,10.05);conveyor(S,15.5,23,7.35);
for(let i=0;i<6;i++)cyl(0.29,0.29,0.88,blue,9+i*0.65,0,1.1,S,32);
for(let i=0;i<3;i++){const g=g0(16+i*1.4,HD-1.2);box(1.2,0.14,1,M(0x9c7a4c,0,0.8),0,0,0,g);box(1.1,1,0.95,M(0xf5f5f5,0,0.9),0,0.14,0,g)}
// mezzanine + stairs by the tanks
(function(){const g=g0(1,0.6);box(8.5,0.08,1.2,M(0x9c5a78,0.2,0.8),4.2,1.9,0.3,g);for(let x=0;x<=8.5;x+=1.7)box(0.06,1.9,0.06,grey,x,0,0.85,g);
 for(let x=0;x<=8.5;x+=1.7)box(0.04,1.0,0.04,steel,x,1.98,0.88,g);pipe([[0,2.98,0.88],[8.5,2.98,0.88]],0.025,steel,g);pipe([[0,2.5,0.88],[8.5,2.5,0.88]],0.02,steel,g);
 for(let i=0;i<9;i++)box(0.9,0.04,0.28,M(0xa7adb2,0.7,0.5),9.0,1.9-i*0.21,0.4+i*0.26,g);pipe([[9.45,2.9,0.4],[9.45,0.9,2.7]],0.025,steel,g);pipe([[8.55,2.9,0.4],[8.55,0.9,2.7]],0.025,steel,g)})();
// build items + badges
const ui=document.getElementById('lbl'),list=document.getElementById('list');
items.forEach((it,i)=>{it.g=it.f();it.g.traverse(o=>o.userData.i=i);const bb=new T.Box3().setFromObject(it.g);it.c=bb.getCenter(new T.Vector3());it.top=new T.Vector3(it.c.x,bb.max.y+0.25,it.c.z);it.bb=bb;
 const d=document.createElement('div');d.className='tag';d.textContent=i+1;d.onclick=()=>pick(i);ui.appendChild(d);it.el=d;
 const b=document.createElement('button');b.innerHTML=`<b>${i+1}</b> ${it.n}`;b.onclick=()=>pick(i);list.appendChild(b);it.btn=b;});
let sel=-1,helper=null,fly=null;
function flyTo(pos,tgt){fly={p0:C.position.clone(),t0:O.target.clone(),p1:pos,t1:tgt,s:performance.now()}}
function pick(i){sel=i;const it=items[i];if(helper)S.remove(helper);helper=new T.Box3Helper(it.bb.clone().expandByScalar(0.08),0x00b0ff);S.add(helper);
 items.forEach((x,j)=>{x.el.classList.toggle('on',j===i);x.btn.classList.toggle('on',j===i)});
 const sz=it.bb.getSize(new T.Vector3()).length();const dir=new T.Vector3(1.2,0.9,1.6).normalize().multiplyScalar(Math.max(3,sz*1.8));
 flyTo(it.c.clone().add(dir),it.c.clone());O.autoRotate=false;
 document.getElementById('info').innerHTML=`<div class="k">${i+1} · ${it.k}</div><h3>${it.n}</h3><table><tr><td>Brand</td><td>${it.b}</td></tr><tr><td>Model</td><td>${it.m}</td></tr><tr><td>Size</td><td>${it.s} <i>(example)</i></td></tr><tr><td>From A1</td><td>${Math.round(it.c.x*100)} cm along · ${Math.round(it.c.z*100)} cm out <i>(example)</i></td></tr></table>`;
 document.getElementById('info').style.display='block';}
const home=()=>{flyTo(new T.Vector3(-3,11,21),new T.Vector3(12,0.5,7));O.autoRotate=false};
document.getElementById('b360').onclick=()=>{O.autoRotate=!O.autoRotate;O.autoRotateSpeed=1.6};
document.getElementById('btop').onclick=()=>{flyTo(new T.Vector3(HL/2,26,HD/2+0.01),new T.Vector3(HL/2,0,HD/2));O.autoRotate=false};
document.getElementById('bres').onclick=()=>{home();document.getElementById('info').style.display='none';if(helper)S.remove(helper);items.forEach(x=>{x.el.classList.remove('on');x.btn.classList.remove('on')})};
const rc=new T.Raycaster(),mv=new T.Vector2();let down=null;
R.domElement.addEventListener('pointerdown',e=>down=[e.clientX,e.clientY]);
R.domElement.addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>6)return;const r=R.domElement.getBoundingClientRect();mv.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);rc.setFromCamera(mv,C);const h=rc.intersectObjects(S.children,true).find(x=>x.object.userData.i!==undefined);if(h)pick(h.object.userData.i)});
C.position.set(-3,11,21);O.target.set(12,0.5,7);
function size(){const el=document.getElementById('v');R.setSize(el.clientWidth,el.clientHeight);C.aspect=el.clientWidth/el.clientHeight;C.updateProjectionMatrix()}
addEventListener('resize',size);size();
const v=new T.Vector3();
(function loop(t){requestAnimationFrame(loop);if(fly){const k=Math.min(1,(t-fly.s)/900),e=k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2;C.position.lerpVectors(fly.p0,fly.p1,e);O.target.lerpVectors(fly.t0,fly.t1,e);if(k>=1)fly=null}
 O.update();R.render(S,C);const w=R.domElement.clientWidth,h=R.domElement.clientHeight;
 items.forEach(it=>{v.copy(it.top).project(C);const ok=v.z<1&&Math.abs(v.x)<1.05&&Math.abs(v.y)<1.05;it.el.style.display=ok?'block':'none';if(ok)it.el.style.transform=`translate(${(v.x+1)/2*w-11}px,${(1-v.y)/2*h-11}px)`})})();
window.__ready=true;

```

## `shell.html`

```html
<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>OmniSite · Chemex 3D twin (sample)</title><style>
*{box-sizing:border-box}body{margin:0;font:14px -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#0f172a;background:#fff}
header{padding:10px 14px;border-bottom:1px solid #e5e7eb;display:flex;gap:10px;align-items:center;flex-wrap:wrap}header h1{font-size:16px;margin:0}
.note{background:#fff7e6;color:#8a5a00;border:1px solid #f5d48a;border-radius:8px;padding:4px 8px;font-size:12px}
.wrap{display:flex;height:calc(100vh - 52px)}#v{position:relative;flex:1;min-width:0;overflow:hidden}#v canvas{display:block;touch-action:none}
#lbl{position:absolute;inset:0;pointer-events:none}.tag{position:absolute;left:0;top:0;width:22px;height:22px;border-radius:50%;background:#1d4ed8;color:#fff;font:700 11px/22px sans-serif;text-align:center;pointer-events:auto;cursor:pointer;box-shadow:0 1px 4px #0006;border:2px solid #fff}
.tag.on{background:#f59e0b}.ctl{position:absolute;left:10px;top:10px;display:flex;gap:6px}.ctl button,.side button{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:7px 10px;font:600 13px sans-serif;cursor:pointer}
#info{display:none;position:absolute;left:10px;bottom:10px;background:#fffffff2;border:1px solid #e5e7eb;border-radius:12px;padding:10px 12px;max-width:330px;box-shadow:0 4px 16px #0002}
#info h3{margin:2px 0 6px;font-size:15px}#info .k{color:#1d4ed8;font-weight:700;font-size:12px}#info td{padding:2px 8px 2px 0;vertical-align:top}#info td:first-child{color:#64748b}#info i{color:#b45309;font-style:normal;font-size:11px}
.side{width:270px;border-left:1px solid #e5e7eb;overflow:auto;padding:8px}.side h2{font-size:13px;margin:6px 4px;color:#475569}.side button{display:block;width:100%;text-align:left;margin:4px 0;font-weight:500}.side button b{color:#1d4ed8;margin-right:4px}.side button.on{border-color:#1d4ed8;background:#eff6ff}
@media(max-width:760px){.wrap{flex-direction:column;height:auto}#v{height:62vh;flex:none}.side{width:auto;border-left:0;border-top:1px solid #e5e7eb}}
</style></head><body><header><h1>Chemex · 3D twin (sample)</h1><span class="note">Example layout: positions and sizes not measured yet. The survey fills in the real ones.</span></header>
<div class="wrap"><div id="v"><div id="lbl"></div><div class="ctl"><button id="b360">360°</button><button id="btop">Top view</button><button id="bres">Reset</button></div><div id="info"></div></div>
<div class="side"><h2>Chemex machines (15)</h2><div id="list"></div></div></div>
<script>/*THREE*/</script><script>/*ORBIT*/</script><script>/*ROOM*/</script><script>/*SCENE*/</script></body></html>

```

