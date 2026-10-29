import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {WorkflowPlansView} from '../../client/workflow-plan-browser';
import {FixtureProvider} from './production-context';
import {theme as dark} from '../board-list/theme';
const params=new URLSearchParams(location.search),theme=params.get('theme')==='light'?{colors:{...dark.colors,surface0:'#f6f8f7',surface1:'#ffffff',surface2:'#edf1ee',border:'#c9d2cc',foreground:'#16241b',foregroundMuted:'#52635a',accent:'#17603b',accentForeground:'#ffffff'}}:dark;
window.fixtureTheme=theme;
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}})}><FixtureProvider>
 <div style={{background:theme.colors.surface0,color:theme.colors.foreground,height:'100vh',display:'flex',flexDirection:'column'}}><div style={{padding:12,borderBottom:`1px solid ${theme.colors.border}`}}>Plan help · actual registered RPCs · disposable home</div><WorkflowPlansView theme={theme}/></div>
</FixtureProvider></QueryClientProvider>);
