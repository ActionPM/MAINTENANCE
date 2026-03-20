# Vault Integration

The ActionPM2 Obsidian vault is the project knowledge base for strategy, architecture, entities, and daily engineering status. This document describes how the codebase stays in sync with the vault.

## Vault Location

`c:\Users\Owner\Documents\01_ActionPM\03_Agents\ActionPM2`

The vault is **not under git**. Writes are not reversible. Always run `/update-vault plan` before a first write against new vault state.

Bug handling uses a split-authority model:

- the vault is the intake and working-draft surface,
- the repo is the canonical technical tracking surface,
- and the vault `Agent Repo Review` section in a bug note freezes once a row exists in `docs/bug-tracker.md`.

## Setup

Add the vault path to `.claude/settings.local.json` (machine-specific, not committed):

```json
"additionalDirectories": ["c:\\Users\\Owner\\Documents\\01_ActionPM\\03_Agents\\ActionPM2"]
```

A user-level behavioral reminder in `~/.claude/CLAUDE.md` prompts suggesting `/update-vault post-commit` after git commits.

## Commands

The `/update-vault` slash command is defined at `.claude/commands/update-vault.md`.

### `/update-vault plan`

Dry-run. Lists every intended change (stub fills, section updates, new files) without writing anything. **Use this first.**

### `/update-vault post-commit`

Lightweight. Appends recent commit summaries to today's Update Note. If the spec-gap-tracker changed, syncs `MOD - Maintenance.md` current state with fresh dashboard totals. Tracks a commit hash marker to avoid duplicates on re-runs.

### `/update-vault full-sync`

Full pass:

1. Creates or updates today's Update Note (Engineering Standup, CEO Review, Next Actions, Action Plan)
2. Fills empty stub notes from codebase sources using vault templates
3. Syncs `MOD - Maintenance.md` tracker totals
4. Updates hub notes (Master Note, System Map) with any newly created notes

Stub fill priority: COMP- -> CTRL- -> core ENT- -> PROC- -> DEC-/PLAT- -> future MOD- (minimal).

### `/update-vault incorporate`

Picks up user edits made in Obsidian. Reads vault notes, flags any discrepancies with codebase state, and updates hub notes if vault structure changed. Does not auto-fix populated user content.

## What the Agent Writes

### Writable

| Scope | Notes |
| --- | --- |
| Prefixes | `COMP-`, `CTRL-`, `ENT-`, `PROC-`, `MOD-`, `DEC-`, `PLAT-`, `TAX-`, `DATA-`, `PKG-`, `BUG-` |
| Update Notes | `Update Note MM-DD-YY.md` in vault root |
| Bug intake notes | `02_System/Bugs/*.md` created from the bug template; agent may fill the `Agent Repo Review` section during intake review only |
| Hub note sections | `MOD - Maintenance.md` -> `## Current state`, `ActionPM - Master Note.md` -> linked workflow sections, `ActionPM - System Map.md` -> section lists |

### Read-only

| Scope | Notes |
| --- | --- |
| Prefixes | `STRAT-`, `SPEC-`, `UI-`, `ACTION-`, `RESEARCH-`, `RMI-`, `ACTOR-` |
| Directories | `07_Maps Excalidraw/`, `97_Agents/`, `99_Templates/`, `.obsidian/` |
| Files | `KPIs.md`, any `.excalidraw.md` |

## Safety Rules

- **Stub detection**: only fills files that are empty, frontmatter-only, or contain template placeholders. Anything else is treated as user-authored.
- **Section-targeted updates**: only replaces content under explicitly named `##` headings. If a heading is missing, the agent skips the file and reports.
- **No deletions, renames, or auto-archiving.**
- **Commit marker**: `<!-- vault-pm-last-commit: hash -->` at the bottom of Update Notes prevents duplicate entries across runs.
- **Bug review freeze**: once `docs/bug-tracker.md` contains a row for a vault bug note, treat that note's `Agent Repo Review` section as frozen. Continue technical status updates in the repo, not the vault note.

## Key Files

| File | Purpose |
| --- | --- |
| `.claude/commands/update-vault.md` | Slash command definition for vault update behavior |
| `~/.claude/CLAUDE.md` | User-level reminder to suggest `/update-vault post-commit` after commits |
| `.claude/settings.local.json` | Vault directory in `additionalDirectories` (machine-specific) |
| `docs/spec-gap-tracker.md` | Source of truth for tracker totals synced to vault |
| `docs/bug-management.md` | Canonical bug handling process |
| `docs/bug-tracker.md` | Canonical reviewed bug backlog |
