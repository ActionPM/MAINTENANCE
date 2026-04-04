#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const canonDir = path.join(root, 'docs', 'canon');
const required = [
  'frontend-operating-blueprint.md',
  'frontend-spec.md',
  'kernel-alignment-rules.md',
  'repo-policy.md',
  'naming-and-worktree-policy.md'
];

let failed = false;
for (const file of required) {
  const p = path.join(canonDir, file);
  if (!fs.existsSync(p)) {
    console.error(`Missing canon doc: docs/canon/${file}`);
    failed = true;
    continue;
  }

  const text = fs.readFileSync(p, 'utf8');
  if (text.trim().length === 0) {
    console.error(`Empty canon doc: docs/canon/${file}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log('docs:check passed');
