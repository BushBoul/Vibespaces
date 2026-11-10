// Builds helper/vibespaces-helper.exe from helper/*.cs with the C# compiler that ships with Windows (.NET Framework 4).
// A GUI-subsystem program (winexe), so it never flashes a console; its output still reaches the extension through pipes.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const out = path.join(root, 'helper', 'vibespaces-helper.exe');
if (process.platform !== 'win32') {
  console.log('build-helper: not Windows, skipped (the helper is Windows-only)');
  process.exit(0);
}
const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
if (!fs.existsSync(csc)) {
  console.error(`build-helper: no C# compiler at ${csc}`);
  process.exit(1);
}
const sources = ['Native.cs', 'Program.cs'].map((f) => path.join(root, 'helper', f));
execFileSync(csc, ['/nologo', '/target:winexe', '/platform:anycpu', '/optimize+', '/r:System.Drawing.dll', `/out:${out}`, ...sources],
  { stdio: 'inherit' });
console.log(`build-helper: ${path.relative(root, out)} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
