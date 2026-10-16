/** Derive a pure-data pack from the registered generated sprites. No runtime imports of this file. */
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..');
const require=createRequire(resolve(root,'docs/board-list/package.json'));
const {build}=require('esbuild');
await build({entryPoints:[resolve(root,'shared/deck-setting.ts')],outfile:resolve(root,'.generated/japanese-schema.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const {SettingManifestSchema,capabilitiesUsed}=await import('../../../.generated/japanese-schema.mjs');
const {images,lanes}=JSON.parse(readFileSync(resolve(here,'registration.json')));
const sprite=image=>({image});
const posts=(prefix,points,facing='front')=>points.map((at,i)=>({id:prefix+'-'+(i+1),at,facing}));
const zone=(id,points,facing='front')=>({id,posts:posts(id,points,facing),assign:'stable',overflow:{kind:'beside',spacing:[12,3]}});
const pack={
  format:'firstmate.deck-setting',formatVersion:1,id:'japanese-ship',name:'Sakura coast',version:'1.0.2',requires:[],
  copy:{pane:'Deck',tooltip:'Sail a Japanese coastal ship past a sakura island.',title:'Sakura coast',noun:'the coastal ship',starting:'Setting sail...',aboard:'aboard',actor:{one:'sailor',many:'sailors'},zones:{rigging:'tending the rigging',stern:'waiting by the stern',bow:'watching the coast',rest:'resting below deck'}},
  images,...(images.preview?{preview:'preview'}:{}),
  stage:{size:[480,320],fit:{top:0,bottom:320,margin:.94},actorHeight:42,
    motion:{bob:{periodS:7.4,amplitude:{channel:'heave'},clock:'swell'}},
    backdrop:{sprite:sprite('ship')},parts:[
      {id:'fixed-rig',optional:false,lite:'run',still:'first-frame',sprite:sprite('rig-fixed'),at:[55,30],cutout:[55,30,352,184]},
      {id:'masthead',optional:false,lite:'run',still:'first-frame',sprite:sprite('masthead'),at:[214,30],behaviour:{kind:'sway',amplitude:{channel:'heave',scale:1.0833333333333335},periodS:6.2,phase:-1,limit:1,clock:'swell'}},
      {id:'sail',optional:false,lite:'run',still:'first-frame',sprite:{image:'sail-billow',rect:[0,0,202,114]},at:[145,75],behaviour:{kind:'cycle',frames:{sprites:[{image:'sail-billow',rect:[0,0,202,114]},{image:'sail-billow',rect:[202,0,202,114]}],frameMs:850,clock:'sail'},duty:{channel:'billow'}}}
    ],
    pieces:[
      {id:'hull-front',sprite:{image:'ship',rect:[38,247,413,43]},at:[38,247],baseline:null},
      {id:'mast',sprite:{image:'ship',rect:[229,194,20,47]},at:[229,194],baseline:239},
      {id:'mast-ladder',sprite:{image:'ship',rect:[245,194,10,39]},at:[245,194],baseline:232},
      {id:'stern-shelter',sprite:{image:'ship',rect:[373,181,89,62]},at:[373,181],baseline:228}
    ],props:[],lightStyles:{},lights:[],tintByPhase:{night:'#7184A1'}},
  floor:{areas:[
    {id:'deck',polygon:[[44,224],[362,224],[390,229],[390,243],[130,244],[76,237],[44,229]]},
    {id:'hold-passage',polygon:[[159,234],[165,234],[165,269],[159,269]],spill:false},
    {id:'hold',polygon:[[66,250],[426,250],[426,270],[66,270]],spill:false}
  ],obstacles:[{id:'mast-foot',rect:[231,230,16,10]},{id:'ladder-foot',rect:[247,226,8,7]}],grid:{cell:2,bounds:[38,218,400,56]},walkSpeed:28},
  zones:{byState:{working:'rigging',waiting:'stern',blocked:'bow',idle:'rest'},zones:[
    zone('rigging',[[200,233],[222,240],[270,233],[294,233],[316,233],[338,233]],'right'),
    zone('stern',[[352,235],[369,238],[387,240]]),
    zone('bow',[[83,230],[106,234],[130,235]],'left'),
    {id:'rest',posts:posts('rest',[[86,269],[124,269],[162,269],[200,269],[238,269],[276,269],[314,269],[352,269],[390,269]]),assign:'ordered',overflow:{kind:'pack',areas:[[78,269,328,1]],spacing:[14,1],fallback:[12,1]},labelFloor:282,appearance:{sprite:sprite('sleep-window'),feet:[7,16],front:'hull-front'}}
  ]},
  cast:{lanes,looks:['indigo','russet'].map(id=>({id,image:'crew-'+id,lane:id,optional:false})),roles:{stand:'stand',walkFront:['front-a','front-pass','front-b','stand'],walkSide:['side-a','side-pass','side-b','side-idle'],rise:1,stepMs:170,settled:{working:{pose:'pull-a',mirror:'facing'},waiting:{pose:'waiting',mirror:'none'},blocked:{pose:'side-idle',mirror:'facing'},idle:{pose:'rest',mirror:'none'}}},fidgets:{working:{periodMs:1600,seedMs:1700,keys:[{fromMs:0,dx:0,dy:0,pose:'pull-a'},{fromMs:800,dx:0,dy:0,pose:'pull-b'}]},waiting:null,blocked:null,idle:null}},
  portals:{entry:{kind:'rise',at:[163,235],ms:1200},exits:{hold:{kind:'sink',at:[163,235],ms:1100}},byDeparture:{done:'hold',failed:'hold',closed:'hold',removed:'hold'},still:{fadeMs:350}},effects:{},
  ambience:[
    {id:'coast',slot:'back',order:0,lite:'run',still:'first-frame',behaviour:{kind:'backdrop-cycle',size:[600,400],phases:{day:'coast',night:'coast-night'},placement:{horizonRow:180,stageRow:150},tint:{to:'#4D647D',amount:{channel:'weather'}}}},
    {id:'sea-ripples',slot:'back',order:1,lite:'freeze',still:'first-frame',behaviour:{kind:'tile',frames:{sprites:[sprite('ripples')],frameMs:500,clock:'water'},drift:{pxPerSecond:3,clock:'water'},origin:214,bands:[{slot:'back',fromRow:214},{slot:'front',fromRow:290}]}},
    {id:'turning-wake',slot:'back',order:2,lite:'freeze',still:'first-frame',behaviour:{kind:'cycle',frames:{sprites:[sprite('wake'),{image:'wake-motion',rect:[128,0,128,36]},{image:'wake-motion',rect:[256,0,128,36]}],frameMs:240,clock:'water'},opacity:{channel:'wake'},at:[342,264],anchor:[0,0]}},
    {id:'clouds',slot:'back',order:3,lite:'freeze',still:'first-frame',behaviour:{kind:'drifters',space:'coast',clock:'wind',slots:3,margin:32,topMin:6,lanes:[[78,82],[96,100],[124,128]],palette:['#7EBBED','#C7DFF0','#F8EDE0'],byPhase:{day:['#7EBBED','#C7DFF0','#F8EDE0'],night:['#1A3E6C','#1E4076','#385890']},sprites:[{id:'puff',image:'cloud-puff',size:[94,22],pxPerSecond:.45},{id:'wisp',image:'cloud-wisp',size:[76,22],pxPerSecond:.3},{id:'bank',image:'cloud-bank',size:[158,47],pxPerSecond:.35}]}}
  ],
  dayCycle:{phases:[{id:'day',localMinute:480},{id:'night',localMinute:1200}],fadeMinutes:90,night:'night',fallback:'day'},
  atmosphere:{table:[{at:0,pace:.45,swell:.75,heave:.7,wake:.4,weather:0,wind:.5,sail:.55,billow:.4},{at:.35,pace:1,swell:1,heave:1,wake:.65,weather:0,wind:1,sail:1,billow:.5},{at:1,pace:1.8,swell:1.2,heave:1.6,wake:1,weather:.25,wind:3,sail:2.4,billow:.65}],delivered:{pace:1,swell:1,heave:1,wake:.7,weather:0,wind:1,sail:1,billow:.5},clocks:{water:'pace',swell:'swell',wind:'wind',sail:'sail'}},
  attentionCarrier:{bubbleHeight:18,at:[100,274],surface:{"row":29,"submergedTint":"#12637C","submergedAlpha":0.22,"ripple":{"colour":"#B1DCE2","shade":"#4195AE","periodMs":1800,"clock":"water"}},size:[56,44],frames:[sprite('reply-shark'),{image:'reply-shark-motion',rect:[56,0,56,44]},{image:'reply-shark-motion',rect:[112,0,56,44]},{image:'reply-shark-motion',rect:[168,0,56,44]}],frameMs:450,loiter:{amplitude:[2,1],periodMs:5200}},
  palette:{fallbackFill:'#07445B',veil:'#061423',staleTint:'#87959D',staleAlpha:.6}
};
// Preserve the approved settled poses in still/stale mode; glance/shift only on the live cast clock.
pack.cast.fidgets.waiting={periodMs:2800,seedMs:37,keys:[{fromMs:0,dx:0,dy:0,pose:'waiting'},{fromMs:2200,dx:0,dy:0,pose:'stand'}]};
pack.cast.fidgets.blocked={periodMs:4600,seedMs:37,keys:[{fromMs:0,dx:0,dy:0,pose:'side-idle'},{fromMs:3400,dx:0,dy:0,pose:'stand'}]};
pack.ambience.push({id:'coast-foreground',slot:'back',order:4,lite:'run',still:'first-frame',behaviour:{kind:'backdrop-cycle',size:[600,400],phases:{day:'coast-front',night:'coast-night-front'},placement:{horizonRow:180,stageRow:150},tint:{to:'#4D647D',amount:{channel:'weather'}}}});
// Keep the animated water/wake above the coast foreground, exactly as above the original coast.
pack.ambience.find(e=>e.id==='sea-ripples').order=5;
pack.ambience.find(e=>e.id==='turning-wake').order=6;
pack.requires=capabilitiesUsed(pack);
SettingManifestSchema.parse(pack);
writeFileSync(resolve(root,'art/settings/japanese-ship/setting.json'),JSON.stringify(pack,null,2)+'\n');
console.log(JSON.stringify({id:pack.id,capabilities:pack.requires}));
