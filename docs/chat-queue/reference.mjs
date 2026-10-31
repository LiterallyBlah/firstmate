/** Render the upstream queue row read-only, beside FirstMate. No upstream code ships.
 * Usage: node docs/chat-queue/reference.mjs /path/to/paseo
 * Run render.mjs first for the before/after screenshots.
 */
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..');
assert.ok(process.argv[2], 'Usage: node docs/chat-queue/reference.mjs /path/to/paseo');
const upstream = resolve(process.argv[2]), out = resolve(root, '.local/chat-queue/ui');
const repo = createRequire(resolve(root, 'package.json')), local = createRequire(resolve(root, 'docs/board-list/package.json'));
const { build } = local('esbuild'), { chromium } = local('playwright');
const source = await readFile(resolve(upstream, 'packages/app/src/composer/index.tsx'), 'utf8');
const tokens = await readFile(resolve(upstream, 'packages/app/src/styles/theme.ts'), 'utf8');
const row = source.slice(source.indexOf('function QueuedMessageRow('), source.indexOf('\ninterface ImageAttachmentPillProps'));
const styles = source.slice(source.indexOf('  queueTrack: {'), source.indexOf('  sendErrorText:'));
assert.ok(row.startsWith('function QueuedMessageRow(') && styles.includes('queueSendButton:'));
const constants = ['SPACING', 'FONT_SIZE', 'BORDER_RADIUS', 'BORDER_WIDTH', 'ICON_SIZE'].map(name => {
  const match = tokens.match(new RegExp(`export const ${name} = \\{[\\s\\S]*?\\} as const;`));
  assert.ok(match, name); return match[0].replace('export ', '');
}).join('\n');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstream, encoding: 'utf8' }).trim();
await mkdir(resolve(out, 'screenshots'), { recursive: true });
await build({ stdin: { contents: `
import React, { useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { View, Text, Pressable } from 'react-native';
import { Icon } from '@getpaseo/plugin/client/react-native';
import { ChatQueueRows } from '../../client/chat-queue';
import { theme as dark } from '../board-list/theme';
${constants}
const theme = { ...(location.search.includes('light') ? { colors: { ...dark.colors, surface0:'#f6f8f7',surface1:'#ffffff',surface2:'#edf1ee',border:'#c9d2cc',foreground:'#16241b',foregroundMuted:'#52635a',accent:'#17603b',accentForeground:'#ffffff' } } : dark), spacing:SPACING, fontSize:FONT_SIZE, borderRadius:BORDER_RADIUS, borderWidth:BORDER_WIDTH };
const styles = { ${styles} };
const iconForegroundMapping = {}, iconAccentForegroundMapping = {};
const ThemedPencil = ({size}) => <Icon name="Pencil" size={size} color={theme.colors.foreground}/>;
const ThemedArrowUp = ({size}) => <Icon name="ArrowUp" size={size} color={theme.colors.accentForeground}/>;
${row}
const items = ['Check the reader update.', 'Then review the tests.', 'Send me the result when ready.'].map((text,i) => ({ id:String(i), text, state:'queued', attachmentCount:0 }));
const pane = { flex:1, minWidth:0, padding:20, gap:16 };
const heading = { fontSize:18, color:theme.colors.foreground, fontWeight:'600' };
const caption = { fontSize:12, color:theme.colors.foregroundMuted };
createRoot(document.getElementById('root')).render(<View style={{flexDirection:'row',backgroundColor:theme.colors.surface0,padding:12}}>
 <View style={pane}><Text style={heading}>Paseo queue</Text><Text style={caption}>Upstream row + styles · ${revision.slice(0, 8)} · isolated fixture</Text><View style={styles.queueTrack}>{items.map(item=><QueuedMessageRow key={item.id} item={item} onEdit={()=>{}} onSendNow={()=>{}} editLabel="Edit queued message" sendNowLabel="Send queued message now"/>)}</View></View>
 <View style={pane}><Text style={heading}>FirstMate queue</Text><Text style={caption}>Shared component · FirstMate theme tokens · Remove retained</Text><ChatQueueRows theme={theme} queue={{items,sending:false}} onEdit={()=>{}} onConfirmed={()=>{}}/></View>
</View>);
`, resolveDir: here, loader: 'tsx' }, outfile: resolve(out, 'reference.js'), bundle: true, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'warning', plugins: [{ name: 'fixture-host', setup(b) {
  b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(root, 'docs/board-list/contracts.js') }));
  b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(here, 'stubs.jsx') }));
  b.onResolve({ filter: /^react($|\/)/ }, a => ({ path: repo.resolve(a.path) }));
  b.onResolve({ filter: /^react-dom($|\/)/ }, a => ({ path: local.resolve(a.path) }));
  b.onResolve({ filter: /^react-native($|-web$)/ }, () => ({ path: local.resolve('react-native-web') }));
  b.onResolve({ filter: /^lucide-react$/ }, () => ({ path: local.resolve('lucide-react') }));
} }] });
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 440 } });
  for (const theme of ['light', 'dark']) {
    await page.goto(`about:blank?${theme}`);
    await page.setContent('<html><head><style>html,body{margin:0;font-family:system-ui}#root{display:flex;flex-direction:column}</style></head><body><div id="root"></div></body></html>');
    await page.addScriptTag({ content: await readFile(resolve(out, 'reference.js'), 'utf8') });
    await page.getByText('3 queued · Sent one at a time', { exact: true }).waitFor();
    await page.locator('#root').screenshot({ path: resolve(out, 'screenshots', `paseo-firstmate-${theme}.png`) });
  }
  await writeFile(resolve(out, 'reference.json'), JSON.stringify({ revision, source: 'packages/app/src/composer/index.tsx', note: 'Actual upstream row/styles rendered in isolation with the same host palette. Not a live agent session.' }, null, 2));
  console.log('Paseo/FirstMate side-by-side queue screenshots captured in both themes.');
} finally { await browser.close(); }
