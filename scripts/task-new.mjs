#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const [, , taskId, ...titleParts] = process.argv;
if (!taskId) {
  console.error('Usage: npm run task:new -- FE-042 Draft PO export visible state');
  process.exit(1);
}

const title = titleParts.join(' ').trim() || 'New task';
const root = process.cwd();
const taskDir = path.join(root, 'docs', 'tasks', taskId);
fs.mkdirSync(taskDir, { recursive: true });

const meta = `task_id: ${taskId}
title: ${title}
risk: medium
change_types: []
affected_divisions: []
generator: 
critic: 
auditor: 
release_sensitive: false
canonical_artifacts:
  - docs/canon/frontend-spec.md
  - docs/canon/kernel-alignment-rules.md
`;

const featurePacket = `# Feature Packet - ${taskId}

## Problem

## In scope

## Out of scope

## Required behavior

## Forbidden behavior

## Likely affected files

## Required evidence

## Merge blockers
`;

const reviewMatrix = `# Review Matrix - ${taskId}

| Review lane | Required | Reviewer | Status | Notes |
|---|---:|---|---|---|
| Governance | Yes |  | Open |  |
| UX / Workflow | No |  | Open |  |
| Semantics / Contract | No |  | Open |  |
| Security | No |  | Open |  |
| Observability | No |  | Open |  |
| Quality | No |  | Open |  |
| Delivery | No |  | Open |  |
`;

const openQuestions = `# Open Questions - ${taskId}
`;
const diffSummary = `# Diff Summary - ${taskId}
`;
const docDelta = `# Doc Delta - ${taskId}

## Canon docs affected

## Why

## No-canon-change rationale
`;

const files = {
  'meta.yaml': meta,
  'feature-packet.md': featurePacket,
  'review-matrix.md': reviewMatrix,
  'open-questions.md': openQuestions,
  'diff-summary.md': diffSummary,
  'doc-delta.md': docDelta,
};

for (const [name, content] of Object.entries(files)) {
  const filePath = path.join(taskDir, name);
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, content, 'utf8');
}

console.log(`Created task scaffold at ${path.relative(root, taskDir)}`);
