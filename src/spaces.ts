// A space is a .code-workspace file. Its name is the file name; everything else lives in the file's "settings":
//   vibespaces.id        the taskbar identity (set once, so renames and moves keep the pin)
//   vibespaces.color     the space's colour (the bars are painted from it, see colorKeys)
//   vibespaces.iconStyle / vibespaces.iconImage   the taskbar icon
//   vibespaces.onOpen    what happens when the space opens: panels, layout, files, terminals, a web page
//   workbench.colorTheme (optional) the space's own colour theme
// so a space can be made or changed by hand as well as by Vibespaces.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';
import * as vscode from 'vscode';
import { applyEdits, modify, parse, JSONPath } from 'jsonc-parser';

// window: a little app window in the colour (default); vscode (opt-in): the user's own VS Code logo, recoloured
export type IconStyle = 'window' | 'initials' | 'image' | 'vscode';

export type Show = '' | 'show' | 'hide';

export interface OnOpen {
  panels: string[];                                   // ids from panels.ts
  layout: { left: Show; right: Show | 'maximize'; bottom: Show };
  files: string[];                                    // relative to the first folder, or absolute
  terminals: { name: string; command: string }[];
  url: string;
  urlIn: 'browser' | 'editor';
  // where the window goes (Windows): always on Reset Layout, and when the space opens if atOpen.
  // Either a preset spot on whichever screen the window is on, or an exact position saved from the window.
  window?: WindowSpot;
  resetTabs: 'keep' | 'close';   // Reset Layout: close tabs that aren't part of the space
}

export const WINDOW_PRESETS = [
  { id: 'left-quarter', label: 'Left column, narrow (a quarter of the screen)' },
  { id: 'second-quarter', label: 'Second quarter from the left' },
  { id: 'third-quarter', label: 'Third quarter from the left' },
  { id: 'right-quarter', label: 'Right column, narrow (a quarter of the screen)' },
  { id: 'left-third', label: 'Left column (a third of the screen)' },
  { id: 'middle-third', label: 'Middle third' },
  { id: 'right-third', label: 'Right column (a third of the screen)' },
  { id: 'left-half', label: 'Left half' },
  { id: 'center', label: 'Centre' },
  { id: 'right-half', label: 'Right half' },
  { id: 'maximized', label: 'Full screen (maximized)' },
] as const;
export type WindowPreset = typeof WINDOW_PRESETS[number]['id'];

export interface WindowSpot {
  preset?: WindowPreset;   // set: a spot on the window's screen; unset: the exact position below
  x: number; y: number; width: number; height: number; maximized: boolean;
  atOpen: boolean;
}

export function readWindow(w: any): WindowSpot | undefined {
  if (!w || typeof w !== 'object') return undefined;
  const atOpen = w.atOpen !== false;
  if (WINDOW_PRESETS.some((p) => p.id === w.preset)) return { preset: w.preset, x: 0, y: 0, width: 0, height: 0, maximized: false, atOpen };
  const n = (v: unknown) => (typeof v === 'number' && isFinite(v) ? Math.round(v) : NaN);
  const p = { x: n(w.x), y: n(w.y), width: n(w.width), height: n(w.height) };
  if (Object.values(p).some(isNaN) || p.width < 100 || p.height < 100) return undefined;
  return { ...p, maximized: !!w.maximized, atOpen };
}

// what goes in the file: a preset spot is just its name
function windowOut(w: WindowSpot): Record<string, unknown> {
  return w.preset ? { preset: w.preset, atOpen: w.atOpen } : { x: w.x, y: w.y, width: w.width, height: w.height, maximized: w.maximized, atOpen: w.atOpen };
}

export interface Space {
  name: string;
  file: string;
  id?: string;
  color?: string;          // #rrggbb
  folders: string[];       // absolute paths
  iconStyle?: IconStyle;   // unset: the global default
  iconImage?: string;
  theme?: string;          // unset: the user's theme
  onOpen: OnOpen;
}

export const PRESETS: { label: string; color: string }[] = [
  { label: 'Blue', color: '#1f3a5f' },
  { label: 'Green', color: '#2e7d46' },
  { label: 'Purple', color: '#5e3a8c' },
  { label: 'Red', color: '#9b2c3a' },
  { label: 'Orange', color: '#b35c1e' },
  { label: 'Teal', color: '#1f6f73' },
  { label: 'Gold', color: '#8a6d12' },
  { label: 'Slate', color: '#46505e' },
];

const FMT = { formattingOptions: { insertSpaces: true, tabSize: 2 } };

export function spacesFolder(): string {
  const v = (vscode.workspace.getConfiguration('vibespaces').get<string>('folder') || '').trim();
  if (v) return path.resolve(v.replace(/^~(?=$|[\\/])/, os.homedir()));
  const def = path.join(documentsFolder(), 'Vibespaces');
  // 0.1 kept spaces in ~/Workspaces: keep using it while it has spaces and the new folder doesn't exist,
  // since moving a space file would break its taskbar pin (the pin reopens the file's path)
  const old = path.join(os.homedir(), 'Workspaces');
  if (!fs.existsSync(def) && hasSpaces(old)) return old;
  return def;
}

function hasSpaces(dir: string): boolean {
  try { return fs.readdirSync(dir).some((n) => n.toLowerCase().endsWith('.code-workspace')); } catch { return false; }
}

// The user's Documents folder, wherever Windows has it (OneDrive can move it)
let documents: string | undefined;
function documentsFolder(): string {
  if (documents) return documents;
  documents = path.join(os.homedir(), 'Documents');
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders', '/v', 'Personal'],
        { encoding: 'utf8', timeout: 5000, windowsHide: true });
      const m = /Personal\s+REG_(?:EXPAND_)?SZ\s+(.+)/.exec(out);
      if (m) documents = m[1].trim().replace(/%([^%]+)%/g, (all, name) => process.env[name] ?? all);
    } catch { /* keep the default */ }
  }
  return documents;
}

export function listSpaces(): Space[] {
  const dir = spacesFolder();
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names
    .filter((n) => n.toLowerCase().endsWith('.code-workspace'))
    .map((n) => readSpace(path.join(dir, n)))
    .filter((s): s is Space => !!s)
    .sort((a, b) => a.name.localeCompare(b.name));
}

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}/i.test(v);

export function readSpace(file: string): Space | undefined {
  let data: any;
  try { data = parse(fs.readFileSync(file, 'utf8')); } catch { return undefined; }
  if (!data || typeof data !== 'object') return undefined;
  const dir = path.dirname(file);
  const s = data.settings && typeof data.settings === 'object' ? data.settings : {};
  const folders = (Array.isArray(data.folders) ? data.folders : [])
    .map((f: any) => (typeof f?.path === 'string' ? path.resolve(dir, f.path) : ''))
    .filter(Boolean);
  const own = s['vibespaces.color'], bar = s['workbench.colorCustomizations']?.['titleBar.activeBackground'];
  const color = isHex(own) ? own : isHex(bar) ? bar : undefined;
  const style = s['vibespaces.iconStyle'];
  const onOpen = s['vibespaces.onOpen'] || {};
  return {
    name: path.basename(file, path.extname(file)),
    file,
    id: typeof s['vibespaces.id'] === 'string' && s['vibespaces.id'] ? s['vibespaces.id'] : undefined,
    color: color?.slice(0, 7).toLowerCase(),
    folders,
    iconStyle: style === 'window' || style === 'vscode' || style === 'initials' || style === 'image' ? style : undefined,
    iconImage: typeof s['vibespaces.iconImage'] === 'string' && s['vibespaces.iconImage'] ? s['vibespaces.iconImage'] : undefined,
    theme: typeof s['workbench.colorTheme'] === 'string' && s['workbench.colorTheme'] ? s['workbench.colorTheme'] : undefined,
    onOpen: readOnOpen(onOpen),
  };
}

function readOnOpen(o: any): OnOpen {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const show = (v: unknown): Show => (v === 'show' || v === 'hide' ? v : '');
  const lay = o.layout && typeof o.layout === 'object' ? o.layout : {};
  const terminals = (Array.isArray(o.terminals) ? o.terminals : [])
    .map((t: any) => ({ name: str(t?.name), command: str(t?.command) }))
    .filter((t: { command: string }) => t.command.trim());
  if (str(o.command).trim()) terminals.unshift({ name: 'start', command: str(o.command) });   // 0.2.0 kept one command
  return {
    panels: Array.isArray(o.panels) ? o.panels.filter((p: unknown) => typeof p === 'string') : [],
    layout: { left: show(lay.left), right: lay.right === 'maximize' ? 'maximize' : show(lay.right), bottom: show(lay.bottom) },
    files: Array.isArray(o.files) ? o.files.filter((f: unknown) => typeof f === 'string' && f) : [],
    terminals,
    url: str(o.url).trim(),
    urlIn: o.urlIn === 'editor' ? 'editor' : 'browser',
    window: readWindow(o.window),
    resetTabs: o.resetTabs === 'close' ? 'close' : 'keep',
  };
}

// the space this window has open (any .code-workspace file counts, not only those in the spaces folder)
export function currentSpace(): Space | undefined {
  const f = vscode.workspace.workspaceFile;
  return f && f.scheme === 'file' ? readSpace(f.fsPath) : undefined;
}

export function sameFile(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

function slug(name: string): string {
  return name.replace(/[^A-Za-z0-9]+/g, '').slice(0, 40) || 'Space';
}

// The taskbar identity, stored in the file the first time it's needed. Spaces from 0.1 had it worked out from the
// file path; that same value is stored, so their pins keep working.
export function ensureId(space: Space): string {
  if (space.id) return space.id;
  const hash = crypto.createHash('sha1').update(path.resolve(space.file).toLowerCase()).digest('hex').slice(0, 8);
  const id = `Vibespaces.${slug(space.name)}.${hash}`;
  editFile(space.file, [[['settings', 'vibespaces.id'], id]]);
  space.id = id;
  return id;
}

export function initials(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const w = words[0] || '?';
  return w.slice(0, 1).toUpperCase() + w.slice(1, 2).toLowerCase();
}

function lum(hex: string): number {
  const n = parseInt(hex.slice(1, 7), 16);
  const lin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

// white or near-black text, whichever reads better on the colour
export function textColorFor(hex: string): string {
  return 1.05 / (lum(hex) + 0.05) >= 4.5 ? '#ffffff' : '#1e1e1e';
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1, 7), 16), pb = parseInt(b.slice(1, 7), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * t + ((pb >> s) & 255) * (1 - t));
  return '#' + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('');
}

// ---- how a space is painted ----

export interface Look {
  targets: { titleBar: boolean; statusBar: boolean; activityBar: boolean; tabs: boolean; border: boolean };
  intensity: 'bold' | 'subtle';
  dark: boolean;
}

export const TARGETS: { key: keyof Look['targets']; label: string }[] = [
  { key: 'titleBar', label: 'Title bar' },
  { key: 'statusBar', label: 'Status bar (bottom)' },
  { key: 'activityBar', label: 'Icon bar (left)' },
  { key: 'tabs', label: 'Line over the open tab' },
  { key: 'border', label: 'Window border' },
];

export function currentLook(): Look {
  const c = vscode.workspace.getConfiguration('vibespaces');
  const t = c.get<Partial<Look['targets']>>('colorTargets') || {};
  const kind = vscode.window.activeColorTheme.kind;
  return {
    targets: {
      titleBar: t.titleBar ?? true, statusBar: t.statusBar ?? true, activityBar: t.activityBar ?? false,
      tabs: t.tabs ?? false, border: t.border ?? false,
    },
    intensity: c.get<string>('intensity') === 'subtle' ? 'subtle' : 'bold',
    dark: kind !== vscode.ColorThemeKind.Light && kind !== vscode.ColorThemeKind.HighContrastLight,
  };
}

// every colour key Vibespaces writes; the ones a look doesn't use are removed
const MANAGED = [
  'titleBar.activeBackground', 'titleBar.activeForeground', 'titleBar.inactiveBackground', 'titleBar.inactiveForeground',
  'statusBar.background', 'statusBar.foreground',
  'activityBar.background', 'activityBar.foreground', 'activityBar.inactiveForeground', 'activityBar.activeBorder',
  'tab.activeBorderTop', 'tab.unfocusedActiveBorderTop',
  'window.activeBorder', 'window.inactiveBorder',
];

export function colorKeys(color: string, look: Look): Record<string, string> {
  // subtle: the colour mixed into the theme's own grey, so it tints rather than shouts
  const bg = look.intensity === 'subtle' ? mix(color, look.dark ? '#1f1f1f' : '#f3f3f3', 0.45) : color;
  const fg = textColorFor(bg);
  const k: Record<string, string> = {};
  if (look.targets.titleBar) {
    k['titleBar.activeBackground'] = bg; k['titleBar.activeForeground'] = fg;
    k['titleBar.inactiveBackground'] = bg + 'b3'; k['titleBar.inactiveForeground'] = fg + 'b3';
  }
  if (look.targets.statusBar) { k['statusBar.background'] = bg; k['statusBar.foreground'] = fg; }
  if (look.targets.activityBar) {
    k['activityBar.background'] = bg; k['activityBar.foreground'] = fg;
    k['activityBar.inactiveForeground'] = fg + '99'; k['activityBar.activeBorder'] = fg;
  }
  if (look.targets.tabs) { k['tab.activeBorderTop'] = color; k['tab.unfocusedActiveBorderTop'] = color + '80'; }
  if (look.targets.border) { k['window.activeBorder'] = color; k['window.inactiveBorder'] = color + '80'; }
  return k;
}

// ---- writing space files (comments and anything else in them are kept) ----

type Change = [JSONPath, unknown];   // value undefined = remove

function editFile(file: string, changes: Change[]): void {
  let text = fs.readFileSync(file, 'utf8');
  for (const [p, v] of changes) text = applyEdits(text, modify(text, p, v, FMT));
  fs.writeFileSync(file, text, 'utf8');
}

export function writeLook(file: string, color: string, look = currentLook()): void {
  const keys = colorKeys(color, look);
  editFile(file, [
    [['settings', 'vibespaces.color'], color],
    ...MANAGED.map((k): Change => [['settings', 'workbench.colorCustomizations', k], keys[k]]),
  ]);
}

export function setFolders(file: string, folders: string[]): void {
  editFile(file, [[['folders'], folders.map((f) => ({ path: f.replace(/\\/g, '/') }))]]);
}

export function setIcon(file: string, style: IconStyle | undefined, image?: string): void {
  const changes: Change[] = [[['settings', 'vibespaces.iconStyle'], style]];
  if (image !== undefined) changes.push([['settings', 'vibespaces.iconImage'], image || undefined]);
  editFile(file, changes);
}

// writes only what's set, so a hand-edited file stays short
export function setOnOpen(file: string, o: OnOpen): void {
  const out: Record<string, unknown> = {};
  if (o.panels.length) out.panels = o.panels;
  const layout = Object.fromEntries(Object.entries(o.layout).filter(([, v]) => v));
  if (Object.keys(layout).length) out.layout = layout;
  const files = o.files.map((f) => f.trim()).filter(Boolean);
  if (files.length) out.files = files;
  const terminals = o.terminals.map((t) => ({ name: t.name.trim(), command: t.command.trim() })).filter((t) => t.command);
  if (terminals.length) out.terminals = terminals;
  if (o.url.trim()) { out.url = o.url.trim(); out.urlIn = o.urlIn; }
  if (o.window) out.window = windowOut(o.window);
  if (o.resetTabs === 'close') out.resetTabs = 'close';
  editFile(file, [[['settings', 'vibespaces.onOpen'], Object.keys(out).length ? out : undefined]]);
}

export function setTheme(file: string, theme: string | undefined): void {
  editFile(file, [[['settings', 'workbench.colorTheme'], theme || undefined]]);
}

export function validName(name: string): string | undefined {
  if (!name.trim()) return 'Give the space a name';
  if (/[\\/:*?"<>|]/.test(name)) return 'A name can\'t contain \\ / : * ? " < > |';
  return undefined;
}

export function nameTaken(name: string, except?: string): boolean {
  return listSpaces().some((s) => s.name.toLowerCase() === name.trim().toLowerCase() && !(except && sameFile(s.file, except)));
}

export function createSpaceFile(name: string, folders: string[], color: string): string {
  const file = path.join(spacesFolder(), `${name}.code-workspace`);
  if (fs.existsSync(file)) throw new Error(`A space called "${name}" already exists`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [
    '{',
    '  // A Vibespaces space: double-click this file (or its taskbar pin) to open the project in VS Code.',
    '  // VS Code remembers this window\'s layout under this file, so set it up once and it comes back that way.',
    '  // Change it with Vibespaces: Edit Space… (the gear next to the space in the Vibespaces list).',
    '  "folders": [],',
    '  "settings": {}',
    '}',
    '',
  ].join('\n'), 'utf8');
  setFolders(file, folders);
  editFile(file, [
    [['settings', 'vibespaces.id'], `Vibespaces.${slug(name)}.${crypto.randomBytes(4).toString('hex')}`],
    // the window name starts with the space name: the title bar, the taskbar, and how Vibespaces finds the window
    [['settings', 'window.title'], name + '${separator}${activeEditorShort}${dirty}'],
  ]);
  writeLook(file, color);
  return file;
}

// Renames the file and the window title. The taskbar ID stays, so the pin keeps working.
export function renameSpace(space: Space, newName: string): string {
  const file = path.join(path.dirname(space.file), `${newName}.code-workspace`);
  if (!sameFile(file, space.file) && fs.existsSync(file)) throw new Error(`A space called "${newName}" already exists`);
  ensureId(space);
  let data: any;
  try { data = parse(fs.readFileSync(space.file, 'utf8')); } catch { data = {}; }
  const title = data?.settings?.['window.title'];
  fs.renameSync(space.file, file);
  if (typeof title === 'string' && title.startsWith(space.name)) {
    editFile(file, [[['settings', 'window.title'], newName + title.slice(space.name.length)]]);
  }
  return file;
}
