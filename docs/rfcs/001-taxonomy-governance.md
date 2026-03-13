# RFC 001: Taxonomy Governance

**Status**: Draft
**Date**: 2026-03-13
**Author**: —

## Summary

This RFC defines the process for proposing, reviewing, and deploying changes to the authoritative taxonomy (`packages/schemas/taxonomy.json`).

## Motivation

The taxonomy is the analytic spine of the system. Every classification, trend report, work-order bundle, and SLA calculation depends on stable, well-defined taxonomy values. Uncontrolled changes risk:

- Breaking downstream analytics (dashboards, reports, bundling logic)
- Invalidating existing Gold Set examples and eval baselines
- Creating drift between pinned taxonomy versions and the live taxonomy
- Introducing category gating contradictions

## Canonical Source

The single authoritative taxonomy file is:

```
packages/schemas/taxonomy.json
```

Any other copy (e.g., `docs/taxonomy.json`) is a convenience mirror and must not be treated as authoritative. See the project's source-of-truth designations in `AGENTS.md`.

## Change Process

### 1. Proposal

- File a new RFC in `docs/rfcs/` describing the proposed change
- Include: motivation, affected fields, example values, and impact analysis
- Impact analysis must cover:
  - Classification cues (`classification_cues.json`) that reference changed values
  - SLA policies (`sla_policies.json`) that reference changed categories
  - Risk protocols (`risk_protocols.json`) that reference changed taxonomy paths
  - Eval datasets (Gold A/B/C, Hard, OOD, Regression) with affected examples
  - Constraint rules (`taxonomy-constraints.json`) that reference changed fields

### 2. Review

- RFC must be reviewed by at least one domain stakeholder and one engineering owner
- Review checklist:
  - [ ] No category gating contradictions introduced
  - [ ] Backward compatibility assessed (existing WOs with old values)
  - [ ] Eval dataset updates identified and planned
  - [ ] Version bump strategy decided

### 3. Implementation

- Bump `taxonomy_version` in `packages/schemas/src/version-pinning.ts`
- Update `packages/schemas/taxonomy.json`
- Update any affected constraint rules, cue dictionaries, and SLA policies
- Update eval datasets to reflect new/changed values
- Run full eval suite to verify no regression
- Update any convenience mirrors (e.g., `docs/taxonomy.json`)

### 4. Deployment

- CI eval gate must pass before merge
- Existing conversations retain their pinned `taxonomy_version` — they are not affected
- New conversations pick up the new taxonomy version automatically
- Monitor classification accuracy for 48 hours post-deploy

## Version Bump Rules

| Change Type                     | Version Bump          | Examples                                  |
| ------------------------------- | --------------------- | ----------------------------------------- |
| Add new value to existing field | Minor (1.0.0 → 1.1.0) | Adding `smart_lock` to Maintenance_Object |
| Remove or rename a value        | Major (1.0.0 → 2.0.0) | Renaming `hvac` → `climate_control`       |
| Add new field                   | Major (1.0.0 → 2.0.0) | Adding `Urgency` field                    |
| Fix typo in value               | Patch (1.0.0 → 1.0.1) | `not_workking` → `not_working`            |

## Backward Compatibility

- Removed values must be mapped to their replacements in a migration table
- Existing work orders with deprecated values remain valid — they use the taxonomy version pinned at conversation creation
- Reports that span taxonomy versions must handle value mapping
