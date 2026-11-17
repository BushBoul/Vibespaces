// The transcript viewer: one Claude Code session in a tab, read-only, with its checkpoints tagged. Opening a
// checkpoint scrolls to it. It follows the session as it grows (only what changed is sent to the page).
import * as vscode from 'vscode';
import { KIND_ICON, transcriptFor } from './checkpointsView';
import { sessionTitle } from './transcripts';
import { nonce, page, webviewRoots } from './webview';

const ICONS = Object.fromEntries(Object.entries(KIND_ICON).map(([k, [icon]]) => [k, icon]));

export class TranscriptPanel {
  private static panels = new Map<string, TranscriptPanel>();
  private panel: vscode.WebviewPanel;
  private ready = false;
  private pending: string | undefined;

  static show(extensionUri: vscode.Uri, file: string, uuid?: string) {
    let p = TranscriptPanel.panels.get(file);
    if (p) p.panel.reveal(undefined, false);
    else { p = new TranscriptPanel(extensionUri, file); TranscriptPanel.panels.set(file, p); }
    if (uuid) p.reveal(uuid);
  }

  // the session files changed: each open viewer gets what's new
  static refreshAll() {
    for (const p of TranscriptPanel.panels.values()) p.push(false);
  }

  private constructor(extensionUri: vscode.Uri, private file: string) {
    this.panel = vscode.window.createWebviewPanel('vibespaces.transcript', TranscriptPanel.title(file),
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: webviewRoots(extensionUri) });
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'activity.svg');
    this.panel.webview.html = page(this.panel.webview, extensionUri, nonce(), 'Transcript', BODY, SCRIPT, STYLE);
    this.panel.webview.onDidReceiveMessage((m) => {
      if (m?.type !== 'ready') return;
      this.ready = true;
      this.push(true);
      if (this.pending) { this.panel.webview.postMessage({ type: 'reveal', uuid: this.pending }); this.pending = undefined; }
    });
    this.panel.onDidDispose(() => TranscriptPanel.panels.delete(this.file));
  }

  private static title(file: string): string {
    const t = sessionTitle(file);
    return `Transcript: ${t.length > 40 ? t.slice(0, 39) + '…' : t}`;
  }

  private push(all: boolean) {
    if (!this.ready) return;
    const t = transcriptFor(this.file);
    const changes = t.takeChanges();
    const from = all ? 0 : changes.from;
    const items = all ? t.items : changes.items;
    if (!all && !items.length) return;
    this.panel.title = TranscriptPanel.title(this.file);
    this.panel.webview.postMessage({ type: 'items', from, items, icons: ICONS, title: sessionTitle(this.file) });
  }

  private reveal(uuid: string) {
    if (!this.ready) { this.pending = uuid; return; }
    this.panel.webview.postMessage({ type: 'reveal', uuid });
  }
}

const BODY = `
<div class="bar">
  <span id="title" class="ttl"></span>
  <label class="opt"><input type="checkbox" id="follow" checked> Follow new activity</label>
  <label class="opt"><input type="checkbox" id="hideTools"> Hide tool calls</label>
</div>
<div id="list"></div>
<p id="empty" class="hint hidden">Nothing in this session yet.</p>`;

const STYLE = `
body { padding: 0 0 40px; }
.bar { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 6px 18px; align-items: center; padding: 8px 16px;
  background: var(--vscode-editor-background); border-bottom: 1px solid var(--line); }
.ttl { font-weight: 600; margin-right: auto; }
.opt { display: inline-flex; gap: 6px; align-items: center; color: var(--muted); }
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
let icons = {}, pending = null;
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
      + (it.result != null ? '<div class="lbl">Result</div><pre>' + esc(it.result) + '</pre>' : '<div class="lbl">No result yet</div>') + '</details>';
  } else {
    el.innerHTML = cp + '<div class="who"><span>' + (it.role === 'you' ? 'You' : 'Claude') + '</span><span>' + clock(it.at) + '</span></div>' + md(it.text);
  }
  return el;
}

function reveal(uuid) {
  const el = document.getElementById('i-' + uuid);
  if (!el) { pending = uuid; return; }
  pending = null;
  $('follow').checked = false;   // looking back: stop jumping to the end
  const d = el.querySelector('details'); if (d) d.open = true;
  el.scrollIntoView({ block: 'center' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

window.addEventListener('message', (e) => {
  const m = e.data;
  if (m.type === 'items') {
    icons = m.icons || icons;
    if (m.title) $('title').textContent = m.title;
    const atEnd = window.innerHeight + window.scrollY >= document.body.scrollHeight - 60;
    while (list.children.length > m.from) list.lastElementChild.remove();
    const frag = document.createDocumentFragment();
    for (const it of m.items) frag.appendChild(render(it));
    list.appendChild(frag);
    $('empty').classList.toggle('hidden', list.children.length > 0);
    if (pending) reveal(pending);
    else if ($('follow').checked && (atEnd || m.from === 0)) window.scrollTo(0, document.body.scrollHeight);
  } else if (m.type === 'reveal') reveal(m.uuid);
});
$('hideTools').onchange = () => document.body.classList.toggle('notools', $('hideTools').checked);
$('follow').onchange = () => { if ($('follow').checked) window.scrollTo(0, document.body.scrollHeight); };
vscode.postMessage({ type: 'ready' });
`;
