/** Remastered Ship: only format-1 data and generated images. */
import {readFileSync,writeFileSync,unlinkSync,readdirSync,statSync} from 'node:fs';
import {dirname,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..'),out=resolve(root,'art/settings/ship');
const require=createRequire(resolve(root,'docs/board-list/package.json'));
await require('esbuild').build({entryPoints:[resolve(root,'shared/deck-setting.ts')],outfile:resolve(root,'.generated/voyage-schema.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const {SettingManifestSchema,capabilitiesUsed,settingImageIds}=await import('../../../.generated/voyage-schema.mjs');
const old=JSON.parse(readFileSync(resolve(root,'test/fixtures/ship-baseline/setting.json'))),reg=JSON.parse(readFileSync(resolve(here,'registration.json')));
const sprite=image=>({image}),seq=(id,n=4)=>Array.from({length:n},(_,i)=>sprite(id+'-'+i));
const base={optional:false,lite:'run',still:'first-frame'};
const cycle=(sprites,frameMs=450,clock='sail')=>({kind:'cycle',frames:{sprites,frameMs,clock}});
const ambient=(id,slot,order,behaviour,extra={})=>({id,slot,order,...base,behaviour,...extra});
const zone=(id,points,facing='front')=>({id,posts:points.map((at,i)=>({id:id+'-'+i,at,facing})),assign:'ordered',overflow:{kind:'beside',spacing:[12,4]}});
const phases=old.dayCycle.phases.map(p=>p.id),span=[-4096,4736],waterline=346,horizon=205;
const pack={format:old.format,formatVersion:1,id:'ship',name:"Ship's deck",version:'2.0.0',requires:[],images:reg.images,
 copy:{...old.copy,tooltip:'Sail a living archipelago aboard the pirate ship.',zones:{station:'working the rigging',helm:'waiting at the wheel',bow:'watching the bow',rest:'resting below deck'}},
 stage:{size:[640,400],fit:{top:0,bottom:400,margin:.94},actorHeight:44,backdrop:{sprite:sprite('ship')},
  motion:{bob:{periodS:6.2,amplitude:{channel:'heave'},clock:'swell'},rock:{pivot:[325,300],degrees:{curve:[[0,.3],[1,1]]},drift:{curve:[[0,.2],[1,.7]]},periodS:8,clock:'swell'}},
  tintByPhase:{dawn:'#E8C6D9',morning:'#FFF0DD',midday:'#FFFFFF',afternoon:'#FFE5C2',dusk:'#D3A4B7',night:'#8299C0'},
  parts:[{id:'fixed',...base,sprite:sprite('fixed'),at:[0,0],cutout:[0,0,640,400]},
   {id:'access-ladder',...base,sprite:sprite('access-ladder'),at:[339,85]},
   ...Object.entries(reg.parts).map(([id,rect])=>({id,...base,sprite:sprite(id+'-0'),at:rect.slice(0,2),behaviour:cycle(seq(id),id==='flag'?180:600)})),
   {id:'cat',...base,sprite:sprite('cat-0'),at:[390,263],behaviour:cycle([sprite('cat-0'),sprite('cat-0'),sprite('cat-0'),sprite('cat-1'),sprite('cat-1'),sprite('cat-0')],700,'life')},
   {id:'yard-gull',...base,sprite:sprite('perched-gull-0'),at:[282,91],behaviour:cycle([sprite('perched-gull-0'),sprite('perched-gull-0'),sprite('perched-gull-1'),sprite('perched-gull-0')],900,'life')}],
  pieces:[{id:'hull-front',sprite:{image:'ship',rect:[70,298,535,52]},at:[70,298],baseline:null},
   {id:'mast',sprite:{image:'ship',rect:[320,225,19,55]},at:[320,225],baseline:280},
   {id:'nest-rim',sprite:{image:'ship',rect:[308,83,44,11]},at:[308,83],baseline:{over:'mast'}},
   {id:'stern-rail',sprite:{image:'ship',rect:[511,278,94,12]},at:[511,278],baseline:290},
   {id:'plank',sprite:{image:'plank',rect:[0,0,100,10]},at:[12,291],baseline:{over:'hull-front'}}],
  props:[],lightStyles:old.stage.lightStyles,
  lights:[[140,249],[270,251],[443,250],[506,233],[593,233]].map((at,i)=>({id:'lantern-'+i,style:'lantern',at,row:230,seed:i*2.3,lite:'run',still:'first-frame'}))},
 floor:{areas:[{id:'deck',polygon:[[125,267],[490,267],[490,295],[125,295]]},{id:'bow',polygon:[[103,270],[143,270],[143,292],[103,292]]},{id:'stern',polygon:[[514,264],[591,264],[591,277],[514,277]]},{id:'stairs',polygon:[[482,282],[514,264],[520,276],[493,295]],spill:false},{id:'hold-passage',polygon:[[242,288],[250,288],[250,335],[242,335]],spill:false},{id:'hold',polygon:[[159,313],[565,313],[565,336],[159,336]],spill:false}],
  obstacles:[{id:'mast',rect:[320,265,19,14]},{id:'chest',rect:[374,267,37,15]},{id:'barrels',rect:[420,265,46,18]},{id:'hatch',rect:[222,267,53,21]}],grid:{cell:2,bounds:[95,258,505,82]},walkSpeed:40},
 zones:{byState:{working:'station',waiting:'helm',blocked:'bow',idle:'rest'},zones:[
  zone('station',[[300,275],[352,280],[286,292],[366,293],[203,278],[418,292],[473,290]],'right'),
  zone('helm',[[536,271],[558,271],[581,271]]),zone('bow',[[112,280],[133,284],[156,278]],'left'),
  {id:'rest',posts:Array.from({length:24},(_,i)=>({id:'rest-'+i,at:[165+i*16,335],facing:'front'})),assign:'ordered',overflow:{kind:'pack',areas:[[165,335,369,1]],spacing:[16,1],fallback:[16,1]},labelFloor:350,appearance:{sprite:sprite('below-deck-porthole'),feet:[8,16],front:'hull-front'}}]},
 cast:structuredClone(old.cast),portals:{entry:{kind:'rise',at:[245,291],ms:1100},exits:{},byDeparture:{done:'plank',failed:'plank',closed:'plank',removed:'plank'},still:{fadeMs:600}},
 effects:structuredClone(old.effects),ambience:[],dayCycle:structuredClone(old.dayCycle),atmosphere:structuredClone(old.atmosphere),
 attentionCarrier:{...structuredClone(old.attentionCarrier),at:[90,350],loiter:{amplitude:[3,1],periodMs:4800},surface:{row:36,submergedTint:'#3E7894',submergedAlpha:.35,ripple:{colour:'#C1E5EF',shade:'#376D91',periodMs:1800,clock:'water-drift'}}},palette:structuredClone(old.palette)};
pack.zones.zones[0].posts[0].transit={path:[[344,275],[344,85],[331,85]],speed:28,poses:['climb-a','climb-b'],stepMs:260,settled:'lookout',front:'mast',needs:['access-ladder']};
for(const row of pack.atmosphere.table){row['voyage-pace']=1;row['life-pace']=1;row.heave=Math.min(2,row.heave);}
pack.atmosphere.delivered['voyage-pace']=1;pack.atmosphere.delivered['life-pace']=1;pack.atmosphere.delivered.heave=1;
pack.atmosphere.clocks.voyage='voyage-pace';pack.atmosphere.clocks.life='life-pace';
// Keep the original finite splash/shark events, but move the path along a real projecting plank.
const departure=structuredClone(old.portals.exits.plank);departure.marks={foot:[112,291],rail:[97,291],tip:[25,291],water:[32,380]};departure.alternate={side:[1],drift:[0]};
pack.portals.exits.plank=departure;
// Sky/day/cloud behavior is preserved, with the world's horizon registered to the larger ship.
for(const id of ['sky','overcast','stars','lightning','clouds','gull']){
 const e=structuredClone(old.ambience.find(e=>e.id===id));
 if(id==='sky')e.behaviour.placement.stageRow=horizon;
 if(id==='gull'){e.behaviour.rows=[30,170];e.behaviour.speed=27;}
 pack.ambience.push(e);
}
pack.ambience.push(ambient('moon','back',2.1,{kind:'overlay',image:'moon',space:'sky',alpha:'night',hiddenBy:['overcast']}));
// Original ocean tile: one shared origin across rear and foreground bands, always fills visible bottom.
for(const id of ['sea','sea-still']){const e=structuredClone(old.ambience.find(e=>e.id===id));e.order=6;e.behaviour.origin=horizon;e.behaviour.bands=[{slot:'back',fromRow:horizon},{slot:'front',fromRow:waterline}];pack.ambience.push(e);}
pack.ambience.push(ambient('voyage-coast','back',6.1,{kind:'phase-strip',top:101,span,frames:{sprites:[sprite('coast-midday')],frameMs:1000},drift:{pxPerSecond:1.7,clock:'voyage'},byPhase:Object.fromEntries(phases.map(p=>[p,[sprite('coast-'+p)]]))}));
pack.ambience.push(ambient('lighthouse-beam','back',6.2,{kind:'phase-strip',top:101,span,frames:{sprites:Array(4).fill(sprite('beam-clear')),frameMs:700,clock:'life'},drift:{pxPerSecond:1.7,clock:'voyage'},byPhase:Object.fromEntries(phases.map(p=>[p,p==='night'?seq('beam'):Array(4).fill(sprite('beam-clear'))]))}));
for(const id of ['wake','foam','foam-still','spindrift','weather-serpent','weather-kraken']){
 const e=structuredClone(old.ambience.find(e=>e.id===id));
 if(id==='wake')e.behaviour.at=[590,waterline];
 if(id==='foam'||id==='foam-still'){e.behaviour.span=[110,590];e.behaviour.top=waterline-9;}
 if(id==='spindrift')e.behaviour.at=[96,waterline];
 if(id==='weather-serpent')e.behaviour.at=[36,358];
 if(id==='weather-kraken')e.behaviour.at=[603,358];
 pack.ambience.push(e);
}
pack.ambience.push(ambient('rain','front',11,{kind:'tile',frames:{sprites:Array(4).fill(sprite('rain-clear')),frameMs:90,clock:'water-drift'},drift:{pxPerSecond:8,clock:'water-drift'},origin:0,bands:[{slot:'front',fromRow:0}],variants:[{id:'storm-rain',frames:seq('rain'),blend:'over',opacity:[[.65,0],[1,.5]]}]},{lite:'freeze',still:'hide'}));
// Quiet intervals are explicit repeated frames, separate from drift and ship rocking.
pack.ambience.push(ambient('dolphins','front',8.5,{...cycle([sprite('dolphin-0'),...seq('dolphin'),sprite('dolphin-3'),...Array(14).fill(sprite('dolphin-3'))],260,'life'),at:[185,375],anchor:[32,52]},{lite:'run',still:'first-frame'}));
pack.ambience.push(ambient('whale-spout','back',6.4,{...cycle([...Array(12).fill(sprite('whale-0')),sprite('whale-1'),sprite('whale-2'),sprite('whale-3')],550,'life'),at:[75,209],anchor:[35,47]}));
pack.ambience.push(ambient('merchant-passage','back',6.3,{kind:'strip',frames:{sprites:seq('merchant-lane'),frameMs:700,clock:'life'},top:151,span,drift:{pxPerSecond:2,clock:'voyage'},variants:[{id:'merchant-away',frames:Array(4).fill(sprite('merchant-clear')),blend:'crossfade',opacity:[[.35,0],[.7,1]]}]}));
pack.ambience.push(ambient('navy-chase','back',6.5,{...cycle(seq('navy-chase'),600,'life'),at:[540,222],anchor:[58,88],opacity:{curve:[[.8,0],[1,1]]}},{still:'hide'}));
pack.ambience.push(ambient('flying-fish','front',9,{kind:'flyby',poses:{glide:sprite('flying-fish')},sequence:['glide'],frameMs:200,glide:'glide',size:[28,20],anchor:[14,10],slotS:19,chance:.7,start:[1,4],speed:55,margin:40,rows:[350,368],wobble:{px:8,rate:1.8},flap:{everyS:2,forS:1},nightBelow:.5,most:1},{lite:'hide',still:'hide'}));
// Prune only files not referenced by the final manifest; sources and frozen originals live outside art/.
const ids=new Set(settingImageIds(pack));pack.images=Object.fromEntries(Object.entries(pack.images).filter(([id])=>ids.has(id)));
pack.requires=capabilitiesUsed(pack);SettingManifestSchema.parse(pack);
const keep=new Set(['setting.json',...Object.values(pack.images).map(v=>v.path)]);
const walk=dir=>{for(const name of readdirSync(dir)){const p=resolve(dir,name);if(!p.startsWith(out+'/')&&!p.startsWith(out+'\\'))throw Error('outside pack');if(statSync(p).isDirectory())walk(p);else if(!keep.has(relative(out,p).replaceAll('\\','/')))unlinkSync(p);}};walk(out);
writeFileSync(resolve(out,'setting.json'),JSON.stringify(pack,null,2)+'\n');
console.log(JSON.stringify({id:pack.id,images:Object.keys(pack.images).length,bytes:Object.values(pack.images).reduce((n,v)=>n+readFileSync(resolve(out,v.path)).length,0),capabilities:pack.requires}));
