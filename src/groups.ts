// Window groups: a few spaces that work side by side, each in its spot on the screen.
// Open a group to open all its spaces and arrange them; home it (Ctrl+Alt+Shift+Home) to put them all back in their
// spots and bring them to the front. Each window arranges itself: the window that asks writes a small signal file in
// the extension's global storage, which every VS Code window watches.
// Groups live in the user setting vibespaces.groups. A member is a space's taskbar id (it survives renames), with
// its file as a fallback, and an optional spot that wins over the space's own while the group is used.
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { Space, WINDOW_PRESETS, WindowPreset, WindowSpot, ensureId, listSpaces, sameFile } from './spaces';

export interface Member { id: string; file: string; spot?: WindowPreset }
// What a group starts when you OPEN it (never when it's only put back in place). A space opened on its own stays
// as it is, so an agent's space can open light and its group can bring the app and the files along.
//   terminal  a command in a terminal of one member's window (`in`: that space's id; none: the first member),
//             in the space's folder; once per window (a terminal of that name already there is left alone)
//   run       a program or command started outside VS Code, by the window that opened the group
//   open      a file, folder or web page opened with its default app (an Excel sheet opens in Excel)
export interface Launch { kind: 'terminal' | 'run' | 'open'; name?: string; command?: string; target?: string; in?: string }
export interface Group { name: string; members: Member[]; shortcut?: string; launch?: Launch[] }

const isPreset = (v: unknown): v is WindowPreset => WINDOW_PRESETS.some((p) => p.id === v);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function readLaunch(v: unknown): Launch[] {
  return (Array.isArray(v) ? v : []).map((l: any): Launch | undefined => {
    const kind = l?.kind;
    if (kind === 'terminal' || kind === 'run') {
      const command = str(l.command);
      return command ? { kind, command, ...(str(l.name) ? { name: str(l.name) } : {}), ...(kind === 'terminal' && str(l.in) ? { in: str(l.in) } : {}) } : undefined;
    }
    if (kind === 'open') { const target = str(l.target); return target ? { kind, target } : undefined; }
    return undefined;
  }).filter((l): l is Launch => !!l);
}

export function allGroups(): Group[] {
  const raw = vscode.workspace.getConfiguration('vibespaces').get<unknown[]>('groups') || [];
  return raw.filter((g: any) => g && typeof g.name === 'string' && g.name.trim()).map((g: any) => ({
    name: g.name.trim(),
    members: (Array.isArray(g.members) ? g.members : [])
      .filter((m: any) => m && (typeof m.id === 'string' || typeof m.file === 'string'))
      .map((m: any) => ({ id: String(m.id || ''), file: String(m.file || ''), spot: isPreset(m.spot) ? m.spot : undefined })),
    shortcut: typeof g.shortcut === 'string' && g.shortcut.trim() ? g.shortcut.trim().toLowerCase() : undefined,
    launch: readLaunch(g.launch),
  }));
}

export async function saveGroups(groups: Group[]): Promise<void> {
  const store = groups.map((g) => ({
    name: g.name,
    members: g.members.map((m) => (m.spot ? { id: m.id, file: m.file, spot: m.spot } : { id: m.id, file: m.file })),
    ...(g.shortcut ? { shortcut: g.shortcut } : {}),
    ...(g.launch && g.launch.length ? { launch: g.launch } : {}),
  }));
  await vscode.workspace.getConfiguration('vibespaces').update('groups', store, vscode.ConfigurationTarget.Global);
}

export function memberFor(space: Space, spot?: WindowPreset): Member {
  return { id: ensureId(space), file: space.file, spot };
}

export function memberSpace(m: Member, spaces = listSpaces()): Space | undefined {
  return spaces.find((s) => m.id && s.id === m.id) ?? spaces.find((s) => m.file && sameFile(s.file, m.file));
}

export function groupsOf(space: Space): Group[] {
  return allGroups().filter((g) => g.members.some((m) => (m.id && m.id === space.id) || (m.file && sameFile(m.file, space.file))));
}

// where a member goes: the group's spot for it, or the space's own
export function spotFor(m: Member, space: Space | undefined): WindowSpot | undefined {
  if (m.spot) return { preset: m.spot, x: 0, y: 0, width: 0, height: 0, maximized: false, atOpen: true };
  return space?.onOpen.window;
}

export function describeSpot(m: Member, space: Space | undefined): string {
  const label = (id: string) => WINDOW_PRESETS.find((p) => p.id === id)?.label ?? id;
  if (m.spot) return label(m.spot);
  const w = space?.onOpen.window;
  if (!w) return 'its own spot (none set: stays where it is)';
  return `its own spot (${w.preset ? label(w.preset) : 'where it was saved'})`;
}

// ---- the signal every window watches ----

export interface Signal {
  seq: string;
  at: number;
  ids: string[] | null;                  // null: every open space
  spots: Record<string, WindowPreset>;   // a group's spot for a space, by its id
  ttl: number;                           // ms: windows that open this soon after it (Open group) follow it too
  focus?: string;                        // the space whose window also takes the focus (the global shortcut)
  group?: string;                        // the group's name: each window reads its own spot from its own copy of it
  launch?: boolean;                      // Open Group: each member window also starts its terminals from the group
}

export function signalPath(ctx: vscode.ExtensionContext): string {
  return path.join(ctx.globalStorageUri.fsPath, 'home-signal.json');
}

export function sendSignal(ctx: vscode.ExtensionContext, ids: string[] | null, spots: Record<string, WindowPreset>, ttl = 0, focus?: string, group?: string, launch = false): Signal {
  const sig: Signal = { seq: crypto.randomBytes(6).toString('hex'), at: Date.now(), ids, spots, ttl, focus, group, ...(launch ? { launch: true } : {}) };
  fs.mkdirSync(path.dirname(signalPath(ctx)), { recursive: true });
  fs.writeFileSync(signalPath(ctx), JSON.stringify(sig), 'utf8');
  return sig;
}

export function readSignal(ctx: vscode.ExtensionContext): Signal | undefined {
  try {
    const s = JSON.parse(fs.readFileSync(signalPath(ctx), 'utf8'));
    return typeof s?.seq === 'string' && typeof s.at === 'number' ? s : undefined;
  } catch { return undefined; }
}

// a group's members as ids and spots, for a signal
export function signalFor(g: Group): { ids: string[]; spots: Record<string, WindowPreset> } {
  const spaces = listSpaces();
  const ids: string[] = [], spots: Record<string, WindowPreset> = {};
  for (const m of g.members) {
    const s = memberSpace(m, spaces);
    const id = s ? ensureId(s) : m.id;
    if (!id) continue;
    ids.push(id);
    if (m.spot) spots[id] = m.spot;
  }
  return { ids, spots };
}

// the group a signal is about, from this window's own settings: by name, else (a signal from an older Vibespaces,
// which sent no name) the one group with exactly those spaces
function signalGroup(sig: Signal): Group | undefined {
  const groups = allGroups();
  const named = sig.group ? groups.find((g) => g.name === sig.group) : undefined;
  if (named || !sig.ids) return named;
  const key = (ids: string[]) => [...ids].sort().join('|');
  const want = key(sig.ids);
  const same = groups.filter((g) => key(signalFor(g).ids) === want);
  return same.length === 1 ? same[0] : undefined;
}

// where this space goes for a signal: its spot in the group as this window knows it, so a window never takes a spot
// meant for another group (or one the sender's Vibespaces didn't know); the sender's map only when the group isn't
// here (settings not caught up yet); undefined: the space's own spot
export function spotInSignal(sig: Signal, space: Space, id: string): WindowPreset | undefined {
  const g = signalGroup(sig);
  const m = g?.members.find((x) => (x.id && x.id === id) || (x.file && sameFile(x.file, space.file)));
  return m ? m.spot : sig.spots[id];
}

// the terminals this window starts for an Open Group signal: the group's terminal launches meant for this space (as
// this window's own settings have the group); one with no window named goes to the group's first member
export function terminalsInSignal(sig: Signal, space: Space, id: string): Launch[] {
  if (!sig.launch) return [];
  const g = signalGroup(sig);
  if (!g || !g.launch) return [];
  const first = g.members.length ? memberSpace(g.members[0]) : undefined;
  const isMe = (sid?: string) => !!sid && (sid === id || sid === space.id);
  return g.launch.filter((l) => l.kind === 'terminal' && (l.in ? isMe(l.in) : !!first && (isMe(first.id) || sameFile(first.file, space.file))));
}

// "ctrl+alt+shift+1" -> "Ctrl+Alt+Shift+1"
export function prettyShortcut(s: string): string {
  return s.split('+').map((k) => k.trim()).filter(Boolean)
    .map((k) => (k.length === 1 ? k.toUpperCase() : k.charAt(0).toUpperCase() + k.slice(1))).join('+');
}
