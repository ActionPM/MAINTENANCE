#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const tasksDir = path.join(root, 'docs', 'tasks');
if (!fs.existsSync(tasksDir)) {
  console.error('Missing docs/tasks directory');
  process.exit(1);
}

const required = ['meta.yaml', 'feature-packet.md', 'review-matrix.md', 'doc-delta.md'];
const taskDirs = fs
  .readdirSync(tasksDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);
const requiredMetaFields = [
  'task_id:',
  'title:',
  'risk:',
  'change_types:',
  'affected_divisions:',
  'generator:',
];
let failed = false;

for (const taskId of taskDirs) {
  const dir = path.join(tasksDir, taskId);
  for (const file of required) {
    const filePath = path.join(dir, file);
    if (!fs.existsSync(filePath)) {
      console.error(`Task ${taskId} is missing ${file}`);
      failed = true;
      continue;
    }

    const text = fs.readFileSync(filePath, 'utf8');
    if (text.trim().length === 0) {
      console.error(`Task ${taskId} has empty required file ${file}`);
      failed = true;
    }
  }

  const metaPath = path.join(dir, 'meta.yaml');
  if (fs.existsSync(metaPath)) {
    const metaText = fs.readFileSync(metaPath, 'utf8');
    for (const field of requiredMetaFields) {
      if (!metaText.includes(field)) {
        console.error(`Task ${taskId} meta.yaml is missing ${field}`);
        failed = true;
      }
    }
  }
}

if (failed) process.exit(1);
console.log(`task:check passed for ${taskDirs.length} task folder(s)`);
