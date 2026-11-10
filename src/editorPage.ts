// The space editor's page: a header with the space, a search box, a menu of sections, and a card per section.
// Every change is sent to the extension, which writes the space file and sends the new state back.

export const EDITOR_STYLE = `
.hero { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 16px; padding: 14px 24px;
  background: var(--vscode-editor-background); border-bottom: 1px solid var(--line); }
.hero-icon { position: relative; width: 48px; height: 48px; flex: 0 0 48px; display: grid; place-items: center;
  border-radius: 10px; background: var(--card); border: 1px solid var(--line); }
.hero-icon img { width: 36px; height: 36px; }
.hero-swatch { position: absolute; right: -4px; bottom: -4px; width: 16px; height: 16px; border-radius: 5px; border: 2px solid var(--vscode-editor-background); }
.hero-text { flex: 1; min-width: 0; }
.hero-name { font-size: 1.5em; font-weight: 600; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hero-sub { display: flex; gap: 8px; align-items: center; color: var(--muted); font-size: .92em; margin-top: 2px; min-width: 0; }
.hero-sub span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hero-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.saved { color: var(--muted); font-size: .9em; opacity: 0; transition: opacity .3s; }
.saved.show { opacity: 1; }
.toolbar { position: sticky; top: 77px; z-index: 4; padding: 10px 24px; background: var(--vscode-editor-background); border-bottom: 1px solid var(--line); }
.search { display: flex; align-items: center; gap: 8px; max-width: 560px; padding: 0 8px; border-radius: 4px;
  background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--line)); }
.search:focus-within { outline: 1px solid var(--accent); outline-offset: -1px; }
.search input { flex: 1; border: 0; background: none; padding: 6px 0; outline: none !important; }
.layout { display: grid; grid-template-columns: 190px 1fr; gap: 24px; padding: 20px 24px 40px; max-width: 1100px; }
.toc { position: sticky; top: 140px; align-self: start; display: flex; flex-direction: column; gap: 2px; }
.toc a { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-radius: 4px; color: var(--vscode-foreground);
  text-decoration: none; cursor: pointer; border-left: 2px solid transparent; }
.toc a:hover { background: var(--vscode-list-hoverBackground); }
.toc a.on { background: var(--vscode-list-inactiveSelectionBackground); border-left-color: var(--accent); font-weight: 600; }
.toc a .codicon { color: var(--muted); }
.toc a.dim { opacity: .4; }
@media (max-width: 760px) {
  .layout { grid-template-columns: 1fr; padding-top: 8px; }
  .toc { flex-direction: row; overflow-x: auto; top: 128px; z-index: 3; background: var(--vscode-editor-background); padding: 6px 0; }
  .toc a { border-left: 0; border-bottom: 2px solid transparent; white-space: nowrap; }
  .toc a.on { border-bottom-color: var(--accent); }
  .hero { flex-wrap: wrap; }
}
.nomatch, .gone { padding: 16px; border: 1px dashed var(--line); border-radius: 8px; margin-bottom: 16px; color: var(--muted); }
.gone { border-color: var(--vscode-errorForeground); color: var(--vscode-errorForeground); }
.swatches { display: flex; flex-wrap: wrap; gap: 6px; }
.swatch { width: 28px; height: 28px; padding: 0; border-radius: 6px; border: 2px solid transparent; }
.swatch:hover { filter: brightness(1.15); }
.swatch.on { border-color: var(--vscode-foreground); box-shadow: 0 0 0 2px var(--vscode-editor-background) inset; }
input[type=color] { width: 40px; height: 30px; padding: 0; border: 1px solid var(--line); border-radius: 4px; background: none; cursor: pointer; }
input.hex, .row > input.hex { width: 96px; flex: 0 0 96px; }
.grid2 .seg { justify-self: start; }
.preview { width: 100%; max-width: 420px; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; font-size: .82em; background: var(--vscode-editor-background); }
.pv-title { display: flex; gap: 10px; align-items: center; padding: 4px 8px; background: var(--vscode-titleBar-activeBackground); color: var(--vscode-titleBar-activeForeground); }
.pv-title .dots { opacity: .5; letter-spacing: -2px; }
.pv-body { display: flex; height: 52px; }
.pv-bar { width: 26px; background: var(--vscode-activityBar-background); }
.pv-tab { display: inline-block; padding: 3px 12px; border-top: 2px solid transparent; background: var(--vscode-tab-activeBackground); }
.pv-status { padding: 2px 8px; background: var(--vscode-statusBar-background); color: var(--vscode-statusBar-foreground); }
.presetbox { width: 100%; padding: 12px; border-radius: 6px; background: var(--vscode-textBlockQuote-background, rgba(128,128,128,.08)); display: flex; flex-direction: column; gap: 8px; }
.presetbox .row select { flex: 1 1 200px; }
details.pgroup { width: 100%; border: 1px solid var(--line); border-radius: 6px; }
details.pgroup + details.pgroup { margin-top: 6px; }
details.pgroup summary { cursor: pointer; padding: 6px 10px; display: flex; align-items: center; gap: 8px; list-style: none; }
details.pgroup summary::-webkit-details-marker { display: none; }
details.pgroup summary .codicon { transition: transform .15s; }
details.pgroup[open] summary .codicon { transform: rotate(90deg); }
details.pgroup summary .count { margin-left: auto; }
details.pgroup .items { padding: 2px 12px 8px 30px; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0 16px; }
.term { width: 100%; display: grid; grid-template-columns: 130px 1fr auto; gap: 8px; }
.grid2 { display: grid; grid-template-columns: max-content 1fr; gap: 8px 14px; align-items: center; }
.path { word-break: break-all; }
.full { width: 100%; }
.tile .codicon.big { font-size: 28px; line-height: 36px; height: 36px; }
`;

export const EDITOR_BODY = `
<header class="hero">
  <div class="hero-icon"><img id="heroIcon" alt=""><span class="hero-swatch" id="heroSwatch"></span></div>
  <div class="hero-text">
    <div class="hero-name" id="heroName"></div>
    <div class="hero-sub"><span id="heroFolders"></span><span class="chip hidden" id="heroHere">This window</span></div>
  </div>
  <div class="hero-actions">
    <span class="saved" id="saved"><i class="codicon codicon-check"></i> Saved</span>
    <button id="open"><i class="codicon codicon-window"></i> Open</button>
    <button class="secondary" id="reset" title="Ctrl+Alt+Home"><i class="codicon codicon-home"></i> Reset layout</button>
  </div>
</header>
<div class="toolbar">
  <div class="search"><i class="codicon codicon-search"></i><input id="search" placeholder="Find an option: colour, terminal, window, Claude…" spellcheck="false">
    <button class="icon hidden" id="searchClear" title="Clear"><i class="codicon codicon-close"></i></button></div>
</div>
<div class="layout">
  <nav class="toc" id="toc"></nav>
  <main>
    <p class="gone hidden" id="gone"><i class="codicon codicon-warning"></i> This space's file is gone (deleted or moved).</p>
    <p class="nomatch hidden" id="nomatch">No options match "<span id="nomatchText"></span>".</p>

    <section class="card" id="sec-look" data-title="Look" data-icon="paintcan">
      <div class="card-head"><i class="codicon codicon-paintcan"></i><div><h2>Look</h2><p class="desc">The name and colour of this space's window.</p></div></div>
      <div class="field" data-k="name rename title">
        <div class="field-head"><label for="name">Name</label><p class="desc">Shown in the title bar, on the taskbar and in the list.</p></div>
        <div class="field-body">
          <div class="row"><input id="name" spellcheck="false"><button class="secondary" id="rename">Rename</button></div>
          <p class="hint error" id="nameError"></p>
        </div>
      </div>
      <div class="field" data-k="colour color swatch hex picker preview">
        <div class="field-head"><span class="label">Colour</span><p class="desc">Pick one, or any colour with the picker.</p></div>
        <div class="field-body">
          <div class="swatches" id="swatches"></div>
          <div class="row"><input type="color" id="picker" title="Any colour"><input id="hex" class="hex mono" spellcheck="false" maxlength="7"></div>
          <div class="preview">
            <div class="pv-title" id="pvTitle"><span class="dots">● ● ●</span><span id="pvName"></span></div>
            <div class="pv-body"><div class="pv-bar" id="pvActivity"></div><div><div class="pv-tab" id="pvTab">app.js</div></div></div>
            <div class="pv-status" id="pvStatus">main · Ln 12, Col 4</div>
          </div>
          <p class="hint">Which parts get the colour, and how strongly: <button class="link" id="openSettings">Vibespaces settings</button>.</p>
        </div>
      </div>
      <div class="field" data-k="theme dark light colour color">
        <div class="field-head"><label for="theme">Colour theme</label><p class="desc">A theme just for this space, so it looks different all over.</p></div>
        <div class="field-body"><select id="theme"></select></div>
      </div>
    </section>

    <section class="card" id="sec-folders" data-title="Folders" data-icon="folder">
      <div class="card-head"><i class="codicon codicon-folder"></i><div><h2>Folders</h2><p class="desc">The project folders this space opens. Your files are never moved or deleted.</p></div></div>
      <div class="field" data-k="folders folder project add remove">
        <div class="field-head"><span class="label">Folders</span><p class="desc">The first one is where terminals start.</p></div>
        <div class="field-body"><ul class="list" id="folders"></ul><button class="ghost" id="addFolder"><i class="codicon codicon-add"></i> Add a folder…</button></div>
      </div>
    </section>

    <section class="card" id="sec-taskbar" data-title="Taskbar" data-icon="pinned">
      <div class="card-head"><i class="codicon codicon-pinned"></i><div><h2>Taskbar</h2><p class="desc">This space's own button on the Windows taskbar.</p></div></div>
      <div class="field" data-k="icon logo initials picture image taskbar">
        <div class="field-head"><span class="label">Icon</span><p class="desc">What its taskbar button shows.</p></div>
        <div class="field-body">
          <div class="tiles" id="iconTiles"></div>
          <p class="hint" id="imagePath"></p>
        </div>
      </div>
      <div class="field" data-k="pin taskbar">
        <div class="field-head"><span class="label">Pin it</span></div>
        <div class="field-body"><p>Right-click the space's button on the taskbar and choose <b>Pin to taskbar</b>. The pin then opens this space.</p></div>
      </div>
    </section>

    <section class="card" id="sec-opens" data-title="When it opens" data-icon="rocket">
      <div class="card-head"><i class="codicon codicon-rocket"></i><div><h2>When it opens</h2><p class="desc">What Vibespaces sets up each time this space opens in a window, in this order.</p></div></div>
      <div class="field" data-k="preset template vibe coder classic clean slate save">
        <div class="field-head"><span class="label">Preset</span><p class="desc">Panels, window arrangement and tab tidying in one go.</p></div>
        <div class="field-body"><div class="presetbox">
          <div class="row"><select id="presetPick"></select><button class="secondary" id="presetApply">Apply</button></div>
          <p class="hint" id="presetHint"></p>
          <p class="hint">Keeps this space's files, terminals, web page and window position.
            <button class="link" id="presetSave">Save this setup as a preset…</button><span id="presetDeleteWrap"> · <button class="link" id="presetDelete">Delete a preset…</button></span></p>
        </div></div>
      </div>
      <div class="field" data-k="files open readme">
        <div class="field-head"><span class="label">Open these files</span><p class="desc">The files you always start with.</p></div>
        <div class="field-body"><ul class="list" id="files"></ul><button class="ghost" id="addFile"><i class="codicon codicon-add"></i> Add a file…</button></div>
      </div>
      <div class="field" data-k="panels assistants ai claude codex gemini copilot antigravity grok explorer search source control side bar">
        <div class="field-head"><span class="label">Show these panels</span><p class="desc">VS Code's own, then AI assistants, then those your extensions add. New ones appear here once installed.</p></div>
        <div class="field-body"><div class="chips" id="chosen"></div><div id="panels" class="full"></div></div>
      </div>
      <div class="field" data-k="terminal terminals command npm run dev server start">
        <div class="field-head"><span class="label">Run in terminals</span><p class="desc">Each in its own terminal, in the first folder. Once per window, not again on reload.</p></div>
        <div class="field-body"><div id="terminals" class="full"></div><button class="ghost" id="addTerminal"><i class="codicon codicon-terminal"></i> Add a terminal</button></div>
      </div>
      <div class="field" data-k="web page url browser localhost site">
        <div class="field-head"><label for="url">Open a web page</label><p class="desc">For example your site's preview.</p></div>
        <div class="field-body"><div class="row"><input id="url" class="mono" spellcheck="false" placeholder="localhost:3000">
          <div class="seg" id="urlIn"><button data-v="browser">In my browser</button><button data-v="editor">Inside VS Code</button></div></div></div>
      </div>
      <div class="field" data-k="try test run now">
        <div class="field-head"><span class="label">Try it</span></div>
        <div class="field-body"><div class="row"><button class="secondary" id="runNow"><i class="codicon codicon-play"></i> Run these steps now</button><span class="hint" id="runHint"></span></div></div>
      </div>
    </section>

    <section class="card" id="sec-window" data-title="Window" data-icon="window">
      <div class="card-head"><i class="codicon codicon-window"></i><div><h2>Window</h2><p class="desc">How the window is arranged. <b>Ctrl+Alt+Home</b> (Reset layout) puts all of this back.</p></div></div>
      <div class="field" data-k="layout left right bottom side bar panel hide show fill arrange">
        <div class="field-head"><span class="label">Side bars and panel</span><p class="desc">"Fill the window" makes the right side bar take the whole window.</p></div>
        <div class="field-body"><div class="grid2">
          <span>Left side bar</span><div class="seg" data-lay="left"><button data-v="">Leave</button><button data-v="show">Show</button><button data-v="hide">Hide</button></div>
          <span>Right side bar</span><div class="seg" data-lay="right"><button data-v="">Leave</button><button data-v="show">Show</button><button data-v="maximize">Fill the window</button><button data-v="hide">Hide</button></div>
          <span>Bottom panel</span><div class="seg" data-lay="bottom"><button data-v="">Leave</button><button data-v="show">Show</button><button data-v="hide">Hide</button></div>
        </div></div>
      </div>
      <div class="field" id="spotField" data-k="window position spot screen column left right half centre center maximize full size where">
        <div class="field-head"><span class="label">Where it sits</span><p class="desc" id="winHint"></p></div>
        <div class="field-body">
          <div class="tiles" id="spots"></div>
          <div class="row"><button class="ghost" id="winSave"><i class="codicon codicon-screen-normal"></i> Use where this window is now</button><span class="hint mono" id="winPos"></span></div>
          <label class="switch"><input type="checkbox" id="winAtOpen"> Also move it there when the space opens</label>
        </div>
      </div>
      <div class="field" data-k="reset tabs close tidy shortcut ctrl alt home">
        <div class="field-head"><span class="label">Open tabs on reset</span><p class="desc">Always kept: this space's files and assistant tabs, pinned tabs, and anything unsaved.</p></div>
        <div class="field-body"><div class="seg" id="resetTabs"><button data-v="keep">Leave them open</button><button data-v="close">Close the extras</button></div></div>
      </div>
    </section>

    <section class="card" id="sec-file" data-title="Space file" data-icon="file-code">
      <div class="card-head"><i class="codicon codicon-file-code"></i><div><h2>Space file</h2><p class="desc">Everything above is kept in one small file.</p></div></div>
      <div class="field" data-k="file json text path delete">
        <div class="field-head"><span class="label">File</span></div>
        <div class="field-body"><p class="mono path" id="file"></p>
          <div class="row"><button class="ghost" id="json"><i class="codicon codicon-json"></i> Edit as text</button>
            <button class="danger" id="delete"><i class="codicon codicon-trash"></i> Delete space…</button></div>
          <p class="hint">Deleting sends only this file to the Recycle Bin, never your project.</p></div>
      </div>
    </section>
  </main>
</div>`;

export const EDITOR_SCRIPT = `
const vs = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
const send = (type, extra) => vs.postMessage(Object.assign({ type }, extra || {}));
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const typing = (el) => el && document.activeElement === el;
let st = null, draft = null;
const copy = (o) => JSON.parse(JSON.stringify(o));
const saveDraft = () => send('onOpen', { onOpen: draft });

// ---- the menu of sections, and which one is in view ----
const sections = Array.from(document.querySelectorAll('section.card'));
function buildToc() {
  $('toc').innerHTML = sections.filter((s) => !s.classList.contains('hidden')).map((s) =>
    '<a data-to="' + s.id + '"><i class="codicon codicon-' + s.dataset.icon + '"></i>' + s.dataset.title + '</a>').join('');
  markToc();
}
$('toc').onclick = (e) => { const a = e.target.closest('a'); if (a) $(a.dataset.to).scrollIntoView({ behavior: 'smooth', block: 'start' }); };
// the section whose top is nearest below the sticky header, or the last one at the bottom of the page
function markToc() {
  const shown = sections.filter((s) => !s.classList.contains('hidden') && s.offsetParent);
  let cur = shown[0];
  for (const s of shown) if (s.getBoundingClientRect().top < 170) cur = s;
  const scrolls = document.body.scrollHeight > window.innerHeight + 8;
  if (scrolls && window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) cur = shown[shown.length - 1];
  document.querySelectorAll('.toc a').forEach((a) => {
    a.classList.toggle('on', !!cur && a.dataset.to === cur.id);
    a.classList.toggle('dim', $(a.dataset.to).classList.contains('nohit'));
  });
}
window.addEventListener('scroll', markToc, { passive: true });

// ---- search: hide the options that don't match ----
function filter() {
  const q = $('search').value.trim().toLowerCase();
  $('searchClear').classList.toggle('hidden', !q);
  let any = false;
  for (const s of sections) {
    if (s.classList.contains('hidden')) continue;
    let hits = 0;
    s.querySelectorAll('.field').forEach((f) => {
      const hit = !q || (f.dataset.k + ' ' + f.textContent + ' ' + s.dataset.title).toLowerCase().includes(q);
      f.classList.toggle('hidden', !hit || f.classList.contains('off'));
      if (hit && !f.classList.contains('off')) hits++;
    });
    s.classList.toggle('nohit', !!q && !hits);
    s.style.display = q && !hits ? 'none' : '';
    if (hits) any = true;
  }
  $('nomatch').classList.toggle('hidden', !q || any);
  $('nomatchText').textContent = q;
  markToc();
}
$('search').oninput = filter;
$('searchClear').onclick = () => { $('search').value = ''; filter(); $('search').focus(); };
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('search').focus(); $('search').select(); }
  if (e.key === 'Escape' && document.activeElement === $('search') && $('search').value) { $('search').value = ''; filter(); }
});

// ---- pictures for the screen spots ----
const SPOT = { 'left-quarter': [0, .25], 'second-quarter': [.25, .5], 'third-quarter': [.5, .75], 'right-quarter': [.75, 1],
  'left-third': [0, 1 / 3], 'middle-third': [1 / 3, 2 / 3], 'right-third': [2 / 3, 1],
  'left-half': [0, .5], center: [.2, .8], 'right-half': [.5, 1], maximized: [0, 1] };
function spotSvg(id) {
  const frame = '<rect x="1" y="1" width="54" height="30" rx="3" fill="none" stroke="currentColor" stroke-opacity=".55"/>'
    + '<rect x="1" y="31" width="54" height="4" rx="1" fill="currentColor" fill-opacity=".25"/>';
  let inner = '';
  if (SPOT[id]) { const [a, b] = SPOT[id]; inner = '<rect x="' + (3 + a * 50) + '" y="3" width="' + ((b - a) * 50) + '" height="26" rx="2" fill="currentColor" fill-opacity=".6"/>'; }
  else if (id === 'custom') inner = '<rect x="9" y="6" width="22" height="20" rx="2" fill="currentColor" fill-opacity=".6"/>';
  else inner = '<path d="M22 12 l12 10 M34 12 l-12 10" stroke="currentColor" stroke-opacity=".45" stroke-width="1.5"/>';
  return '<svg viewBox="0 0 56 36" aria-hidden="true">' + frame + inner + '</svg>';
}
const SPOT_LABEL = { '': 'Not set', 'left-quarter': 'Quarter 1', 'second-quarter': 'Quarter 2', 'third-quarter': 'Quarter 3',
  'right-quarter': 'Quarter 4', 'left-third': 'Left third', 'middle-third': 'Middle third', 'right-third': 'Right third',
  'left-half': 'Left half', center: 'Centre', 'right-half': 'Right half', maximized: 'Full screen', custom: 'Where I saved it' };

// ---- segmented buttons ----
function setSeg(el, v) { el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); }

// ---- paint the page from the state ----
function paintPreview(k) {
  const set = (el, bg, fg) => { el.style.background = bg || ''; el.style.color = fg || ''; };
  set($('pvTitle'), k['titleBar.activeBackground'], k['titleBar.activeForeground']);
  set($('pvStatus'), k['statusBar.background'], k['statusBar.foreground']);
  set($('pvActivity'), k['activityBar.background'], '');
  $('pvTab').style.borderTopColor = k['tab.activeBorderTop'] || 'transparent';
  $('pvTitle').parentElement.style.outline = k['window.activeBorder'] ? '1px solid ' + k['window.activeBorder'] : '';
}

function render() {
  const s = st.space, o = draft;
  // header
  $('heroName').textContent = s.name;
  $('heroFolders').textContent = s.folders.map((f) => f.split(/[\\\\/]/).pop()).join(', ');
  $('heroSwatch').style.background = s.color || 'transparent';
  $('heroHere').classList.toggle('hidden', !st.isCurrent);
  $('open').classList.toggle('hidden', st.isCurrent);
  $('reset').disabled = !st.isCurrent;
  $('reset').title = st.isCurrent ? 'Put the panels, layout and window back (Ctrl+Alt+Home)' : 'Open this space to reset it';

  // look
  if (!typing($('name'))) $('name').value = s.name;
  $('pvName').textContent = s.name + ' - app.js';
  $('swatches').replaceChildren(...st.presets.map((p) => {
    const b = document.createElement('button');
    b.className = 'swatch' + (p.color === s.color ? ' on' : '');
    b.dataset.c = p.color; b.title = p.label + ' ' + p.color; b.style.background = p.color;   // .style: the CSP blocks style="" in markup
    return b;
  }));
  $('picker').value = s.color || '#1f3a5f';
  if (!typing($('hex'))) $('hex').value = s.color;
  paintPreview(st.keys || {});
  $('theme').innerHTML = '<option value="">Same as my other windows</option>' + st.themes.map((t) => '<option value="' + esc(t) + '">' + esc(t) + '</option>').join('');
  $('theme').value = s.theme;

  // folders
  $('folders').innerHTML = s.folders.map((f) => '<li><i class="codicon codicon-folder"></i><span class="grow mono" title="' + esc(f) + '">' + esc(f)
    + '</span><button class="icon" data-f="' + esc(f) + '" title="Remove from this space"><i class="codicon codicon-close"></i></button></li>').join('');

  // taskbar
  $('sec-taskbar').classList.toggle('hidden', !st.windows);
  const styles = [['', 'Default'], ['window', 'Window'], ['initials', 'Initials'], ['image', 'My picture'], ['vscode', 'VS Code logo (opt-in)']];
  $('iconTiles').innerHTML = styles.map(([v, label]) => '<button class="tile' + (v === s.iconStyle ? ' on' : '') + '" data-style="' + v + '">'
    + (v === (s.iconStyle) && st.iconUri ? '<img src="' + st.iconUri + '" alt="">' : '<i class="codicon codicon-' + ({ '': 'settings', window: 'window', vscode: 'vscode', initials: 'symbol-text', image: 'file-media' })[v] + ' big"></i>')
    + '<span>' + label + (v === '' ? '<br><span class="desc">(' + ({ window: 'window', vscode: 'logo', initials: 'initials', image: 'picture' })[st.defaultIconStyle] + ')</span>' : '') + '</span></button>').join('');
  $('imagePath').textContent = s.iconStyle === 'vscode'
    ? 'Opt-in: this recolours the icon of your own VS Code. Its brand rules do not allow modified logos, so keep it for your own use, not in screenshots you share.'
    : s.iconImage ? 'Picture: ' + s.iconImage : '';

  // when it opens
  const keep = $('presetPick').value;
  const pgroups = [];
  for (const p of st.spacePresets) { let g = pgroups.find((x) => x.name === p.group); if (!g) pgroups.push(g = { name: p.group, items: [] }); g.items.push(p); }
  $('presetPick').innerHTML = '<option value="">Choose a preset…</option>' + pgroups.map((g) => '<optgroup label="' + esc(g.name) + '">'
    + g.items.map((p) => '<option value="' + esc(p.name) + '">' + esc(p.name) + (p.missing ? ' (not installed)' : '') + '</option>').join('') + '</optgroup>').join('');
  $('presetPick').value = st.spacePresets.some((p) => p.name === keep) ? keep : '';
  presetHint();
  $('presetDeleteWrap').classList.toggle('hidden', !st.spacePresets.some((p) => !p.builtIn));
  $('files').innerHTML = o.files.map((f) => '<li><i class="codicon codicon-file"></i><span class="grow mono" title="' + esc(f) + '">' + esc(f)
    + '</span><button class="icon" data-file="' + esc(f) + '" title="Don\\'t open this"><i class="codicon codicon-close"></i></button></li>').join('')
    || '<li class="empty">None</li>';
  const label = (id) => (st.panels.find((p) => p.id === id) || { label: id }).label;
  $('chosen').innerHTML = o.panels.length ? o.panels.map((id) => '<span class="chip">' + esc(label(id)) + '</span>').join('') : '<span class="desc">None chosen</span>';
  const groups = [];
  for (const p of st.panels) { let g = groups.find((x) => x.name === p.group); if (!g) groups.push(g = { name: p.group, items: [] }); g.items.push(p); }
  const wasOpen = new Set(Array.from(document.querySelectorAll('details.pgroup[open]')).map((d) => d.dataset.g));
  $('panels').innerHTML = groups.map((g, i) => {
    const n = g.items.filter((p) => o.panels.includes(p.id)).length;
    const open = wasOpen.size ? wasOpen.has(g.name) : (i < 2 || n > 0);
    return '<details class="pgroup" data-g="' + esc(g.name) + '"' + (open ? ' open' : '') + '><summary><i class="codicon codicon-chevron-right"></i>' + esc(g.name)
      + '<span class="count desc">' + (n ? n + ' chosen' : g.items.length + '') + '</span></summary><div class="items">'
      + g.items.map((p) => '<label class="switch"><input type="checkbox" data-p="' + esc(p.id) + '"' + (o.panels.includes(p.id) ? ' checked' : '') + '> ' + esc(p.label) + '</label>').join('')
      + '</div></details>';
  }).join('');
  if (!$('terminals').contains(document.activeElement)) {
    $('terminals').innerHTML = o.terminals.map((t, i) => '<div class="term" data-i="' + i + '"><input class="tname" placeholder="Name" value="' + esc(t.name)
      + '"><input class="tcmd mono" placeholder="npm run dev" spellcheck="false" value="' + esc(t.command)
      + '"><button class="icon" data-rm="' + i + '" title="Remove"><i class="codicon codicon-close"></i></button></div>').join('');
  }
  if (!typing($('url'))) $('url').value = o.url;
  setSeg($('urlIn'), o.urlIn);
  $('runNow').disabled = !st.isCurrent;
  $('runHint').textContent = st.isCurrent ? 'Runs them in this window.' : 'Open this space to try them.';

  // window
  document.querySelectorAll('[data-lay]').forEach((el) => setSeg(el, o.layout[el.dataset.lay]));
  $('spotField').classList.toggle('off', !st.windows);
  const w = o.window, cur = !w ? '' : w.preset || 'custom';
  const ids = ['', 'left-quarter', 'second-quarter', 'third-quarter', 'right-quarter', 'left-third', 'middle-third', 'right-third',
    'left-half', 'center', 'right-half', 'maximized'].concat(cur === 'custom' ? ['custom'] : []);
  $('spots').innerHTML = ids.map((id) => '<button class="tile' + (id === cur ? ' on' : '') + '" data-spot="' + id + '">' + spotSvg(id) + '<span>' + SPOT_LABEL[id] + '</span></button>').join('');
  $('winPos').textContent = cur === 'custom' ? (w.maximized ? 'saved: maximized' : 'saved: ' + w.width + ' × ' + w.height + ' at ' + w.x + ', ' + w.y) : '';
  $('winSave').disabled = !st.isCurrent;
  $('winAtOpen').checked = !!(w && w.atOpen);
  $('winAtOpen').disabled = !w;
  $('winHint').textContent = st.isCurrent ? 'Click a spot and the window moves there now, on whichever screen it\\'s on.' : 'Open this space to try a spot.';
  setSeg($('resetTabs'), o.resetTabs);

  // file
  $('file').textContent = s.file;
  buildToc();
  filter();
}

function presetHint() {
  const p = st.spacePresets.find((x) => x.name === $('presetPick').value);
  $('presetHint').textContent = p ? p.summary + (p.missing ? ' Needs ' + p.missing + ', which isn\\'t installed yet.' : '') : '';
  $('presetApply').disabled = !p;
}

let savedTimer = 0;
window.addEventListener('message', (e) => {
  const m = e.data;
  if (m.type === 'state') {
    const icon = st && st.iconUri;   // the icon comes in its own message; keep showing the last one meanwhile
    st = m; st.iconUri = icon; draft = copy(m.space.onOpen);
    $('gone').classList.add('hidden'); $('nameError').textContent = '';
    document.querySelectorAll('section.card').forEach((s) => s.classList.remove('gone-hide'));
    render();
  } else if (m.type === 'icon') {
    st.iconUri = m.uri; $('heroIcon').src = m.uri;
    const t = document.querySelector('#iconTiles .tile.on');
    if (t && !t.querySelector('img')) render();
  } else if (m.type === 'saved') {
    $('saved').classList.add('show'); clearTimeout(savedTimer); savedTimer = setTimeout(() => $('saved').classList.remove('show'), 1600);
  } else if (m.type === 'nameError') {
    $('nameError').textContent = m.message;
  } else if (m.type === 'gone') {
    $('gone').classList.remove('hidden');
    sections.forEach((s) => s.classList.add('hidden'));
  }
});

// ---- controls ----
$('open').onclick = () => send('open');
$('reset').onclick = () => send('reset');
$('rename').onclick = () => send('rename', { name: $('name').value });
$('name').onkeydown = (e) => { if (e.key === 'Enter') send('rename', { name: $('name').value }); };
$('swatches').onclick = (e) => { const c = e.target.dataset && e.target.dataset.c; if (c) send('color', { color: c }); };
$('picker').oninput = () => { $('hex').value = $('picker').value; $('pvTitle').style.background = $('picker').value; $('heroSwatch').style.background = $('picker').value; };
$('picker').onchange = () => send('color', { color: $('picker').value });
$('hex').onkeydown = (e) => { if (e.key === 'Enter') $('hex').blur(); };
$('hex').onchange = () => { let v = $('hex').value.trim(); if (!v.startsWith('#')) v = '#' + v; if (/^#[0-9a-f]{6}$/i.test(v)) send('color', { color: v }); else render(); };
$('openSettings').onclick = () => send('settings');
$('theme').onchange = () => send('theme', { theme: $('theme').value });
$('folders').onclick = (e) => { const b = e.target.closest('button'); if (b && b.dataset.f) send('removeFolder', { folder: b.dataset.f }); };
$('addFolder').onclick = () => send('addFolder');
$('iconTiles').onclick = (e) => { const b = e.target.closest('.tile'); if (b) send(b.dataset.style === 'image' && st.space.iconStyle === 'image' ? 'pickImage' : 'iconStyle', { style: b.dataset.style }); };
$('presetPick').onchange = presetHint;
$('presetApply').onclick = () => send('applyPreset', { name: $('presetPick').value });
$('presetSave').onclick = () => send('savePreset');
$('presetDelete').onclick = () => send('deletePreset');
$('files').onclick = (e) => { const b = e.target.closest('button'); if (b && b.dataset.file) { draft.files = draft.files.filter((x) => x !== b.dataset.file); saveDraft(); } };
$('addFile').onclick = () => send('addFile');
$('panels').onchange = (e) => {
  const id = e.target.dataset && e.target.dataset.p; if (!id) return;
  draft.panels = e.target.checked ? draft.panels.concat([id]) : draft.panels.filter((x) => x !== id);
  saveDraft();
};
const readTerminals = () => Array.from(document.querySelectorAll('#terminals .term')).map((r) => ({ name: r.querySelector('.tname').value, command: r.querySelector('.tcmd').value }));
$('terminals').onchange = () => { draft.terminals = readTerminals(); saveDraft(); };
$('terminals').onclick = (e) => {
  const b = e.target.closest('button'); if (!b || b.dataset.rm === undefined) return;
  const t = readTerminals(); t.splice(Number(b.dataset.rm), 1); draft.terminals = t; $('terminals').innerHTML = ''; saveDraft();
};
$('addTerminal').onclick = () => {
  const i = readTerminals().length;
  const row = document.createElement('div'); row.className = 'term';
  row.innerHTML = '<input class="tname" placeholder="Name"><input class="tcmd mono" placeholder="npm run dev" spellcheck="false"><button class="icon" data-rm="' + i + '" title="Remove"><i class="codicon codicon-close"></i></button>';
  $('terminals').appendChild(row); row.querySelector('.tcmd').focus();
};
$('url').onchange = () => { draft.url = $('url').value; saveDraft(); };
$('urlIn').onclick = (e) => { const b = e.target.closest('button'); if (b) { draft.urlIn = b.dataset.v; setSeg($('urlIn'), b.dataset.v); saveDraft(); } };
$('runNow').onclick = () => send('runNow');
document.querySelectorAll('[data-lay]').forEach((el) => { el.onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  draft.layout[el.dataset.lay] = b.dataset.v; setSeg(el, b.dataset.v); saveDraft();
}; });
$('spots').onclick = (e) => { const b = e.target.closest('.tile'); if (b && b.dataset.spot !== 'custom') send('winPreset', { value: b.dataset.spot }); };
$('winSave').onclick = () => send('winSave');
$('winAtOpen').onchange = () => send('winAtOpen', { on: $('winAtOpen').checked });
$('resetTabs').onclick = (e) => { const b = e.target.closest('button'); if (b) { draft.resetTabs = b.dataset.v; setSeg($('resetTabs'), b.dataset.v); saveDraft(); } };
$('json').onclick = () => send('json');
$('delete').onclick = () => send('delete');
send('ready');
`;
