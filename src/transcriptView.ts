// The transcript viewer: one Claude Code session in a tab, read-only, with its checkpoints tagged. A session can be
// tens of thousands of items, so the page shows a window of them (around the checkpoint you opened, or the end), with
// buttons for earlier and later ones; their full text is read from the file only for what's shown. While the window
// reaches the end, it follows the session as it grows.
import * as vscode from 'vscode';
import { KIND_ICON, transcriptFor } from './checkpointsView';
import { Transcript, sessionTitle } from './transcripts';
import { nonce, page, webviewRoots } from './webview';

const ICONS = Object.fromEntries(Object.entries(KIND_ICON).map(([k, [icon]]) => [k, icon]));
const WINDOW = 300;   // items on the page at once
const STEP = 300;     // how many more "Show earlier" / "Show later" adds

export class TranscriptPanel {
  private static panels = new Map<string, TranscriptPanel>();
  private panel: vscode.WebviewPanel;
  private ready = false;
  private pending: string | undefined;
  private start = 0;   // the window: items start..end
  private end = 0;

  static show(extensionUri: vscode.Uri, file: string, uuid?: string) {
    let p = TranscriptPanel.panels.get(file);
    if (p) { p.panel.reveal(undefined, false); if (uuid) void p.goTo(uuid); else void p.goTo(); return; }
    p = new TranscriptPanel(extensionUri, file);
    TranscriptPanel.panels.set(file, p);
    p.pending = uuid;
  }

  // the session files changed: each open viewer gets what's new
  static refreshAll() {
    for (const p of TranscriptPanel.panels.values()) void p.follow();
  }

  private constructor(extensionUri: vscode.Uri, private file: string) {
    this.panel = vscode.window.createWebviewPanel('vibespaces.transcript', TranscriptPanel.title(file),
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: webviewRoots(extensionUri) });
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'activity.svg');
    this.panel.webview.html = page(this.panel.webview, extensionUri, nonce(), 'Transcript', BODY, SCRIPT, STYLE);
    this.panel.webview.onDidReceiveMessage((m) => this.handle(m));
    this.panel.onDidDispose(() => TranscriptPanel.panels.delete(this.file));
  }

  private static title(file: string): string {
    const t = sessionTitle(file);
    return `Transcript: ${t.length > 40 ? t.slice(0, 39) + '…' : t}`;
  }

  private async handle(m: any) {
    if (m?.type === 'ready') {
      this.ready = true;
      await this.goTo(this.pending);
      this.pending = undefined;
    } else if (m?.type === 'earlier') {
      const t = await transcriptFor(this.file);
      this.show(t, Math.max(0, this.start - STEP), this.end, undefined, 'earlier');
    } else if (m?.type === 'later') {
      const t = await transcriptFor(this.file);
      this.show(t, this.start, Math.min(t.items.length, this.end + STEP));
    } else if (m?.type === 'end') {
      await this.goTo();
    }
  }

  // show the window around a checkpoint, or the end of the session
  private async goTo(uuid?: string) {
    if (!this.ready) { this.pending = uuid; return; }
    const t = await transcriptFor(this.file);
    t.takeChanges();
    const n = t.items.length;
    const at = uuid ? t.indexOf(uuid) : -1;
    if (at >= 0) {
      const start = Math.max(0, at - WINDOW / 2);
      this.show(t, start, Math.min(n, start + WINDOW), uuid);
    } else {
      this.show(t, Math.max(0, n - WINDOW), n);
    }
  }

  private show(t: Transcript, start: number, end: number, reveal?: string, keep?: 'earlier') {
    this.start = start; this.end = end;
    this.panel.title = TranscriptPanel.title(this.file);
    this.panel.webview.postMessage({
      type: 'window', start, total: t.items.length, items: t.full(start, end), icons: ICONS, title: sessionTitle(this.file), reveal, keep,
    });
  }

  // new activity: added to the page if the window reaches the end of the session
  private async follow() {
    if (!this.ready) return;
    const t = await transcriptFor(this.file);
    const from = t.takeChanges();   // the first item that's new or changed
    const n = t.items.length;
    if (from >= n && this.end >= n) return;   // nothing new
    if (this.end >= from) {
      // the window reaches the changes: send everything from the first change on, and the window grows to the end
      const send = Math.max(from, this.start);
      this.end = n;
      this.panel.webview.postMessage({ type: 'more', from: send, total: n, items: t.full(send, n), icons: ICONS });
    } else {
      this.panel.webview.postMessage({ type: 'total', total: n });   // looking further back: only the count below grows
    }
  }
}

const BODY = `
<div class="bar">
  <span id="title" class="ttl"></span>
  <label class="opt"><input type="checkbox" id="follow" checked> Follow new activity</label>
  <label class="opt"><input type="checkbox" id="hideTools"> Hide tool calls</label>
</div>
<div class="more"><button class="secondary hidden" id="earlier"></button></div>
<div id="list"></div>
<div class="more"><button class="secondary hidden" id="later"></button></div>
<p id="empty" class="hint hidden pad">Nothing in this session yet.</p>`;

const STYLE = `
body { padding: 0 0 40px; }
.bar { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 6px 18px; align-items: center; padding: 8px 16px;
  background: var(--vscode-editor-background); border-bottom: 1px solid var(--line); }
.ttl { font-weight: 600; margin-right: auto; }
.opt { display: inline-flex; gap: 6px; align-items: center; color: var(--muted); }
.pad { padding: 12px 16px; }
.more { padding: 8px 16px 0; }
#list { display: flex; flex-direction: column; gap: 10px; padding: 12px 16px; max-width: 980px; }
.it { border-radius: var(--radius); padding: 8px 12px; scroll-margin: 70px; }
.it.you { background: var(--vscode-textBlockQuote-background, rgba(128,128,128,.1)); border-left: 3px solid var(--accent); }
.it.claude { padding-left: 15px; }
.it.tool { padding: 2px 15px; }
.who { font-size: .85em; color: var(--muted); margin-bottom: 4px; display: flex; gap: 8px; }
.md { white-space: pre-wrap; word-wrap: break-word; }
.md code, .tool .mono { font-family: var(--vscode-editor-font-family); font-size: .92em; }
.md code { background: var(--vscode-textCodeBlock-background); padding: 0 4px; border-radius: 3px; }
.md .h { display: inline-block; margin-top: 4px; }
pre { white-space: pre-wrap; word-wrap: break-word; margin: 6px 0; padding: 8px 10px; border-radius: 4px; max-height: 360px; overflow: auto;
  background: var(--vscode-textCodeBlock-background); font-family: var(--vscode-editor-font-family); font-size: .9em; }
details summary { cursor: pointer; color: var(--muted); display: flex; gap: 6px; align-items: center; min-width: 0; }
details summary .mono { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
details summary b { color: var(--vscode-foreground); font-weight: 600; flex: none; }
.err summary b, .err summary .codicon { color: var(--vscode-errorForeground); }
.lbl { font-size: .85em; color: var(--muted); margin-top: 6px; }
.cp { display: inline-flex; gap: 6px; align-items: center; font-size: .85em; font-weight: 600; padding: 2px 8px; margin-bottom: 6px; border-radius: 10px;
  background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); max-width: 100%; }
.cp span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.notools .tool:not(.has-cp) { display: none; }
.flash { animation: flash 1.6s ease-out; }
@keyframes flash { from { box-shadow: 0 0 0 2px var(--accent); background: var(--vscode-editor-findMatchHighlightBackground); } to { box-shadow: 0 0 0 2px transparent; } }
@media (prefers-reduced-motion: reduce) { .flash { animation: none; outline: 2px solid var(--accent); } }`;

// String.raw keeps the regular expressions as written (a backtick is \x60 in them)
const SCRIPT = String.raw`
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
const list = $('list');
let icons = {}, start = 0, total = 0;
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clock = (ms) => ms ? new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';

// enough Markdown to read replies: code blocks, inline code, bold, headings, links (as their text)
function inline(t) {
  return esc(t.replace(/^\n+|\s+$/g, ''))
    .replace(/\x60([^\x60\n]+)\x60/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/^#{1,6}\s+(.+)$/gm, '<b class="h">$1</b>')
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '<u title="$2">$1</u>');
}
function md(t) {
  return String(t ?? '').split(/\x60\x60\x60[^\n]*\n?/).map((p, i) => i % 2
    ? '<pre>' + esc(p.replace(/\n$/, '')) + '</pre>'
    : (p.trim() ? '<div class="md">' + inline(p) + '</div>' : '')).join('');
}

function render(it) {
  const el = document.createElement('div');
  el.id = 'i-' + it.uuid;
  el.className = 'it ' + it.role + (it.checkpoint ? ' has-cp' : '') + (it.error ? ' err' : '');
  const cp = it.checkpoint ? '<div class="cp"><i class="codicon codicon-' + (icons[it.checkpoint.kind] || 'bookmark') + '"></i><span>' + esc(it.checkpoint.label) + '</span></div>' : '';
  if (it.role === 'tool') {
    el.innerHTML = cp + '<details><summary><i class="codicon codicon-' + (it.error ? 'error' : 'tools') + '"></i><b>' + esc(it.tool) + '</b><span class="mono">' + esc(it.summary) + '</span></summary>'
      + (it.input ? '<div class="lbl">Input</div><pre>' + esc(it.input) + '</pre>' : '')
      + (it.done ? '<div class="lbl">Result</div><pre>' + esc(it.result || '(nothing)') + '</pre>' : '<div class="lbl">No result yet</div>') + '</details>';
  } else {
    el.innerHTML = cp + '<div class="who"><span>' + (it.role === 'you' ? 'You' : 'Claude') + '</span><span>' + clock(it.at) + '</span></div>' + md(it.text);
  }
  return el;
}

function buttons() {
  const end = start + list.children.length;
  $('earlier').textContent = 'Show earlier (' + start + ' more)';
  $('earlier').classList.toggle('hidden', start <= 0);
  $('later').textContent = 'Show later (' + (total - end) + ' more)';
  $('later').classList.toggle('hidden', end >= total);
  $('empty').classList.toggle('hidden', total > 0);
}

function reveal(uuid) {
  const el = document.getElementById('i-' + uuid);
  if (!el) return;
  $('follow').checked = false;   // looking back: stop jumping to the end
  const d = el.querySelector('details'); if (d) d.open = true;
  el.scrollIntoView({ block: 'center' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

const atEnd = () => window.innerHeight + window.scrollY >= document.body.scrollHeight - 60;

window.addEventListener('message', (e) => {
  const m = e.data;
  icons = m.icons || icons;
  if (m.type === 'window') {
    if (m.title) $('title').textContent = m.title;
    // "Show earlier": keep what's on screen where it is
    const anchor = m.keep === 'earlier' ? list.firstElementChild : null, top = anchor ? anchor.getBoundingClientRect().top : 0;
    start = m.start; total = m.total;
    list.textContent = '';
    const frag = document.createDocumentFragment();
    for (const it of m.items) frag.appendChild(render(it));
    list.appendChild(frag);
    buttons();
    if (m.reveal) reveal(m.reveal);
    else if (anchor && document.getElementById(anchor.id)) window.scrollBy(0, document.getElementById(anchor.id).getBoundingClientRect().top - top);
    else if (!m.keep) window.scrollTo(0, document.body.scrollHeight);
  } else if (m.type === 'more') {
    const follow = $('follow').checked && atEnd();
    total = m.total;
    while (list.children.length > m.from - start) list.lastElementChild.remove();
    const frag = document.createDocumentFragment();
    for (const it of m.items) frag.appendChild(render(it));
    list.appendChild(frag);
    buttons();
    if (follow) window.scrollTo(0, document.body.scrollHeight);
  } else if (m.type === 'total') { total = m.total; buttons(); }
});
$('earlier').onclick = () => vscode.postMessage({ type: 'earlier' });
$('later').onclick = () => vscode.postMessage({ type: 'later' });
$('hideTools').onchange = () => document.body.classList.toggle('notools', $('hideTools').checked);
$('follow').onchange = () => { if ($('follow').checked) vscode.postMessage({ type: 'end' }); };
vscode.postMessage({ type: 'ready' });
`;
