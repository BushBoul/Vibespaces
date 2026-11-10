// The space editor: a form in an editor tab for one space (name, colour, folders, icon, what opens with it).
// It edits the space file; the file stays the source of truth, so changes made by hand show up here too.
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  OnOpen, PRESETS, Space, IconStyle, WINDOW_PRESETS, colorKeys, currentLook, currentSpace, nameTaken, readSpace, readWindow,
  renameSpace, sameFile, setFolders, setIcon, setOnOpen, setTheme, spacesFolder, validName, writeLook,
} from './spaces';
import { KIND_LABEL, allPresets, deletePreset, kindOf, missing, offerInstall, presetFrom, savePreset, summary, userPresets, withPreset } from './presets';
import { allPanels, allThemes, findPanel } from './panels';
import { defaultIconStyle, helperAvailable, iconSource, spaceIcon } from './taskbar';
import { nonce, page, webviewRoots } from './webview';
import { EDITOR_BODY, EDITOR_SCRIPT, EDITOR_STYLE } from './editorPage';

export interface EditorHost {
  extensionUri: vscode.Uri;
  extensionPath: string;
  log(m: string): void;
  openSpace(file: string): Promise<void>;
  deleteSpace(space: Space): Promise<boolean>;
  editJson(space: Space): Promise<void>;
  runOnOpen(space: Space): Promise<void>;
  saveWindowPosition(): Promise<boolean>;   // this window's position becomes its space's
  placeWindow(space: Space): Promise<void>; // put this window where its space says
  changed(): void;   // a space file was written
}

// what the form sends, checked before it goes in the file
function cleanOnOpen(o: any): OnOpen {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const show = (v: unknown) => (v === 'show' || v === 'hide' ? v : '') as '' | 'show' | 'hide';
  const lay = o?.layout || {};
  return {
    panels: Array.isArray(o?.panels) ? o.panels.filter((p: unknown) => typeof p === 'string') : [],
    layout: { left: show(lay.left), right: lay.right === 'maximize' ? 'maximize' : show(lay.right), bottom: show(lay.bottom) },
    files: Array.isArray(o?.files) ? o.files.filter((f: unknown) => typeof f === 'string') : [],
    terminals: (Array.isArray(o?.terminals) ? o.terminals : []).map((t: any) => ({ name: str(t?.name), command: str(t?.command) })),
    url: str(o?.url),
    urlIn: o?.urlIn === 'editor' ? 'editor' : 'browser',
    window: readWindow(o?.window),
    resetTabs: o?.resetTabs === 'close' ? 'close' : 'keep',
  };
}

export class SpaceEditor {
  private static editors: SpaceEditor[] = [];

  static show(host: EditorHost, space: Space) {
    const open = SpaceEditor.editors.find((e) => sameFile(e.file, space.file));
    if (open) { open.panel.reveal(); return; }
    SpaceEditor.editors.push(new SpaceEditor(host, space.file));
  }

  // a space file changed on disk (by us, by hand, or by another window)
  static refreshAll() {
    for (const e of SpaceEditor.editors) e.post();
  }

  private panel: vscode.WebviewPanel;
  private iconJob = 0;

  private constructor(private host: EditorHost, private file: string) {
    this.panel = vscode.window.createWebviewPanel('vibespaces.editor', this.title(), vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [...webviewRoots(host.extensionUri), vscode.Uri.file(path.join(spacesFolder(), 'icons'))],
    });
    this.panel.iconPath = vscode.Uri.joinPath(host.extensionUri, 'media', 'icon.png');
    this.panel.webview.html = this.html();
    this.panel.webview.onDidReceiveMessage((m) => this.handle(m).catch((e) => this.error(e)));
    this.panel.onDidDispose(() => { SpaceEditor.editors = SpaceEditor.editors.filter((x) => x !== this); });
  }

  private title() {
    return `Space: ${path.basename(this.file, path.extname(this.file))}`;
  }

  private space(): Space | undefined {
    return readSpace(this.file);
  }

  private post() {
    const s = this.space();
    if (!s) { this.panel.webview.postMessage({ type: 'gone' }); return; }
    this.panel.title = this.title();
    const look = currentLook();
    const here = currentSpace();
    const panels = allPanels().map((p) => ({ id: p.id, label: p.label, group: p.group }));
    // a saved panel whose extension is gone still shows, so it can be unticked
    for (const id of s.onOpen.panels) {
      const p = findPanel(id);
      if (!p) panels.push({ id, label: `${id} (not installed)`, group: 'Not installed' });
    }
    this.panel.webview.postMessage({
      type: 'state',
      space: {
        name: s.name, file: s.file, color: s.color ?? '', folders: s.folders,
        iconStyle: s.iconStyle ?? '', iconImage: s.iconImage ?? '', theme: s.theme ?? '',
        onOpen: { ...s.onOpen, panels: s.onOpen.panels.map((id) => findPanel(id)?.id ?? id) },
      },
      defaultIconStyle: defaultIconStyle(),
      keys: s.color ? colorKeys(s.color, look) : {},
      presets: PRESETS,
      panels,
      themes: allThemes(),
      spacePresets: allPresets().map((p) => ({
        name: p.name, summary: summary(p), builtIn: !!p.builtIn, group: KIND_LABEL[kindOf(p)], missing: missing(p)?.name ?? '',
      })),
      windowPresets: WINDOW_PRESETS,
      isCurrent: !!here && sameFile(here.file, s.file),
      windows: helperAvailable(),
    });
    this.makeIcon(s);
  }

  // the taskbar icon preview (made by the helper, so it lags the colour by a second or so)
  private async makeIcon(s: Space) {
    if (!helperAvailable() || !s.color) return;
    const job = ++this.iconJob;
    try {
      const ico = await spaceIcon(this.host.extensionPath, s, (m) => this.host.log(m));
      if (job !== this.iconJob || !ico) return;
      const uri = this.panel.webview.asWebviewUri(vscode.Uri.file(ico)).toString();
      this.panel.webview.postMessage({ type: 'icon', uri, style: iconSource(s).style });
    } catch (e: any) {
      this.host.log(`icon: ${e.message}`);
    }
  }

  private async handle(m: any) {
    const s = this.space();
    if (m.type === 'ready') { this.post(); return; }
    if (!s) return;
    switch (m.type) {
      case 'reset':
        await vscode.commands.executeCommand('vibespaces.resetLayout');
        break;
      case 'settings':
        await vscode.commands.executeCommand('vibespaces.settings.focus');
        break;
      case 'color':
        if (/^#[0-9a-f]{6}$/i.test(m.color)) { writeLook(s.file, m.color.toLowerCase()); this.saved(); }
        break;
      case 'rename': {
        const name = String(m.name || '').trim();
        if (name === s.name) break;
        const bad = validName(name) ?? (nameTaken(name, s.file) ? 'That name is taken' : undefined);
        if (bad) { this.panel.webview.postMessage({ type: 'nameError', message: bad }); this.post(); break; }
        const isCurrent = !!currentSpace() && sameFile(currentSpace()!.file, s.file);
        const ok = await vscode.window.showWarningMessage(
          `Rename "${s.name}" to "${name}"?`,
          {
            modal: true,
            detail: (isCurrent ? 'This window reopens as the renamed space. ' : 'If it\'s open in another window, close that window first. ')
              + 'Its taskbar pin keeps working. VS Code may forget this window\'s panel layout once.',
          },
          'Rename');
        if (ok !== 'Rename') { this.post(); break; }
        this.file = renameSpace(s, name);
        this.saved();
        this.post();
        if (isCurrent) await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(this.file), { forceNewWindow: false });
        break;
      }
      case 'addFolder': {
        const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: true, openLabel: 'Add to this space' });
        if (!picked?.length) break;
        const all = [...s.folders];
        for (const u of picked) if (!all.some((f) => sameFile(f, u.fsPath))) all.push(u.fsPath);
        setFolders(s.file, all);
        this.saved();
        break;
      }
      case 'removeFolder':
        if (s.folders.length <= 1) { vscode.window.showInformationMessage('A space needs at least one folder.'); break; }
        setFolders(s.file, s.folders.filter((f) => !sameFile(f, m.folder)));
        this.saved();
        break;
      case 'iconStyle': {
        const style = (m.style || undefined) as IconStyle | undefined;
        if (style === 'image' && !s.iconImage) { await this.pickImage(s); break; }
        setIcon(s.file, style);
        this.saved();
        break;
      }
      case 'pickImage':
        await this.pickImage(s);
        break;
      case 'onOpen':
        setOnOpen(s.file, cleanOnOpen(m.onOpen));
        this.saved();
        break;
      case 'addFile': {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: true, openLabel: 'Open these with the space',
          defaultUri: s.folders[0] ? vscode.Uri.file(s.folders[0]) : undefined,
        });
        if (!picked?.length) break;
        // inside the space's first folder: stored relative, so the space still works if the folder moves
        const base = s.folders[0];
        const rel = (f: string) => {
          const r = base ? path.relative(base, f) : '';
          return r && !r.startsWith('..') && !path.isAbsolute(r) ? r.replace(/\\/g, '/') : f;
        };
        const files = [...s.onOpen.files];
        for (const u of picked) { const f = rel(u.fsPath); if (!files.includes(f)) files.push(f); }
        setOnOpen(s.file, { ...s.onOpen, files });
        this.saved();
        break;
      }
      case 'theme':
        setTheme(s.file, String(m.theme || ''));
        this.saved();
        break;
      case 'runNow':
        await this.host.runOnOpen(s);
        break;
      case 'winSave':
        await this.host.saveWindowPosition();
        break;
      case 'winPreset': {
        const v = String(m.value || '');
        if (v === 'custom') break;   // the saved spot stays as it is
        const preset = WINDOW_PRESETS.find((p) => p.id === v)?.id;
        const window = preset ? { preset, x: 0, y: 0, width: 0, height: 0, maximized: false, atOpen: s.onOpen.window?.atOpen ?? true } : undefined;
        setOnOpen(s.file, { ...s.onOpen, window });
        this.saved();
        const here = currentSpace();
        if (preset && here && sameFile(here.file, s.file)) await this.host.placeWindow(readSpace(s.file)!);   // show it now
        break;
      }
      case 'applyPreset': {
        const p = allPresets().find((x) => x.name === m.name);
        if (!p) break;
        const ok = await vscode.window.showWarningMessage(`Apply the preset "${p.name}" to "${s.name}"?`, {
          modal: true,
          detail: `${summary(p)}\n\nThis replaces the space's panels, window arrangement and tab tidying. Its files, terminals, web page and window position stay.`,
        }, 'Apply');
        if (ok !== 'Apply') break;
        setOnOpen(s.file, withPreset(s.onOpen, p));
        this.saved();
        offerInstall(p);
        break;
      }
      case 'savePreset': {
        const name = (await vscode.window.showInputBox({
          title: 'Save this space\'s setup as a preset',
          prompt: 'Its panels, window arrangement and tab tidying (not its files, terminals, web page or window position)',
          value: `${s.name} setup`,
          validateInput: (v) => (v.trim() ? undefined : 'Give the preset a name'),
        }))?.trim();
        if (!name) break;
        const existing = allPresets().find((x) => x.name.toLowerCase() === name.toLowerCase());
        if (existing) {
          const what = existing.builtIn ? 'a built-in preset (yours will be used instead)' : 'one of your presets';
          const ok = await vscode.window.showWarningMessage(`"${existing.name}" is already ${what}. Replace it?`, { modal: true }, 'Replace');
          if (ok !== 'Replace') break;
        }
        await savePreset(presetFrom(name, s.onOpen));
        vscode.window.showInformationMessage(`Saved the preset "${name}". Pick it when you make a new space, or apply it here.`);
        this.post();
        break;
      }
      case 'deletePreset': {
        const pick = await vscode.window.showQuickPick(userPresets().map((p) => ({ label: p.name, description: summary(p) })), { placeHolder: 'Delete which of your presets?' });
        if (!pick) break;
        await deletePreset(pick.label);
        this.post();
        break;
      }
      case 'winAtOpen':
        if (s.onOpen.window) { setOnOpen(s.file, { ...s.onOpen, window: { ...s.onOpen.window, atOpen: !!m.on } }); this.saved(); }
        break;
      case 'open':
        await this.host.openSpace(s.file);
        break;
      case 'json':
        await this.host.editJson(s);
        break;
      case 'delete':
        if (await this.host.deleteSpace(s)) this.panel.dispose();
        break;
    }
  }

  private async pickImage(s: Space) {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false, openLabel: 'Use as the icon',
      filters: { Images: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'ico'] },
    });
    if (!picked?.length || !fs.existsSync(picked[0].fsPath)) { this.post(); return; }
    setIcon(s.file, 'image', picked[0].fsPath);
    this.saved();
  }

  private error(e: any) {
    this.host.log(`editor: ${e?.message ?? e}`);
    vscode.window.showErrorMessage(`Vibespaces: ${e?.message ?? e}`);
    this.post();
  }

  // a change went in the file: tell the list and the other editors, and show "Saved" here
  private saved() {
    this.host.changed();
    this.panel.webview.postMessage({ type: 'saved' });
  }

  private html(): string {
    return page(this.panel.webview, this.host.extensionUri, nonce(), 'Space', EDITOR_BODY, EDITOR_SCRIPT, EDITOR_STYLE);
  }
}
