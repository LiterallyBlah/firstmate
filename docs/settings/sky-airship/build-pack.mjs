/** Sky pirates: offline data authoring, using only the closed format-1 catalogue. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..');
const require=createRequire(resolve(root,'docs/board-list/package.json'));
mkdirSync(resolve(root,'.generated'),{recursive:true});
await require('esbuild').build({entryPoints:[resolve(root,'shared/deck-setting.ts')],outfile:resolve(root,'.generated/airship-schema.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const {SettingManifestSchema,capabilitiesUsed}=await import('../../../.generated/airship-schema.mjs');
const {images,lanes,pieces}=JSON.parse(readFileSync(resolve(here,'registration.json')));
const ship=JSON.parse(readFileSync(resolve(root,'art/settings/ship/setting.json')));
const sprite=image=>({image}),seq=(name,n=4)=>Array.from({length:n},(_,i)=>sprite(name+'-'+i));
const base={optional:false,lite:'run',still:'first-frame'};
const cycle=(sprites,frameMs,clock='sail')=>({kind:'cycle',frames:{sprites,frameMs,clock}});
const ambient=(id,slot,order,behaviour,extra={})=>({id,slot,order,...base,behaviour,...extra});
const post=(id,at,facing='front')=>({id,at,facing});
const zone=(id,points,facing='front')=>({id,posts:points.map((at,i)=>post(id+'-'+i,at,facing)),assign:'stable',overflow:{kind:'beside',spacing:[14,5]}});
const stageParts=[{id:'fixed',...base,sprite:sprite('fixed'),at:[0,0],cutout:[0,0,480,320]}];
for(const [id,[x,y]]of Object.entries(pieces))stageParts.push({id,...base,sprite:sprite(id+'-0'),at:[x,y],behaviour:cycle(seq(id),id==='propeller'?90:id==='balloon'?900:id==='flag'?180:500,id==='propeller'?'engine':'sail')});
stageParts.push({id:'chimney-smoke',...base,sprite:sprite('smoke-0'),at:[278,135],behaviour:cycle(seq('smoke'),350,'engine')});
stageParts.push({id:'propeller-vapour',...base,sprite:sprite('vapour-0'),at:[400,266],behaviour:cycle(seq('vapour'),220,'wind')});
// A small independent rig ornament uses the catalogue's sway directly; cloth cycles also encode sway.
stageParts.push({id:'lookout-pennant',...base,sprite:{image:'flag-0',rect:[10,0,54,30]},at:[250,4],behaviour:{kind:'sway',amplitude:{channel:'heave'},periodS:4.8,phase:1,limit:2,clock:'swell'}});
const lamp=structuredClone(ship.stage.lightStyles.lantern);
const fire=structuredClone(lamp);fire.glyph=['abbbba','abbbba','abbbba','abbbba','aaaaaa'];fire.origin=[3,0];fire.glow[0].radius=13;fire.glow[1].radius=7;fire.flicker.base=.72;
const pack={format:'firstmate.deck-setting',formatVersion:1,id:'sky-airship',name:'Sky pirates',version:'1.0.0',requires:[],images,...(images.preview?{preview:'preview'}:{}),
 copy:{pane:'Deck',tooltip:'Ride the cloud sea aboard a sky-pirate airship.',title:'Sky pirates',noun:'the airship',starting:'Catching the wind...',aboard:'aboard',actor:{one:'sailor',many:'sailors'},zones:{engine:'cranking the engine',helm:'waiting at the wheel',bow:'watching the sky',rest:'resting in hammocks'}},
 stage:{size:[480,320],fit:{top:-4,bottom:324,margin:.94},actorHeight:42,motion:{bob:{periodS:5.6,amplitude:{channel:'heave'},clock:'swell'}},tintByPhase:{dawn:'#FFE0CC',dusk:'#D9AEB0',night:'#778BB9'},backdrop:{sprite:sprite('ship')},parts:stageParts,
 pieces:[{id:'hull-front',sprite:{image:'ship',rect:[55,244,402,50]},at:[55,244],baseline:null},{id:'engine-front',sprite:{image:'ship',rect:[230,191,65,43]},at:[230,191],baseline:233},{id:'ladder',sprite:{image:'ship',rect:[241,42,14,151]},at:[241,42],baseline:227},{id:'stern-rail',sprite:{image:'ship',rect:[367,206,85,11]},at:[367,206],baseline:216},{id:'plank',sprite:{image:'ship',rect:[6,242,73,10]},at:[6,242],baseline:{over:'hull-front'}}],props:[],lightStyles:{lantern:lamp,firebox:fire},
 lights:[[98,205],[118,190],[340,190],[440,164],[258,218]].map((at,i)=>({id:'light-'+i,style:i===4?'firebox':'lantern',at,row:i===4?234:240,seed:i*2.3,lite:'run',still:'first-frame'}))},
 floor:{areas:[{id:'deck',polygon:[[78,214],[360,214],[380,224],[380,240],[78,240]]},{id:'stern',polygon:[[374,201],[439,201],[439,209],[374,209]]},{id:'stairs',polygon:[[358,213],[374,201],[380,207],[380,234],[358,234]],spill:false},{id:'bow',polygon:[[64,220],[90,220],[90,240],[64,240]]},{id:'hold-passage',polygon:[[156,232],[164,232],[164,274],[156,274]],spill:false},{id:'hold',polygon:[[90,250],[420,250],[420,275],[90,275]],spill:false}],obstacles:[{id:'engine',rect:[230,213,65,19]}],grid:{cell:2,bounds:[50,198,395,80]},walkSpeed:34},
 zones:{byState:{working:'engine',waiting:'helm',blocked:'bow',idle:'rest'},zones:[zone('engine',[[206,226],[220,237],[302,222],[322,230],[342,238],[188,237]],'right'),zone('helm',[[388,204],[410,204],[431,204]]),zone('bow',[[66,228],[84,232],[104,234]],'left'),{id:'rest',posts:Array.from({length:24},(_,i)=>post('rest-'+i,[96+i*14,274])),assign:'ordered',overflow:{kind:'pack',areas:[[96,274,324,1]],spacing:[14,1],fallback:[14,1]},labelFloor:288,appearance:{sprite:sprite('sleep-window'),feet:[7,16],front:'hull-front'}}]},
 cast:{lanes,looks:['navy','russet'].map(id=>({id,image:'crew-'+id,lane:id,optional:false})),roles:{stand:'stand',walkFront:['front-a','front-pass','front-b','stand'],walkSide:['side-a','side-pass','side-b','side-idle'],rise:1,stepMs:160,settled:{working:{pose:'crank-a',mirror:'facing'},waiting:{pose:'waiting',mirror:'none'},blocked:{pose:'side-idle',mirror:'facing'},idle:{pose:'rest',mirror:'none'}}},fidgets:{working:{periodMs:1000,seedMs:1700,keys:[{fromMs:0,dx:0,dy:0,pose:'crank-a'},{fromMs:500,dx:0,dy:1,pose:'crank-b'}]},waiting:{periodMs:3100,seedMs:37,keys:[{fromMs:0,dx:0,dy:0,pose:'waiting'},{fromMs:2500,dx:1,dy:0,pose:'stand'}]},blocked:{periodMs:4200,seedMs:97,keys:[{fromMs:0,dx:0,dy:0,pose:'side-idle'},{fromMs:3200,dx:0,dy:0,pose:'lookout'}]},idle:null},breath:{state:'waiting',rows:20,periodMs:3000,inMs:1600,seedMs:31}},
 portals:{entry:{kind:'rise',at:[160,232],ms:1400},exits:{},byDeparture:{done:'plank',failed:'plank',closed:'plank',removed:'plank'},still:{fadeMs:600}},
 effects:{whale:{size:[96,80],points:{anchor:[48,76],mouth:[61,23]},frames:Object.fromEntries(['surface','rise','swallow','sink'].map((id,i)=>[id,sprite('whale-'+i)]))},puff:{size:[64,48],points:{anchor:[32,40]},frames:Object.fromEntries(['impact','burst','ring','mist'].map((id,i)=>[id,sprite('puff-'+i)]))}},
 ambience:[],dayCycle:{phases:[{id:'dawn',localMinute:330},{id:'day',localMinute:480},{id:'dusk',localMinute:1110},{id:'night',localMinute:1260}],fadeMinutes:90,night:'night',fallback:'day'},
 atmosphere:{table:[{at:0,pace:.6,wind:.7,sail:.7,swell:.8,heave:2,engine:.7,mood:0},{at:.35,pace:1,wind:1.3,sail:1.2,swell:1,heave:3,engine:1.1,mood:0},{at:1,pace:2.1,wind:3.3,sail:2.4,swell:1.3,heave:4,engine:1.8,mood:.75}],delivered:{pace:1,wind:1,sail:1,swell:1,heave:2,engine:1,mood:0},clocks:{cloud:'pace',wind:'wind',sail:'sail',swell:'swell',engine:'engine'}},
 attentionCarrier:{at:[412,277],size:[56,44],bubbleHeight:12,frames:seq('carrier'),frameMs:400,loiter:{amplitude:[2,1],periodMs:4800},surface:{row:31,submergedTint:'#ACBDE4',submergedAlpha:.28,ripple:{colour:'#F5ECDC',shade:'#B1C3E7',periodMs:1900,clock:'cloud'}}},
 palette:{fallbackFill:'#8FAEDB',veil:'#0B1630',staleTint:'#87959D',staleAlpha:.6}
};
pack.zones.zones[0].posts[0].transit={path:[[246,226],[246,44]],speed:28,poses:['climb-a','climb-b'],stepMs:230,settled:'lookout',front:'ladder',needs:['ship']};
// Finite, anchored departure: walk out, drop through cloud, rise briefly into the whale mouth, vanish.
pack.portals.exits.plank={kind:'choreography',marks:{queue:[81,237],edge:[27,246],cloud:[65,300],mouth:[65,263]},queue:{at:'queue',release:'impact',spacing:[12,3]},alternate:{side:[-1],drift:[0]},actor:[
 {ms:'walk',to:{mark:'edge'},path:'line',pose:{cycle:'walkSide'},layer:{front:'plank'},moving:true},
 {ms:300,pose:'stand',jiggle:{dx:[0,-1,0,1],stepMs:75},layer:{front:'plank'},moving:false},
 {ms:550,event:'impact',to:{mark:'cloud'},path:{ballistic:18},pose:'fall',layer:'effects',moving:true},
 {ms:180,pose:'fall',reveal:[1,.35],layer:'effects',moving:false},
 {ms:550,to:{mark:'mouth'},path:'line',pose:'fall',reveal:[.35,1],layer:'effects',moving:true,event:'swallow'},
 {ms:450,pose:'fall',layer:'effects',moving:false,gone:true}],effects:[
 {effect:'whale',order:1,keys:[{frame:'surface',at:{event:'impact',plusMs:80},ms:220,place:{mark:'cloud',alignX:'mouth'}},{frame:'rise',at:{event:'impact',plusMs:300},ms:250,place:{mark:'cloud',alignX:'mouth'}},{frame:'swallow',at:{event:'impact',plusMs:550},ms:380,place:{mark:'cloud',alignX:'mouth'}},{frame:'sink',at:{event:'impact',plusMs:930},ms:250,place:{mark:'cloud',alignX:'mouth'}}]},
 {effect:'puff',order:2,keys:['impact','burst','ring','mist'].map((frame,i)=>({frame,at:{event:'impact',plusMs:i*160},ms:160,place:{mark:'cloud'}}))} ]};
pack.ambience.push(ambient('sky','back',0,{kind:'backdrop-cycle',size:[600,400],phases:{dawn:'sky-dawn',day:'sky-day',dusk:'sky-dusk',night:'sky-night'},placement:{horizonRow:240,stageRow:230},tint:{to:'#29344D',amount:{channel:'mood'}}}));
const palette=['#6E8FC2','#B9CCEB','#FFF1D6'],night=['#203052','#3F5788','#778DB9'];
pack.ambience.push(ambient('clouds','back',3,{kind:'drifters',space:'sky',clock:'wind',slots:3,margin:40,topMin:5,lanes:[[36,48],[80,100],[145,165],[185,200]],palette,byPhase:{dawn:['#A58AA6','#E7B1B9','#FFE2BC'],day:palette,dusk:['#695D8F','#B48CA5','#E7B7B8'],night},sprites:[['cloud-bank',128,48,.5],['cloud-puff',64,38,.85],['cloud-wisp',96,24,1.1]].map(([id,w,h,v])=>({id,image:id,size:[w,h],pxPerSecond:v,variants:[{id:id+'-storm',frames:[sprite(id)],blend:'crossfade',opacity:[[.5,0],[.9,1]],palette,byPhase:Object.fromEntries(['dawn','day','dusk','night'].map(p=>[p,['#222C47','#46536C','#75819C']]))}]}))}));
pack.ambience.push(ambient('lightning','back',2,{kind:'flash',frames:[{sprite:sprite('lightning-0'),ms:100,alpha:1},{sprite:sprite('lightning-1'),ms:150,alpha:.45}],size:[70,105],anchor:[35,3],under:'clouds',opacity:[[.75,0],[1,.55]],perMinute:[[.75,0],[1,5]]},{lite:'hide',still:'hide'}));
pack.ambience.push(ambient('thunderheads','back',1,{kind:'cycle',frames:{sprites:[sprite('thunderhead')],frameMs:1000,clock:'wind'},at:[380,100],anchor:[90,32],opacity:{curve:[[.45,0],[.9,.95]]}},{still:'hide'}));
pack.ambience.push(ambient('cloud-sea','back',5,{kind:'tile',frames:{sprites:seq('cloud-sea'),frameMs:350,clock:'cloud'},drift:{pxPerSecond:5,clock:'wind'},origin:290,bands:[{slot:'back',fromRow:290},{slot:'front',fromRow:297}]}));
pack.ambience.push(ambient('mist','front',6,{kind:'strip',frames:{sprites:seq('mist'),frameMs:450,clock:'cloud'},top:291,span:[0,480],drift:{pxPerSecond:3,clock:'cloud'}}));
pack.ambience.push(ambient('rain','front',10,{kind:'tile',frames:{sprites:Array(4).fill(sprite('rain-clear')),frameMs:90,clock:'wind'},drift:{pxPerSecond:8,clock:'wind'},origin:0,bands:[{slot:'front',fromRow:0}],variants:[{id:'storm-rain',frames:seq('rain'),blend:'over',opacity:[[.6,0],[1,.5]]}]},{lite:'freeze',still:'hide'}));
pack.ambience.push(ambient('sky-serpent','back',4,{...cycle(seq('serpent'),600,'swell'),at:[365,165],anchor:[55,43],opacity:{curve:[[.82,0],[1,.95]]}},{lite:'freeze',still:'hide'}));
const fly=(id,poses,size,rows,speed,slotS)=>ambient(id,'back',4,{kind:'flyby',poses,sequence:Object.keys(poses),frameMs:170,glide:Object.keys(poses)[0],size,anchor:[Math.floor(size[0]/2),Math.floor(size[1]/2)],slotS,chance:.85,start:[1,3],speed,margin:55,rows,wobble:{px:3,rate:.65},flap:{everyS:3,forS:1.5},nightBelow:.5,most:2},{lite:'hide',still:'hide'});
pack.ambience.push(fly('gulls',{up:sprite('gull-up'),down:sprite('gull-down')},[24,20],[35,155],25,22),fly('distant-airship',{glide:sprite('distant-airship')},[48,30],[30,55],9,65));
pack.requires=capabilitiesUsed(pack);SettingManifestSchema.parse(pack);
writeFileSync(resolve(root,'art/settings/sky-airship/setting.json'),JSON.stringify(pack,null,2)+'\n');
console.log(JSON.stringify({id:pack.id,capabilities:pack.requires.length}));
