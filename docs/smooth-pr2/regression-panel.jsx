/** Registered production Home and shell; only the host and read data are synthetic. */
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {registerFleetViews} from '../../client/workspace-panels';
import {theme as dark} from '../board-list/theme';
import {params} from './data';
const theme=params.get('theme')==='light'?{colors:{...dark.colors,surface0:'#f6f8f7',surface1:'#ffffff',surface2:'#edf1ee',border:'#c9d2cc',foreground:'#16241b',foregroundMuted:'#52635a',statusWarning:'#8a5813',statusDanger:'#a52c2c',accent:'#17603b',accentForeground:'#ffffff'}}:dark;
window.fixtureTheme=theme;
let Home,changeRoute;
registerFleetViews({addScreen(s){Home=s.Component},addWorkspacePanel(){},openScreen(s){window.review.navigation.push(s);changeRoute(s.params)},openPanel(){}});
const cache=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false},mutations:{retry:false}}});
window.review.cache=cache;
function App(){const[route,setRoute]=useState({chat:'show'});changeRoute=setRoute;
return <QueryClientProvider client={cache}><Home theme={theme} layout={{compact:innerWidth<638}} host={{id:'local',label:'Local',online:true}} workspaceId="sample" params={route} navigation={{openAgent:input=>window.review.navigation.push(input)}} /></QueryClientProvider>}
document.body.style.background=theme.colors.surface0;
createRoot(document.getElementById('root')).render(<App/>);
