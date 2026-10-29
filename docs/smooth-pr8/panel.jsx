import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider,useQuery} from '@tanstack/react-query';
import {MateChat} from '../../client/chat';
import {DecisionDrawer} from '../../client/decision-drawer';
import {WorkflowSurface} from '../../client/workflow-plans';
import {NEEDS_YOU_QUERY_KEY} from '../../client/needs-you-query';
import {readScopeNeeds} from '../../shared/supervision-rpc';
import {useRpc} from './stubs';
import {drafts} from '../../client/draft';
import {scopeDraftKey} from '../../shared/scope-discussion';
import {params,homeId,planId,scope,fleet} from './data';
import {theme as dark} from '../board-list/theme';
const theme=params.get('theme')==='light'?{colors:{...dark.colors,surface0:'#f6f8f7',surface1:'#ffffff',surface2:'#edf1ee',border:'#c9d2cc',foreground:'#16241b',foregroundMuted:'#52635a',statusWarning:'#8a5813',statusDanger:'#a52c2c',accent:'#17603b',accentForeground:'#ffffff'}}:dark;
window.fixtureTheme=theme;
const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false},mutations:{retry:false}}});
const surface=params.get('surface')??'discussion', compact=innerWidth<600;
const initial={new:scope.scopes[3].id,remote:'remote',routine:'routine'}[surface]??planId;
drafts.set(scopeDraftKey('local',homeId,initial),surface==='new'?'Can you explain this trial before we start?':'Explain the next step before doing any work.');
function App(){
 const [generation,remount]=useState(0),[request,setRequest]=useState({homeId,scopeId:initial}),[destination,setDestination]=useState({homeId,requestId:'all'}),read=useRpc(readScopeNeeds);
 const query=useQuery({queryKey:NEEDS_YOU_QUERY_KEY,queryFn:()=>read({})});
 window.pr8.remount=()=>{client.removeQueries({queryKey:['firstmate','scope-read']});remount(v=>v+1);};
 const shell={openScope:(scopeId,home)=>{window.pr8.navigation.push({scopeId,home});setRequest({scopeId,homeId:home});},openHome(){}};
 return <WorkflowSurface hostId="local" theme={theme} shell={shell}>
  {surface.includes('needs')||surface==='maintenance-answer'?<DecisionDrawer theme={theme} compact={compact} modal={false} snapshot={query.data} offline={false} destination={destination} onSelect={setDestination} onClose={()=>window.pr8.navigation.push('closed')} onBackToFirstMate={()=>window.pr8.navigation.push('FirstMate')} mateId={fleet.mate.id} suggestions={[]} />:
  <MateChat key={generation} mate={fleet.mate} theme={theme} compact={compact} onChanged={()=>{}} onOpenFile={()=>{}} scopeRequest={request} imageContext={{serverId:'local',home:homeId}} navigation={{openAgent:input=>window.pr8.navigation.push(input),openWorkspace:input=>window.pr8.navigation.push(input)}} />}
 </WorkflowSurface>;
}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><div style={{height:'100vh',display:'flex',flexDirection:'column',background:theme.colors.surface0,color:theme.colors.foreground}}><div style={{padding:'10px 16px',fontSize:12,borderBottom:`1px solid ${theme.colors.border}`}}>FirstMate · isolated component fixture · no live effects</div><App /></div></QueryClientProvider>);
