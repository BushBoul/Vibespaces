// Shared page shell for Vibespaces' webviews: the CSP, VS Code's icon font (codicons, bundled), and one set of styles
// drawn from the theme's own colours, so the pages look at home in any theme.
import * as crypto from 'crypto';
import * as vscode from 'vscode';

export function nonce(): string {
  return crypto.randomBytes(16).toString('base64');
}

// where the webview may load files from: the extension's media and the bundled icon font
export function webviewRoots(extensionUri: vscode.Uri): vscode.Uri[] {
  return [vscode.Uri.joinPath(extensionUri, 'media'), vscode.Uri.joinPath(extensionUri, 'node_modules', '@vscode', 'codicons', 'dist')];
}

export function page(webview: vscode.Webview, extensionUri: vscode.Uri, n: string, title: string, body: string, script: string, extraStyle = ''): string {
  const codicons = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css'));
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `font-src ${webview.cspSource}`,
    `style-src ${webview.cspSource} 'nonce-${n}'`,
    `script-src 'nonce-${n}'`,
  ].join('; ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="${codicons}">
<style nonce="${n}">${STYLE}${extraStyle}</style>
</head>
<body>
${body}
<script nonce="${n}">${script}</script>
</body>
</html>`;
}

const STYLE = `
:root {
  --gap: 12px;
  --radius: 6px;
  --card: var(--vscode-sideBar-background, var(--vscode-editorWidget-background));
  --line: var(--vscode-widget-border, rgba(128,128,128,.22));
  --muted: var(--vscode-descriptionForeground);
  --accent: var(--vscode-focusBorder);
}
* { box-sizing: border-box; }
body { margin: 0; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground);
  background: var(--vscode-editor-background); line-height: 1.45; }
.hidden { display: none !important; }
.codicon { vertical-align: middle; }
p { margin: 0; }
.desc, .hint { color: var(--muted); font-size: .92em; }
.hint { margin-top: 6px; }
.error { color: var(--vscode-errorForeground); }

/* controls */
input:not([type]), input[type=text], select {
  font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--line)); border-radius: 4px; padding: 5px 8px; min-width: 0; }
select { color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); border-color: var(--vscode-dropdown-border, var(--line)); }
input:focus, select:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
input.mono, .mono { font-family: var(--vscode-editor-font-family); }
button { font: inherit; display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 4px; cursor: pointer;
  border: 1px solid var(--vscode-button-border, transparent); color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
button:hover { background: var(--vscode-button-hoverBackground); }
button:disabled { opacity: .5; cursor: default; }
button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
button.ghost { background: transparent; color: var(--vscode-foreground); border-color: var(--line); }
button.ghost:hover { background: var(--vscode-toolbar-hoverBackground); }
button.danger { background: transparent; color: var(--vscode-errorForeground); border-color: var(--vscode-errorForeground); }
button.link { padding: 0 2px; border: 0; background: none; color: var(--vscode-textLink-foreground); }
button.link:hover { background: none; text-decoration: underline; }
button.icon { padding: 3px; border: 0; background: none; color: var(--muted); }
button.icon:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.row > input:not([type]) { flex: 1 1 160px; }

/* switch (a checkbox) */
.switch { display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 3px 0; }
.switch input { appearance: none; -webkit-appearance: none; flex: 0 0 32px; width: 32px; height: 18px; margin: 0; border-radius: 9px;
  background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--line)); position: relative; cursor: pointer; transition: background .15s; }
.switch input::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%;
  background: var(--muted); transition: transform .15s, background .15s; }
.switch input:checked { background: var(--vscode-button-background); border-color: var(--vscode-button-background); }
.switch input:checked::after { transform: translateX(14px); background: var(--vscode-button-foreground); }
.switch input:disabled { opacity: .45; cursor: default; }

/* segmented buttons */
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 5px; overflow: hidden; }
.seg button { border: 0; border-radius: 0; background: transparent; color: var(--vscode-foreground); padding: 4px 11px; }
.seg button + button { border-left: 1px solid var(--line); }
.seg button:hover { background: var(--vscode-toolbar-hoverBackground); }
.seg button.on { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }

/* tiles (screen spots, icon styles) */
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 8px; }
.tile { flex-direction: column; gap: 6px; padding: 10px 6px 8px; background: transparent; color: var(--vscode-foreground);
  border: 1px solid var(--line); border-radius: var(--radius); font-size: .88em; text-align: center; line-height: 1.25; }
.tile:hover { background: var(--vscode-toolbar-hoverBackground); }
.tile.on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; background: var(--vscode-list-activeSelectionBackground, transparent);
  color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground)); }
.tile svg { width: 56px; height: 36px; }
.tile img { width: 36px; height: 36px; }

/* cards */
.card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; margin-bottom: 16px; scroll-margin-top: 110px; }
.card-head { display: flex; gap: 12px; align-items: flex-start; padding: 14px 18px 12px; border-bottom: 1px solid var(--line); }
.card-head > .codicon { font-size: 20px; margin-top: 2px; color: var(--accent); }
.card-head h2 { margin: 0; font-size: 1.12em; font-weight: 600; }
.field { display: grid; grid-template-columns: minmax(150px, 210px) 1fr; gap: 6px 24px; padding: 14px 18px; }
.field + .field { border-top: 1px solid var(--line); }
.field-head label, .field-head .label { font-weight: 600; display: block; margin-bottom: 2px; }
.field-body { min-width: 0; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.field-body > .row, .field-body > input, .field-body > select, .field-body > .tiles, .field-body > .grid2 { width: 100%; }
@media (max-width: 720px) { .field { grid-template-columns: 1fr; } }

/* lists */
.list { list-style: none; margin: 0; padding: 0; width: 100%; }
.list li { display: flex; gap: 8px; align-items: center; padding: 4px 8px; border-radius: 4px; }
.list li:hover { background: var(--vscode-list-hoverBackground); }
.list .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.list .empty { color: var(--muted); font-style: italic; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: 10px; font-size: .85em;
  background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
`;
