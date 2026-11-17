// The Checkpoints list in the side bar: this window's recent Claude Code sessions, each opening to its checkpoints
// (newest first). A click opens the transcript at that point. It follows the session files as they grow.
import * as fs from 'fs';
import * as vscode from 'vscode';
import { Checkpoint, Kind, Session, Transcript, projectsRoot, sessionDirs, sessionsFor } from './transcripts';

// icon and colour for each kind of checkpoint (the viewer uses the same)
export const KIND_ICON: Record<Kind, [string, string?]> = {
  prompt: ['account'], marker: ['bookmark', 'charts.yellow'], commit: ['git-commit', 'charts.blue'], push: ['cloud-upload', 'charts.blue'],
  release: ['rocket', 'charts.purple'], testsPassed: ['pass', 'testing.iconPassed'], testsFailed: ['error', 'testing.iconFailed'],
  error: ['warning', 'problemsWarningIcon.foreground'], question: ['question', 'charts.orange'], denied: ['circle-slash', 'problemsErrorIcon.foreground'],
  pause: ['clock'], agent: ['hubot'], reply: ['comment'],
};

// read sessions, shared by the list, the viewer and the overview; each one re-reads only what was added to its file
const transcripts = new Map<string, Transcript>();
export function transcriptOf(file: string): Transcript {
  let t = transcripts.get(file);
  if (!t) { t = new Transcript(file); transcripts.set(file, t); }
  return t;
}
export async function transcriptFor(file: string): Promise<Transcript> {
  const t = transcriptOf(file);
  await t.update();
  return t;
}

export const windowFolders = () => (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);

const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
function ago(ms: number): string {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ms).toLocaleDateString();
}

export class SessionItem extends vscode.TreeItem {
  constructor(readonly session: Session, first: boolean) {
    super(session.title, first ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
    this.id = session.file;
    this.description = ago(session.mtime);
    this.tooltip = `${session.title}\nLast active ${new Date(session.mtime).toLocaleString()}`;
    this.iconPath = new vscode.ThemeIcon('comment-discussion');
    this.contextValue = 'session';
  }
}

class CheckpointItem extends vscode.TreeItem {
  constructor(file: string, c: Checkpoint) {
    super(c.label, vscode.TreeItemCollapsibleState.None);
    this.id = `${file}#${c.uuid}`;
    this.description = c.at ? clock(c.at) : '';
    this.tooltip = c.at ? `${c.label}\n${new Date(c.at).toLocaleString()}` : c.label;
    const [icon, color] = KIND_ICON[c.kind];
    this.iconPath = new vscode.ThemeIcon(icon, color ? new vscode.ThemeColor(color) : undefined);
    this.command = { command: 'vibespaces.openCheckpoint', title: 'Show in transcript', arguments: [file, c.uuid] };
  }
}

const MAX_SHOWN = 300;

export class CheckpointsTree implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private watchers: fs.FSWatcher[] = [];
  private timer: NodeJS.Timeout | undefined;
  private watched = '';

  constructor(private changed: () => void) {
    this.watch();
  }

  // the session folders change as files are written; a project's first session makes its folder
  private watch() {
    const dirs = sessionDirs(windowFolders());
    const key = dirs.join('|') || projectsRoot();
    if (key === this.watched) return;
    this.watched = key;
    this.watchers.forEach((w) => w.close());
    this.watchers = [];
    for (const dir of dirs.length ? dirs : [projectsRoot()]) {
      try { this.watchers.push(fs.watch(dir, () => this.soon())); } catch { /* not there yet */ }
    }
  }

  private soon() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), 700);
  }

  refresh() {
    this.watch();
    this.emitter.fire();
    this.changed();
  }

  getTreeItem(el: vscode.TreeItem) { return el; }

  async getChildren(el?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!el) return sessionsFor(windowFolders(), 6).map((s, i) => new SessionItem(s, i === 0));
    if (el instanceof SessionItem) {
      const cps = (await transcriptFor(el.session.file)).checkpoints();
      return cps.slice(-MAX_SHOWN).reverse().map((c) => new CheckpointItem(el.session.file, c));
    }
    return [];
  }

  dispose() {
    this.watchers.forEach((w) => w.close());
    if (this.timer) clearTimeout(this.timer);
    this.emitter.dispose();
  }
}
