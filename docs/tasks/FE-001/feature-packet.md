# Feature Packet - FE-001

## Problem

The repo needs a governed frontend operating entry point that is real enough to start work without relying on chat memory.

## In scope

- Canon docs for frontend operating rules
- Task packet structure
- Review and evidence templates
- Guard scripts for tasks and canon

## Out of scope

- Product implementation work
- Workflow engine changes
- ERP or backend contract changes

## Required behavior

- Frontend work starts from canon and a task packet
- Guard scripts catch missing or hollow operating artifacts
- PR discipline is explicit about roles, evidence, and canon impact

## Forbidden behavior

- Treating placeholders as real governance
- Merging governed work without task and review artifacts
- Shadowing kernel, taxonomy, or contract meaning in frontend docs

## Affected files

- `docs/canon/*`
- `.actionpm/*`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `scripts/*.mjs`

## Required evidence

- Passing `guard:frontend`
- Canon docs updated
- Review template and checklist coverage present

## Merge blockers

- `canon:check` fails
- required canon docs are empty
- required task packet files are empty
