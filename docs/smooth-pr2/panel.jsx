import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {FleetSurface,bindSettingsOpener} from '../../client/fleet';
import {theme as dark} from '../../docs/board-list/theme';
import {params,scope,homeId} from './data';
import {SettingsScreen} from '../../client/settings-screen';
const theme=params.get('theme')==='light'?{colors:{...dark.colors,surface0:'#f6f8f7',surface1:'#ffffff',surface2:'#edf1ee',border:'#c9d2cc',foreground:'#16241b',foregroundMuted:'#52635a',statusWarning:'#8a5813',statusDanger:'#a52c2c',accent:'#17603b',accentForeground:'#ffffff'}}:dark;
window.fixtureTheme=theme;
const surface=params.get('surface')||'home';
const view={plans:'plans',discussion:'chat',board:'board',needs:'crew'}[surface];
bindSettingsOpener(()=>window.review.navigation.push('settings'));
const shell={openHome(){window.review.navigation.push('FirstMate');},openView(){},openDecision(){},openScope(){},openTask(){}};
const route=surface==='needs'?{decision:'all',decisionHome:'C:/fixture/FirstMate'}:{chat:'show'};
// Discussion copy is tested through explicit named navigation. Feature
// availability keeps ordinary Home/Chat on its existing General transcript.
if(surface==='discussion')Object.assign(route,{discussionScope:scope.scopes[0].id,discussionHome:homeId});
document.body.style.background=theme.colors.surface0;
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false},mutations:{retry:false}}})}>
 <div style={{height:'100vh',width:'100%',display:'flex',flexDirection:'column',minHeight:0,color:theme.colors.foreground,background:theme.colors.surface0}}>
 <div style={{padding:'10px 16px',borderBottom:`1px solid ${theme.colors.border}`,fontSize:12,color:theme.colors.foregroundMuted}}>FirstMate · isolated review fixture · {params.get('home')} home · features {params.get('features')}</div>
 {surface==='settings'?<SettingsScreen theme={theme} layout={{compact:innerWidth<638}} />:<FleetSurface theme={theme} layout={{compact:innerWidth<638}} host={{id:'local',label:'Local',online:true}} workspaceId="sample" params={route} view={view} shell={shell} navigation={{openAgent:input=>window.review.navigation.push(input)}} />}
 </div>
</QueryClientProvider>);
