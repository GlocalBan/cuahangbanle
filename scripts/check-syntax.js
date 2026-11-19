'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const ignoreDirs = new Set(['node_modules', '.git', '.playwright-cli', 'data', 'assets']);
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoreDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.cjs')) files.push(full);
  }
}

walk(root);
let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    failed++;
    console.error(`Syntax error in ${path.relative(root, file)}:\n${err.stderr?.toString() || err.message}`);
  }
}

if (failed > 0) {
  console.error(`Checked ${files.length} files: ${failed} failed.`);
  process.exit(1);
}
console.log(`Syntax check passed for ${files.length} JS files.`);
