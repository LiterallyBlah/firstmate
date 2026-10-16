/** Sakura additions composed exclusively from the existing format-1 catalogue. */
import {readFileSync} from 'node:fs';
export function addParity(pack){
  const registration=JSON.parse(readFileSync(new URL('./registration.json',import.meta.url)));
  const ship=JSON.parse(readFileSync(new URL('../../../../art/settings/ship/setting.json',import.meta.url)));
  const sprite=image=>({image}),frame=(image,x,w,h)=>({image,rect:[x,0,w,h]});
  pack.version='1.1.0';Object.assign(pack.images,registration.images);
  pack.cast.lanes=registration.lanes;
  pack.cast.looks=Object.keys(registration.lanes).map(id=>({id,image:'crew-'+id,lane:id,optional:false}));
  pack.dayCycle=structuredClone(ship.dayCycle);
  pack.stage.tintByPhase={dawn:'#DECBD8',morning:'#FFF6EA',midday:'#FFFFFF',afternoon:'#FFEDD9',dusk:'#C9ACC2',night:'#7184A1'};
  const phases=Object.fromEntries(pack.dayCycle.phases.map(({id})=>[id,id==='midday'?'coast':'coast-'+id]));
  for(const e of pack.ambience){
    if(e.behaviour.kind==='backdrop-cycle')e.behaviour.phases=Object.fromEntries(Object.entries(phases).map(([k,v])=>[k,v+(e.id==='coast-foreground'?'-front':'')]));
    if(e.behaviour.kind==='drifters'){
      const {day,night}=e.behaviour.byPhase;
      e.behaviour.byPhase={dawn:['#9D8AAB','#D7B5C9','#F8DDDB'],morning:day,midday:day,afternoon:['#9BBBD9','#D8D6E3','#FAE7D4'],dusk:['#74758D','#AA8CA7','#E3B1BE'],night};
    }
  }
  // A normal opaque day backdrop covers a night-only twinkle layer. At night its transparent
  // foreground reveals the same approved night coast beneath, plus ordinary finite frame cycles.
  const coast=pack.ambience.find(e=>e.id==='coast');
  const nightBase=structuredClone(coast);nightBase.id='night-sky-base';nightBase.order=-3;
  nightBase.behaviour.phases=Object.fromEntries(pack.dayCycle.phases.map(({id})=>[id,'coast-night']));
  coast.behaviour.phases.night='coast-night-front';
  pack.ambience.unshift(nightBase);
  for(const [i,at]of [[20,12],[350,8]].entries())pack.ambience.push({id:'twinkle-'+i,slot:'back',order:-2,lite:'freeze',still:'first-frame',behaviour:{kind:'cycle',frames:{sprites:[sprite('stars'),sprite('stars-dim')],frameMs:1700+i*430},at,anchor:[0,0]}});
  pack.ambience.push({id:'moon',slot:'back',order:-1,lite:'run',still:'first-frame',behaviour:{kind:'overlay',image:'moon-sky',space:'coast',alpha:'night'}});
  pack.ambience.push({id:'overcast',slot:'back',order:.5,lite:'run',still:'hide',behaviour:{kind:'overlay',image:'overcast',space:'coast',alpha:{curve:[[.45,0],[.9,.75]]},tint:'space'}});
  pack.ambience.push({id:'lightning',slot:'back',order:2.5,lite:'hide',still:'hide',behaviour:{kind:'flash',frames:[{sprite:sprite('lightning-a'),ms:80,alpha:1},{sprite:sprite('lightning-b'),ms:120,alpha:.45}],size:[24,48],anchor:[12,4],under:'clouds',opacity:[[.92,0],[1,.54]],perMinute:[[.92,0],[1,2]]}});
  const crane=structuredClone(ship.ambience.find(e=>e.id==='gull'));crane.id='cranes';crane.order=7;
  Object.assign(crane.behaviour,{poses:{up:sprite('crane-up'),mid:sprite('crane-mid'),down:sprite('crane-down')},size:[32,24],anchor:[16,12],rows:[24,50],chance:.85});pack.ambience.push(crane);
  pack.ambience.push({id:'petals',slot:'front',order:12,lite:'freeze',still:'first-frame',behaviour:{kind:'drifters',space:'coast',clock:'wind',slots:3,margin:12,topMin:6,lanes:[[50,60],[90,100],[140,150]],palette:['#B55B81','#EC9DB9','#FFDDE1'],byPhase:Object.fromEntries(pack.dayCycle.phases.map(({id})=>[id,id==='night'?['#574D71','#93799C','#BFA4BE']:['#B55B81','#EC9DB9','#FFDDE1']])),sprites:[{id:'petal',image:'petal',size:[6,5],pxPerSecond:3}]}});
  const frames=Array.from({length:4},(_,i)=>frame('umibozu',i*72,72,80));
  pack.ambience.push({id:'umibozu',slot:'back',order:6.5,lite:'freeze',still:'hide',behaviour:{kind:'cycle',frames:{sprites:frames.map(()=>frames[0]),frameMs:1300,clock:'swell'},at:[58,163],anchor:[36,78],opacity:{curve:[[.78,0],[1,.85]]},variants:[{id:'umibozu-rises',frames,blend:'crossfade',opacity:[[.84,0],[1,1]]}]}});
  pack.ambience.push({id:'rain-spray',slot:'front',order:11,lite:'freeze',still:'hide',behaviour:{kind:'tile',frames:{sprites:[sprite('clear-weather'),sprite('clear-weather')],frameMs:180,clock:'wind'},drift:{pxPerSecond:12,clock:'wind'},origin:0,bands:[{slot:'front',fromRow:0}],variants:[{id:'storm-rain',frames:[sprite('rain-0'),sprite('rain-1')],blend:'over',opacity:[[.55,0],[1,.55]]}]}});
  pack.atmosphere.table[2].weather=.55;
  pack.stage.pieces.push({id:'plank',sprite:sprite('plank'),at:[344,240],baseline:{over:'hull-front'}},{id:'lookout-perch',sprite:sprite('perch'),at:[226,54],baseline:241});
  // Ladder rungs run in front of the cream sail; original sail/rig pixels and motion remain intact.
  for(let i=0;i<7;i++)pack.stage.parts.push({id:'ladder-extension-'+i,lite:'run',still:'first-frame',sprite:{image:'ship',rect:[245,202,10,18]},at:[245,76+i*18]});
  const rigging=pack.zones.zones.find(z=>z.id==='rigging');
  rigging.posts.unshift({id:'masthead-lookout',at:[252,236],facing:'front',transit:{path:[[251,220],[251,65],[241,65]],speed:24,poses:['climb-a','climb-b'],stepMs:260,settled:'lookout',front:'lookout-perch',needs:['ship','perch']}});
  const rest=pack.zones.zones.find(z=>z.id==='rest');
  const restX=[...Array.from({length:21},(_,i)=>78+i*12),374,386,398];
  const spread=[0,3,6,9,12,15,18,21,23];
  rest.posts=[...spread,...restX.map((_,i)=>i).filter(i=>!spread.includes(i))].map((index,i)=>({id:'rest-'+(i+1),at:[restX[index],269],facing:'front'}));
  rest.overflow={kind:'pack',areas:[[78,269,252,1],[374,269,42,1]],spacing:[12,1],fallback:[10,1]};
  const exit=structuredClone(ship.portals.exits.plank);
  exit.marks={foot:[350,240],rail:[350,246],tip:[350,274],water:[350,305]};
  const poses={'front-walk-a':'front-a','front-walk-b':'front-b','front-idle':'stand'};
  for(const segment of exit.actor)if(typeof segment.pose==='string')segment.pose=poses[segment.pose]??segment.pose;
  exit.effects[1].effect='dragon';exit.effects[1].keys[0].approach.px=26;
  pack.portals.exits={plank:exit};pack.portals.byDeparture={done:'plank',failed:'plank',closed:'plank',removed:'plank'};
  pack.effects={dragon:{size:[80,72],points:{anchor:[40,66],mouth:[62,28]},frames:Object.fromEntries(['fin','surface','chomp','submerge'].map((k,i)=>[k,frame('dragon',i*80,80,72)]))},splash:{size:[48,32],points:{anchor:[24,27]},frames:{impact:sprite('splash-impact'),burst:sprite('splash-burst')}}};
  const style=structuredClone(ship.stage.lightStyles.lantern);Object.assign(style,{glyph:registration.lantern,origin:[4,0],inks:{a:'#161E30',b:'#FFD688',c:'#943E41'},glow:[{at:[0,7],radius:13,colour:'#FFB050',alpha:.12},{at:[0,7],radius:7,colour:'#FFC070',alpha:.2}]});
  pack.stage.lightStyles={chochin:style};
  pack.stage.lights=[[125,218],[332,210],[398,201]].map((at,i)=>({id:'chochin-'+i,style:'chochin',at,row:245,seed:i*2.3,lite:'run',still:'first-frame'}));
}
