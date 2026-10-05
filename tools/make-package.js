// 配布用の zip を作る。
//
//   node tools/make-package.js
//
// dist/AutoShiftGenerator-<版>/ に次を置き、同じ名前の .zip にまとめる（dist/ は git に入れない）。
//   ShiftGenerator.html … prototype/ShiftGrid.html の写し
//   install-local.ps1   … tools/install-local.ps1 の写し（UTF-8 BOM・CRLF のまま）
//   README.md           … tools/package/README.md の {{VERSION}} を版に置き換えたもの
//
// 版は ShiftGrid.html の APP_VERSION から読む（ここに版を書かない）。
// zip は PowerShell の Compress-Archive で作る（日本語を含む中身でも UTF-8 で入る）。
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PATHS = Object.freeze({
  HTML: path.join(ROOT, 'prototype', 'ShiftGrid.html'),
  INSTALL: path.join(ROOT, 'tools', 'install-local.ps1'),
  README: path.join(ROOT, 'tools', 'package', 'README.md'),
  DIST: path.join(ROOT, 'dist')
});
const NAME_PREFIX = 'AutoShiftGenerator-';
const OUT_HTML = 'ShiftGenerator.html';     // install-local.ps1 が隣に探す名前

function log(level, msg) {
  const line = new Date().toISOString() + ' [' + level + '] make-package: ' + msg;
  if (level === 'ERROR') console.error(line); else console.log(line);
}

function main() {
  const html = fs.readFileSync(PATHS.HTML, 'utf8');
  const m = /const APP_VERSION = '([\d.]+)';/.exec(html);
  if (!m) throw new Error('APP_VERSION が見つかりません: ' + PATHS.HTML);
  const ver = m[1];
  const name = NAME_PREFIX + ver;
  const dir = path.join(PATHS.DIST, name);
  const zip = path.join(PATHS.DIST, name + '.zip');

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(zip, { force: true });
  fs.mkdirSync(dir, { recursive: true });

  fs.copyFileSync(PATHS.HTML, path.join(dir, OUT_HTML));
  fs.copyFileSync(PATHS.INSTALL, path.join(dir, 'install-local.ps1'));
  const readme = fs.readFileSync(PATHS.README, 'utf8').split('{{VERSION}}').join(ver);
  fs.writeFileSync(path.join(dir, 'README.md'), readme);

  execFileSync('powershell', ['-NoProfile', '-Command',
    'Compress-Archive -Path "' + dir + '\\*" -DestinationPath "' + zip + '" -Force'], { stdio: 'inherit' });

  const kb = Math.round(fs.statSync(zip).size / 1024);
  log('INFO', name + '.zip を作りました（' + kb + ' KB）: ' + zip);
  return zip;
}

try {
  main();
} catch (e) {
  log('ERROR', e.message + '\n' + e.stack);
  process.exit(1);
}
