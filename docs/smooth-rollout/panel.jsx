import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {FleetSurface,bindSettingsOpener} from '../../client/fleet';
import {theme as dark} from '../../docs/board-list/theme';
import {params} from './data';
import { drafts, scopeUiKey } from '../../client/draft';
import { pendingAttachments } from '../../client/attachments';
const theme=params.get('theme')==='light'?{colors:{...dark.colors,surface0:'#f6f8f7',surface1:'#ffffff',surface2:'#edf1ee',border:'#c9d2cc',foreground:'#16241b',foregroundMuted:'#52635a',statusWarning:'#8a5813',statusDanger:'#a52c2c',accent:'#17603b',accentForeground:'#ffffff'}}:dark;
window.fixtureTheme=theme;
const surface=params.get('surface')||'home';
const view={plans:'plans',discussion:'chat',board:'board',needs:'crew',deck:'deck'}[surface];
bindSettingsOpener(()=>window.review.navigation.push('settings'));
const shell={openHome(){},openView(){},openDecision(){},openScope(){},openTask(){}};
const route=surface==='needs'?{decision:'all',decisionHome:'C:/fixture/FirstMate'}:{chat:'show'};
if(params.has('scoped')) Object.assign(route,{discussionHome:'C:/fixture/FirstMate',discussionScope:window.review.scope.scopes.find(s=>s.kind!=='general')?.id||'missing'});
if(params.has('legacy')) drafts.set(scopeUiKey('local','C:/fixture/FirstMate'),'enabled');
window.review.setDraft=text=>drafts.set('first-mate',text);
window.review.attach=()=>pendingAttachments.set('first-mate',[{id:'file',kind:'file',fileName:'reader-notes.txt',mimeType:'text/plain',size:5,data:'aGVsbG8='}]);
document.body.style.background=theme.colors.surface0;
const cache=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false},mutations:{retry:false}}});
window.review.refresh=()=>cache.invalidateQueries();
function Host(){
 const [currentRoute,setRoute]=useState(route);
 const handoff=React.useRef(0);
 window.review.openScope=(scopeId,discussionHome='C:/fixture/FirstMate')=>setRoute({chat:'show',discussionScope:scopeId,discussionHome,discussionHandoff:String(++handoff.current)});
 return <QueryClientProvider client={cache}>
 <div style={{height:'100vh',width:'100%',display:'flex',flexDirection:'column',minHeight:0,color:theme.colors.foreground,background:theme.colors.surface0}}>
 <div style={{padding:'10px 16px',borderBottom:`1px solid ${theme.colors.border}`,fontSize:12,color:theme.colors.foregroundMuted}}>FirstMate · isolated review fixture · {params.get('home')} home · features {params.get('features')}</div>
 <FleetSurface theme={theme} layout={{compact:innerWidth<638}} host={{id:'local',label:'Local',online:true}} workspaceId="sample" params={currentRoute} view={view} shell={shell} navigation={{openAgent:input=>window.review.navigation.push(input)}} />
 </div>
</QueryClientProvider>;
}
createRoot(document.getElementById('root')).render(<Host/>);
