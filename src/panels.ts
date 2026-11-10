// What a space can open with: VS Code's own views, and every side bar or panel your extensions add,
// found at run time (each extension view container gets an automatic workbench.view.extension.<id> command),
// so assistants like Codex, Gemini or Copilot show up by themselves once installed.
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export interface Panel {
  id: string;        // stored in the space file
  label: string;
  group: string;     // 'VS Code' or the extension's name
  command: string;
  args?: unknown[];
  tabViewType?: string;   // opens as an editor tab of this webview type: skipped when one is already open
}

const BUILT_IN: Panel[] = [
  { id: 'explorer', label: 'Files (Explorer)', group: 'VS Code', command: 'workbench.view.explorer' },
  { id: 'search', label: 'Search', group: 'VS Code', command: 'workbench.view.search' },
  { id: 'scm', label: 'Source Control', group: 'VS Code', command: 'workbench.view.scm' },
  { id: 'debug', label: 'Run and Debug', group: 'VS Code', command: 'workbench.view.debug' },
  { id: 'testing', label: 'Testing', group: 'VS Code', command: 'workbench.view.testing' },
  { id: 'extensions', label: 'Extensions', group: 'VS Code', command: 'workbench.view.extensions' },
  { id: 'problems', label: 'Problems', group: 'VS Code', command: 'workbench.actions.view.problems' },
  { id: 'terminal', label: 'Terminal', group: 'VS Code', command: 'workbench.action.terminal.focus' },
  { id: 'chat', label: 'Chat (Copilot)', group: 'VS Code', command: 'workbench.action.chat.open' },
];

// Extensions whose own "open" command beats focusing their container (it opens them where the user set them to)
const PREFERRED: Record<string, { label: string; command: string; containers: string[]; tabViewType?: string }> = {
  'anthropic.claude-code': {
    label: 'Claude Code', command: 'claude-vscode.editor.openLast', tabViewType: 'claudeVSCodePanel',
    containers: ['claude-sidebar', 'claude-sidebar-secondary', 'claude-sessions-sidebar'],
  },
  'google.google-antigravity': { label: 'Antigravity', command: 'antigravity.panel.focus', containers: ['antigravity-sidebar'] },
};
// ids from 0.2.0 space files
const OLD_IDS: Record<string, string> = { claude: 'anthropic.claude-code', antigravity: 'google.google-antigravity' };

const WHERE: Record<string, string> = { activitybar: 'left side bar', secondarySidebar: 'right side bar', panel: 'bottom panel' };

// VS Code's own views first, then AI assistants (extensions in the AI or Chat category), then everything else
export function allPanels(): Panel[] {
  const assistants: Panel[] = [], others: Panel[] = [];
  const exts = vscode.extensions.all
    .filter((e) => !e.id.startsWith('vscode.') && e.id !== 'bushboul.vibespaces')
    .sort((a, b) => extName(a).localeCompare(extName(b)));
  for (const ext of exts) {
    const pref = PREFERRED[ext.id.toLowerCase()];
    const cats: string[] = Array.isArray(ext.packageJSON?.categories) ? ext.packageJSON.categories : [];
    const isAssistant = !!pref || cats.some((c) => /^(AI|Chat)$/i.test(c));
    const name = extName(ext);
    const found: Panel[] = [];
    if (pref) found.push({ id: `ext:${ext.id.toLowerCase()}`, label: pref.label, group: '', command: pref.command, tabViewType: pref.tabViewType });
    const containers = ext.packageJSON?.contributes?.viewsContainers || {};
    for (const where of Object.keys(containers)) {
      for (const c of Array.isArray(containers[where]) ? containers[where] : []) {
        if (typeof c?.id !== 'string' || (pref && pref.containers.includes(c.id))) continue;
        found.push({ id: `view:${c.id}`, label: localize(ext, c.title) || c.id, group: WHERE[where] ?? where, command: `workbench.view.extension.${c.id}` });
      }
    }
    // an extension with the same title in several places: say where each one is (and number repeats in one place)
    const title = found.map((p) => p.label), place = found.map((p) => p.group);
    found.forEach((p, i) => {
      if (title.filter((t) => t === title[i]).length > 1 && place[i]) {
        const same = found.filter((_, j) => title[j] === title[i] && place[j] === place[i]).length;
        const nth = found.slice(0, i + 1).filter((_, j) => title[j] === title[i] && place[j] === place[i]).length;
        p.label = `${title[i]} (${place[i]}${same > 1 ? ` ${nth}` : ''})`;
      }
      p.group = isAssistant ? 'AI assistants' : name;
      if (isAssistant && !pref && !p.label.toLowerCase().includes(name.toLowerCase().split(/[:\s]/)[0])) p.label = `${name}: ${p.label}`;
    });
    (isAssistant ? assistants : others).push(...found);
  }
  return [...BUILT_IN, ...assistants, ...others];
}

// an editor tab of this webview type is open in any tab group (VS Code may prefix the type, so match the end)
export function tabOpen(viewType: string): boolean {
  return vscode.window.tabGroups.all.some((g) => g.tabs.some((t) =>
    t.input instanceof vscode.TabInputWebview && (t.input.viewType === viewType || t.input.viewType.endsWith('-' + viewType))));
}

export function findPanel(id: string, panels = allPanels()): Panel | undefined {
  const old = OLD_IDS[id];
  return panels.find((p) => p.id === id || (old && p.id === `ext:${old}`));
}

function extName(ext: vscode.Extension<any>): string {
  return localize(ext, ext.packageJSON?.displayName) || ext.packageJSON?.name || ext.id;
}

// "%key%" titles come from the extension's package.nls.json
const nlsCache = new Map<string, Record<string, string>>();
function localize(ext: vscode.Extension<any>, s: unknown): string {
  if (typeof s !== 'string') return '';
  const m = /^%(.+)%$/.exec(s);
  if (!m) return s;
  let nls = nlsCache.get(ext.id);
  if (!nls) {
    try { nls = JSON.parse(fs.readFileSync(path.join(ext.extensionPath, 'package.nls.json'), 'utf8')); } catch { nls = {}; }
    nlsCache.set(ext.id, nls!);
  }
  const v: any = nls![m[1]];
  return typeof v === 'string' ? v : typeof v?.message === 'string' ? v.message : '';
}

// installed colour themes, by the name workbench.colorTheme takes
export function allThemes(): string[] {
  const names = new Set<string>();
  for (const ext of vscode.extensions.all) {
    for (const t of ext.packageJSON?.contributes?.themes || []) {
      const n = t.id || localize(ext, t.label);
      if (n) names.add(n);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}
