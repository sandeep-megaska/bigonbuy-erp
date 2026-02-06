#!/usr/bin/env node

const { execSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const repoRoot = process.cwd();
const selfPath = 'scripts/lint-routes.js';

const forbiddenStrings = ['/api/erp/', 'pages/api/erp/', 'app/api/erp/'];

const ignoredExtensions = new Set(['.md', '.mdx', '.txt']);
const ignoredPrefixes = ['docs/', 'public/'];

function shouldIgnore(file) {
  if (file === selfPath) return true;
  if (ignoredPrefixes.some((prefix) => file.startsWith(prefix))) return true;
  const dotIndex = file.lastIndexOf('.');
  if (dotIndex >= 0 && ignoredExtensions.has(file.slice(dotIndex))) return true;
  return false;
}

function lineNumbersWithNeedle(text, needle) {
  const lines = text.split(/\r?\n/);
  const lineNumbers = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes(needle)) lineNumbers.push(i + 1);
  }
  return lineNumbers;
}

let files = [];
try {
  const output = execSync('git ls-files', { encoding: 'utf8' });
  files = output.split('\n').filter(Boolean);
} catch (error) {
  console.error('Failed to list repository files with git ls-files.');
  console.error(error.message);
  process.exit(2);
}

const violations = [];

for (const file of files) {
  if (shouldIgnore(file)) continue;

  for (const forbiddenString of forbiddenStrings) {
    if (file.includes(forbiddenString)) {
      violations.push({ file, reason: `forbidden path contains "${forbiddenString}"` });
    }
  }

  const absolutePath = resolve(repoRoot, file);
  let content = '';
  try {
    content = readFileSync(absolutePath, 'utf8');
  } catch {
    continue;
  }

  for (const forbiddenString of forbiddenStrings) {
    const lines = lineNumbersWithNeedle(content, forbiddenString);
    for (const line of lines) {
      violations.push({ file, reason: `forbidden string "${forbiddenString}" on line ${line}` });
    }
  }
}

if (violations.length > 0) {
  console.error('Forbidden ERP API route references found. Use module-scoped operational APIs under /api/<module>/** and keep UI at /erp/**.');
  for (const violation of violations) {
    console.error(`- ${violation.file}: ${violation.reason}`);
  }
  process.exit(1);
}

console.log('Route lint passed: no forbidden ERP API route references found.');
