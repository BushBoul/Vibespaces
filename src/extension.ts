import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  PRESETS, Space, WINDOW_PRESETS, WindowPreset, WindowSpot, createSpaceFile, currentSpace, ensureId, listSpaces, moveSpace, nameTaken,
  placeSpaces, readSpace, renameSpace, sameFile, setOnOpen, spacesFolder, validName, writeLook,
} from './spaces';
import { allPanels, findPanel, tabOpen } from './panels';
import { KIND_LABEL, Preset, allPresets, kindOf, missing, offerInstall, summary, withPreset } from './presets';
import { helperAvailable, identifyWindow, placeWindow, raiseWindow, whereWindow } from './taskbar';
import { SpaceEditor, EditorHost } from './editor';
import { SettingsView } from './settingsView';
import { GlobalHotkey, shortcutKey } from './hotkey';
import {
  Group, Launch, Member, Signal, allGroups, describeSpot, groupsOf, memberFor, memberSpace, prettyShortcut, readSignal, saveGroups,
  sendSignal, signalFor, signalPath, spotInSignal, terminalsInSignal,
} from './groups';
import { spawn } from 'child_process';

const WALKTHROUGH = 'bushboul.vibespaces#vibespaces.start';

let output: vscode.OutputChannel;
let extPath = '';
const log = (m: string) => output.appendLine(`${new Date().toLocaleTimeString()} ${m}`);

export function activate(ctx: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel('Vibespaces');
  extPath = ctx.extensionPath;
  const tree = new SpacesTree(ctx);
  const groupsTree = new GroupsTree(ctx);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = 'vibespaces.open';
  const paintStatus = () => {
    const s = currentSpace();
    status.text = `$(window) ${s ? s.name : 'Vibespaces'}`;
    status.tooltip = s ? `This window is the space "${s.name}". Click to open another space.` : 'Open a space';
    status.show();
    vscode.commands.executeCommand('setContext', 'vibespaces.isSpace', !!s);   // which button the list's title bar shows
  };
  paintStatus();

  const settings = new SettingsView({ extensionUri: ctx.extensionUri, reapplyAll });

  // something wrote a space file: the list, the status bar, open editors and (for this window's space) the taskbar icon
  let lastIconKey = iconKey(currentSpace());
  const changed = () => {
    tree.refresh();
    groupsTree.refresh();
    paintStatus();
    SpaceEditor.refreshAll();
    const key = iconKey(currentSpace());
    if (key !== lastIconKey) { lastIconKey = key; applyTaskbar(ctx, true, false); }
  };

  const editorHost: EditorHost = {
    extensionUri: ctx.extensionUri,
    extensionPath: ctx.extensionPath,
    log,
    openSpace,
    deleteSpace,
    editJson: async (s) => { await vscode.window.showTextDocument(vscode.Uri.file(s.file)); },
    runOnOpen,
    saveWindowPosition,
    placeWindow: async (s) => {
      if (!s.onOpen.window || !helperAvailable()) return;
      try { await placeWindow(extPath, s, s.onOpen.window, log); } catch (e: any) { log(`window: ${e.message}`); }
    },
    changed,
  };
  const target = async (item: SpaceItem | undefined, prompt: string) =>
    item?.space ?? currentSpace() ?? await pickSpace(prompt);

  ctx.subscriptions.push(
    output, status,
    // drag spaces to put the list in your own order (several at once with Ctrl/Shift)
    vscode.window.createTreeView('vibespaces.list', { treeDataProvider: tree, dragAndDropController: new SpacesDrop(), canSelectMany: true }),
    vscode.commands.registerCommand('vibespaces.moveUp', (item?: SpaceItem) => item && moveSpace(item.space.file, -1)),
    vscode.commands.registerCommand('vibespaces.moveDown', (item?: SpaceItem) => item && moveSpace(item.space.file, 1)),
    vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration('vibespaces.order')) tree.refresh(); }),
    vscode.window.registerWebviewViewProvider('vibespaces.settings', settings),
    vscode.commands.registerCommand('vibespaces.open', () => pickAndOpen()),
    vscode.commands.registerCommand('vibespaces.openSpace', (arg: string | SpaceItem) => openSpace(typeof arg === 'string' ? arg : arg.space.file)),
    vscode.commands.registerCommand('vibespaces.create', () => createSpace()),
    vscode.commands.registerCommand('vibespaces.fromWindow', () => spaceFromWindow()),
    vscode.commands.registerCommand('vibespaces.edit', async (item?: SpaceItem) => {
      const s = await target(item, 'Edit which space?');
      if (s) SpaceEditor.show(editorHost, s);
    }),
    vscode.commands.registerCommand('vibespaces.editThis', () => {
      const s = currentSpace();
      if (s) SpaceEditor.show(editorHost, s);
      else vscode.window.showInformationMessage('This window isn\'t a space yet. Use Make This Window a Space.');
    }),
    vscode.commands.registerCommand('vibespaces.resetLayout', async () => {
      const s = currentSpace();
      if (!s) { vscode.window.showInformationMessage('This window isn\'t a space yet. Use Make This Window a Space.'); return; }
      const L = s.onOpen.layout;
      if (!s.onOpen.panels.length && !L.left && !L.right && !L.bottom && !s.onOpen.window && s.onOpen.resetTabs !== 'close') {
        const go = await vscode.window.showInformationMessage(
          `"${s.name}" has no layout to go back to yet. Choose its panels and layout under "When this space opens".`, 'Edit This Space');
        if (go) SpaceEditor.show(editorHost, s);
        return;
      }
      await runOnOpen(s, true);
    }),
    vscode.commands.registerCommand('vibespaces.saveWindowPosition', () => saveWindowPosition()),
    vscode.commands.registerCommand('vibespaces.setColor', async (item?: SpaceItem) => {
      const s = await target(item, 'Change the colour of which space?');
      const color = s && await pickColor(s.color);
      if (s && color) { writeLook(s.file, color); changed(); }
    }),
    vscode.commands.registerCommand('vibespaces.rename', async (item?: SpaceItem) => {
      const s = await target(item, 'Rename which space?');
      if (s) await rename(s);
    }),
    vscode.commands.registerCommand('vibespaces.delete', async (item?: SpaceItem) => {
      const s = await target(item, 'Delete which space?');
      if (s) await deleteSpace(s);
    }),
    vscode.commands.registerCommand('vibespaces.editFile', async (item?: SpaceItem) => {
      const s = await target(item, 'Edit which space\'s file?');
      if (s) await vscode.window.showTextDocument(vscode.Uri.file(s.file));
    }),
    vscode.commands.registerCommand('vibespaces.refresh', () => changed()),
    vscode.commands.registerCommand('vibespaces.fixTaskbar', () => applyTaskbar(ctx, true, true)),
    vscode.commands.registerCommand('vibespaces.reapplyColors', async () => {
      const n = await reapplyAll();
      vscode.window.showInformationMessage(`Repainted ${n} space${n === 1 ? '' : 's'}.`);
    }),
    vscode.commands.registerCommand('vibespaces.walkthrough', () =>
      vscode.commands.executeCommand('workbench.action.openWalkthrough', WALKTHROUGH, false)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('vibespaces.folder')) { watchFolder(); changed(); }
      if (e.affectsConfiguration('vibespaces.iconStyle') || e.affectsConfiguration('vibespaces.taskbar')) {
        lastIconKey = iconKey(currentSpace());
        applyTaskbar(ctx, true, false);
      }
      if (e.affectsConfiguration('vibespaces')) settings.refresh();
      if (e.affectsConfiguration('vibespaces.presets')) SpaceEditor.refreshAll();
    }),
  );

  // the list follows the spaces folder; this window also follows its own space file, wherever it is
  let watchers: vscode.Disposable[] = [];
  const watchFolder = () => {
    watchers.forEach((w) => w.dispose());
    watchers = [];
    const add = (base: string, glob: string) => {
      const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(base), glob));
      w.onDidChange(changed); w.onDidCreate(changed); w.onDidDelete(changed);
      watchers.push(w);
    };
    add(spacesFolder(), '*.code-workspace');
    const here = currentSpace();
    if (here && !sameFile(path.dirname(here.file), spacesFolder())) add(path.dirname(here.file), path.basename(here.file));
  };
  watchFolder();
  ctx.subscriptions.push({ dispose: () => watchers.forEach((w) => w.dispose()) });

  // groups: the list, and the signal that tells every window to go to its spot
  ctx.subscriptions.push(
    vscode.window.registerTreeDataProvider('vibespaces.groups', groupsTree),
    vscode.commands.registerCommand('vibespaces.newGroup', () => newGroup()),
    vscode.commands.registerCommand('vibespaces.openGroup', (item?: GroupItem) => openGroup(ctx, item?.group)),
    vscode.commands.registerCommand('vibespaces.homeGroup', (item?: GroupItem) => homeGroup(ctx, item?.group)),
    vscode.commands.registerCommand('vibespaces.homeAll', () => sendHome(ctx, null, {})),
    vscode.commands.registerCommand('vibespaces.editGroup', (item?: GroupItem) => editGroup(item?.group)),
    vscode.commands.registerCommand('vibespaces.renameGroup', (item?: GroupItem) => renameGroup(item?.group)),
    vscode.commands.registerCommand('vibespaces.deleteGroup', (item?: GroupItem) => deleteGroup(item?.group)),
    vscode.commands.registerCommand('vibespaces.groupShortcut', (item?: GroupItem) => groupShortcut(item?.group)),
    vscode.commands.registerCommand('vibespaces.groupLaunches', (item?: GroupItem) => editLaunches(item?.group)),
    vscode.commands.registerCommand('vibespaces.memberSpot', (item?: MemberItem) => item && memberSpot(item)),
    vscode.commands.registerCommand('vibespaces.removeMember', (item?: MemberItem) => item && removeMember(item)),
    vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration('vibespaces.groups')) groupsTree.refresh(); }),
  );
  watchSignal(ctx);

  // the group shortcut from anywhere, and which space was used last (what it brings up)
  const hotkey = new GlobalHotkey(ctx.extensionPath, log, () => homeFromAnywhere(ctx));
  const noteFocus = () => {
    const s = currentSpace();
    if (s && vscode.window.state.focused) ctx.globalState.update('lastFocusedSpace', ensureId(s));
  };
  // each group's own shortcut (optional): one helper per key, held by whichever window gets it first
  const groupKeys = new Map<string, GlobalHotkey>();
  const syncGroupKeys = () => {
    const main = shortcutKey(vscode.workspace.getConfiguration('vibespaces').get<string>('globalShortcut') ?? '');
    const want = new Map<string, string>();   // key -> as written
    for (const g of allGroups()) {
      if (!g.shortcut) continue;
      const k = shortcutKey(g.shortcut);
      if (!k) { log(`group ${g.name}: can't use the shortcut "${g.shortcut}"`); continue; }
      if (k === main || want.has(k)) { log(`group ${g.name}: ${g.shortcut} is already another shortcut`); continue; }
      want.set(k, g.shortcut);
    }
    for (const [k, h] of groupKeys) if (!want.has(k)) { h.dispose(); groupKeys.delete(k); }
    for (const [k, written] of want) {
      if (groupKeys.has(k)) continue;
      const h = new GlobalHotkey(ctx.extensionPath, log, () => homeByShortcut(ctx, k), () => written, 'group shortcut');
      groupKeys.set(k, h);
      h.start(true);
    }
  };
  ctx.subscriptions.push(
    hotkey,
    { dispose: () => { groupKeys.forEach((h) => h.dispose()); groupKeys.clear(); } },
    vscode.window.onDidChangeWindowState((st) => {
      if (st.focused) { noteFocus(); hotkey.start(); groupKeys.forEach((h) => h.start()); }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('vibespaces.globalShortcut')) hotkey.start(true);
      if (e.affectsConfiguration('vibespaces.globalShortcut') || e.affectsConfiguration('vibespaces.groups')) syncGroupKeys();
    }),
  );
  noteFocus();
  hotkey.start(true);
  syncGroupKeys();

  const here = currentSpace();
  if (here) {
    ensureId(here);
    // opened as part of a group (Open group, moments ago): the group's spot wins over the space's own
    const sig = readSignal(ctx);
    const forUs = !!sig && Date.now() - sig.at < sig.ttl && (!sig.ids || sig.ids.includes(here.id!));
    const taskbar = applyTaskbar(ctx, false, false);
    runOnOpen(here, false, taskbar, forUs);
    if (forUs) taskbar.finally(() => onSignal(sig!, false));
  }

  // the guide opens once, the first time Vibespaces runs
  if (!ctx.globalState.get('welcomed')) {
    ctx.globalState.update('welcomed', true);
    vscode.commands.executeCommand('vibespaces.walkthrough');
  }
}

export function deactivate() {}

// changes that need a new taskbar icon
function iconKey(s: Space | undefined): string {
  return s ? [s.name, s.color, s.iconStyle, s.iconImage].join('|') : '';
}

async function applyTaskbar(ctx: vscode.ExtensionContext, force: boolean, manual: boolean) {
  const space = currentSpace();
  if (!space) { if (manual) vscode.window.showInformationMessage('This window isn\'t a space yet. Use Vibespaces: Make This Window a Space.'); return; }
  if (!helperAvailable()) { if (manual) vscode.window.showInformationMessage('Taskbar buttons are a Windows feature.'); return; }
  if (!vscode.workspace.getConfiguration('vibespaces').get<boolean>('taskbar', true)) return;
  try {
    await identifyWindow(ctx.extensionPath, space, force, log);
  } catch (e: any) {
    log(`taskbar: ${e.message}`);
    if (manual) vscode.window.showErrorMessage(`Vibespaces couldn't set this window's taskbar button: ${e.message}`);
  }
}

// What a space does when it opens, in an order that keeps each step from undoing the last:
// files, then panels, then the layout (a panel can reopen a side bar), then terminals, then the web page.
// layoutOnly (Reset Layout): just the panels and the layout.
async function runOnOpen(space: Space, layoutOnly = false, taskbarDone?: Promise<unknown>, skipWindow = false) {
  const o = space.onOpen;
  const run = async (what: string, command: string, ...args: unknown[]) => {
    try { await vscode.commands.executeCommand(command, ...args); } catch (e: any) { log(`${what}: ${e.message}`); }
  };

  // a reset that tidies tabs also brings back the space's own files
  const tidy = layoutOnly && o.resetTabs === 'close';
  if (tidy) await closeOtherTabs(space);

  for (const f of layoutOnly && !tidy ? [] : o.files) {
    const file = path.isAbsolute(f) ? f : path.join(space.folders[0] ?? '', f);
    try { await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false, preserveFocus: true }); }
    catch (e: any) { log(`open file ${f}: ${e.message}`); }
  }

  const panels = allPanels();
  for (const id of o.panels) {
    const p = findPanel(id, panels);
    if (!p) { log(`open ${id}: not installed`); continue; }
    // VS Code brings back open tabs by itself; opening again would make a second one
    if (p.tabViewType && tabOpen(p.tabViewType)) { log(`${p.label}: already open`); continue; }
    await run(`open ${p.label}`, p.command, ...(p.args ?? []));
  }

  // An assistant that opens as a tab (Claude Code) opens beside the current editor, which can leave the first editor
  // pane empty: fold the panes into one when one of them has nothing in it.
  const groups = vscode.window.tabGroups.all;
  if (groups.length > 1 && groups.some((g) => g.tabs.length === 0)) await run('join editor panes', 'workbench.action.joinAllGroups');

  const L = o.layout;
  if (L.left === 'show') await run('show left side bar', 'workbench.action.focusSideBar');
  if (L.left === 'hide') await run('hide left side bar', 'workbench.action.closeSidebar');
  if (L.right === 'show') await run('show right side bar', 'workbench.action.focusAuxiliaryBar');
  if (L.right === 'maximize') await run('maximize right side bar', 'workbench.action.maximizeAuxiliaryBar');
  if (L.right === 'hide') await run('hide right side bar', 'workbench.action.closeAuxiliaryBar');
  if (L.bottom === 'show') await run('show bottom panel', 'workbench.action.focusPanel');
  if (L.bottom === 'hide') await run('hide bottom panel', 'workbench.action.closePanel');

  // the window's place on screen, after the taskbar step (that one hides and shows the window)
  const W = o.window;
  if (W && (layoutOnly || W.atOpen) && !skipWindow && helperAvailable()) {
    await taskbarDone?.catch(() => undefined);
    try { await placeWindow(extPath, space, W, log); } catch (e: any) { log(`window: ${e.message}`); }
  }
  if (layoutOnly) return;

  // each terminal once per window: a reload brings it back by itself, so a name already there is skipped
  o.terminals.forEach((t, i) => {
    const name = `${space.name}: ${t.name || (o.terminals.length > 1 ? `start ${i + 1}` : 'start')}`;
    if (vscode.window.terminals.some((x) => x.name === name)) return;
    const term = vscode.window.createTerminal({ name, cwd: space.folders[0] });
    if (L.bottom !== 'hide' && i === o.terminals.length - 1) term.show(true);
    term.sendText(t.command);
  });

  if (o.url) {
    const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(o.url) ? o.url : `http://${o.url}`;
    if (o.urlIn === 'editor') await run('open page in VS Code', 'simpleBrowser.show', url);
    else await vscode.env.openExternal(vscode.Uri.parse(url));
  }
}

// Closes every tab that isn't part of the space. Kept: the space's files, the tabs of its panels (Claude Code),
// pinned tabs, and anything unsaved (never lose work, never ask to save). Emptied split panes close themselves.
async function closeOtherTabs(space: Space) {
  const base = space.folders[0] ?? '';
  const files = space.onOpen.files.map((f) => path.resolve(path.isAbsolute(f) ? f : path.join(base, f)).toLowerCase());
  const panels = allPanels();
  const keepTypes = space.onOpen.panels.map((id) => findPanel(id, panels)?.tabViewType).filter((v): v is string => !!v);
  const close: vscode.Tab[] = [];
  for (const g of vscode.window.tabGroups.all) {
    for (const t of g.tabs) {
      if (t.isPinned || t.isDirty) continue;
      const input = t.input;
      if (input instanceof vscode.TabInputText && files.includes(path.resolve(input.uri.fsPath).toLowerCase())) continue;
      if (input instanceof vscode.TabInputWebview && keepTypes.some((v) => input.viewType === v || input.viewType.endsWith('-' + v))) continue;
      close.push(t);
    }
  }
  if (close.length) {
    try { await vscode.window.tabGroups.close(close, true); } catch (e: any) { log(`close tabs: ${e.message}`); }
  }
  log(`reset: closed ${close.length} tab(s)`);
}

// this window's place on screen becomes the space's (Reset Layout puts it back there)
async function saveWindowPosition(): Promise<boolean> {
  const s = currentSpace();
  if (!s) { vscode.window.showInformationMessage('This window isn\'t a space yet. Use Make This Window a Space.'); return false; }
  if (!helperAvailable()) { vscode.window.showInformationMessage('Window positions are a Windows feature for now.'); return false; }
  try {
    const p = await whereWindow(extPath, s);
    setOnOpen(s.file, { ...s.onOpen, window: { ...p, atOpen: s.onOpen.window?.atOpen ?? true } });
    vscode.commands.executeCommand('vibespaces.refresh');
    vscode.window.showInformationMessage(p.maximized
      ? `Saved: "${s.name}" opens maximized. Ctrl+Alt+Home puts it back.`
      : `Saved: ${p.width} × ${p.height}. Ctrl+Alt+Home puts the window back here.`);
    return true;
  } catch (e: any) {
    log(`window: ${e.message}`);
    vscode.window.showErrorMessage(`Vibespaces couldn't read this window's position: ${e.message}`);
    return false;
  }
}

async function reapplyAll(): Promise<number> {
  let n = 0;
  for (const s of listSpaces()) {
    if (!s.color) continue;
    try { writeLook(s.file, s.color); n++; } catch (e: any) { log(`repaint ${s.name}: ${e.message}`); }
  }
  return n;
}

async function openSpace(file: string) {
  const s = currentSpace();
  if (s && sameFile(s.file, file)) return;
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(file), { forceNewWindow: true });
}

async function pickAndOpen() {
  const here = currentSpace();
  const items: (vscode.QuickPickItem & { file?: string; act?: string })[] = listSpaces().map((s) => ({
    label: s.name,
    description: here && sameFile(here.file, s.file) ? 'this window' : s.folders.map((f) => path.basename(f)).join(', '),
    detail: s.folders.join('   '),
    file: s.file,
  }));
  if (items.length) items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
  if (!here && vscode.workspace.workspaceFolders?.length) items.push({ label: '$(window) Make this window a space…', act: 'from' });
  items.push({ label: '$(add) New space…', act: 'new' });
  const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Open a space' });
  if (!pick) return;
  if (pick.file) await openSpace(pick.file);
  else if (pick.act === 'from') await spaceFromWindow();
  else if (pick.act === 'new') await createSpace();
}

async function askName(value: string): Promise<string | undefined> {
  const name = await vscode.window.showInputBox({
    title: 'Name the space',
    prompt: 'Shown in the title bar, on the taskbar and in the Vibespaces list',
    value,
    validateInput: (v) => validName(v) ?? (nameTaken(v) ? 'That name is taken' : undefined),
  });
  return name?.trim() || undefined;
}

async function createSpace() {
  const picked = await vscode.window.showOpenDialog({
    title: 'Choose the project folder for the new space',
    canSelectFolders: true, canSelectFiles: false, canSelectMany: true, openLabel: 'Use for this space',
  });
  if (!picked?.length) return;
  const name = await askName(path.basename(picked[0].fsPath));
  const color = name && await pickColor();
  const preset = color ? await pickPreset() : undefined;
  if (!name || !color || preset === undefined) return;
  try {
    const file = makeSpace(name, picked.map((u) => u.fsPath), color, preset);
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(file), { forceNewWindow: true });
  } catch (e: any) {
    vscode.window.showErrorMessage(e.message);
  }
}

// this window's folders become a space, and the window reopens as it
async function spaceFromWindow() {
  if (currentSpace()) { vscode.window.showInformationMessage(`This window is already the space "${currentSpace()!.name}".`); return; }
  const folders = (vscode.workspace.workspaceFolders || []).filter((f) => f.uri.scheme === 'file').map((f) => f.uri.fsPath);
  if (!folders.length) { await createSpace(); return; }
  const name = await askName(path.basename(folders[0]));
  const color = name && await pickColor();
  const preset = color ? await pickPreset() : undefined;
  if (!name || !color || preset === undefined) return;
  try {
    const file = makeSpace(name, folders, color, preset);
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(file), { forceNewWindow: false });
  } catch (e: any) {
    vscode.window.showErrorMessage(e.message);
  }
}

function makeSpace(name: string, folders: string[], color: string, preset: Preset | null): string {
  const file = createSpaceFile(name, folders, color);
  const made = preset && readSpace(file);
  if (made) { setOnOpen(file, withPreset(made.onOpen, preset)); offerInstall(preset); }
  return file;
}

// null: no preset; undefined: cancelled. Grouped: AI assistants, layouts, yours.
async function pickPreset(): Promise<Preset | null | undefined> {
  type Item = vscode.QuickPickItem & { preset?: Preset | null };
  const items: Item[] = [{ label: 'No preset', description: 'Set it up later in the space\'s editor', preset: null }];
  for (const kind of Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]) {
    const ps = allPresets().filter((p) => kindOf(p) === kind);
    if (!ps.length) continue;
    items.push({ label: KIND_LABEL[kind], kind: vscode.QuickPickItemKind.Separator });
    for (const p of ps) {
      const need = missing(p);
      items.push({ label: p.name, description: need ? `${need.name} isn't installed` : '', detail: summary(p), preset: p });
    }
  }
  const pick = await vscode.window.showQuickPick(items, { title: 'Start with a preset?', placeHolder: 'How the window is set up each time the space opens' });
  return pick && pick.preset !== undefined ? pick.preset : undefined;
}

async function rename(s: Space) {
  const name = await vscode.window.showInputBox({
    title: `Rename "${s.name}"`, value: s.name,
    validateInput: (v) => validName(v) ?? (nameTaken(v, s.file) ? 'That name is taken' : undefined),
  });
  if (!name || name.trim() === s.name) return;
  const here = currentSpace();
  const isCurrent = !!here && sameFile(here.file, s.file);
  try {
    const file = renameSpace(s, name.trim());
    if (isCurrent) await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(file), { forceNewWindow: false });
    else vscode.commands.executeCommand('vibespaces.refresh');
  } catch (e: any) {
    vscode.window.showErrorMessage(e.message);
  }
}

async function deleteSpace(s: Space): Promise<boolean> {
  const ok = await vscode.window.showWarningMessage(`Delete the space "${s.name}"?`, {
    modal: true,
    detail: 'Only the space file goes to the Recycle Bin. Your project folders and files are not touched. '
      + 'A window that has this space open stays open until you close it.',
  }, 'Delete');
  if (ok !== 'Delete') return false;
  await vscode.workspace.fs.delete(vscode.Uri.file(s.file), { useTrash: true });
  vscode.commands.executeCommand('vibespaces.refresh');
  return true;
}

async function pickSpace(placeHolder: string): Promise<Space | undefined> {
  const pick = await vscode.window.showQuickPick(listSpaces().map((s) => ({ label: s.name, space: s })), { placeHolder });
  return pick?.space;
}

async function pickColor(current?: string): Promise<string | undefined> {
  const items: (vscode.QuickPickItem & { color?: string })[] = PRESETS.map((p) => ({
    label: p.label, description: p.color + (current === p.color ? '  (current)' : ''), color: p.color,
  }));
  items.push({ label: 'Custom…', description: 'type a colour code (the space editor has a colour picker)' });
  const pick = await vscode.window.showQuickPick(items, { title: 'Pick a colour', placeHolder: 'For the title bar, status bar and taskbar icon' });
  if (!pick) return undefined;
  if (pick.color) return pick.color;
  const typed = await vscode.window.showInputBox({
    prompt: 'Colour code, e.g. #2e7d46', value: current,
    validateInput: (v) => (/^#?[0-9a-f]{6}$/i.test(v.trim()) ? undefined : 'Six hex digits, e.g. #2e7d46'),
  });
  return typed ? '#' + typed.trim().replace(/^#/, '').toLowerCase() : undefined;
}

class SpaceItem extends vscode.TreeItem {
  constructor(public readonly space: Space, current: boolean, iconDir: string) {
    super(space.name, vscode.TreeItemCollapsibleState.None);
    const folders = space.folders.map((f) => path.basename(f)).join(', ');
    this.description = current ? `this window · ${folders}` : folders;
    this.tooltip = new vscode.MarkdownString(`**${space.name}**${current ? ' (this window)' : ''}\n\n${space.folders.map((f) => `- ${f}`).join('\n')}\n\nClick to open · gear to edit`);
    this.contextValue = current ? 'space.current' : 'space';
    this.command = { command: 'vibespaces.openSpace', title: 'Open', arguments: [space.file] };
    this.iconPath = space.color ? vscode.Uri.file(swatch(iconDir, space.color, current)) : new vscode.ThemeIcon('window');
  }
}

class SpacesTree implements vscode.TreeDataProvider<SpaceItem> {
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  constructor(private ctx: vscode.ExtensionContext) {}
  refresh() { this.emitter.fire(); }
  getTreeItem(item: SpaceItem) { return item; }
  getChildren(): SpaceItem[] {
    const here = currentSpace();
    const dir = this.ctx.globalStorageUri.fsPath;
    return listSpaces().map((s) => new SpaceItem(s, !!here && sameFile(here.file, s.file), dir));
  }
}

// dragging in the Spaces list reorders it (the order is a setting, so every window's list follows)
const SPACES_MIME = 'application/vnd.vibespaces.spaces';
class SpacesDrop implements vscode.TreeDragAndDropController<SpaceItem> {
  readonly dragMimeTypes = [SPACES_MIME];
  readonly dropMimeTypes = [SPACES_MIME];
  handleDrag(source: readonly SpaceItem[], data: vscode.DataTransfer) {
    data.set(SPACES_MIME, new vscode.DataTransferItem(JSON.stringify(source.map((s) => s.space.file))));
  }
  async handleDrop(target: SpaceItem | undefined, data: vscode.DataTransfer) {
    const item = data.get(SPACES_MIME);
    if (!item) return;
    let files: string[];
    try { files = JSON.parse(await item.asString()); } catch { return; }
    if (Array.isArray(files) && files.length) await placeSpaces(files, target?.space.file);
  }
}

// a small rounded square in the space's colour for the list (with a ring for this window's space)
function swatch(dir: string, color: string, ring: boolean): string {
  const file = path.join(dir, `swatch-${color.slice(1)}${ring ? '-ring' : ''}.svg`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dir, { recursive: true });
    const box = ring
      ? `<rect x="1" y="1" width="14" height="14" rx="4" fill="none" stroke="${color}" stroke-width="1.5"/><rect x="4" y="4" width="8" height="8" rx="2" fill="${color}"/>`
      : `<rect x="2" y="2" width="12" height="12" rx="3" fill="${color}"/>`;
    fs.writeFileSync(file, `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">${box}</svg>`);
  }
  return file;
}

// ---- window groups ----

// every window watches the signal file; the window that asks also acts on it straight away
const handledSignals = new Set<string>();
function watchSignal(ctx: vscode.ExtensionContext) {
  const dir = path.dirname(signalPath(ctx));
  fs.mkdirSync(dir, { recursive: true });
  let timer: NodeJS.Timeout | undefined;
  try {
    const w = fs.watch(dir, (_e, name) => {
      if (name && name !== path.basename(signalPath(ctx))) return;
      clearTimeout(timer);
      timer = setTimeout(() => { const s = readSignal(ctx); if (s && Date.now() - s.at < 10000) onSignal(s); }, 60);
    });
    ctx.subscriptions.push({ dispose: () => w.close() });
  } catch (e: any) { log(`groups: can't watch for signals: ${e.message}`); }
}

// this window, if the signal names its space: back to its own layout (what Ctrl+Alt+Home does: panels, side bars,
// tab tidying), then to its spot (the group's, or its own) and to the front. A window just opened by Open Group has
// run its opening steps already, so it only takes its spot (homeLayout false).
async function onSignal(sig: Signal, homeLayout = true) {
  if (handledSignals.has(sig.seq)) return;
  handledSignals.add(sig.seq);
  const s = currentSpace();
  if (!s) return;
  const id = ensureId(s);
  if (sig.ids && !sig.ids.includes(id)) return;
  if (homeLayout) await runOnOpen(s, true, undefined, true);   // the window spot comes next, from the signal
  // Open Group: this window's terminals from the group (once: a terminal already there is left alone)
  for (const t of terminalsInSignal(sig, s, id)) {
    const name = `${sig.group}: ${t.name || 'start'}`;
    if (vscode.window.terminals.some((x) => x.name === name)) { log(`${name}: already running`); continue; }
    const term = vscode.window.createTerminal({ name, cwd: s.folders[0] });
    if (s.onOpen.layout.bottom !== 'hide') term.show(true);
    term.sendText(t.command!);
    log(`group ${sig.group}: started "${t.command}" here`);
  }
  if (!helperAvailable()) return;
  // its spot in the group as this window's settings have it (never the sender's idea of another group)
  const preset = spotInSignal(sig, s, id);
  const spot: WindowSpot | undefined = preset
    ? { preset, x: 0, y: 0, width: 0, height: 0, maximized: false, atOpen: true }
    : s.onOpen.window;
  const focus = sig.focus === id;
  try {
    if (spot) await placeWindow(extPath, s, spot, log, true, focus);
    else await raiseWindow(extPath, s, log, focus);
  } catch (e: any) { log(`group: ${e.message}`); }
}

// the global shortcut, pressed anywhere: the group of the space used last (the one last opened, if it's in several),
// else the group last opened, else every open space; the space used last also takes the focus
function homeFromAnywhere(ctx: vscode.ExtensionContext) {
  const lastSpace = ctx.globalState.get<string>('lastFocusedSpace');
  const last = ctx.globalState.get<string>('lastGroup');
  const groups = allGroups();
  const mine = lastSpace ? groups.filter((g) => signalFor(g).ids.includes(lastSpace)) : [];
  const group = mine.find((g) => g.name === last) ?? mine[0] ?? groups.find((g) => g.name === last);
  if (!group) { onSignal(sendSignal(ctx, null, {}, 0, lastSpace)); return; }
  const { ids, spots } = signalFor(group);
  onSignal(sendSignal(ctx, ids, spots, 0, lastSpace && ids.includes(lastSpace) ? lastSpace : ids[0], group.name));
}

// a group's own shortcut, pressed anywhere: that group back in place, and it becomes the group used last
function homeByShortcut(ctx: vscode.ExtensionContext, key: string) {
  const group = allGroups().find((g) => g.shortcut && shortcutKey(g.shortcut) === key);
  if (!group) return;
  ctx.globalState.update('lastGroup', group.name);
  const lastSpace = ctx.globalState.get<string>('lastFocusedSpace');
  const { ids, spots } = signalFor(group);
  onSignal(sendSignal(ctx, ids, spots, 0, lastSpace && ids.includes(lastSpace) ? lastSpace : ids[0], group.name));
}

function sendHome(ctx: vscode.ExtensionContext, ids: string[] | null, spots: Record<string, WindowPreset>, ttl = 0, group?: string) {
  onSignal(sendSignal(ctx, ids, spots, ttl, undefined, group));
}

// the group to home: the one this window's space was last opened with, else its first group; outside a space,
// the group last opened; and with no group at all, every open space
async function homeGroup(ctx: vscode.ExtensionContext, group?: Group) {
  const s = currentSpace();
  const last = ctx.globalState.get<string>('lastGroup');
  if (!group) {
    const mine = s ? groupsOf(s) : allGroups();
    group = mine.find((g) => g.name === last) ?? (s ? mine[0] : undefined);
  }
  if (!group) { sendHome(ctx, null, {}); return; }
  const { ids, spots } = signalFor(group);
  sendHome(ctx, ids, spots, 0, group.name);
}

// opens every space in the group (one already open just comes forward) and puts each in its spot
async function openGroup(ctx: vscode.ExtensionContext, group?: Group) {
  group = group ?? await pickGroup('Open which group?');
  if (!group) return;
  ctx.globalState.update('lastGroup', group.name);
  const spaces = listSpaces();
  const { ids, spots } = signalFor(group);
  // windows that open in the next minute follow it too; open ones act on it now. It also carries the launches:
  // each member window starts its own terminals.
  onSignal(sendSignal(ctx, ids, spots, 60000, undefined, group.name, !!group.launch?.length));
  const here = currentSpace();
  for (const m of group.members) {
    const s = memberSpace(m, spaces);
    if (!s) { log(`group ${group.name}: a space is missing (${m.file || m.id})`); continue; }
    if (here && sameFile(here.file, s.file)) continue;
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(s.file), { forceNewWindow: true });
  }
  // and this window starts the programs and opens the files and pages, once
  for (const l of group.launch ?? []) await runLaunch(group.name, l);
}

// ~ and %VARS% in a launch's path or command
const expand = (v: string) => v.replace(/^~(?=$|[\\/])/, process.env.USERPROFILE || process.env.HOME || '~').replace(/%([^%]+)%/g, (all, n) => process.env[n] ?? all);

async function runLaunch(group: string, l: Launch) {
  try {
    if (l.kind === 'open' && l.target) {
      const t = expand(l.target);
      const web = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^www\./i.test(t);
      if (!web && !fs.existsSync(t)) { log(`group ${group}: can't open ${t} (not found)`); vscode.window.showWarningMessage(`Group "${group}": couldn't find ${t}`); return; }
      const ok = await vscode.env.openExternal(web ? vscode.Uri.parse(/^www\./i.test(t) ? `https://${t}` : t) : vscode.Uri.file(t));
      log(`group ${group}: ${ok ? 'opened' : 'could not open'} ${t}`);
    } else if (l.kind === 'run' && l.command) {
      // outside VS Code, on its own: it keeps running when the windows close
      const child = spawn(expand(l.command), { shell: true, detached: true, stdio: 'ignore', windowsHide: false });
      child.on('error', (e) => log(`group ${group}: ${l.command}: ${e.message}`));
      child.unref();
      log(`group ${group}: started ${l.command}`);
    }
  } catch (e: any) { log(`group ${group}: ${e.message}`); }
}

// ---- a group's launches: what it starts when it opens ----

function describeLaunch(l: Launch, spaces = listSpaces()): { label: string; description: string } {
  if (l.kind === 'open') return { label: `$(link-external) Open ${path.basename(l.target ?? '') || l.target}`, description: l.target ?? '' };
  if (l.kind === 'run') return { label: `$(rocket) Start ${l.name || l.command}`, description: l.name ? l.command ?? '' : 'outside VS Code' };
  const where = spaces.find((s) => s.id === l.in)?.name ?? 'the first space';
  return { label: `$(terminal) ${l.name || l.command}`, description: `${l.name ? l.command + ' · ' : ''}in ${where}'s terminal` };
}

async function editLaunches(group?: Group) {
  group = group ?? await pickGroup('Launches for which group?');
  if (!group) return;
  const name = group.name;
  type Item = vscode.QuickPickItem & { act: 'del' | 'terminal' | 'run' | 'open' | 'url'; i?: number };
  for (;;) {
    const g = allGroups().find((x) => x.name === name);
    if (!g) return;
    const launch = g.launch ?? [];
    const spaces = listSpaces();
    const items: Item[] = [
      ...launch.map((l, i) => ({ ...describeLaunch(l, spaces), detail: 'Pick to remove', act: 'del' as const, i })),
      { label: '', kind: vscode.QuickPickItemKind.Separator, act: 'del' },
      { label: '$(terminal) Run a command in a space\'s terminal…', description: 'e.g. start the app, with its log in the agent\'s window', act: 'terminal' },
      { label: '$(rocket) Start a program…', description: 'outside VS Code, e.g. start "" "C:\\Apps\\Dashboard.exe"', act: 'run' },
      { label: '$(file) Open a file or folder…', description: 'with its own app: an Excel sheet opens in Excel', act: 'open' },
      { label: '$(globe) Open a web page…', description: 'in your browser', act: 'url' },
    ];
    const pick = await vscode.window.showQuickPick(items, {
      title: `Launches for "${name}"`,
      placeHolder: launch.length ? 'These start when you open the group (not when you put it back). Pick one to remove it, or add another.' : 'Nothing yet. These start when you open the group (not when you put it back).',
    });
    if (!pick) return;
    let add: Launch | undefined;
    if (pick.act === 'del' && pick.i !== undefined) {
      const ok = await vscode.window.showWarningMessage(`Remove "${describeLaunch(launch[pick.i], spaces).label.replace(/^\$\([^)]*\) /, '')}" from "${name}"?`, { modal: true }, 'Remove');
      if (ok) await saveGroups(allGroups().map((x) => (x.name === name ? { ...x, launch: launch.filter((_, j) => j !== pick.i) } : x)));
      continue;
    }
    if (pick.act === 'terminal') {
      const members = g.members.map((m) => memberSpace(m, spaces)).filter((s): s is Space => !!s);
      const where = members.length === 1 ? members[0] : (await vscode.window.showQuickPick(members.map((s) => ({ label: s.name, s })), { title: 'In which space\'s window?' }))?.s;
      if (!where) continue;
      const command = (await vscode.window.showInputBox({ title: `Command for ${where.name}'s terminal`, prompt: `Runs in ${where.folders[0] ?? 'its folder'}`, placeHolder: 'e.g. npm run dev' }))?.trim();
      if (!command) continue;
      const nm = (await vscode.window.showInputBox({ title: 'A name for its terminal (optional)', placeHolder: 'e.g. app' }))?.trim();
      add = { kind: 'terminal', command, in: ensureId(where), ...(nm ? { name: nm } : {}) };
    } else if (pick.act === 'run') {
      const command = (await vscode.window.showInputBox({ title: 'Program or command to start', prompt: 'Starts outside VS Code and keeps running. Paths with spaces in quotes; ~ and %VARS% work.', placeHolder: 'start "" "C:\\Apps\\Dashboard.exe"' }))?.trim();
      if (!command) continue;
      add = { kind: 'run', command };
    } else if (pick.act === 'open') {
      const uris = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: true, canSelectMany: true, openLabel: 'Open with the group' });
      if (!uris?.length) continue;
      const adds: Launch[] = uris.map((u) => ({ kind: 'open', target: u.fsPath }));
      await saveGroups(allGroups().map((x) => (x.name === name ? { ...x, launch: [...launch, ...adds] } : x)));
      continue;
    } else if (pick.act === 'url') {
      const target = (await vscode.window.showInputBox({ title: 'Web page to open', placeHolder: 'https://…', validateInput: (v) => (/^(https?:\/\/|www\.)\S+$/i.test(v.trim()) ? undefined : 'A web address, e.g. https://example.com') }))?.trim();
      if (!target) continue;
      add = { kind: 'open', target };
    }
    if (add) await saveGroups(allGroups().map((x) => (x.name === name ? { ...x, launch: [...launch, add!] } : x)));
  }
}

async function pickGroup(placeHolder: string): Promise<Group | undefined> {
  const groups = allGroups();
  if (!groups.length) { vscode.window.showInformationMessage('No groups yet. Make one with the + in the Groups list.'); return undefined; }
  const pick = await vscode.window.showQuickPick(groups.map((g) => ({ label: g.name, description: `${g.members.length} spaces`, group: g })), { placeHolder });
  return pick?.group;
}

// which spaces are in a group (all of them pickable, the current members ticked)
async function pickMembers(title: string, current: Member[] = []): Promise<Space[] | undefined> {
  const spaces = listSpaces();
  if (!spaces.length) { vscode.window.showInformationMessage('Make a space or two first.'); return undefined; }
  const items = spaces.map((s) => ({
    label: s.name, description: s.folders.map((f) => path.basename(f)).join(', '), space: s,
    picked: current.some((m) => (m.id && m.id === s.id) || (m.file && sameFile(m.file, s.file))),
  }));
  const picks = await vscode.window.showQuickPick(items, { title, canPickMany: true, placeHolder: 'Tick the spaces that work side by side' });
  return picks?.map((p) => p.space);
}

// a spot for one space in a group; undefined: cancelled, null: the space's own
async function pickSpot(space: Space, current?: WindowPreset): Promise<WindowPreset | null | undefined> {
  const own = describeSpot({ id: '', file: '' }, space);
  type Item = vscode.QuickPickItem & { spot: WindowPreset | null };
  const items: Item[] = [
    { label: 'Its own spot', description: own.replace(/^its own spot /, ''), spot: null, picked: !current },
    ...WINDOW_PRESETS.map((p) => ({ label: p.label, spot: p.id as WindowPreset, description: p.id === current ? '(current)' : '' })),
  ];
  const pick = await vscode.window.showQuickPick(items, { title: `Where should "${space.name}" go in this group?` });
  return pick ? pick.spot : undefined;
}

async function newGroup() {
  const name = (await vscode.window.showInputBox({
    title: 'New group', prompt: 'A name for spaces that work side by side, e.g. "Trading"',
    validateInput: (v) => !v.trim() ? 'Give the group a name'
      : allGroups().some((g) => g.name.toLowerCase() === v.trim().toLowerCase()) ? 'That name is taken' : undefined,
  }))?.trim();
  if (!name) return;
  const spaces = await pickMembers(`Spaces in "${name}"`);
  if (!spaces?.length) return;
  const members: Member[] = [];
  for (const s of spaces) {
    const spot = await pickSpot(s);
    if (spot === undefined) return;
    members.push(memberFor(s, spot ?? undefined));
  }
  const group: Group = { name, members };
  await saveGroups([...allGroups(), group]);
  const go = await vscode.window.showInformationMessage(`Made the group "${name}". Ctrl+Alt+Shift+Home puts its windows back in their spots.`, 'Open it now');
  if (go) vscode.commands.executeCommand('vibespaces.openGroup', { group });
}

async function editGroup(group?: Group) {
  group = group ?? await pickGroup('Change which group?');
  if (!group) return;
  const g0 = group;
  const spaces = await pickMembers(`Spaces in "${g0.name}"`, g0.members);
  if (!spaces) return;
  // staying members keep their spots; new ones use their own
  const members = spaces.map((s) => g0.members.find((m) => (m.id && m.id === s.id) || (m.file && sameFile(m.file, s.file))) ?? memberFor(s));
  await saveGroups(allGroups().map((g) => (g.name === g0.name ? { ...g, members } : g)));
}

// a shortcut for one group (Windows: works from any app); empty removes it
async function groupShortcut(group?: Group) {
  group = group ?? await pickGroup('A shortcut for which group?');
  if (!group) return;
  const g0 = group;
  const mainKey = shortcutKey(vscode.workspace.getConfiguration('vibespaces').get<string>('globalShortcut') ?? '');
  const v = await vscode.window.showInputBox({
    title: `Shortcut for "${g0.name}"`,
    value: g0.shortcut ?? '',
    placeHolder: 'e.g. ctrl+alt+shift+1',
    prompt: 'Puts this group back in place and brings it to the front, even from another app. Modifiers ctrl, alt, shift, win plus one key. Empty for none.',
    validateInput: (text) => {
      const t = text.trim();
      if (!t) return undefined;
      const k = shortcutKey(t);
      if (!k) return 'Use ctrl, alt, shift or win (one or more) plus one key, e.g. ctrl+alt+shift+1';
      if (k === mainKey) return 'That\'s the main group shortcut (Settings in the Vibespaces side bar)';
      const other = allGroups().find((g) => g.name !== g0.name && g.shortcut && shortcutKey(g.shortcut) === k);
      return other ? `"${other.name}" already uses it` : undefined;
    },
  });
  if (v === undefined) return;
  const t = v.trim().toLowerCase().replace(/\s+/g, '');
  await saveGroups(allGroups().map((g) => (g.name === g0.name ? { ...g, shortcut: t || undefined } : g)));
}

async function renameGroup(group?: Group) {
  group = group ?? await pickGroup('Rename which group?');
  if (!group) return;
  const g0 = group;
  const name = (await vscode.window.showInputBox({
    title: `Rename "${g0.name}"`, value: g0.name,
    validateInput: (v) => !v.trim() ? 'Give the group a name'
      : allGroups().some((g) => g.name !== g0.name && g.name.toLowerCase() === v.trim().toLowerCase()) ? 'That name is taken' : undefined,
  }))?.trim();
  if (!name || name === g0.name) return;
  await saveGroups(allGroups().map((g) => (g.name === g0.name ? { ...g, name } : g)));
}

async function deleteGroup(group?: Group) {
  group = group ?? await pickGroup('Delete which group?');
  if (!group) return;
  const g0 = group;
  const ok = await vscode.window.showWarningMessage(`Delete the group "${g0.name}"?`, { modal: true, detail: 'Its spaces stay as they are.' }, 'Delete');
  if (ok === 'Delete') await saveGroups(allGroups().filter((g) => g.name !== g0.name));
}

const sameMember = (a: Member, b: Member) => a.id === b.id && a.file === b.file;

async function memberSpot(item: MemberItem) {
  if (!item.space) return;
  const spot = await pickSpot(item.space, item.member.spot);
  if (spot === undefined) return;
  await saveGroups(allGroups().map((g) => g.name !== item.group.name ? g : {
    ...g, members: g.members.map((m) => (sameMember(m, item.member) ? { ...m, spot: spot ?? undefined } : m)),
  }));
}

async function removeMember(item: MemberItem) {
  await saveGroups(allGroups().map((g) => g.name !== item.group.name ? g : {
    ...g, members: g.members.filter((m) => !sameMember(m, item.member)),
  }));
}

class GroupItem extends vscode.TreeItem {
  constructor(public readonly group: Group, last: boolean) {
    super(group.name, vscode.TreeItemCollapsibleState.Expanded);
    const key = group.shortcut ? ` · ${prettyShortcut(group.shortcut)}` : '';
    const n = group.launch?.length ?? 0, starts = n ? ` · starts ${n} thing${n === 1 ? '' : 's'}` : '';
    this.description = `${group.members.length} space${group.members.length === 1 ? '' : 's'}${starts}${key}${last ? ' · last opened' : ''}`;
    this.tooltip = 'Click (or play) opens its spaces side by side' + (n ? ' and starts its launches' : '') + '; the house puts them back in their spots (Ctrl+Alt+Shift+Home'
      + (group.shortcut ? `, or this group's own ${prettyShortcut(group.shortcut)}` : '') + '). Right-click to give it its own shortcut, or Launches… to have it start an app, a terminal command or a file when it opens.';
    // a click on the group's name opens the group, as a click on a space opens the space (the arrow still folds it)
    this.command = { command: 'vibespaces.openGroup', title: 'Open Group', arguments: [this] };
    this.contextValue = 'group';
    this.iconPath = new vscode.ThemeIcon('multiple-windows');
  }
}

class MemberItem extends vscode.TreeItem {
  constructor(public readonly group: Group, public readonly member: Member, public readonly space: Space | undefined, iconDir: string) {
    super(space?.name ?? `Missing space (${path.basename(member.file || member.id)})`, vscode.TreeItemCollapsibleState.None);
    this.description = describeSpot(member, space);
    this.contextValue = 'member';
    this.iconPath = space?.color ? vscode.Uri.file(swatch(iconDir, space.color, false)) : new vscode.ThemeIcon('warning');
    if (space) this.command = { command: 'vibespaces.openSpace', title: 'Open', arguments: [space.file] };
  }
}

class GroupsTree implements vscode.TreeDataProvider<GroupItem | MemberItem> {
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  constructor(private ctx: vscode.ExtensionContext) {}
  refresh() { this.emitter.fire(); }
  getTreeItem(item: GroupItem | MemberItem) { return item; }
  getChildren(item?: GroupItem | MemberItem): (GroupItem | MemberItem)[] {
    if (!item) {
      const last = this.ctx.globalState.get<string>('lastGroup');
      return allGroups().map((g) => new GroupItem(g, g.name === last));
    }
    if (item instanceof GroupItem) {
      const spaces = listSpaces();
      return item.group.members.map((m) => new MemberItem(item.group, m, memberSpace(m, spaces), this.ctx.globalStorageUri.fsPath));
    }
    return [];
  }
}
