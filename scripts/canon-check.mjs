#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const specPath = path.join(root, 'docs', 'canon', 'frontend-spec.md');
const rulesPath = path.join(root, 'docs', 'canon', 'kernel-alignment-rules.md');

const requiredSpecPhrases = [
  'kernel-first',
  'phase-one workflow boundary',
  'draft Purchase Order',
  'truthful degraded-state',
  'taxonomy',
  'KPI',
];

const requiredRulesPhrases = [
  'no shadow taxonomy',
  'no shadow contract',
  'drilldown',
  'release-sensitive',
  'doc gate',
];

let failed = false;

function checkFile(filePath, phrases, label) {
  if (!fs.existsSync(filePath)) {
    console.error(`Missing ${label}: ${path.relative(root, filePath)}`);
    failed = true;
    return;
  }
  const text = fs.readFileSync(filePath, 'utf8').toLowerCase();
  for (const phrase of phrases) {
    if (!text.includes(phrase.toLowerCase())) {
      console.error(`${label} missing expected phrase: ${phrase}`);
      failed = true;
    }
  }
}

checkFile(specPath, requiredSpecPhrases, 'frontend-spec');
checkFile(rulesPath, requiredRulesPhrases, 'kernel-alignment-rules');

if (failed) process.exit(1);
console.log('canon:check passed');
