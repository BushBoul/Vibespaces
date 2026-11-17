// The overview across spaces: one column per space, in its colour, with what its Claude Code session is doing now
// and its latest checkpoints. For keeping an eye on several agents at once. It follows every space's session files.
import * as fs from 'fs';
import * as vscode from 'vscode';
import { KIND_ICON, transcriptOf } from './checkpointsView';
import { Space, currentSpace, listSpaces, sameFile, textColorFor } from './spaces';
import { TranscriptPanel } from './transcriptView';
import { Checkpoint, Item, sessionDirs, sessionsFor } from './transcripts';
import { nonce, page, webviewRoots } from './webview';

const ICONS = Object.fromEntries(Object.entries(KIND_ICON).map(([k, [icon]]) => [k, icon]));
const SHOWN = 10;

type State = 'working' | 'waiting' | 'finished' | 'idle' | 'none';

interface Column {
  name: string; spaceFile: string; color: string; fg: string; here: boolean;
  session?: {
    file: string; title: string; lastAt: number; state: State; loading: boolean; counts: Record<string, number>;
    now: string; lastYou: string; checkpoints: Checkpoint[]; onlyMessages: boolean;
  };
}

const DAY = 24 * 3600_000;

// What the session is doing, from its last message or tool call and when that was (not when the file last changed:
// Claude Code also writes bookkeeping there when a window is focused or reloaded).
function stateOf(last: Item | undefined): State {
  if (!last || !last.at) return 'idle';
  const age = Date.now() - last.at;
  if (last.role === 'tool' && !last.done) return age < 45_000 ? 'working' : age < DAY ? 'waiting' : 'idle';   // a long command, or your OK
  if (age < 90_000) return 'working';
  if (last.role === 'you' && age < 10 * 60_000) return 'working';   // thinking about what you wrote
  if (last.role === 'claude' && age < DAY) return 'finished';
  return 'idle';
}

// the latest thing that happened, as a line
function nowLine(last: Item | undefined): string {
  if (!last) return '';
  if (last.role === 'tool') return `${last.tool}${last.summary ? ': ' + last.summary : ''}`;
  if (last.role === 'claude') return `Claude: ${last.summary ?? ''}`;
  return `You: ${last.summary ?? ''}`;
}

const MESSAGES = new Set(['prompt', 'reply']);

// a space as a column, from its newest session as read so far (a session still being read the first time says so)
function column(s: Space, here: Space | undefined): Column {
  const color = s.color ?? '#485460';
  const col: Column = { name: s.name, spaceFile: s.file, color, fg: textColorFor(color), here: !!here && sameFile(here.file, s.file) };
  const latest = sessionsFor(s.folders, 1)[0];
  if (!latest) return col;
  const t = transcriptOf(latest.file);
  const cps = t.loaded ? t.checkpoints() : [];
  const counts: Record<string, number> = { commit: 0, release: 0, error: 0, testsFailed: 0, prompt: 0 };
  for (const c of cps) if (c.kind in counts) counts[c.kind]++;
  const last = t.loaded ? t.items[t.items.length - 1] : undefined;
  const lastYou = [...cps].reverse().find((c) => c.kind === 'prompt');
  // the moments that matter when you're keeping an eye on it; just your messages if there's nothing else yet
  const notable = cps.filter((c) => !MESSAGES.has(c.kind));
  const shown = notable.length ? notable : cps.filter((c) => c.kind === 'prompt');
  col.session = {
    file: latest.file, title: latest.title, lastAt: last?.at || latest.mtime, loading: !t.loaded, state: stateOf(last), counts,
    now: nowLine(last), lastYou: lastYou && last?.role !== 'you' ? lastYou.label : '', checkpoints: shown.slice(-SHOWN).reverse(),
    onlyMessages: !notable.length,
  };
  return col;
}

// every space as a column: the ones with a session first (in your order), then the rest
export function overviewColumns(spaces = listSpaces()): Column[] {
  const here = currentSpace();
  const cols = spaces.map((s) => column(s, here));
  cols.sort((a, b) => Number(!a.session) - Number(!b.session));
  return cols;
}

// read what's new in each space's newest session, one at a time; after is called each time one changed
export async function readSessions(spaces: Space[], after: () => void) {
  for (const s of spaces) {
    const latest = sessionsFor(s.folders, 1)[0];
    if (latest && await transcriptOf(latest.file).update()) after();
  }
}

export const overviewPage = (webview: vscode.Webview, extensionUri: vscode.Uri) =>
  page(webview, extensionUri, nonce(), 'All Spaces', BODY, SCRIPT, STYLE);

export class OverviewPanel {
  private static current: OverviewPanel | undefined;
  private panel: vscode.WebviewPanel;
  private ready = false;
  private watchers: fs.FSWatcher[] = [];
  private watched = '';
  private timer: NodeJS.Timeout | undefined;
  private tick: NodeJS.Timeout;
  private last = '';

  static show(extensionUri: vscode.Uri) {
    if (OverviewPanel.current) { OverviewPanel.current.panel.reveal(); OverviewPanel.current.push(); return; }
    OverviewPanel.current = new OverviewPanel(extensionUri);
  }

  private constructor(private extensionUri: vscode.Uri) {
    this.panel = vscode.window.createWebviewPanel('vibespaces.overview', 'All Spaces', vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: webviewRoots(extensionUri) });
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'activity.svg');
    this.panel.webview.html = overviewPage(this.panel.webview, extensionUri);
    this.panel.webview.onDidReceiveMessage((m) => this.handle(m));
    this.panel.onDidDispose(() => this.dispose());
    // a session that stops changing still moves from "working" to "finished" or "idle"
    this.tick = setInterval(() => this.push(), 30_000);
  }

  private handle(m: any) {
    if (m?.type === 'ready') { this.ready = true; this.last = ''; this.push(); }
    else if (m?.type === 'checkpoint' && typeof m.file === 'string') TranscriptPanel.show(this.extensionUri, m.file, m.uuid || undefined);
    else if (m?.type === 'space' && typeof m.file === 'string') vscode.commands.executeCommand('vibespaces.openSpace', m.file);
  }

  // every space's session folders, watched; a new space or a project's first session changes the set
  private watch(spaces: Space[]) {
    const dirs = [...new Set(spaces.flatMap((s) => sessionDirs(s.folders)))];
    const key = dirs.join('|');
    if (key === this.watched) return;
    this.watched = key;
    this.watchers.forEach((w) => w.close());
    this.watchers = [];
    for (const d of dirs) {
      try { this.watchers.push(fs.watch(d, () => this.soon())); } catch { /* gone */ }
    }
  }

  private soon() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.push(), 800);
  }

  // show what's known now, then read what's new and show each column as its session is read
  private push() {
    if (!this.ready) return;
    const spaces = listSpaces();
    this.watch(spaces);
    this.post(spaces);
    void readSessions(spaces, () => this.post(spaces)).then(() => this.post(spaces));
  }

  private post(spaces: Space[]) {
    const cols = overviewColumns(spaces);
    const json = JSON.stringify(cols);
    if (json === this.last) return;
    this.last = json;
    this.panel.webview.postMessage({ type: 'columns', columns: cols, icons: ICONS });
  }

  private dispose() {
    OverviewPanel.current = undefined;
    this.watchers.forEach((w) => w.close());
    if (this.timer) clearTimeout(this.timer);
    clearInterval(this.tick);
  }
}

const BODY = `
<div class="bar">
  <span class="ttl">All spaces</span>
  <span class="hint" id="summary"></span>
</div>
<div id="cols" class="cols"></div>
<p id="empty" class="hint hidden pad">No spaces yet.</p>`;

const STYLE = `
body { padding: 0 0 32px; }
.bar { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 4px 16px; align-items: baseline; padding: 10px 16px;
  background: var(--vscode-editor-background); border-bottom: 1px solid var(--line); }
.ttl { font-weight: 600; font-size: 1.1em; }
.pad { padding: 16px; }
.cols { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 14px; padding: 14px 16px; align-items: start; }
.col { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--card); min-width: 0; display: flex; flex-direction: column; }
.col.none { opacity: .62; }
.head { padding: 9px 12px; display: flex; flex-direction: column; gap: 3px; }
.head .row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.head .name { font-weight: 700; font-size: 1.05em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.head .here { font-size: .78em; padding: 0 6px; border-radius: 8px; border: 1px solid currentColor; opacity: .85; flex: none; }
.head .go { margin-left: auto; background: none; border: 0; color: inherit; cursor: pointer; padding: 2px; opacity: .85; flex: none; }
.head .go:hover { opacity: 1; }
.state { font-size: .86em; display: flex; align-items: center; gap: 6px; opacity: .95; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; flex: none; }
.s-working .dot { background: var(--vscode-testing-iconPassed, #3fb950); box-shadow: 0 0 0 2px rgba(255,255,255,.55); }
.s-waiting .dot { background: var(--vscode-charts-orange, #d18616); box-shadow: 0 0 0 2px rgba(255,255,255,.55); }
.s-finished .dot { background: var(--vscode-charts-blue, #3794ff); box-shadow: 0 0 0 2px rgba(255,255,255,.55); }
.s-idle .dot, .s-none .dot { opacity: .5; }
@media (prefers-reduced-motion: no-preference) { .s-working .dot { animation: pulse 1.6s ease-in-out infinite; } }
@keyframes pulse { 50% { opacity: .35; } }
.body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: none; border: 0; color: var(--vscode-textLink-foreground);
  padding: 0; text-align: left; cursor: pointer; font: inherit; font-weight: 600; }
.title:hover { text-decoration: underline; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { font-size: .8em; padding: 1px 7px; border-radius: 9px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
  display: inline-flex; gap: 4px; align-items: center; font-variant-numeric: tabular-nums; }
.chip.bad { background: var(--vscode-inputValidation-errorBackground, rgba(255,0,0,.2)); color: var(--vscode-errorForeground); }
.cps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.cps button { width: 100%; display: grid; grid-template-columns: 16px 1fr auto; gap: 7px; align-items: center; background: none; border: 0;
  color: var(--vscode-foreground); text-align: left; padding: 3px 4px; border-radius: 4px; cursor: pointer; font: inherit; min-width: 0; }
.cps button:hover, .cps button:focus-visible { background: var(--vscode-list-hoverBackground); outline: none; }
.cps .lab { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cps .t { font-size: .82em; color: var(--muted); font-variant-numeric: tabular-nums; }
.k-commit .codicon, .k-push .codicon { color: var(--vscode-charts-blue); }
.k-release .codicon { color: var(--vscode-charts-purple); }
.k-testsPassed .codicon { color: var(--vscode-testing-iconPassed); }
.k-testsFailed .codicon, .k-denied .codicon { color: var(--vscode-errorForeground); }
.k-error .codicon { color: var(--vscode-problemsWarningIcon-foreground); }
.k-marker .codicon { color: var(--vscode-charts-yellow); }
.k-question .codicon { color: var(--vscode-charts-orange); }
.none-note { color: var(--muted); font-size: .9em; }
.line { display: grid; grid-template-columns: 68px 1fr; gap: 8px; font-size: .9em; min-width: 0; }
.line .k { color: var(--muted); }
.line .v { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.sec { font-size: .78em; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin-top: 4px; }`;

const SCRIPT = String.raw`
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let columns = [], icons = {};

function ago(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + ' h ago';
  return new Date(ms).toLocaleDateString();
}
// a time today, else the day
const clock = (ms) => !ms ? '' : new Date(ms).toDateString() === new Date().toDateString()
  ? new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  : new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const STATE = { working: 'Working', waiting: 'Waiting on a long command or your OK', finished: 'Finished, waiting for you', idle: 'Idle', none: 'No Claude sessions yet' };

function chip(n, label, icon, bad) {
  return n ? '<span class="chip' + (bad ? ' bad' : '') + '"><i class="codicon codicon-' + icon + '"></i>' + n + ' ' + label + '</span>' : '';
}

function render() {
  const live = columns.filter((c) => c.session && (c.session.state === 'working' || c.session.state === 'waiting')).length;
  $('summary').textContent = columns.length ? (live ? live + ' of ' + columns.length + ' spaces active' : 'Nothing running right now') : '';
  $('empty').classList.toggle('hidden', columns.length > 0);
  $('cols').innerHTML = columns.map((c, i) => {
    const s = c.session, state = s ? s.state : 'none';
    const head = '<div class="head s-' + state + '" data-c="' + i + '">'
      + '<div class="row"><span class="name">' + esc(c.name) + '</span>' + (c.here ? '<span class="here">this window</span>' : '')
      + '<button class="go" data-space="' + i + '" title="Go to this space"><i class="codicon codicon-link-external"></i></button></div>'
      + '<div class="state"><span class="dot"></span><span>' + STATE[state] + (s && state !== 'working' ? ' · ' + ago(s.lastAt) : '') + '</span></div></div>';
    if (!s) return '<div class="col none">' + head + '<div class="body"><span class="none-note">Claude Code hasn\'t worked in this space\'s folders yet.</span></div></div>';
    const n = s.counts;
    if (s.loading) return '<div class="col">' + head + '<div class="body">'
      + '<button class="title" data-open="' + i + '" title="Open the transcript">' + esc(s.title) + '</button>'
      + '<span class="none-note"><i class="codicon codicon-loading codicon-modifier-spin"></i> Reading this session (a long one)…</span></div></div>';
    return '<div class="col">' + head + '<div class="body">'
      + '<button class="title" data-open="' + i + '" title="Open the transcript">' + esc(s.title) + '</button>'
      + '<div class="chips">' + chip(n.prompt, n.prompt === 1 ? 'message' : 'messages', 'account') + chip(n.commit, n.commit === 1 ? 'commit' : 'commits', 'git-commit')
      + chip(n.release, n.release === 1 ? 'release' : 'releases', 'rocket') + chip(n.testsFailed, 'test failures', 'error', true) + chip(n.error, n.error === 1 ? 'failure' : 'failures', 'warning', true) + '</div>'
      + (s.now ? '<div class="line"><span class="k">Latest</span><span class="v" title="' + esc(s.now) + '">' + esc(s.now) + '</span></div>' : '')
      + (s.lastYou ? '<div class="line"><span class="k">You asked</span><span class="v" title="' + esc(s.lastYou) + '">' + esc(s.lastYou.replace(/^You: /, '')) + '</span></div>' : '')
      + (s.checkpoints.length ? '<div class="sec">' + (s.onlyMessages ? 'Your messages' : 'Highlights') + '</div>' : '')
      + '<ul class="cps">' + s.checkpoints.map((cp, j) => '<li class="k-' + cp.kind + '"><button data-col="' + i + '" data-cp="' + j + '" title="' + esc(cp.label) + '">'
        + '<i class="codicon codicon-' + (icons[cp.kind] || 'bookmark') + '"></i><span class="lab">' + esc(cp.label) + '</span><span class="t">' + clock(cp.at) + '</span></button></li>').join('')
      + '</ul></div></div>';
  }).join('');
  // each header in its space's colour (set here: the page's security rules block style="" in markup)
  document.querySelectorAll('.head[data-c]').forEach((h) => { const c = columns[+h.dataset.c]; h.style.background = c.color; h.style.color = c.fg; });
}

$('cols').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.space) vscode.postMessage({ type: 'space', file: columns[+b.dataset.space].spaceFile });
  else if (b.dataset.open) vscode.postMessage({ type: 'checkpoint', file: columns[+b.dataset.open].session.file });
  else if (b.dataset.cp) { const c = columns[+b.dataset.col]; vscode.postMessage({ type: 'checkpoint', file: c.session.file, uuid: c.session.checkpoints[+b.dataset.cp].uuid }); }
};
window.addEventListener('message', (e) => {
  if (e.data.type === 'columns') { columns = e.data.columns; icons = e.data.icons || icons; render(); }
});
setInterval(render, 30000);   // keep "5 min ago" current
vscode.postMessage({ type: 'ready' });
`;
