# Frontend Architecture

## Purpose

This file tracks the working architecture for the governed ActionPM frontend.

## Current shape

- Next.js frontend in the shared monorepo
- Frontend remains downstream of maintenance kernel rules
- Shared contracts, taxonomy, and validators remain upstream sources of truth

## Current constraints

- Kernel-first
- Internal-only phase-one workflow
- No shadow taxonomy or shadow contract layer
- Truthful degraded-state behavior is required
