// The group shortcuts from anywhere (Windows): VS Code's own shortcuts only work while it's in front, so a small
// helper holds a system-wide hotkey (one helper per shortcut: the main one, and each group's own). Every window tries to start one; Windows lets only one program hold a hotkey,
// so one wins and the rest try again now and then (and when focused), taking over when the winner's window closes.
import { ChildProcess, spawn } from 'child_process';
import { helperExe } from './taskbar';
import * as vscode from 'vscode';

const MODS: Record<string, number> = { alt: 1, ctrl: 2, control: 2, shift: 4, win: 8, meta: 8 };
const KEYS: Record<string, number> = {
  home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22, insert: 0x2d, delete: 0x2e, space: 0x20, tab: 0x09,
  up: 0x26, down: 0x28, left: 0x25, right: 0x27, '`': 0xc0, backquote: 0xc0,
};

// "ctrl+alt+shift+home" -> modifiers and a virtual-key code; undefined if it can't be a global shortcut
export function parseShortcut(s: string): { mods: number; key: number } | undefined {
  const parts = s.toLowerCase().split('+').map((p) => p.trim()).filter(Boolean);
  let mods = 0, key = 0;
  for (const p of parts) {
    if (MODS[p]) mods |= MODS[p];
    else if (KEYS[p]) key = KEYS[p];
    else if (/^f([1-9]|1[0-9]|2[0-4])$/.test(p)) key = 0x6f + Number(p.slice(1));
    else if (/^[a-z0-9]$/.test(p)) key = p.toUpperCase().charCodeAt(0);
    else return undefined;
  }
  return key && mods ? { mods, key } : undefined;   // a bare key would steal it from every app
}

export class GlobalHotkey implements vscode.Disposable {
  private child?: ChildProcess;
  private holding = false;
  private retry?: NodeJS.Timeout;
  private lastTry = 0;
  private warned = false;

  // want: the shortcut to hold right now ('' for none); label: what it does, for the log
  constructor(private extPath: string, private log: (m: string) => void, private onPress: () => void,
    private want: () => string = () => (vscode.workspace.getConfiguration('vibespaces').get<string>('globalShortcut') ?? '').trim(),
    private label = 'global shortcut') {}

  get active(): boolean { return this.holding; }

  // (re)start with the current setting; called at start, on focus and when the setting changes
  start(force = false) {
    if (process.platform !== 'win32') return;
    if (this.holding && !force) return;
    if (!force && Date.now() - this.lastTry < 8000) return;
    this.stop();
    const want = this.want();
    if (!want) return;
    const k = parseShortcut(want);
    if (!k) { this.log(`${this.label}: can't use "${want}"`); return; }
    this.lastTry = Date.now();
    const child = spawn(helperExe(this.extPath),
      ['-Action', 'hotkey', '-Mods', String(k.mods), '-Key', String(k.key), '-OwnerPid', String(process.pid)], { windowsHide: true });
    this.child = child;
    let buf = '';
    child.stdout?.on('data', (d) => {
      buf += String(d);
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (line === 'listening') { this.holding = true; this.log(`${this.label}: ${want} works from anywhere (this window holds it)`); }
        else if (line === 'taken') { this.taken(want); }
        else if (line === 'hotkey') { this.onPress(); }
      }
    });
    child.on('exit', () => {
      if (this.child === child) { this.child = undefined; this.holding = false; }
      this.later();
    });
  }

  // another Vibespaces window holds it (fine), or another program does (say so once)
  private taken(want: string) {
    this.holding = false;
    if (!this.warned) { this.warned = true; this.log(`${this.label}: ${want} is held elsewhere (another VS Code window, or another program); trying again later`); }
  }

  private later() {
    clearTimeout(this.retry);
    this.retry = setTimeout(() => this.start(), 60000);
  }

  stop() {
    clearTimeout(this.retry);
    if (this.child) { const c = this.child; this.child = undefined; this.holding = false; try { c.kill(); } catch { /* gone */ } }
  }

  dispose() { this.stop(); }
}

// the same key however it's written ("Ctrl+Alt+1", "alt+ctrl+1"); undefined if it can't be a global shortcut
export function shortcutKey(s: string): string | undefined {
  const k = parseShortcut(s);
  return k ? `${k.mods}:${k.key}` : undefined;
}
