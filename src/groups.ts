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
export interface Group { name: string; members: Member[] }

const isPreset = (v: unknown): v is WindowPreset => WINDOW_PRESETS.some((p) => p.id === v);

export function allGroups(): Group[] {
  const raw = vscode.workspace.getConfiguration('vibespaces').get<unknown[]>('groups') || [];
  return raw.filter((g: any) => g && typeof g.name === 'string' && g.name.trim()).map((g: any) => ({
    name: g.name.trim(),
    members: (Array.isArray(g.members) ? g.members : [])
      .filter((m: any) => m && (typeof m.id === 'string' || typeof m.file === 'string'))
      .map((m: any) => ({ id: String(m.id || ''), file: String(m.file || ''), spot: isPreset(m.spot) ? m.spot : undefined })),
  }));
}

export async function saveGroups(groups: Group[]): Promise<void> {
  const store = groups.map((g) => ({
    name: g.name,
    members: g.members.map((m) => (m.spot ? { id: m.id, file: m.file, spot: m.spot } : { id: m.id, file: m.file })),
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
}

export function signalPath(ctx: vscode.ExtensionContext): string {
  return path.join(ctx.globalStorageUri.fsPath, 'home-signal.json');
}

export function sendSignal(ctx: vscode.ExtensionContext, ids: string[] | null, spots: Record<string, WindowPreset>, ttl = 0, focus?: string): Signal {
  const sig: Signal = { seq: crypto.randomBytes(6).toString('hex'), at: Date.now(), ids, spots, ttl, focus };
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
