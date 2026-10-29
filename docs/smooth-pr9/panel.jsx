import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {WorkflowPlanBrowser} from '../../client/workflow-plan-browser';
import {PlanHelpSurface} from '../../client/plan-help';
import {FixtureContext} from './context';
import {workflow, params} from '../smooth-pr2/data';
import {theme as dark} from '../board-list/theme';
const theme=params.get('theme')==='light'?{colors:{...dark.colors,surface0:'#f6f8f7',surface1:'#ffffff',surface2:'#edf1ee',border:'#c9d2cc',foreground:'#16241b',foregroundMuted:'#52635a',statusWarning:'#8a5813',statusDanger:'#a52c2c',accent:'#17603b',accentForeground:'#ffffff'}}:dark;
window.fixtureTheme=theme;
const cache=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
createRoot(document.getElementById('root')).render(<QueryClientProvider client={cache}><FixtureContext><div style={{background:theme.colors.surface0,color:theme.colors.foreground,height:'100vh',display:'flex',flexDirection:'column'}}>
<div style={{padding:12,borderBottom:`1px solid ${theme.colors.border}`}}>Plans · isolated host fixture · illustrative data</div>
<PlanHelpSurface theme={theme}><WorkflowPlanBrowser theme={theme} snapshot={workflow} loading={false} error={null} onRefresh={()=>{}} onOpen={()=>{}} /></PlanHelpSurface>
</div></FixtureContext></QueryClientProvider>);
