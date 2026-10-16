/** Ghost ship format-1 manifest authoring; data and art only. */
import {readFileSync,writeFileSync,mkdirSync,readdirSync,unlinkSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..'),out=resolve(root,'art/settings/ghost-ship');
const require=createRequire(resolve(root,'docs/board-list/package.json'));
mkdirSync(resolve(here,'.generated'),{recursive:true});
await require('esbuild').build({entryPoints:[resolve(root,'shared/deck-setting.ts')],outfile:resolve(here,'.generated/schema.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const {SettingManifestSchema,capabilitiesUsed,settingImageIds}=await import('./.generated/schema.mjs');
const {images,lanes,parts}=JSON.parse(readFileSync(resolve(here,'registration.json')));
const s=image=>({image}),seq=(n,count=4)=>Array.from({length:count},(_,i)=>s(n+'-'+i));
const base={optional:false,lite:'run',still:'first-frame'};
const cycle=(sprites,frameMs=400,clock='wind')=>({kind:'cycle',frames:{sprites,frameMs,clock}});
const ambient=(id,slot,order,behaviour,extra={})=>({id,slot,order,...base,behaviour,...extra});
const post=(id,at,facing='front')=>({id,at,facing});
const zone=(id,points,facing)=>({id,posts:points.map((at,i)=>post(id+'-'+i,at,facing)),assign:'ordered',overflow:{kind:'beside',spacing:[25,11]}});
const partList=[{id:'fixed',...base,sprite:s('fixed'),at:[0,0],cutout:[0,0,800,520]}];
for(const [id,[x,y]]of Object.entries(parts))partList.push({id,...base,sprite:s(id+'-0'),at:[x,y],behaviour:cycle(seq(id),id.startsWith('flag')?200:750,'wind')});
partList.push({id:'seam-light',...base,sprite:s('seam-0'),at:[0,0],behaviour:{...cycle(seq('seam'),1500,'swell'),opacity:{curve:[[0,.45],[1,1]]}}});
partList.push({id:'hatch-mist',...base,sprite:s('hatch-mist-0'),at:[553,295],behaviour:cycle(seq('hatch-mist'),250,'swell')});
partList.push({id:'raven-main',...base,sprite:s('raven-rest'),at:[363,76],behaviour:cycle([s('raven-rest'),{image:'raven-turn',rect:[4,0,16,18]},s('raven-rest')],1600,'swell')});
const phases=['dawn','morning','midday','afternoon','dusk','night'];
const lantern={glyph:['..a..','.aaa.','abbba','abbba','abbba','aaaaa'],origin:[2,0],inks:{a:'#17372E',b:'#B6FFD0'},glass:'b',tints:[[.88,'#E1FFE7'],[.74,'#A0FFC0'],[0,'#58CE95']],glow:[{at:[0,3],radius:11,colour:'#48FFB0',alpha:.12},{at:[0,3],radius:5,colour:'#A0FFD0',alpha:.25}],glowAlpha:{base:.45,gain:.55},flicker:{base:.8,waves:[[.1,7.1,1],[.06,13.7,2],[.04,29,5]],still:.85}};
const sleepers=[];for(const x0 of [282,372,466,560])for(const y of [374,398])for(let c=0;c<3;c++)sleepers.push([x0+c*22,y]);
const pack={format:'firstmate.deck-setting',formatVersion:1,id:'ghost-ship',name:'Ghost ship',version:'1.0.0',requires:[],preview:'preview',images,
copy:{pane:'Deck',tooltip:'Sail haunted waters aboard a spectral pirate galleon.',title:'Ghost ship',noun:'the ghost ship',starting:'Gathering the ghosts\u2026',aboard:'aboard',actor:{one:'ghost pirate',many:'ghost pirates'},zones:{rigging:'hauling the ghostly rigging',helm:'waiting at the wheel',bow:'watching from the figurehead',rest:'sleeping in the cabins'}},
stage:{size:[800,520],fit:{top:-8,bottom:600,margin:.94},actorHeight:38,
motion:{bob:{periodS:6,amplitude:{channel:'heave'},clock:'swell'},rock:{pivot:[400,340],degrees:{curve:[[0,.25],[1,.8]]},drift:{curve:[[0,.2],[1,.8]]},periodS:8,clock:'swell'}},
tintByPhase:{dawn:'#CABACA',morning:'#CFDCD8',midday:'#CDDCD5',afternoon:'#D5CFBF',dusk:'#A4A2C4',night:'#C8FFE0'},
backdrop:{sprite:s('ship')},parts:partList,pieces:[
{id:'hull-front',sprite:{image:'ship',rect:[24,340,752,126]},at:[24,340],baseline:null},
{id:'mast',sprite:{image:'ship',rect:[286,66,24,270]},at:[286,66],baseline:320},
{id:'sail-screen',sprite:s('sail-screen'),at:[284,96],baseline:321},
{id:'capstan',sprite:{image:'ship',rect:[370,299,32,36]},at:[370,299],baseline:334},
{id:'stern-rail',sprite:{image:'ship',rect:[675,263,94,12]},at:[675,263],baseline:274},
{id:'plank',sprite:{image:'ship',rect:[28,259,86,16]},at:[28,259],baseline:{over:'hull-front'}}],props:[],lightStyles:{lantern},
lights:[[247,294,298],[445,299,301],[648,294,296],[714,229,230],[749,228,230],[296,64,68]].map(([x,y,row],i)=>({id:'lantern-'+i,style:'lantern',at:[x,y],row,seed:i*3.1,lite:'run',still:'first-frame'}))},
floor:{areas:[
{id:'main-deck',polygon:[[260,315],[655,315],[655,335],[260,335]]},
{id:'foredeck',polygon:[[196,294],[260,307],[282,315],[282,333],[234,320],[196,307]]},
{id:'stern',polygon:[[687,257],[753,257],[753,261],[687,261]]},
{id:'stairs',polygon:[[635,315],[687,257],[700,259],[663,335],[635,335]],spill:false},
{id:'hatch-passage',polygon:[[566,325],[574,325],[574,399],[566,399]],spill:false},
{id:'cabins',polygon:[[273,352],[615,352],[615,401],[273,401]],spill:false}],
obstacles:[{id:'capstan',rect:[370,312,32,17]}],grid:{cell:2,bounds:[180,246,580,158]},walkSpeed:40},
zones:{byState:{working:'rigging',waiting:'helm',blocked:'bow',idle:'rest'},zones:[
zone('rigging',[[298,326],[346,326],[424,326],[454,326],[486,326],[522,326]],'right'),
zone('helm',[[710,257],[740,257]],'front'),zone('bow',[[248,312],[272,326]],'left'),
{id:'rest',posts:sleepers.map((at,i)=>post('rest-'+i,at)),assign:'ordered',overflow:{kind:'pack',areas:[...new Set(sleepers.map(p=>p[0]))].flatMap(x=>[[x,374,1,1],[x,398,1,1]]),spacing:[22,24],fallback:[22,24]},appearance:{sprite:s('sleeper'),feet:[9,12],front:'hull-front'},labelFloor:428}]},
cast:{lanes,looks:Array.from({length:8},(_,i)=>({id:'ghost-'+i,image:'crew-'+i,lane:'ghost-'+i,optional:false})),roles:{stand:'stand',walkFront:['stand','walk-a','stand','walk-b'],walkSide:['walk-a','stand','walk-b','wait'],rise:1,stepMs:180,settled:{working:{pose:'haul-a',mirror:'facing'},waiting:{pose:'wait',mirror:'none'},blocked:{pose:'stand',mirror:'facing'},idle:{pose:'wait',mirror:'none'}}},
fidgets:{working:{periodMs:1200,seedMs:719,keys:[{fromMs:0,dx:0,dy:0,pose:'haul-a'},{fromMs:600,dx:0,dy:1,pose:'haul-b'}]},waiting:{periodMs:3900,seedMs:137,keys:[{fromMs:0,dx:0,dy:0,pose:'wait'},{fromMs:3100,dx:0,dy:1,pose:'stand'}]},blocked:{periodMs:4500,seedMs:173,keys:[{fromMs:0,dx:0,dy:0,pose:'stand'},{fromMs:3500,dx:1,dy:0,pose:'wait'}]},idle:null},breath:{state:'waiting',rows:12,periodMs:3200,inMs:1800,seedMs:97}},
portals:{entry:{kind:'rise',at:[570,329],ms:1200},exits:{},byDeparture:{done:'plank',failed:'plank',closed:'plank',removed:'plank'},still:{fadeMs:600}},
effects:{kraken:{size:[156,132],points:{anchor:[78,110],mouth:[78,83]},frames:Object.fromEntries(Array.from({length:8},(_,i)=>['pose-'+i,s('kraken-'+i)]))}},
dayCycle:{phases:phases.map((id,i)=>({id,localMinute:[330,480,720,960,1110,1260][i]})),fadeMinutes:90,night:'night',fallback:'midday'},
atmosphere:{table:[{at:0,wind:.6,water:.7,swell:.7,heave:1,mood:0,voyage:1},{at:.4,wind:1.2,water:1,swell:1,heave:2,mood:.05,voyage:1},{at:1,wind:2.5,water:1.8,swell:1.3,heave:3,mood:.72,voyage:1}],delivered:{wind:.6,water:.7,swell:.7,heave:1,mood:0,voyage:1},clocks:{wind:'wind',water:'water',swell:'swell',voyage:'voyage'}},
attentionCarrier:{at:[700,459],size:[64,56],bubbleHeight:12,frames:seq('angler'),frameMs:320,loiter:{amplitude:[3,1],periodMs:5000},surface:{row:39,submergedTint:'#297D83',submergedAlpha:.5,ripple:{colour:'#81F2C5',shade:'#196B70',periodMs:1800,clock:'water'}}},
ambience:[],palette:{fallbackFill:'#041D27',veil:'#081522',staleTint:'#809B99',staleAlpha:.5}};
pack.zones.zones[0].posts[0].transit={path:[[298,290],[298,82]],speed:28,poses:['climb','haul-a'],stepMs:250,settled:'wait',front:'mast',needs:['ship','sail-screen']};
// The two-second eater is separate from approach and drop. Its final frame is empty water.
pack.portals.exits.plank={kind:'choreography',marks:{queue:[248,312],root:[104,267],edge:[40,267],water:[102,474],mouth:[102,447]},queue:{at:'queue',release:'impact',spacing:[25,11]},alternate:{side:[-1],drift:[0]},actor:[
{ms:'walk',to:{mark:'root'},path:'line',pose:{cycle:'walkSide'},layer:{front:'plank'},moving:true},
{ms:'walk',to:{mark:'edge'},path:'line',pose:{cycle:'walkSide'},layer:{front:'plank'},moving:true},
{ms:600,event:'impact',to:{mark:'water'},path:{ballistic:8},pose:'fall',layer:'effects',moving:true},
{ms:500,to:{mark:'mouth'},path:'line',pose:'fall',layer:'effects',moving:true},
{ms:500,pose:'fall',reveal:[1,0],layer:'effects',moving:false,event:'swallowed'},
{ms:1000,pose:'fall',layer:'effects',moving:false,gone:true}],effects:[{effect:'kraken',order:2,keys:Array.from({length:8},(_,i)=>({frame:'pose-'+i,at:{event:'impact',plusMs:i*250},ms:250,place:{mark:'water'}}))}]};
const add=(...a)=>pack.ambience.push(...a);
add(ambient('sky','back',0,{kind:'backdrop-cycle',size:[320,240],phases:Object.fromEntries(phases.map(p=>[p,'sky-'+p])),placement:{horizonRow:200,stageRow:270},tint:{to:'#102A25',amount:{channel:'mood'}}}));
add(ambient('overcast','back',1,{kind:'overlay',image:'storm-sky-overcast',space:'sky',alpha:{curve:[[.35,0],[1,.72]]}},{still:'hide'}));
const cloudPalette=['#405464','#6E8C96','#BED4D0'];
add(ambient('clouds','back',3,{kind:'drifters',space:'sky',clock:'wind',slots:3,margin:110,topMin:0,lanes:[[8,30],[40,65],[80,110],[125,155],[165,190]],palette:cloudPalette,byPhase:Object.fromEntries(phases.map(p=>[p,p==='night'?['#233447','#405364','#849A9A']:cloudPalette])),sprites:[{id:'wisp',image:'cloud-wisp',size:[40,12],pxPerSecond:.4},{id:'bank',image:'cloud-bank',size:[52,28],pxPerSecond:.7}]}));
add(ambient('lightning','back',2,{kind:'flash',frames:[{sprite:s('lightning'),ms:120,alpha:1},{sprite:s('lightning'),ms:160,alpha:.45}],size:[70,160],anchor:[35,0],under:'clouds',opacity:[[.7,0],[1,.6]],perMinute:[[.7,0],[1,6]]},{lite:'hide',still:'hide'}));
add(ambient('coast','back',4,{kind:'phase-strip',top:103,span:[-4000,4800],frames:{sprites:[s('coast-midday')],frameMs:1000},byPhase:Object.fromEntries(phases.map(p=>[p,[s(p==='night'||p==='dusk'?'coast-night':'coast-midday')]])),drift:{pxPerSecond:1000/1200,clock:'voyage'}}));
add(ambient('lighthouse-beam','back',4.1,{kind:'phase-strip',top:116,span:[-4000,4800],frames:{sprites:seq('beam'),frameMs:700,clock:'swell'},byPhase:Object.fromEntries(phases.map(p=>[p,p==='night'||p==='dusk'?seq('beam'):Array(4).fill(s('beam-clear'))])),drift:{pxPerSecond:1000/1200,clock:'voyage'}}));
add(ambient('far-sea','back',5,{kind:'tile',frames:{sprites:seq('water-0-0'),frameMs:450,clock:'water'},origin:265,bands:[{slot:'back',fromRow:265}],drift:{pxPerSecond:1,clock:'water'},variants:[{id:'rough-far',frames:seq('water-0-1'),blend:'crossfade',opacity:[[.25,0],[1,1]]}]}));
add(ambient('mid-sea','back',6,{kind:'strip',frames:{sprites:seq('water-1-0'),frameMs:350,clock:'water'},top:326,span:[-4000,4800],drift:{pxPerSecond:2,clock:'water'},variants:[{id:'rough-mid',frames:seq('water-1-1'),blend:'crossfade',opacity:[[.3,0],[1,1]]}]}));
add(ambient('deep-water','front',1,{kind:'tile',frames:{sprites:[s('deep-water')],frameMs:1000},origin:450,bands:[{slot:'front',fromRow:450}],drift:{pxPerSecond:0}}));
add(ambient('underwater-wreck','front',2,{...cycle([s('underwater')],1000),at:[140,490],anchor:[0,0]}));
add(ambient('near-sea','front',3,{kind:'strip',frames:{sprites:seq('water-2-0'),frameMs:300,clock:'water'},top:436,span:[-4000,4800],drift:{pxPerSecond:3.5,clock:'water'},variants:[{id:'rough-near',frames:seq('water-2-1'),blend:'crossfade',opacity:[[.25,0],[1,1]]}]}));
for(const [i,x,y]of [[0,170,510],[1,350,530],[2,545,515],[3,640,545]])add(ambient('jellyfish-'+i,'front',4,{...cycle([s('jelly-wide'),s('jelly-narrow')],800+i*80,'swell'),at:[x,y],anchor:[14,0]},{lite:'hide',still:'hide'}));
for(const [i,x,y]of [[0,220,456],[1,440,452],[2,650,454]])add(ambient('candle-'+i,'front',4,{...cycle(seq('candle'),380+i*70,'swell'),at:[x,y],anchor:[10,20]}));
for(const [i,top,speed]of [[0,235,1.1],[1,435,2.2]])add(ambient('mist-'+i,i?'front':'back',i?5:7,{kind:'phase-strip',frames:{sprites:seq('fog'),frameMs:650,clock:'wind'},byPhase:Object.fromEntries(phases.map(p=>[p,p==='night'?seq('night-fog'):seq('fog')])),top,span:[-4000,4800],drift:{pxPerSecond:speed,clock:'wind'}}));
add(ambient('storm-fog','front',9,{kind:'tile',frames:{sprites:Array(4).fill(s('rain-clear')),frameMs:750,clock:'wind'},origin:0,bands:[{slot:'front',fromRow:0}],drift:{pxPerSecond:.8,clock:'wind'},variants:[{id:'fog-thick',frames:seq('fog'),blend:'over',opacity:[[.35,0],[1,.35]]}]},{still:'hide'}));
// Variant frames must share base dimensions; fog's transparent base is generated below in build-art.
pack.ambience.at(-1).behaviour.frames.sprites=Array(4).fill(s('fog-clear'));
add(ambient('rain','front',10,{kind:'tile',frames:{sprites:Array(4).fill(s('rain-clear')),frameMs:90,clock:'water'},origin:0,bands:[{slot:'front',fromRow:0}],drift:{pxPerSecond:8,clock:'water'},variants:[{id:'storm-rain',frames:seq('rain'),blend:'over',opacity:[[.5,0],[1,.65]]}]},{lite:'freeze',still:'hide'}));
const whaleSeq=[...Array(16).fill(s('whale-clear')),...seq('whale',6),s('whale-clear')];
add(ambient('ghost-whale','back',8,{...cycle(whaleSeq,400,'swell'),at:[115,286],anchor:[87,148],opacity:{curve:[[.8,0],[1,1]]}},{lite:'hide',still:'hide'}));
add(ambient('spectral-passage','back',7.5,{...cycle([...Array(12).fill(s('ship-passage-clear')),...seq('ship-passage',8),s('ship-passage-clear')],950,'swell'),at:[0,174],anchor:[0,0],opacity:{curve:[[.8,0],[1,.85]]}},{lite:'hide',still:'hide'}));
add(ambient('distant-kraken','back',8.2,{...cycle([...Array(20).fill(s('distant-kraken-clear')),...seq('distant-kraken',8)],350,'swell'),at:[765,286],anchor:[39,55],opacity:{curve:[[.9,0],[1,.8]]}},{lite:'hide',still:'hide'}));
const batFrames=[...Array(24).fill(s('bat-flight-clear')),...seq('bat-flight',16),...Array(12).fill(s('bat-flight-clear'))];
add(ambient('night-bats','back',8.5,{kind:'phase-strip',top:40,span:[-2000,2800],frames:{sprites:batFrames,frameMs:140,clock:'swell'},byPhase:Object.fromEntries(phases.map(p=>[p,p==='night'?batFrames:batFrames.map(()=>s('bat-flight-clear'))])),drift:{pxPerSecond:0}},{lite:'hide',still:'hide'}));
for(const [i,x,y]of [[0,190,255],[1,470,290],[2,640,210]])add(ambient('will-o-wisp-'+i,'back',8,{...cycle(seq('hatch-mist'),700+i*110,'swell'),at:[x,y],anchor:[18,21],opacity:.45},{lite:'hide',still:'hide'}));
pack.requires=capabilitiesUsed(pack);
const used=new Set(settingImageIds(pack));pack.images=Object.fromEntries(Object.entries(images).filter(([id])=>used.has(id)));
SettingManifestSchema.parse(pack);
writeFileSync(resolve(out,'setting.json'),JSON.stringify(pack,null,2)+'\n');
// Only remove orphan PNGs generated into this exact owned pack directory.
for(const file of readdirSync(out))if(file.endsWith('.png')&&!Object.values(pack.images).some(i=>i.path===file))unlinkSync(resolve(out,file));
console.log(JSON.stringify({id:pack.id,images:Object.keys(pack.images).length,bytes:Object.values(pack.images).reduce((n,a)=>n+readFileSync(resolve(out,a.path)).length,0)}));








