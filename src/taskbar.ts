// Windows: each space's window gets its own taskbar button and icon, and can be pinned and reopened from the pin.
// The work is done by the helper program (helper/vibespaces-helper.exe, built from helper/*.cs).
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { IconStyle, ScreenRef, Space, ensureId, iconStyleOf, initials, spacesFolder } from './spaces';

export function helperAvailable(): boolean {
  return process.platform === 'win32';
}

// the helper program (helper/*.cs, built by tools/build-helper.js)
export function helperExe(extPath: string): string {
  return path.join(extPath, 'helper', 'vibespaces-helper.exe');
}

function runHelper(extPath: string, args: string[], timeoutMs = 45000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(helperExe(extPath), args, { timeout: timeoutMs, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) reject(new Error((stderr || err.message).trim()));
        else resolve(stdout.trim());
      });
  });
}

// VS Code itself: the program the pin reopens, and its logo (looked up each time, since updates move the install folder)
function codeExe(): string {
  if (/\.exe$/i.test(process.execPath) && !/node\.exe$/i.test(process.execPath)) return process.execPath;
  return path.resolve(vscode.env.appRoot, '..', '..', '..', 'Code.exe');
}

function codeIco(): string {
  return path.join(vscode.env.appRoot, 'resources', 'win32', 'code.ico');
}

export function defaultIconStyle(): IconStyle {
  const v = vscode.workspace.getConfiguration('vibespaces').inspect<string>('iconStyle')?.globalValue;
  return iconStyleOf(v) ?? 'windowInitials';
}

// What a space's icon is made from. A picture that's gone, or the VS Code logo in an editor that doesn't ship
// VS Code's icon file (Cursor, Windsurf...), falls back to the window with initials.
export function iconSource(space: Space): { style: IconStyle; image?: string } {
  const style = space.iconStyle ?? defaultIconStyle();
  if (style === 'image') {
    if (space.iconImage && fs.existsSync(space.iconImage)) return { style, image: space.iconImage };
    return { style: 'windowInitials' };
  }
  if (style === 'vscode' && !fs.existsSync(codeIco())) return { style: 'windowInitials' };
  return { style };
}

const STYLE_REV: Partial<Record<IconStyle, string>> = { initials: ' v2', vscode: ' v2' };   // vscode v2: greys stay grey

// The space's .ico, made once per name + look. Old ones are kept: a pin may still point at one.
export async function spaceIcon(extPath: string, space: Space, log: (m: string) => void): Promise<string | undefined> {
  if (!helperAvailable() || !space.color) return undefined;
  const { style, image } = iconSource(space);
  const safe = space.name.replace(/[^A-Za-z0-9 _-]+/g, '').trim() || 'space';
  // the style's design version is in the name, so a redesign makes new icons instead of reusing old ones
  let key = `${space.color.slice(1)} ${style}${STYLE_REV[style] ?? ''}`;
  if (image) key += ' ' + crypto.createHash('sha1').update(image + fs.statSync(image).mtimeMs).digest('hex').slice(0, 8);
  const out = path.join(spacesFolder(), 'icons', `${safe} ${key}.ico`);
  if (fs.existsSync(out)) return out;
  const args = ['-Action', 'icon', '-Style', style, '-Color', space.color, '-Out', out];
  if (style === 'vscode') args.push('-Source', codeIco());
  else if (style === 'image') args.push('-Source', image!);
  else if (style === 'initials' || style === 'windowInitials') args.push('-Text', initials(space.name));
  log(await runHelper(extPath, args));
  return out;
}

export interface WindowPos { x: number; y: number; width: number; height: number; maximized: boolean }

// the screens now, numbered left to right
export interface ScreenInfo { id: string; name: string; index: number; primary: boolean; x: number; y: number; width: number; height: number }

export async function listScreens(extPath: string): Promise<ScreenInfo[]> {
  if (!helperAvailable()) return [];
  const list = JSON.parse(await runHelper(extPath, ['-Action', 'screens'], 15000));
  return Array.isArray(list) ? list : [];
}

export function screenRef(s: ScreenInfo): ScreenRef {
  return { id: s.id, index: s.index, name: s.name };
}

// where this space's window is on screen now
export async function whereWindow(extPath: string, space: Space): Promise<WindowPos> {
  const out = await runHelper(extPath, ['-Action', 'where', '-ProcessId', String(process.ppid), '-Title', space.name]);
  const j = JSON.parse(out);
  if (j.error) throw new Error(j.error);
  return { x: j.x, y: j.y, width: j.width, height: j.height, maximized: !!j.maximized };
}

// raise: also bring it up above the other windows (a group coming home); activate: and give it the focus
export async function placeWindow(extPath: string, space: Space, p: WindowPos & { preset?: string; screen?: ScreenRef }, log: (m: string) => void, raise = false, activate = false): Promise<void> {
  const r = [...(raise ? ['-Raise'] : []), ...(activate ? ['-Activate'] : [])];
  if (p.preset) {
    const on = p.screen ? ['-Screen', p.screen.id, '-ScreenIndex', String(p.screen.index)] : [];
    log(`window: ${await runHelper(extPath, ['-Action', 'snap', '-ProcessId', String(process.ppid), '-Title', space.name, '-Where', p.preset, ...on, ...r])}`);
    return;
  }
  const args = ['-Action', 'place', '-ProcessId', String(process.ppid), '-Title', space.name,
    '-X', String(p.x), '-Y', String(p.y), '-Width', String(p.width), '-Height', String(p.height), ...r];
  if (p.maximized) args.push('-Maximize');
  log(`window: ${await runHelper(extPath, args)}`);
}

// Keeps the window in front of other windows (true), stops (false), or only asks (undefined); answers how it is now.
export async function windowOnTop(extPath: string, space: Space, set?: boolean): Promise<boolean> {
  const args = ['-Action', 'ontop', '-ProcessId', String(process.ppid), '-Title', space.name];
  if (set !== undefined) args.push('-Set', set ? 'on' : 'off');
  const out = await runHelper(extPath, args, 15000);
  if (out !== 'on' && out !== 'off') throw new Error(out);
  return out === 'on';
}

export async function raiseWindow(extPath: string, space: Space, log: (m: string) => void, activate = false): Promise<void> {
  log(`window: ${await runHelper(extPath, ['-Action', 'raise', '-ProcessId', String(process.ppid), '-Title', space.name, ...(activate ? ['-Activate'] : [])])}`);
}

// Gives this window its space's taskbar identity. force: set it again even if it's already there (e.g. a new icon).
export async function identifyWindow(extPath: string, space: Space, force: boolean, log: (m: string) => void): Promise<void> {
  const icon = await spaceIcon(extPath, space, log);
  const args = [
    '-Action', 'identify',
    '-ProcessId', String(process.ppid),   // the extension host's parent is the VS Code process that owns the windows
    '-Title', space.name,
    '-AppId', ensureId(space),
    '-Icon', icon ? `${icon},0` : `${codeExe()},0`,
    '-Command', `"${codeExe()}" "${space.file}"`,
    '-DisplayName', space.name,
  ];
  if (force) args.push('-Force');
  log(await runHelper(extPath, args));
}
