// Presets: a space's setup (panels, layout, tab tidying) under a name, to start other spaces from.
// Built-in ones ship with Vibespaces; yours live in the user setting vibespaces.presets (so Settings Sync carries them).
// A preset never holds files, terminals, a web page or a window position: those belong to one project or one screen.
import * as vscode from 'vscode';
import { OnOpen } from './spaces';

export interface Preset {
  name: string;
  description: string;
  builtIn?: boolean;
  kind?: 'assistant' | 'layout';
  needs?: { id: string; name: string };   // the extension it's built around
  panels: string[];
  layout: OnOpen['layout'];
  resetTabs: OnOpen['resetTabs'];
}

// An assistant that lives in a side bar fills the window from the right side bar ("Fill the window").
// VS Code can't move a panel by script (its Move View commands always ask), so one that starts in the left bar
// has to be dragged to the right side bar once; its description says so.
const fill: OnOpen['layout'] = { left: 'hide', right: 'maximize', bottom: 'hide' };
const DRAG = ' Drag its icon to the right side bar once, so it can fill the window.';

export const BUILT_IN_PRESETS: Preset[] = [
  {
    name: 'Claude vibe coder', kind: 'assistant', builtIn: true,
    description: 'Claude Code fills the window as a tab; the side bars and bottom panel stay out of the way, and a reset tidies stray tabs.',
    needs: { id: 'anthropic.claude-code', name: 'Claude Code' },
    panels: ['ext:anthropic.claude-code'], layout: { left: 'hide', right: 'hide', bottom: 'hide' }, resetTabs: 'close',
  },
  {
    name: 'Codex', kind: 'assistant', builtIn: true,
    description: 'OpenAI\'s Codex fills the window from the right side bar; a reset tidies stray tabs.',
    needs: { id: 'openai.chatgpt', name: 'Codex' },
    panels: ['view:codexSecondaryViewContainer'], layout: fill, resetTabs: 'close',
  },
  {
    name: 'Antigravity', kind: 'assistant', builtIn: true,
    description: 'Google\'s Antigravity fills the window from the right side bar; a reset tidies stray tabs.' + DRAG,
    needs: { id: 'google.google-antigravity', name: 'Antigravity' },
    panels: ['ext:google.google-antigravity'], layout: fill, resetTabs: 'close',
  },
  {
    name: 'Gemini Code Assist', kind: 'assistant', builtIn: true,
    description: 'Gemini Code Assist fills the window from the right side bar (it now works for Google Cloud accounts; personal accounts use Antigravity).' + DRAG,
    needs: { id: 'google.geminicodeassist', name: 'Gemini Code Assist' },
    panels: ['view:geminiChat'], layout: fill, resetTabs: 'close',
  },
  {
    name: 'Grok (AFK Pilot)', kind: 'assistant', builtIn: true,
    description: 'AFK Pilot (Grok, and the other models it runs) fills the window from the right side bar; a reset tidies stray tabs.',
    needs: { id: 'pawelhuryn.grok-vscode-phuryn', name: 'AFK Pilot' },
    panels: ['view:grokSidebar'], layout: fill, resetTabs: 'close',
  },
  {
    name: 'GitHub Copilot', kind: 'assistant', builtIn: true,
    description: 'VS Code\'s Chat (GitHub Copilot) fills the window from the right side bar; sign in with GitHub to use it.',
    panels: ['chat'], layout: fill, resetTabs: 'close',
  },
  {
    name: 'Cline', kind: 'assistant', builtIn: true,
    description: 'Cline fills the window from the right side bar; a reset tidies stray tabs.' + DRAG,
    needs: { id: 'saoudrizwan.claude-dev', name: 'Cline' },
    panels: ['view:claude-dev-ActivityBar'], layout: fill, resetTabs: 'close',
  },
  {
    name: 'Local AI (Ollama)', kind: 'assistant', builtIn: true,
    description: 'VS Code\'s Chat on your own models through Ollama (Qwen, gpt-oss…: pick one in Chat\'s model list), filling the window from the right side bar. Needs the Ollama extension (and GitHub Copilot Chat).',
    needs: { id: 'Ollama.ollama', name: 'Ollama' },
    panels: ['chat'], layout: fill, resetTabs: 'close',
  },
  {
    name: 'Continue (local AI)', kind: 'assistant', builtIn: true,
    description: 'Continue, the open-source assistant for local models (chat, plus suggestions as you type), filling the window from the right side bar.' + DRAG,
    needs: { id: 'Continue.continue', name: 'Continue' },
    panels: ['view:continue'], layout: fill, resetTabs: 'close',
  },
  {
    name: 'Classic editor', kind: 'layout', builtIn: true,
    description: 'Files on the left, a terminal along the bottom, nothing on the right.',
    panels: ['explorer', 'terminal'], layout: { left: 'show', right: 'hide', bottom: 'show' }, resetTabs: 'keep',
  },
  {
    name: 'Clean slate', kind: 'layout', builtIn: true,
    description: 'Just the editor: every side bar and panel hidden, stray tabs closed on reset.',
    panels: [], layout: { left: 'hide', right: 'hide', bottom: 'hide' }, resetTabs: 'close',
  },
];

// the extension a preset is built around isn't installed
export function missing(p: Preset): { id: string; name: string } | undefined {
  return p.needs && !vscode.extensions.getExtension(p.needs.id) ? p.needs : undefined;
}

// after a preset is used: if its assistant isn't installed, say so and offer its page in Extensions
export async function offerInstall(p: Preset): Promise<void> {
  const need = missing(p);
  if (!need) return;
  const go = await vscode.window.showInformationMessage(
    `"${p.name}" uses ${need.name}, which isn't installed. Install it, then reopen the space (or press Ctrl+Alt+Home).`, `Show ${need.name}`);
  if (go) await vscode.commands.executeCommand('extension.open', need.id);
}

export const KIND_LABEL ={ assistant: 'AI assistants', layout: 'Layouts', mine: 'Yours' };
export function kindOf(p: Preset): keyof typeof KIND_LABEL {
  return !p.builtIn ? 'mine' : p.kind === 'assistant' ? 'assistant' : 'layout';
}

export function userPresets(): Preset[] {
  const raw = vscode.workspace.getConfiguration('vibespaces').get<unknown[]>('presets') || [];
  const show = (v: unknown) => (v === 'show' || v === 'hide' ? v : '') as '' | 'show' | 'hide';
  return raw.filter((p: any) => p && typeof p.name === 'string' && p.name.trim()).map((p: any) => ({
    name: p.name.trim(),
    description: typeof p.description === 'string' ? p.description : '',
    panels: Array.isArray(p.panels) ? p.panels.filter((x: unknown) => typeof x === 'string') : [],
    layout: {
      left: show(p.layout?.left),
      right: p.layout?.right === 'maximize' ? 'maximize' : show(p.layout?.right),
      bottom: show(p.layout?.bottom),
    },
    resetTabs: p.resetTabs === 'close' ? 'close' : 'keep',
  }));
}

export function allPresets(): Preset[] {
  const mine = userPresets();
  // a preset of yours with a built-in's name replaces it
  return [...BUILT_IN_PRESETS.filter((b) => !mine.some((m) => m.name.toLowerCase() === b.name.toLowerCase())), ...mine];
}

export function presetFrom(name: string, o: OnOpen, description = ''): Preset {
  return { name, description, panels: [...o.panels], layout: { ...o.layout }, resetTabs: o.resetTabs };
}

export async function savePreset(p: Preset): Promise<void> {
  const rest = userPresets().filter((x) => x.name.toLowerCase() !== p.name.toLowerCase());
  const store = [...rest, p].map(({ builtIn, ...keep }) => keep);
  await vscode.workspace.getConfiguration('vibespaces').update('presets', store, vscode.ConfigurationTarget.Global);
}

export async function deletePreset(name: string): Promise<void> {
  const store = userPresets().filter((x) => x.name.toLowerCase() !== name.toLowerCase());
  await vscode.workspace.getConfiguration('vibespaces').update('presets', store, vscode.ConfigurationTarget.Global);
}

// a space's setup with a preset applied: its files, terminals, web page and window position stay
export function withPreset(o: OnOpen, p: Preset): OnOpen {
  return { ...o, panels: [...p.panels], layout: { ...p.layout }, resetTabs: p.resetTabs };
}

// a short line for lists: what the preset does
export function summary(p: Preset): string {
  if (p.description) return p.description;
  const bits: string[] = [];
  if (p.panels.length) bits.push(`${p.panels.length} panel${p.panels.length === 1 ? '' : 's'}`);
  const L = p.layout;
  for (const [k, label] of [['left', 'left bar'], ['right', 'right bar'], ['bottom', 'bottom panel']] as const) {
    if (L[k]) bits.push(`${label} ${L[k] === 'maximize' ? 'fills the window' : L[k] === 'show' ? 'shown' : 'hidden'}`);
  }
  if (p.resetTabs === 'close') bits.push('reset closes stray tabs');
  return bits.join(' · ') || 'No changes';
}
