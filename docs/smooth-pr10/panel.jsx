import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelpSettings } from '../../client/help-settings';
import { MaintenanceOwnershipBoard } from '../../client/maintenance-ownership';
import { ProjectMateIntroduction } from '../../client/project-introduction';
import { FleetSurface, bindSettingsOpener } from '../../client/fleet';
import { WorkflowSurface } from '../../client/workflow-plans';
import { theme as dark } from '../board-list/theme';
import { params, homeId, scope } from '../smooth-pr2/data';
const theme = params.get('theme') === 'light' ? { colors: { ...dark.colors, surface0: '#f6f8f7', surface1: '#ffffff', surface2: '#edf1ee', border: '#c9d2cc', foreground: '#16241b', foregroundMuted: '#52635a', statusWarning: '#8a5813', statusDanger: '#a52c2c', accent: '#17603b', accentForeground: '#ffffff' } } : dark;
window.fixtureTheme = theme;
const stage = params.get('stage'), surface = params.get('surface'), compact = innerWidth < 638;
window.review.cache = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
const isFleet = ['home','plans','discussion','needs','board','list'].includes(surface);
bindSettingsOpener(() => window.review.navigation.push('settings'));
const shell = { openHome() {}, openView() {}, openDecision() {}, openScope() {}, openTask() {} };
const route = surface === 'needs' ? { decision: 'all', decisionHome: homeId } : { chat: 'show' };
if (surface === 'discussion') Object.assign(route, { discussionScope: scope.scopes[0].id, discussionHome: homeId });
document.body.style.background = theme.colors.surface0;
createRoot(document.getElementById('root')).render(<QueryClientProvider client={window.review.cache}>
  <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: theme.colors.surface0, color: theme.colors.foreground }}>
    <div style={{ padding: '10px 16px', fontSize: 12, borderBottom: `1px solid ${theme.colors.border}` }}>FirstMate · isolated fixture · no live effects{surface === 'introduction' ? ' · introduction preview; production gate remains closed' : ''}</div>
    {isFleet ? <FleetSurface theme={theme} layout={{ compact }} host={{ id: 'local', label: 'Local', online: true }} workspaceId="sample" params={route} view={{ plans: 'plans', discussion: 'chat', needs: 'crew', board: 'board', list: 'crew' }[surface]} shell={shell} navigation={{ openAgent() {} }} /> :
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: compact ? 12 : 24 }}>
        {surface === 'introduction' ? <>
          <p>Your conversation with FirstMate stays here.</p>
          {stage === 'after' ? <ProjectMateIntroduction theme={theme} hostId="local" homeId={homeId}
            readiness={{ firstmateExists: true, conversationExists: true, fleetReady: true, projectsReady: true, policyReady: true, projectsNeedSetup: true }} onSetup={() => window.review.navigation.push('project-setup-preview')} /> : null}
        </> : surface === 'advanced' ? <WorkflowSurface theme={theme} hostId="local"><MaintenanceOwnershipBoard theme={theme} compact={compact} advanced /></WorkflowSurface> :
          <HelpSettings theme={theme} home={homeId} hostId="local" compact={compact} />}
      </div>}
  </div>
</QueryClientProvider>);
