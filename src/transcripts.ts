// Claude Code's session transcripts, read for checkpoints: the moments worth going back to in a long session.
// Claude Code keeps each session in ~/.claude/projects/<the project's path, every symbol a "-">/<session id>.jsonl,
// one JSON record per line. Vibespaces only reads them. The format is Claude Code's own and isn't documented, so
// everything here reads it defensively: a record it doesn't understand is skipped, never an error.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface Session { file: string; id: string; title: string; mtime: number }

export type Kind = 'prompt' | 'marker' | 'commit' | 'push' | 'release' | 'testsPassed' | 'testsFailed' | 'error' | 'question'
  | 'denied' | 'pause' | 'agent' | 'reply';

export interface Checkpoint { uuid: string; kind: Kind; label: string; at: number }

// one thing in the session, as the viewer shows it
export interface Item {
  uuid: string;
  at: number;
  role: 'you' | 'claude' | 'tool';
  text?: string;                // you, claude
  tool?: string;                // tool: its name, a one-line summary of what it was asked, and what came back
  summary?: string;
  input?: string;
  result?: string;
  error?: boolean;
  checkpoint?: Checkpoint;
}

const PAUSE_MS = 10 * 60 * 1000;
const MAX_RESULT = 6000;

export function projectsRoot(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

// the folder name Claude Code uses for a project: its path with every symbol as "-" (the drive letter's case varies)
const folderKey = (p: string) => p.replace(/[^A-Za-z0-9]/g, '-').toLowerCase();

// the project folders that hold this window's sessions
export function sessionDirs(folders: string[]): string[] {
  const want = new Set(folders.map(folderKey));
  try {
    return fs.readdirSync(projectsRoot(), { withFileTypes: true })
      .filter((d) => d.isDirectory() && want.has(d.name.toLowerCase()))
      .map((d) => path.join(projectsRoot(), d.name));
  } catch { return []; }
}

// the newest sessions first
export function sessionsFor(folders: string[], max = 8): Session[] {
  const out: Session[] = [];
  for (const dir of sessionDirs(folders)) {
    let names: string[] = [];
    try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl')); } catch { continue; }
    for (const n of names) {
      const file = path.join(dir, n);
      try { out.push({ file, id: n.slice(0, -6), title: '', mtime: fs.statSync(file).mtimeMs }); } catch { /* gone */ }
    }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  const top = out.slice(0, max);
  for (const s of top) s.title = titleOf(s.file) || `Session ${s.id.slice(0, 8)}`;
  return top;
}

// The session's title, cheaply: Claude Code's own title near the end of the file, else the first thing you asked.
const titles = new Map<string, { mtime: number; title: string }>();
export function sessionTitle(file: string): string {
  return titleOf(file) || `Session ${path.basename(file, '.jsonl').slice(0, 8)}`;
}
function titleOf(file: string): string {
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch { return ''; }
  const known = titles.get(file);
  if (known && known.mtime === st.mtimeMs) return known.title;
  let title = '';
  const tail = readSlice(file, Math.max(0, st.size - 256 * 1024), st.size);
  const m = [...tail.matchAll(/"aiTitle":"((?:[^"\\]|\\.)*)"/g)].pop();
  if (m) { try { title = JSON.parse(`"${m[1]}"`); } catch { /* keep looking */ } }
  if (!title) {
    for (const line of readSlice(file, 0, Math.min(st.size, 256 * 1024)).split('\n')) {
      const r = parseLine(line);
      const p = r && promptText(r);
      if (p) { title = firstLine(p, 70); break; }
    }
  }
  titles.set(file, { mtime: st.mtimeMs, title });
  return title;
}

function readSlice(file: string, from: number, to: number): string {
  if (to <= from) return '';
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(to - from);
    const n = fs.readSync(fd, buf, 0, buf.length, from);
    return buf.subarray(0, n).toString('utf8');
  } finally { fs.closeSync(fd); }
}

function parseLine(line: string): any {
  if (!line.trim()) return undefined;
  try { return JSON.parse(line); } catch { return undefined; }
}

const firstLine = (t: string, max = 90) => {
  const l = t.trim().split(/\r?\n/).find((x) => x.trim()) ?? '';
  return l.length > max ? l.slice(0, max - 1).trimEnd() + '…' : l;
};

const textOf = (content: unknown): string => typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter((b: any) => b && b.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('\n') : '';

// What you typed, from a record (not tool results, system notes or command wrappers)
function promptText(r: any): string {
  if (r.isSidechain) return '';
  if (r.type === 'attachment' && r.attachment?.type === 'queued_command' && r.attachment.humanTurn) return textOf(r.attachment.prompt).trim();
  if (r.type !== 'user' || r.isMeta || !r.message) return '';
  const c = r.message.content;
  if (Array.isArray(c) && c.some((b: any) => b?.type === 'tool_result')) return '';
  const t = textOf(c).trim();
  const human = r.origin?.kind === 'human';
  if (!t || (!human && (t.startsWith('<') || t.startsWith('[Request interrupted')))) return '';
  return t.replace(/^\[Image: source:[^\]]*\]\s*/gm, '').trim() || '(a picture)';
}

// ---- what a command was ----
// Matched with quoted text taken out, so a command that only searches for "git commit" or "vsce publish" doesn't count.
const unquoted = (cmd: string) => cmd.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
const TESTS = /\b(npm (run )?test|npm t\b|yarn test|pnpm test|pytest|jest|vitest|go test|cargo test|dotnet test|mocha|playwright test|node --test|phpunit|rspec)\b/;
const COMMIT = /\bgit\s+(?:-C\s+\S+\s+)?commit\b/;
const PUSH = /\bgit\s+(?:-C\s+\S+\s+)?push\b/;
const PUBLISH: [RegExp, string][] = [
  [/\bvsce\s+publish\b/, 'VS Code Marketplace'], [/\bovsx\s+publish\b/, 'Open VSX'], [/\bnpm\s+publish\b/, 'npm'],
  [/\bgh\s+release\s+create\b/, 'GitHub'], [/\bcargo\s+publish\b/, 'crates.io'], [/\btwine\s+upload\b/, 'PyPI'],
];

// where a command published, if it did: publishing tools, or a POST that creates a GitHub release
function publishedTo(cmd: string): string {
  const bare = unquoted(cmd);
  const where = PUBLISH.filter(([re]) => re.test(bare)).map(([, w]) => w);
  if (cmd.split(/;|&&|\n/).some((part) => /\bcurl\b/.test(part) && /-X\s*POST/.test(part)
    && /api\.github\.com\/repos\/[^\s"']+\/releases["'\s]/.test(part)) && !where.includes('GitHub')) where.unshift('GitHub');
  return where.join(' and ');
}

// a command as a short line: without the "cd <folder>;" it so often starts with
const shortCommand = (cmd: string, max = 70) => firstLine(cmd.replace(/^\s*cd\s+("[^"]*"|\S+)\s*(;|&&)\s*/, ''), max);

const DENIED = /^Permission (for this action )?(was )?denied|doesn't want to proceed|was denied by|The user rejected/i;

function commitMessage(cmd: string): string {
  const here = cmd.match(/-m\s+"?\$\(cat <<'?(\w+)'?\r?\n([^\r\n]+)/);
  if (here) return here[2].trim();
  const q = cmd.match(/-m\s+(["'])([\s\S]*?)\1/);
  return q ? firstLine(q[2], 80) : '';
}

function commandOf(input: any): string {
  return typeof input?.command === 'string' ? input.command : '';
}

function toolSummary(name: string, input: any): string {
  if (!input || typeof input !== 'object') return '';
  const cmd = commandOf(input);
  if (cmd) return shortCommand(cmd, 140);
  for (const k of ['file_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt', 'skill']) {
    if (typeof input[k] === 'string' && input[k]) return firstLine(input[k], 140);
  }
  if (name === 'AskUserQuestion' && Array.isArray(input.questions)) return firstLine(String(input.questions[0]?.question ?? ''), 140);
  return firstLine(JSON.stringify(input), 140);
}

// A session as it's read so far: re-reads only what was added to the file since the last time.
export class Transcript {
  items: Item[] = [];
  private offset = 0;
  private rest = '';
  private byToolId = new Map<string, Item>();
  private lastAt = 0;
  private lastReply: Item | undefined;   // Claude's latest text in this turn: the turn's reply once you write again
  private tests = new Set<Item>();
  changedFrom = 0;                        // the first item that changed since the last takeChanges()

  constructor(readonly file: string) {}

  // read what's new; true if anything changed
  update(): boolean {
    let size = 0;
    try { size = fs.statSync(this.file).size; } catch { return false; }
    if (size < this.offset) { this.reset(); }   // rewritten: start over
    if (size === this.offset) return false;
    const chunk = this.rest + readSlice(this.file, this.offset, size);
    this.offset = size;
    const lines = chunk.split('\n');
    this.rest = lines.pop() ?? '';
    const before = this.items.length;
    let touched = Number.MAX_SAFE_INTEGER;
    for (const line of lines) {
      const r = parseLine(line);
      if (!r) continue;
      const t = this.take(r);
      if (t !== undefined) touched = Math.min(touched, t);
    }
    if (touched === Number.MAX_SAFE_INTEGER && this.items.length === before) return false;
    this.changedFrom = Math.min(this.changedFrom, touched, before);
    return true;
  }

  takeChanges(): { from: number; items: Item[] } {
    const from = Math.min(this.changedFrom, this.items.length);
    this.changedFrom = this.items.length;
    return { from, items: this.items.slice(from) };
  }

  checkpoints(): Checkpoint[] {
    return this.items.filter((i) => i.checkpoint).map((i) => i.checkpoint!);
  }

  private reset() {
    this.items = []; this.offset = 0; this.rest = ''; this.byToolId.clear(); this.lastAt = 0; this.lastReply = undefined;
    this.tests.clear(); this.changedFrom = 0;
  }

  private add(item: Item): number {
    if (this.lastAt && item.at - this.lastAt > PAUSE_MS && !item.checkpoint) {
      item.checkpoint = { uuid: item.uuid, kind: 'pause', label: `Paused ${Math.round((item.at - this.lastAt) / 60000)} min`, at: item.at };
    }
    if (item.at) this.lastAt = item.at;
    this.items.push(item);
    return this.items.length - 1;
  }

  private mark(item: Item, kind: Kind, label: string) {
    if (!item.checkpoint || item.checkpoint.kind === 'pause') item.checkpoint = { uuid: item.uuid, kind, label, at: item.at };
  }

  // one record; returns the index of an existing item it changed, if any
  private take(r: any): number | undefined {
    if (r.isSidechain) return undefined;
    const at = Date.parse(r.timestamp ?? r.attachment?.timestamp ?? '') || 0;
    const uuid = String(r.uuid ?? r.attachment?.source_uuid ?? `${this.items.length}`);

    const prompt = promptText(r);
    if (prompt) {
      let changed: number | undefined;
      if (this.lastReply) {
        this.mark(this.lastReply, 'reply', `Reply: ${firstLine(this.lastReply.text ?? '', 80)}`);
        changed = this.items.indexOf(this.lastReply);
        this.lastReply = undefined;
      }
      const item: Item = { uuid, at, role: 'you', text: prompt };
      this.add(item);
      this.mark(item, 'prompt', `You: ${firstLine(prompt, 80)}`);
      return changed;
    }

    if (r.type === 'user' && r.message && Array.isArray(r.message.content)) {
      let changed: number | undefined;
      for (const b of r.message.content) {
        if (b?.type !== 'tool_result') continue;
        const item = this.byToolId.get(b.tool_use_id);
        if (!item) continue;
        item.result = textOf(b.content).slice(0, MAX_RESULT) || (typeof b.content === 'string' ? b.content.slice(0, MAX_RESULT) : '');
        item.error = !!b.is_error;
        const res = item.result ?? '';
        if (r.toolDenialKind || (item.error && DENIED.test(res))) {
          item.checkpoint = undefined;   // a refused publish or push didn't happen
          this.mark(item, 'denied', `Not allowed: ${firstLine(item.summary ?? item.tool ?? '', 60)}`);
        } else if (this.tests.has(item)) {
          const failed = item.error || /\b\d+ (failed|failing)\b|\bFAIL(ED)?\b|Tests?:\s+\d+ failed/.test(res);
          this.mark(item, failed ? 'testsFailed' : 'testsPassed', failed ? 'Tests failed' : 'Tests passed');
        } else if (item.error && !res.startsWith('<tool_use_error>')) {   // the harness's own hiccups aren't worth a stop
          if (item.checkpoint && ['commit', 'push', 'release'].includes(item.checkpoint.kind)) item.checkpoint = undefined;
          this.mark(item, 'error', firstLine(`Failed: ${item.tool === 'Bash' || item.tool === 'PowerShell' ? '' : item.tool + ' '}${item.summary ?? ''}`, 80));
        }
        const i = this.items.indexOf(item);
        if (i >= 0) changed = changed === undefined ? i : Math.min(changed, i);
      }
      return changed;
    }

    if (r.type === 'assistant' && r.message && Array.isArray(r.message.content)) {
      for (const b of r.message.content) {
        if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
          const item: Item = { uuid: `${uuid}:${this.items.length}`, at, role: 'claude', text: b.text };
          this.add(item);
          const m = b.text.match(/^\s*(?:[-*]\s*)?(?:\*\*)?Checkpoint:(?:\*\*)?\s*(.+)$/m);
          if (m) this.mark(item, 'marker', firstLine(m[1].replace(/\*\*/g, ''), 90));
          else this.lastReply = item;
        } else if (b?.type === 'tool_use') {
          const name = String(b.name ?? 'tool');
          const item: Item = { uuid: `${uuid}:${this.items.length}`, at, role: 'tool', tool: name, summary: toolSummary(name, b.input),
            input: typeof b.input === 'object' ? JSON.stringify(b.input, null, 2).slice(0, MAX_RESULT) : '' };
          this.add(item);
          if (b.id) this.byToolId.set(b.id, item);
          const cmd = commandOf(b.input), bare = unquoted(cmd), where = cmd ? publishedTo(cmd) : '';
          if (cmd && COMMIT.test(bare)) this.mark(item, 'commit', `Commit: ${commitMessage(cmd) || shortCommand(cmd, 60)}`);
          else if (where) this.mark(item, 'release', `Published to ${where}`);
          else if (cmd && PUSH.test(bare)) this.mark(item, 'push', 'Pushed');
          else if (cmd && TESTS.test(bare)) this.tests.add(item);
          else if (name === 'AskUserQuestion') this.mark(item, 'question', `Asked you: ${item.summary}`);
          else if (name === 'Agent' || name === 'Task') this.mark(item, 'agent', `Agent: ${item.summary}`);
        }
      }
      return undefined;
    }
    return undefined;
  }
}
