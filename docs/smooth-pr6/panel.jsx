import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsScreen } from '../../client/settings-screen';
import { theme as dark } from '../board-list/theme';
const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'light' ? { colors: { ...dark.colors, surface0: '#f6f8f7', surface1: '#ffffff', surface2: '#edf1ee', border: '#c9d2cc', foreground: '#16241b', foregroundMuted: '#52635a', statusWarning: '#8a5813', statusDanger: '#a52c2c', accent: '#17603b', accentForeground: '#ffffff' } } : dark;
window.fixtureTheme = theme;
window.review.cache = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
document.body.style.background = theme.colors.surface0;
createRoot(document.getElementById('root')).render(<QueryClientProvider client={window.review.cache}>
  <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', minHeight: 0, color: theme.colors.foreground, background: theme.colors.surface0 }}>
    <div style={{ padding: '10px 16px', borderBottom: `1px solid ${theme.colors.border}`, fontSize: 12, color: theme.colors.foregroundMuted }}>FirstMate · individual project setup · isolated synthetic host</div>
    <SettingsScreen theme={theme} layout={{ compact: innerWidth < 638 }} host={{ id: 'local', label: 'This computer' }} navigation={{ openAgent: input => window.review.opened = input }} />
  </div>
</QueryClientProvider>);
