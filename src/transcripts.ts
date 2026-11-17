// Claude Code's session transcripts, read for checkpoints: the moments worth going back to in a long session.
// Claude Code keeps each session in ~/.claude/projects/<the project's path, every symbol a "-">/<session id>.jsonl,
// one JSON record per line. Vibespaces only reads them. The format is Claude Code's own and isn't documented, so
// everything here reads it defensively: a record it doesn't understand is skipped, never an error.
//
// Long sessions run to a gigabyte or more, mostly tool results with pictures in them. So a session is read in steps
// (letting VS Code breathe between them), each line is looked at only as far as needed, and an item keeps just its
// label and where it is in the file; its full text is read from the file when the viewer shows it.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface Session { file: string; id: string; title: string; mtime: number }

export type Kind = 'prompt' | 'marker' | 'commit' | 'push' | 'release' | 'testsPassed' | 'testsFailed' | 'error' | 'question'
  | 'denied' | 'pause' | 'agent' | 'reply';

export interface Checkpoint { uuid: string; kind: Kind; label: string; at: number }

// one thing in the session, kept light
export interface Item {
  uuid: string;
  at: number;
  role: 'you' | 'claude' | 'tool';
  tool?: string;              // tool: its name and a one-line summary of what it was asked
  summary?: string;
  toolId?: string;
  error?: boolean;
  done?: boolean;             // tool: its result has come back
  checkpoint?: Checkpoint;
  pos: number; len: number;   // where its record is in the file
  part: number;               // which block of the record
  rpos?: number; rlen?: number;   // tool: where its result is
}

// the same, with its full text, for the viewer
export interface FullItem extends Item { text?: string; input?: string; result?: string }

const PAUSE_MS = 10 * 60 * 1000;
const MAX_TEXT = 6000;
const STEP = 4 * 1024 * 1024;   // read at a time; about 90 ms of work on a big session before VS Code gets a turn

export function projectsRoot(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

// the folder name Claude Code uses for a project: its path with every symbol as "-" (the drive letter's case varies)
const folderKey = (p: string) => p.replace(/[^A-Za-z0-9]/g, '-').toLowerCase();

// the project folders that hold these folders' sessions
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
  for (const s of top) s.title = sessionTitle(s.file);
  return top;
}

// The session's title, cheaply: Claude Code's own title near the end of the file, else the first thing you asked.
const titles = new Map<string, { mtime: number; title: string }>();
export function sessionTitle(file: string): string {
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch { return 'Session'; }
  const known = titles.get(file);
  if (known && known.mtime === st.mtimeMs) return known.title;
  let title = '';
  const tail = readSlice(file, Math.max(0, st.size - 512 * 1024), st.size).toString('utf8');
  const m = [...tail.matchAll(/"aiTitle":"((?:[^"\\]|\\.)*)"/g)].pop();
  // (Claude Code's title for a session that opened with a paste can be the paste's opening tag)
  if (m) { try { title = firstLine(ownWords(JSON.parse(`"${m[1]}"`)), 70); } catch { /* keep looking */ } }
  if (!title) {
    for (const line of readSlice(file, 0, Math.min(st.size, 512 * 1024)).toString('utf8').split('\n')) {
      const r = parseLine(line);
      const p = r && promptText(r);
      if (p) { title = firstLine(ownWords(p), 70); break; }
    }
  }
  title = title || `Session ${path.basename(file, '.jsonl').slice(0, 8)}`;
  titles.set(file, { mtime: st.mtimeMs, title });
  return title;
}

function readSlice(file: string, from: number, to: number): Buffer {
  if (to <= from) return Buffer.alloc(0);
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(to - from);
    const n = fs.readSync(fd, buf, 0, buf.length, from);
    return buf.subarray(0, n);
  } finally { fs.closeSync(fd); }
}

function parseLine(line: string): any {
  if (!line.trim()) return undefined;
  try { return JSON.parse(line); } catch { return undefined; }
}

// a message as a one-line label: your own words, without pasted blocks and other tagged context (just the pasted
// text, if that's all there is)
function ownWords(t: string): string {
  const tags = (s: string) => s.replace(/<\/?[a-z][\w-]*\b[^>]*>/g, '').trim();   // also a paste cut off before its end tag
  return tags(t.replace(/<([a-z][\w-]*)\b[^>]*>[\s\S]*?<\/\1>/g, '')) || tags(t);
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

// The records worth parsing. The bulky ones never needed here (copies of what was sent to the model, file snapshots,
// bookkeeping) start with their type, so a look at the first bytes skips them. Messages and tool calls can put their
// type after the whole message, so everything else is parsed.
const SKIP = /^\{"type":"(api-request|file-history|last-prompt|session-owner|atis-latch|ai-title|mode|frame-link|tools-used|cost-state|artifact|queue-operation|summary)/;
function wanted(buf: Buffer, start: number, end: number): boolean {
  return !SKIP.test(buf.toString('latin1', start, Math.min(end, start + 48)));
}

// ---- what a command was ----
// Matched with quoted text taken out, so a command that only searches for "git commit" or "vsce publish" doesn't count.
// (also without here-documents: a script being written out isn't being run)
const unquoted = (cmd: string) => cmd
  .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\b/g, '<<')
  .replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
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

const commandOf = (input: any): string => typeof input?.command === 'string' ? input.command : '';

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

// A session as read so far. update() reads only what was added to the file since the last time.
export class Transcript {
  items: Item[] = [];
  private offset = 0;
  private rest: Buffer = Buffer.alloc(0);
  private byToolId = new Map<string, Item>();
  private lastAt = 0;
  private lastReply: Item | undefined;   // Claude's latest text in this turn: the turn's reply once you write again
  private tests = new Set<Item>();
  private running: Promise<boolean> | undefined;
  changedFrom = 0;                        // the first item that changed since the last takeChanges()
  loaded = false;                         // read to the end at least once

  constructor(readonly file: string) {}

  // read what's new, in steps; true if anything changed. Calls while a read is going on share it.
  update(): Promise<boolean> {
    if (!this.running) this.running = this.read().finally(() => { this.running = undefined; });
    return this.running;
  }

  private async read(): Promise<boolean> {
    let changed = false;
    for (;;) {
      let size = 0;
      try { size = fs.statSync(this.file).size; } catch { return changed; }
      if (size < this.offset) { this.reset(); changed = true; }   // rewritten: start over
      if (size === this.offset) { this.loaded = true; return changed; }
      const to = Math.min(size, this.offset + STEP);
      const chunk = readSlice(this.file, this.offset, to);
      const buf = this.rest.length ? Buffer.concat([this.rest, chunk]) : chunk;
      const base = this.offset - this.rest.length;   // the file position of buf[0]
      this.offset += chunk.length;
      let start = 0;
      for (let nl = buf.indexOf(10, start); nl >= 0; nl = buf.indexOf(10, start)) {
        if (nl > start && wanted(buf, start, nl)) {
          const r = parseLine(buf.toString('utf8', start, nl));
          if (r && this.take(r, base + start, nl - start)) changed = true;
        }
        start = nl + 1;
      }
      this.rest = Buffer.from(buf.subarray(start));
      if (to < size) await new Promise((res) => setImmediate(res));   // a long file: let everything else run
    }
  }

  takeChanges(): number {
    const from = Math.min(this.changedFrom, this.items.length);
    this.changedFrom = this.items.length;
    return from;
  }

  checkpoints(): Checkpoint[] {
    return this.items.filter((i) => i.checkpoint).map((i) => i.checkpoint!);
  }

  indexOf(uuid: string): number {
    for (let i = this.items.length - 1; i >= 0; i--) if (this.items[i].uuid === uuid) return i;
    return -1;
  }

  // items from..to with their full text, read from the file
  full(from: number, to: number): FullItem[] {
    const out: FullItem[] = [];
    let fd: number | undefined;
    try {
      fd = fs.openSync(this.file, 'r');
      const line = (pos: number, len: number) => {
        const b = Buffer.alloc(len);
        fs.readSync(fd!, b, 0, len, pos);
        return parseLine(b.toString('utf8'));
      };
      for (const it of this.items.slice(from, to)) {
        const f: FullItem = { ...it };
        try {
          const r = line(it.pos, it.len);
          if (it.role === 'you') f.text = r ? promptText(r) : '';
          else if (it.role === 'claude') f.text = String(r?.message?.content?.[it.part]?.text ?? '');
          else {
            const b = r?.message?.content?.[it.part];
            f.input = b?.input && typeof b.input === 'object' ? JSON.stringify(b.input, null, 2).slice(0, MAX_TEXT) : '';
            if (it.rpos !== undefined && it.rlen) {
              const res = line(it.rpos, it.rlen);
              const rb = Array.isArray(res?.message?.content) ? res.message.content.find((x: any) => x?.tool_use_id === it.toolId) : undefined;
              const text = textOf(rb?.content);
              const pics = Array.isArray(rb?.content) ? rb.content.filter((x: any) => x?.type === 'image').length : 0;
              f.result = (text.slice(0, MAX_TEXT) + (text.length > MAX_TEXT ? '\n…' : '') + (pics ? `\n(${pics} picture${pics > 1 ? 's' : ''})` : '')).trim();
            }
          }
        } catch { /* shown without its text */ }
        out.push(f);
      }
    } catch { /* the file went away */ } finally { if (fd !== undefined) fs.closeSync(fd); }
    return out;
  }

  private reset() {
    this.items = []; this.offset = 0; this.rest = Buffer.alloc(0); this.byToolId.clear(); this.lastAt = 0; this.lastReply = undefined;
    this.tests.clear(); this.changedFrom = 0;
  }

  private add(item: Item) {
    if (this.lastAt && item.at - this.lastAt > PAUSE_MS && !item.checkpoint) {
      const min = Math.round((item.at - this.lastAt) / 60000);
      const long = min < 120 ? `${min} min` : min < 48 * 60 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} days`;
      item.checkpoint = { uuid: item.uuid, kind: 'pause', label: `Paused ${long}`, at: item.at };
    }
    if (item.at) this.lastAt = item.at;
    this.items.push(item);
  }

  private mark(item: Item, kind: Kind, label: string) {
    if (!item.checkpoint || item.checkpoint.kind === 'pause') item.checkpoint = { uuid: item.uuid, kind, label, at: item.at };
  }

  private touched(item: Item) {
    const i = this.indexOf(item.uuid);
    if (i >= 0) this.changedFrom = Math.min(this.changedFrom, i);
  }

  // one record at pos (len bytes long); true if it added or changed anything
  private take(r: any, pos: number, len: number): boolean {
    if (r.isSidechain) return false;
    const at = Date.parse(r.timestamp ?? r.attachment?.timestamp ?? '') || 0;
    const uuid = String(r.uuid ?? r.attachment?.source_uuid ?? `${pos}`);

    const prompt = promptText(r);
    if (prompt) {
      if (this.lastReply) {
        this.mark(this.lastReply, 'reply', `Reply: ${this.lastReply.summary ?? ''}`);
        this.touched(this.lastReply);
        this.lastReply = undefined;
      }
      const item: Item = { uuid, at, role: 'you', summary: firstLine(ownWords(prompt), 80), pos, len, part: 0 };
      this.add(item);
      this.mark(item, 'prompt', `You: ${item.summary}`);
      return true;
    }

    if (r.type === 'user' && r.message && Array.isArray(r.message.content)) {
      let changed = false;
      for (const b of r.message.content) {
        if (b?.type !== 'tool_result') continue;
        const item = this.byToolId.get(b.tool_use_id);
        if (!item) continue;
        this.byToolId.delete(b.tool_use_id);
        item.rpos = pos; item.rlen = len; item.done = true; item.error = !!b.is_error;
        const res = textOf(b.content);
        if (r.toolDenialKind || (item.error && DENIED.test(res))) {
          item.checkpoint = undefined;   // a refused publish or push didn't happen
          this.mark(item, 'denied', `Not allowed: ${firstLine(item.summary ?? item.tool ?? '', 60)}`);
        } else if (this.tests.has(item)) {
          this.tests.delete(item);
          const failed = item.error || /\b\d+ (failed|failing)\b|\bFAIL(ED)?\b|Tests?:\s+\d+ failed/.test(res);
          this.mark(item, failed ? 'testsFailed' : 'testsPassed', failed ? 'Tests failed' : 'Tests passed');
        } else if (item.error && !res.startsWith('<tool_use_error>') && !/^\s*Exit code \d+\s*$/.test(res)) {
          // (not the harness's own hiccups, nor a bare exit code with no output: a search that found nothing)
          if (item.checkpoint && ['commit', 'push', 'release'].includes(item.checkpoint.kind)) item.checkpoint = undefined;
          this.mark(item, 'error', firstLine(`Failed: ${item.tool === 'Bash' || item.tool === 'PowerShell' ? '' : item.tool + ' '}${item.summary ?? ''}`, 80));
        }
        this.touched(item);
        changed = true;
      }
      return changed;
    }

    if (r.type === 'assistant' && r.message && Array.isArray(r.message.content)) {
      let changed = false;
      r.message.content.forEach((b: any, part: number) => {
        if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
          const item: Item = { uuid: `${uuid}:${part}`, at, role: 'claude', summary: firstLine(b.text, 80), pos, len, part };
          this.add(item);
          const m = b.text.match(/^\s*(?:[-*]\s*)?(?:\*\*)?Checkpoint:(?:\*\*)?\s*(.+)$/m);
          if (m) this.mark(item, 'marker', firstLine(m[1].replace(/\*\*/g, ''), 90));
          else this.lastReply = item;
          changed = true;
        } else if (b?.type === 'tool_use') {
          const name = String(b.name ?? 'tool');
          const item: Item = { uuid: `${uuid}:${part}`, at, role: 'tool', tool: name, summary: toolSummary(name, b.input), toolId: b.id, pos, len, part };
          this.add(item);
          if (b.id) this.byToolId.set(b.id, item);
          const cmd = commandOf(b.input), bare = unquoted(cmd), where = cmd ? publishedTo(cmd) : '';
          if (cmd && COMMIT.test(bare)) { const msg = commitMessage(cmd); this.mark(item, 'commit', msg && !msg.startsWith('$') ? `Commit: ${msg}` : 'Commit'); }
          else if (where) this.mark(item, 'release', `Published to ${where}`);
          else if (cmd && PUSH.test(bare)) this.mark(item, 'push', 'Pushed');
          else if (cmd && TESTS.test(bare)) this.tests.add(item);
          else if (name === 'AskUserQuestion') this.mark(item, 'question', `Asked you: ${item.summary}`);
          else if (name === 'Agent' || name === 'Task') this.mark(item, 'agent', `Agent: ${item.summary}`);
          changed = true;
        }
      });
      return changed;
    }
    return false;
  }
}
