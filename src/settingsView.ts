// The Settings section under the Spaces list: Vibespaces' own settings as a small form.
import * as vscode from 'vscode';
import { TARGETS, currentLook, spacesFolder } from './spaces';
import { defaultIconStyle, helperAvailable } from './taskbar';
import { nonce, page, webviewRoots } from './webview';

export interface SettingsHost {
  extensionUri: vscode.Uri;
  reapplyAll(): Promise<number>;   // repaint every space file with the current look; returns how many
}

export class SettingsView implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(private host: SettingsHost) {}

  refresh() {
    this.post();
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: webviewRoots(this.host.extensionUri) };
    view.webview.html = page(view.webview, this.host.extensionUri, nonce(), 'Settings', BODY, SCRIPT, STYLE);
    view.webview.onDidReceiveMessage((m) => this.handle(m).catch((e) => vscode.window.showErrorMessage(`Vibespaces: ${e.message}`)));
    view.onDidChangeVisibility(() => view.visible && this.post());
  }

  private post() {
    if (!this.view) return;
    const c = vscode.workspace.getConfiguration('vibespaces');
    const look = currentLook();
    this.view.webview.postMessage({
      type: 'state',
      folder: spacesFolder(),
      targets: look.targets,
      targetList: TARGETS,
      intensity: look.intensity,
      taskbar: c.get<boolean>('taskbar', true),
      globalShortcut: (c.get<string>('globalShortcut') ?? '').trim(),
      iconStyle: defaultIconStyle(),
      windows: helperAvailable(),
    });
  }

  private async handle(m: any) {
    const c = vscode.workspace.getConfiguration('vibespaces');
    const G = vscode.ConfigurationTarget.Global;
    switch (m.type) {
      case 'ready':
        break;
      case 'target':
        await c.update('colorTargets', { ...currentLook().targets, [m.key]: !!m.on }, G);
        await this.host.reapplyAll();
        break;
      case 'intensity':
        await c.update('intensity', m.value === 'subtle' ? 'subtle' : 'bold', G);
        await this.host.reapplyAll();
        break;
      case 'taskbar':
        await c.update('taskbar', !!m.on, G);
        break;
      case 'globalKey':
        // on: the default key (a custom one is set in All settings); off: empty
        await c.update('globalShortcut', m.on ? undefined : '', G);
        break;
      case 'iconStyle':
        await c.update('iconStyle', ['initials', 'vscode'].includes(m.value) ? m.value : 'window', G);
        break;
      case 'folder': {
        const picked = await vscode.window.showOpenDialog({
          canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Keep my spaces here',
          defaultUri: vscode.Uri.file(spacesFolder()),
        });
        if (picked?.length) await c.update('folder', picked[0].fsPath, G);
        break;
      }
      case 'reveal':
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(spacesFolder()));
        break;
      case 'guide':
        await vscode.commands.executeCommand('vibespaces.walkthrough');
        break;
      case 'all':
        await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:bushboul.vibespaces');
        break;
    }
    this.post();
  }
}

const STYLE = `
body { background: transparent; padding: 6px 10px 18px; }
.card { scroll-margin-top: 0; margin-bottom: 10px; }
.card-head { padding: 10px 12px 8px; gap: 10px; }
.card-head > .codicon { font-size: 16px; }
.card-head h2 { font-size: 1em; }
.card-body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 8px; }
.mini { position: relative; height: 74px; border: 1px solid var(--line); border-radius: 5px; overflow: hidden; background: var(--vscode-editor-background); }
.mini div { position: absolute; background: var(--line); transition: background .2s; }
.mini .t { left: 0; right: 0; top: 0; height: 11px; }
.mini .a { left: 0; top: 11px; bottom: 9px; width: 12px; }
.mini .tab { left: 18px; top: 15px; width: 38px; height: 9px; background: var(--vscode-tab-activeBackground, var(--line)); border-top: 2px solid transparent; }
.mini .s { left: 0; right: 0; bottom: 0; height: 9px; }
.mini.border { box-shadow: 0 0 0 2px var(--accent) inset; }
.mini .on { background: var(--accent); }
.mini .tab.on { background: var(--vscode-tab-activeBackground, var(--line)); border-top-color: var(--accent); }
.seg { width: 100%; }
.seg button { flex: 1; justify-content: center; }
select { width: 100%; }
.path { font-size: .9em; word-break: break-all; color: var(--muted); }
.links { display: flex; flex-direction: column; gap: 4px; padding: 4px 2px; }
`;

const BODY = `
<section class="card">
  <div class="card-head"><i class="codicon codicon-paintcan"></i><div><h2>Colour</h2><p class="desc">Which parts of a space's window get its colour.</p></div></div>
  <div class="card-body">
    <div class="mini" id="mini"><div class="t" id="m-titleBar"></div><div class="a" id="m-activityBar"></div><div class="tab" id="m-tabs"></div><div class="s" id="m-statusBar"></div></div>
    <div id="targets"></div>
    <span class="label">Strength</span>
    <div class="seg" id="intensity"><button data-v="bold">Bold</button><button data-v="subtle">Subtle</button></div>
    <p class="desc" id="intensityHint"></p>
  </div>
</section>

<section class="card" id="win">
  <div class="card-head"><i class="codicon codicon-pinned"></i><div><h2>Taskbar</h2><p class="desc">Windows taskbar buttons for spaces.</p></div></div>
  <div class="card-body">
    <label class="switch"><input type="checkbox" id="taskbar"> Each space gets its own button</label>
    <label class="switch"><input type="checkbox" id="globalKey"> Group shortcut works from any app</label>
    <p class="desc" id="globalKeyHint"></p>
    <span class="label">Icon for new spaces</span>
    <div class="seg" id="iconStyle"><button data-v="window">Window</button><button data-v="initials">Initials</button><button data-v="vscode">VS Code logo</button></div>
    <p class="desc" id="logoNote">The VS Code logo option recolours your own VS Code's icon. VS Code's brand rules don't allow modified logos, so keep it for your own use, not in screenshots you share.</p>
  </div>
</section>

<section class="card">
  <div class="card-head"><i class="codicon codicon-folder"></i><div><h2>Where spaces are kept</h2></div></div>
  <div class="card-body">
    <p class="path mono" id="folder"></p>
    <div class="row"><button class="ghost" id="changeFolder">Change…</button><button class="ghost" id="reveal"><i class="codicon codicon-folder-opened"></i> Show</button></div>
  </div>
</section>

<div class="links">
  <button class="link" id="guide"><i class="codicon codicon-question"></i> How Vibespaces works</button>
  <button class="link" id="all"><i class="codicon codicon-settings-gear"></i> All Vibespaces settings</button>
</div>`;

const SCRIPT = `
const vs = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
const send = (type, extra) => vs.postMessage(Object.assign({ type }, extra || {}));
const setSeg = (el, v) => el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
window.addEventListener('message', (e) => {
  const m = e.data;
  if (m.type !== 'state') return;
  $('targets').innerHTML = m.targetList.map((t) =>
    '<label class="switch"><input type="checkbox" data-k="' + t.key + '"' + (m.targets[t.key] ? ' checked' : '') + '> ' + t.label + '</label>').join('');
  for (const k of ['titleBar', 'activityBar', 'tabs', 'statusBar']) $('m-' + k).classList.toggle('on', !!m.targets[k]);
  $('mini').classList.toggle('border', !!m.targets.border);
  setSeg($('intensity'), m.intensity);
  $('intensityHint').textContent = m.intensity === 'subtle' ? 'A tint of the colour, mixed into the theme.' : 'The full colour.';
  $('taskbar').checked = m.taskbar;
  $('globalKey').checked = !!m.globalShortcut;
  $('globalKeyHint').textContent = m.globalShortcut
    ? m.globalShortcut.split('+').map((k) => k.charAt(0).toUpperCase() + k.slice(1)).join('+') + ' puts your group back and brings it to the front, even from another app.'
    : 'Off: the group shortcut works only while VS Code is in front.';
  setSeg($('iconStyle'), ['initials', 'vscode'].includes(m.iconStyle) ? m.iconStyle : 'window');
  $('logoNote').classList.toggle('hidden', m.iconStyle !== 'vscode');
  $('win').classList.toggle('hidden', !m.windows);
  $('folder').textContent = m.folder;
  $('folder').title = m.folder;
});
$('targets').onchange = (e) => send('target', { key: e.target.dataset.k, on: e.target.checked });
$('intensity').onclick = (e) => { const b = e.target.closest('button'); if (b) send('intensity', { value: b.dataset.v }); };
$('taskbar').onchange = () => send('taskbar', { on: $('taskbar').checked });
$('globalKey').onchange = () => send('globalKey', { on: $('globalKey').checked });
$('iconStyle').onclick = (e) => { const b = e.target.closest('button'); if (b) send('iconStyle', { value: b.dataset.v }); };
$('changeFolder').onclick = () => send('folder');
$('reveal').onclick = () => send('reveal');
$('guide').onclick = () => send('guide');
$('all').onclick = () => send('all');
send('ready');
`;
