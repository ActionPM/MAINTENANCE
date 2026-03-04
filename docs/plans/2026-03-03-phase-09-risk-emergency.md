# Phase 9: Risk Protocols + Mitigation Templates + Emergency Router Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:executing-plans to implement this plan task-by-task.

**Goal:** Implement deterministic risk scanning, mitigation template rendering, and emergency contact chain routing with exhaustion handling — spec §17, §2 non-negotiable #7, §1.6.

**Architecture:** A pure-function Risk Engine scans tenant text and classification outputs against the `risk_protocols.json` trigger grammar (keywords, regex, taxonomy paths). Matched triggers surface mitigation templates immediately and, when emergency-severity, prompt the tenant for confirmation before dispatching an Emergency Router through the per-building contact chain in `emergency_escalation_plans.json`. The router uses call-until-answered semantics with exhaustion handling (internal alert + safe tenant message). All risk activity is recorded as append-only `risk_events`. Risk flags propagate to created Work Orders.

**Tech Stack:** TypeScript, vitest, JSON risk protocol/escalation plan data files, existing orchestrator action handler pattern, append-only event pattern.

---

### Task 0: Risk Types in Schemas Package

**Files:**
- Create: `packages/schemas/src/types/risk.ts`
- Modify: `packages/schemas/src/index.ts`

**Step 1: Write the failing test**

```typescript
// packages/schemas/src/__tests__/risk-types.test.ts
import { describe, it, expect } from 'vitest';
import type {
  RiskTrigger,
  TriggerGrammar,
  RiskSeverity,
  MitigationTemplate,
  EscalationPlan,
  ContactChainEntry,
  ExhaustionBehavior,
  RiskScanResult,
  EscalationState,
  RiskProtocols,
  EscalationPlans,
} from '@wo-agent/schemas';

describe('Risk types', () => {
  it('RiskTrigger is structurally valid', () => {
    const trigger: RiskTrigger = {
      trigger_id: 'fire-001',
      name: 'Fire',
      grammar: {
        keyword_any: ['fire'],
        regex_any: ['\\bfire\\b'],
        taxonomy_path_any: [],
      },
      requires_confirmation: true,
      severity: 'emergency',
      mitigation_template_id: 'mit-fire',
    };
    expect(trigger.trigger_id).toBe('fire-001');
    expect(trigger.severity).toBe('emergency');
  });

  it('EscalationPlan is structurally valid', () => {
    const plan: EscalationPlan = {
      plan_id: 'plan-001',
      building_id: 'bldg-001',
      contact_chain: [
        { role: 'building_manager', contact_id: 'c-1', name: 'BM', phone: '+1234' },
      ],
      exhaustion_behavior: {
        internal_alert: true,
        tenant_message_template: 'Unable to reach management.',
        retry_after_minutes: 15,
      },
    };
    expect(plan.contact_chain).toHaveLength(1);
  });

  it('RiskScanResult contains matched triggers', () => {
    const result: RiskScanResult = {
      triggers_matched: [],
      has_emergency: false,
      highest_severity: null,
    };
    expect(result.has_emergency).toBe(false);
  });

  it('EscalationState values are correct', () => {
    const states: EscalationState[] = ['none', 'pending_confirmation', 'routing', 'completed', 'exhausted'];
    expect(states).toHaveLength(5);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/schemas && pnpm vitest run src/__tests__/risk-types.test.ts`
Expected: FAIL — types not exported

**Step 3: Write types**

```typescript
// packages/schemas/src/types/risk.ts

/** Severity levels for risk triggers (spec §17). */
export type RiskSeverity = 'emergency' | 'high' | 'medium';

/** Deterministic trigger grammar (spec §17). */
export interface TriggerGrammar {
  readonly keyword_any: readonly string[];
  readonly regex_any: readonly string[];
  readonly taxonomy_path_any: readonly string[];
}

/** A single risk trigger definition from risk_protocols.json. */
export interface RiskTrigger {
  readonly trigger_id: string;
  readonly name: string;
  readonly grammar: TriggerGrammar;
  readonly requires_confirmation: boolean;
  readonly severity: RiskSeverity;
  readonly mitigation_template_id: string;
}

/** Mitigation template definition from risk_protocols.json. */
export interface MitigationTemplate {
  readonly template_id: string;
  readonly name: string;
  readonly message_template: string;
  readonly safety_instructions: readonly string[];
}

/** Typed container for risk_protocols.json. */
export interface RiskProtocols {
  readonly version: string;
  readonly triggers: readonly RiskTrigger[];
  readonly mitigation_templates: readonly MitigationTemplate[];
}

/** A matched trigger with its match details. */
export interface MatchedTrigger {
  readonly trigger: RiskTrigger;
  readonly matched_keywords: readonly string[];
  readonly matched_regex: readonly string[];
  readonly matched_taxonomy_paths: readonly string[];
}

/** Result of a deterministic risk scan. */
export interface RiskScanResult {
  readonly triggers_matched: readonly MatchedTrigger[];
  readonly has_emergency: boolean;
  readonly highest_severity: RiskSeverity | null;
}

/** Contact in an escalation chain (spec §1.6). */
export interface ContactChainEntry {
  readonly role: string;
  readonly contact_id: string;
  readonly name: string;
  readonly phone: string;
}

/** Exhaustion behavior when all contacts in chain are unreachable (spec §1.6). */
export interface ExhaustionBehavior {
  readonly internal_alert: boolean;
  readonly tenant_message_template: string;
  readonly retry_after_minutes: number;
}

/** Per-building escalation plan from emergency_escalation_plans.json. */
export interface EscalationPlan {
  readonly plan_id: string;
  readonly building_id: string;
  readonly contact_chain: readonly ContactChainEntry[];
  readonly exhaustion_behavior: ExhaustionBehavior;
}

/** Typed container for emergency_escalation_plans.json. */
export interface EscalationPlans {
  readonly version: string;
  readonly plans: readonly EscalationPlan[];
}

/** Escalation state tracked on the session. */
export type EscalationState = 'none' | 'pending_confirmation' | 'routing' | 'completed' | 'exhausted';

/** Result of an escalation attempt on one contact. */
export interface EscalationAttempt {
  readonly contact_id: string;
  readonly role: string;
  readonly name: string;
  readonly attempted_at: string;
  readonly answered: boolean;
}

/** Final result of the emergency router. */
export interface EscalationResult {
  readonly plan_id: string;
  readonly state: 'completed' | 'exhausted';
  readonly attempts: readonly EscalationAttempt[];
  readonly answered_by: ContactChainEntry | null;
  readonly exhaustion_message: string | null;
}
```

Add to `packages/schemas/src/index.ts`:

```typescript
export type {
  RiskSeverity,
  TriggerGrammar,
  RiskTrigger,
  MitigationTemplate,
  RiskProtocols,
  MatchedTrigger,
  RiskScanResult,
  ContactChainEntry,
  ExhaustionBehavior,
  EscalationPlan,
  EscalationPlans,
  EscalationState,
  EscalationAttempt,
  EscalationResult,
} from './types/risk.js';
```

**Step 4: Run test to verify it passes**

Run: `cd packages/schemas && pnpm vitest run src/__tests__/risk-types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/schemas/src/types/risk.ts packages/schemas/src/__tests__/risk-types.test.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): add risk protocol, escalation plan, and risk scan result types (phase 9)"
```

---

### Task 1: Risk Protocol + Escalation Plan Loaders

**Files:**
- Create: `packages/schemas/src/risk-protocols.ts`
- Create: `packages/schemas/src/escalation-plans.ts`
- Create: `packages/schemas/src/__tests__/risk-loaders.test.ts`
- Modify: `packages/schemas/src/index.ts`

**Step 1: Write the failing test**

```typescript
// packages/schemas/src/__tests__/risk-loaders.test.ts
import { describe, it, expect } from 'vitest';
import { loadRiskProtocols, loadEscalationPlans } from '@wo-agent/schemas';

describe('loadRiskProtocols', () => {
  it('loads and returns typed risk protocols from JSON', () => {
    const protocols = loadRiskProtocols();
    expect(protocols.version).toBe('1.0.0');
    expect(protocols.triggers.length).toBeGreaterThan(0);
    expect(protocols.mitigation_templates.length).toBeGreaterThan(0);

    const fire = protocols.triggers.find(t => t.trigger_id === 'fire-001');
    expect(fire).toBeDefined();
    expect(fire!.severity).toBe('emergency');
    expect(fire!.grammar.keyword_any).toContain('fire');
    expect(fire!.mitigation_template_id).toBe('mit-fire');
  });

  it('every trigger references an existing mitigation template', () => {
    const protocols = loadRiskProtocols();
    const templateIds = new Set(protocols.mitigation_templates.map(t => t.template_id));
    for (const trigger of protocols.triggers) {
      expect(templateIds.has(trigger.mitigation_template_id)).toBe(true);
    }
  });
});

describe('loadEscalationPlans', () => {
  it('loads and returns typed escalation plans from JSON', () => {
    const plans = loadEscalationPlans();
    expect(plans.version).toBe('1.0.0');
    expect(plans.plans.length).toBeGreaterThan(0);

    const plan = plans.plans[0];
    expect(plan.plan_id).toBeDefined();
    expect(plan.building_id).toBeDefined();
    expect(plan.contact_chain.length).toBeGreaterThan(0);
    expect(plan.exhaustion_behavior.internal_alert).toBe(true);
  });

  it('every plan has at least one contact in the chain', () => {
    const plans = loadEscalationPlans();
    for (const plan of plans.plans) {
      expect(plan.contact_chain.length).toBeGreaterThan(0);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/schemas && pnpm vitest run src/__tests__/risk-loaders.test.ts`
Expected: FAIL — functions not exported

**Step 3: Write loaders**

```typescript
// packages/schemas/src/risk-protocols.ts
import type { RiskProtocols } from './types/risk.js';
import data from '../risk_protocols.json' with { type: 'json' };

/**
 * Load risk_protocols.json as a typed RiskProtocols object.
 * Validates that every trigger references an existing mitigation template.
 */
export function loadRiskProtocols(): RiskProtocols {
  const protocols = data as unknown as RiskProtocols;
  const templateIds = new Set(protocols.mitigation_templates.map(t => t.template_id));
  for (const trigger of protocols.triggers) {
    if (!templateIds.has(trigger.mitigation_template_id)) {
      throw new Error(
        `Trigger ${trigger.trigger_id} references missing mitigation template: ${trigger.mitigation_template_id}`,
      );
    }
  }
  return protocols;
}
```

```typescript
// packages/schemas/src/escalation-plans.ts
import type { EscalationPlans } from './types/risk.js';
import data from '../emergency_escalation_plans.json' with { type: 'json' };

/**
 * Load emergency_escalation_plans.json as a typed EscalationPlans object.
 * Validates that every plan has at least one contact.
 */
export function loadEscalationPlans(): EscalationPlans {
  const plans = data as unknown as EscalationPlans;
  for (const plan of plans.plans) {
    if (plan.contact_chain.length === 0) {
      throw new Error(`Escalation plan ${plan.plan_id} has an empty contact chain`);
    }
  }
  return plans;
}
```

Add to `packages/schemas/src/index.ts`:

```typescript
export { loadRiskProtocols } from './risk-protocols.js';
export { loadEscalationPlans } from './escalation-plans.js';
```

**Note:** The JSON imports may require adjusting `tsconfig.json` to enable `resolveJsonModule` — check existing pattern from `taxonomy.ts` which already imports `taxonomy.json`.

**Step 4: Run test to verify it passes**

Run: `cd packages/schemas && pnpm vitest run src/__tests__/risk-loaders.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/schemas/src/risk-protocols.ts packages/schemas/src/escalation-plans.ts packages/schemas/src/__tests__/risk-loaders.test.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): add typed loaders for risk_protocols.json and escalation_plans.json"
```

---

### Task 2: Risk Trigger Scanner (Deterministic)

**Files:**
- Create: `packages/core/src/risk/trigger-scanner.ts`
- Create: `packages/core/src/__tests__/risk/trigger-scanner.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/risk/trigger-scanner.test.ts
import { describe, it, expect } from 'vitest';
import { scanTextForTriggers, scanClassificationForTriggers } from '../../risk/trigger-scanner.js';
import type { RiskProtocols } from '@wo-agent/schemas';

const TEST_PROTOCOLS: RiskProtocols = {
  version: '1.0.0',
  triggers: [
    {
      trigger_id: 'fire-001',
      name: 'Fire',
      grammar: {
        keyword_any: ['fire', 'smoke', 'burning'],
        regex_any: ['\\b(fire|flames)\\b'],
        taxonomy_path_any: [],
      },
      requires_confirmation: true,
      severity: 'emergency',
      mitigation_template_id: 'mit-fire',
    },
    {
      trigger_id: 'flood-001',
      name: 'Flood',
      grammar: {
        keyword_any: ['flood', 'burst pipe'],
        regex_any: ['\\bflood(ing)?\\b'],
        taxonomy_path_any: ['maintenance.plumbing.flood'],
      },
      requires_confirmation: true,
      severity: 'emergency',
      mitigation_template_id: 'mit-flood',
    },
    {
      trigger_id: 'no-heat-001',
      name: 'No Heat',
      grammar: {
        keyword_any: ['no heat'],
        regex_any: ['\\bno\\s+heat\\b'],
        taxonomy_path_any: ['maintenance.hvac.no_heat'],
      },
      requires_confirmation: true,
      severity: 'high',
      mitigation_template_id: 'mit-no-heat',
    },
  ],
  mitigation_templates: [],
};

describe('scanTextForTriggers', () => {
  it('returns empty result for benign text', () => {
    const result = scanTextForTriggers('My faucet is dripping', TEST_PROTOCOLS);
    expect(result.triggers_matched).toHaveLength(0);
    expect(result.has_emergency).toBe(false);
    expect(result.highest_severity).toBeNull();
  });

  it('matches keyword triggers (case-insensitive)', () => {
    const result = scanTextForTriggers('There is SMOKE coming from my unit', TEST_PROTOCOLS);
    expect(result.triggers_matched).toHaveLength(1);
    expect(result.triggers_matched[0].trigger.trigger_id).toBe('fire-001');
    expect(result.triggers_matched[0].matched_keywords).toContain('smoke');
    expect(result.has_emergency).toBe(true);
    expect(result.highest_severity).toBe('emergency');
  });

  it('matches regex triggers', () => {
    const result = scanTextForTriggers('The apartment is flooding badly', TEST_PROTOCOLS);
    expect(result.triggers_matched).toHaveLength(1);
    expect(result.triggers_matched[0].trigger.trigger_id).toBe('flood-001');
    expect(result.triggers_matched[0].matched_regex.length).toBeGreaterThan(0);
  });

  it('matches multiple triggers', () => {
    const result = scanTextForTriggers('Fire and flooding in the building', TEST_PROTOCOLS);
    expect(result.triggers_matched).toHaveLength(2);
    const ids = result.triggers_matched.map(t => t.trigger.trigger_id);
    expect(ids).toContain('fire-001');
    expect(ids).toContain('flood-001');
  });

  it('matches multi-word keywords', () => {
    const result = scanTextForTriggers('We have a burst pipe in the kitchen', TEST_PROTOCOLS);
    expect(result.triggers_matched).toHaveLength(1);
    expect(result.triggers_matched[0].trigger.trigger_id).toBe('flood-001');
    expect(result.triggers_matched[0].matched_keywords).toContain('burst pipe');
  });

  it('sets highest_severity to the worst match', () => {
    const result = scanTextForTriggers('No heat and also there is fire', TEST_PROTOCOLS);
    expect(result.highest_severity).toBe('emergency');
  });

  it('handles high severity without emergency', () => {
    const result = scanTextForTriggers('There is no heat in my apartment', TEST_PROTOCOLS);
    expect(result.has_emergency).toBe(false);
    expect(result.highest_severity).toBe('high');
  });
});

describe('scanClassificationForTriggers', () => {
  it('matches taxonomy path triggers', () => {
    const classification = { maintenance_category: 'plumbing', maintenance_subcategory: 'flood' };
    const result = scanClassificationForTriggers(classification, TEST_PROTOCOLS);
    expect(result.triggers_matched).toHaveLength(1);
    expect(result.triggers_matched[0].trigger.trigger_id).toBe('flood-001');
    expect(result.triggers_matched[0].matched_taxonomy_paths).toContain('maintenance.plumbing.flood');
  });

  it('returns empty for non-risk classification', () => {
    const classification = { maintenance_category: 'general', maintenance_subcategory: 'cleaning' };
    const result = scanClassificationForTriggers(classification, TEST_PROTOCOLS);
    expect(result.triggers_matched).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/risk/trigger-scanner.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// packages/core/src/risk/trigger-scanner.ts
import type { RiskProtocols, RiskTrigger, RiskScanResult, MatchedTrigger, RiskSeverity } from '@wo-agent/schemas';

const SEVERITY_RANK: Record<RiskSeverity, number> = {
  emergency: 3,
  high: 2,
  medium: 1,
};

/**
 * Deterministic risk scan against trigger grammar (spec §17).
 * Pure function — no side effects.
 * Checks keyword_any and regex_any against lowercased text.
 */
export function scanTextForTriggers(
  text: string,
  protocols: RiskProtocols,
): RiskScanResult {
  const lowerText = text.toLowerCase();
  const matched: MatchedTrigger[] = [];

  for (const trigger of protocols.triggers) {
    const matchedKeywords = trigger.grammar.keyword_any.filter(
      kw => lowerText.includes(kw.toLowerCase()),
    );

    const matchedRegex: string[] = [];
    for (const pattern of trigger.grammar.regex_any) {
      try {
        const re = new RegExp(pattern, 'i');
        if (re.test(text)) {
          matchedRegex.push(pattern);
        }
      } catch {
        // Invalid regex in config — skip
      }
    }

    if (matchedKeywords.length > 0 || matchedRegex.length > 0) {
      matched.push({
        trigger,
        matched_keywords: matchedKeywords,
        matched_regex: matchedRegex,
        matched_taxonomy_paths: [],
      });
    }
  }

  return buildScanResult(matched);
}

/**
 * Scan classification output for taxonomy_path_any triggers (spec §17).
 * Builds taxonomy paths from classification field values and matches
 * against trigger grammar.
 */
export function scanClassificationForTriggers(
  classification: Record<string, string>,
  protocols: RiskProtocols,
): RiskScanResult {
  // Build all possible taxonomy paths from classification values
  // e.g. { maintenance_category: 'plumbing', maintenance_subcategory: 'flood' }
  // → ['maintenance.plumbing', 'maintenance.plumbing.flood']
  const paths = buildTaxonomyPaths(classification);
  const matched: MatchedTrigger[] = [];

  for (const trigger of protocols.triggers) {
    if (trigger.grammar.taxonomy_path_any.length === 0) continue;

    const matchedPaths = trigger.grammar.taxonomy_path_any.filter(
      tp => paths.has(tp),
    );

    if (matchedPaths.length > 0) {
      matched.push({
        trigger,
        matched_keywords: [],
        matched_regex: [],
        matched_taxonomy_paths: matchedPaths,
      });
    }
  }

  return buildScanResult(matched);
}

/**
 * Merge two scan results (text scan + classification scan).
 * Deduplicates by trigger_id, merging match details.
 */
export function mergeRiskScanResults(
  a: RiskScanResult,
  b: RiskScanResult,
): RiskScanResult {
  const byId = new Map<string, MatchedTrigger>();

  for (const m of [...a.triggers_matched, ...b.triggers_matched]) {
    const existing = byId.get(m.trigger.trigger_id);
    if (existing) {
      byId.set(m.trigger.trigger_id, {
        trigger: m.trigger,
        matched_keywords: [...new Set([...existing.matched_keywords, ...m.matched_keywords])],
        matched_regex: [...new Set([...existing.matched_regex, ...m.matched_regex])],
        matched_taxonomy_paths: [...new Set([...existing.matched_taxonomy_paths, ...m.matched_taxonomy_paths])],
      });
    } else {
      byId.set(m.trigger.trigger_id, m);
    }
  }

  return buildScanResult([...byId.values()]);
}

function buildScanResult(matched: MatchedTrigger[]): RiskScanResult {
  let highestRank = 0;
  let highestSeverity: RiskSeverity | null = null;
  let hasEmergency = false;

  for (const m of matched) {
    const rank = SEVERITY_RANK[m.trigger.severity];
    if (rank > highestRank) {
      highestRank = rank;
      highestSeverity = m.trigger.severity;
    }
    if (m.trigger.severity === 'emergency') {
      hasEmergency = true;
    }
  }

  return {
    triggers_matched: matched,
    has_emergency: hasEmergency,
    highest_severity: highestSeverity,
  };
}

function buildTaxonomyPaths(classification: Record<string, string>): Set<string> {
  const paths = new Set<string>();
  const category = classification.maintenance_category;
  const subcategory = classification.maintenance_subcategory;
  const object = classification.maintenance_object;

  if (category) {
    paths.add(`maintenance.${category}`);
    if (subcategory) {
      paths.add(`maintenance.${category}.${subcategory}`);
      if (object) {
        paths.add(`maintenance.${category}.${subcategory}.${object}`);
      }
    }
  }

  return paths;
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/risk/trigger-scanner.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/risk/trigger-scanner.ts packages/core/src/__tests__/risk/trigger-scanner.test.ts
git commit -m "feat(core): deterministic risk trigger scanner — keyword, regex, taxonomy path matching"
```

---

### Task 3: Mitigation Template Resolver

**Files:**
- Create: `packages/core/src/risk/mitigation.ts`
- Create: `packages/core/src/__tests__/risk/mitigation.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/risk/mitigation.test.ts
import { describe, it, expect } from 'vitest';
import { resolveMitigationTemplate, renderMitigationMessages } from '../../risk/mitigation.js';
import type { RiskProtocols, MatchedTrigger } from '@wo-agent/schemas';

const TEST_PROTOCOLS: RiskProtocols = {
  version: '1.0.0',
  triggers: [
    {
      trigger_id: 'fire-001',
      name: 'Fire',
      grammar: { keyword_any: ['fire'], regex_any: [], taxonomy_path_any: [] },
      requires_confirmation: true,
      severity: 'emergency',
      mitigation_template_id: 'mit-fire',
    },
  ],
  mitigation_templates: [
    {
      template_id: 'mit-fire',
      name: 'Fire Safety',
      message_template: 'If there is an active fire, call 911 immediately.',
      safety_instructions: ['Call 911', 'Evacuate via stairwell'],
    },
  ],
};

describe('resolveMitigationTemplate', () => {
  it('resolves template by ID', () => {
    const template = resolveMitigationTemplate('mit-fire', TEST_PROTOCOLS);
    expect(template).toBeDefined();
    expect(template!.name).toBe('Fire Safety');
  });

  it('returns null for unknown template ID', () => {
    const template = resolveMitigationTemplate('mit-unknown', TEST_PROTOCOLS);
    expect(template).toBeNull();
  });
});

describe('renderMitigationMessages', () => {
  it('renders mitigation messages for matched triggers', () => {
    const matches: MatchedTrigger[] = [{
      trigger: TEST_PROTOCOLS.triggers[0],
      matched_keywords: ['fire'],
      matched_regex: [],
      matched_taxonomy_paths: [],
    }];
    const messages = renderMitigationMessages(matches, TEST_PROTOCOLS);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('Fire Safety');
    expect(messages[0]).toContain('call 911');
    expect(messages[0]).toContain('Call 911');
    expect(messages[0]).toContain('Evacuate via stairwell');
  });

  it('returns empty array when no matches', () => {
    const messages = renderMitigationMessages([], TEST_PROTOCOLS);
    expect(messages).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/risk/mitigation.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// packages/core/src/risk/mitigation.ts
import type { RiskProtocols, MitigationTemplate, MatchedTrigger } from '@wo-agent/schemas';

/**
 * Look up a mitigation template by ID from risk protocols.
 * Returns null if not found.
 */
export function resolveMitigationTemplate(
  templateId: string,
  protocols: RiskProtocols,
): MitigationTemplate | null {
  return protocols.mitigation_templates.find(t => t.template_id === templateId) ?? null;
}

/**
 * Render user-facing mitigation messages for matched triggers.
 * Each message includes the template name, safety message, and instructions.
 */
export function renderMitigationMessages(
  matches: readonly MatchedTrigger[],
  protocols: RiskProtocols,
): string[] {
  const messages: string[] = [];

  for (const match of matches) {
    const template = resolveMitigationTemplate(match.trigger.mitigation_template_id, protocols);
    if (!template) continue;

    const instructions = template.safety_instructions
      .map(s => `- ${s}`)
      .join('\n');

    messages.push(
      `**${template.name}**\n\n${template.message_template}\n\n${instructions}`,
    );
  }

  return messages;
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/risk/mitigation.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/risk/mitigation.ts packages/core/src/__tests__/risk/mitigation.test.ts
git commit -m "feat(core): mitigation template resolver and message renderer"
```

---

### Task 4: Risk Event Builder (Append-Only)

**Files:**
- Create: `packages/core/src/risk/event-builder.ts`
- Create: `packages/core/src/__tests__/risk/event-builder.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/risk/event-builder.test.ts
import { describe, it, expect } from 'vitest';
import {
  buildRiskDetectedEvent,
  buildEscalationAttemptEvent,
  buildEscalationResultEvent,
} from '../../risk/event-builder.js';
import type { MatchedTrigger, EscalationResult } from '@wo-agent/schemas';

describe('buildRiskDetectedEvent', () => {
  it('builds a risk_detected event with trigger details', () => {
    const triggers: MatchedTrigger[] = [{
      trigger: {
        trigger_id: 'fire-001',
        name: 'Fire',
        grammar: { keyword_any: [], regex_any: [], taxonomy_path_any: [] },
        requires_confirmation: true,
        severity: 'emergency',
        mitigation_template_id: 'mit-fire',
      },
      matched_keywords: ['fire'],
      matched_regex: [],
      matched_taxonomy_paths: [],
    }];

    const event = buildRiskDetectedEvent({
      eventId: 'evt-1',
      conversationId: 'conv-1',
      triggersMatched: triggers,
      hasEmergency: true,
      highestSeverity: 'emergency',
      createdAt: '2026-03-03T00:00:00Z',
    });

    expect(event.event_id).toBe('evt-1');
    expect(event.conversation_id).toBe('conv-1');
    expect(event.event_type).toBe('risk_detected');
    expect(event.payload.triggers_matched).toHaveLength(1);
    expect(event.payload.has_emergency).toBe(true);
  });
});

describe('buildEscalationAttemptEvent', () => {
  it('builds an escalation_attempt event', () => {
    const event = buildEscalationAttemptEvent({
      eventId: 'evt-2',
      conversationId: 'conv-1',
      contactId: 'c-1',
      role: 'building_manager',
      name: 'BM',
      answered: false,
      createdAt: '2026-03-03T00:01:00Z',
    });

    expect(event.event_type).toBe('escalation_attempt');
    expect(event.payload.contact_id).toBe('c-1');
    expect(event.payload.answered).toBe(false);
  });
});

describe('buildEscalationResultEvent', () => {
  it('builds an escalation_result event for completed escalation', () => {
    const result: EscalationResult = {
      plan_id: 'plan-1',
      state: 'completed',
      attempts: [{ contact_id: 'c-1', role: 'bm', name: 'BM', attempted_at: '2026-03-03T00:00:00Z', answered: true }],
      answered_by: { role: 'bm', contact_id: 'c-1', name: 'BM', phone: '+1' },
      exhaustion_message: null,
    };

    const event = buildEscalationResultEvent({
      eventId: 'evt-3',
      conversationId: 'conv-1',
      escalationResult: result,
      createdAt: '2026-03-03T00:02:00Z',
    });

    expect(event.event_type).toBe('escalation_result');
    expect(event.payload.state).toBe('completed');
    expect(event.payload.answered_by).toBeDefined();
  });

  it('builds an escalation_result event for exhausted escalation', () => {
    const result: EscalationResult = {
      plan_id: 'plan-1',
      state: 'exhausted',
      attempts: [],
      answered_by: null,
      exhaustion_message: 'Unable to reach anyone.',
    };

    const event = buildEscalationResultEvent({
      eventId: 'evt-4',
      conversationId: 'conv-1',
      escalationResult: result,
      createdAt: '2026-03-03T00:03:00Z',
    });

    expect(event.payload.state).toBe('exhausted');
    expect(event.payload.exhaustion_message).toBe('Unable to reach anyone.');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/risk/event-builder.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// packages/core/src/risk/event-builder.ts
import type { MatchedTrigger, RiskSeverity, EscalationResult } from '@wo-agent/schemas';

/**
 * Risk event row — append-only, INSERT only, no UPDATE/DELETE (spec §7).
 */
export interface RiskEvent {
  readonly event_id: string;
  readonly conversation_id: string;
  readonly event_type: 'risk_detected' | 'escalation_attempt' | 'escalation_result';
  readonly payload: Record<string, unknown>;
  readonly created_at: string;
}

export interface RiskDetectedInput {
  readonly eventId: string;
  readonly conversationId: string;
  readonly triggersMatched: readonly MatchedTrigger[];
  readonly hasEmergency: boolean;
  readonly highestSeverity: RiskSeverity | null;
  readonly createdAt: string;
}

export function buildRiskDetectedEvent(input: RiskDetectedInput): RiskEvent {
  return {
    event_id: input.eventId,
    conversation_id: input.conversationId,
    event_type: 'risk_detected',
    payload: {
      triggers_matched: input.triggersMatched.map(t => ({
        trigger_id: t.trigger.trigger_id,
        name: t.trigger.name,
        severity: t.trigger.severity,
        matched_keywords: t.matched_keywords,
        matched_regex: t.matched_regex,
        matched_taxonomy_paths: t.matched_taxonomy_paths,
      })),
      has_emergency: input.hasEmergency,
      highest_severity: input.highestSeverity,
    },
    created_at: input.createdAt,
  };
}

export interface EscalationAttemptInput {
  readonly eventId: string;
  readonly conversationId: string;
  readonly contactId: string;
  readonly role: string;
  readonly name: string;
  readonly answered: boolean;
  readonly createdAt: string;
}

export function buildEscalationAttemptEvent(input: EscalationAttemptInput): RiskEvent {
  return {
    event_id: input.eventId,
    conversation_id: input.conversationId,
    event_type: 'escalation_attempt',
    payload: {
      contact_id: input.contactId,
      role: input.role,
      name: input.name,
      answered: input.answered,
    },
    created_at: input.createdAt,
  };
}

export interface EscalationResultInput {
  readonly eventId: string;
  readonly conversationId: string;
  readonly escalationResult: EscalationResult;
  readonly createdAt: string;
}

export function buildEscalationResultEvent(input: EscalationResultInput): RiskEvent {
  return {
    event_id: input.eventId,
    conversation_id: input.conversationId,
    event_type: 'escalation_result',
    payload: {
      plan_id: input.escalationResult.plan_id,
      state: input.escalationResult.state,
      attempts: input.escalationResult.attempts,
      answered_by: input.escalationResult.answered_by,
      exhaustion_message: input.escalationResult.exhaustion_message,
    },
    created_at: input.createdAt,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/risk/event-builder.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/risk/event-builder.ts packages/core/src/__tests__/risk/event-builder.test.ts
git commit -m "feat(core): append-only risk event builders — risk_detected, escalation_attempt, escalation_result"
```

---

### Task 5: Session Risk Tracking Fields

**Files:**
- Modify: `packages/core/src/session/types.ts`
- Modify: `packages/core/src/session/session.ts`
- Create: `packages/core/src/__tests__/risk/session-risk.test.ts`
- Modify: `packages/core/src/session/index.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/risk/session-risk.test.ts
import { describe, it, expect } from 'vitest';
import { createSession, setRiskTriggers, setEscalationState } from '../../session/session.js';
import type { MatchedTrigger } from '@wo-agent/schemas';

describe('session risk tracking', () => {
  const baseSession = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['unit-1'],
    pinned_versions: { taxonomy_version: '1', schema_version: '1', model_id: 'm', prompt_version: '1' },
  });

  it('initializes with no risk triggers and escalation_state=none', () => {
    expect(baseSession.risk_triggers).toHaveLength(0);
    expect(baseSession.escalation_state).toBe('none');
    expect(baseSession.escalation_plan_id).toBeNull();
  });

  it('setRiskTriggers stores matched triggers on session', () => {
    const triggers: MatchedTrigger[] = [{
      trigger: {
        trigger_id: 'fire-001',
        name: 'Fire',
        grammar: { keyword_any: [], regex_any: [], taxonomy_path_any: [] },
        requires_confirmation: true,
        severity: 'emergency',
        mitigation_template_id: 'mit-fire',
      },
      matched_keywords: ['fire'],
      matched_regex: [],
      matched_taxonomy_paths: [],
    }];

    const updated = setRiskTriggers(baseSession, triggers);
    expect(updated.risk_triggers).toHaveLength(1);
    expect(updated.risk_triggers[0].trigger.trigger_id).toBe('fire-001');
  });

  it('setEscalationState updates escalation state and plan', () => {
    const updated = setEscalationState(baseSession, 'routing', 'plan-001');
    expect(updated.escalation_state).toBe('routing');
    expect(updated.escalation_plan_id).toBe('plan-001');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/risk/session-risk.test.ts`
Expected: FAIL — properties/functions not found

**Step 3: Add risk fields to ConversationSession**

In `packages/core/src/session/types.ts`, add to `ConversationSession`:

```typescript
  /** Matched risk triggers from deterministic scan (spec §17) */
  readonly risk_triggers: readonly MatchedTrigger[];
  /** Current escalation state */
  readonly escalation_state: EscalationState;
  /** Escalation plan ID if emergency routing is active */
  readonly escalation_plan_id: string | null;
```

Import `MatchedTrigger` and `EscalationState` from `@wo-agent/schemas`.

In `packages/core/src/session/session.ts`, add to `createSession()` defaults:

```typescript
  risk_triggers: [],
  escalation_state: 'none',
  escalation_plan_id: null,
```

Add helper functions:

```typescript
export function setRiskTriggers(
  session: ConversationSession,
  triggers: readonly MatchedTrigger[],
): ConversationSession {
  return { ...session, risk_triggers: triggers };
}

export function setEscalationState(
  session: ConversationSession,
  state: EscalationState,
  planId?: string,
): ConversationSession {
  return {
    ...session,
    escalation_state: state,
    ...(planId !== undefined ? { escalation_plan_id: planId } : {}),
  };
}
```

Export from `packages/core/src/session/index.ts`:

```typescript
export { setRiskTriggers, setEscalationState } from './session.js';
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/risk/session-risk.test.ts`
Expected: PASS

**Step 5: Run ALL existing tests to confirm no regressions**

Run: `cd packages/core && pnpm vitest run`
Expected: All existing tests still pass (new fields have defaults, no breaking changes)

**Step 6: Commit**

```bash
git add packages/core/src/session/types.ts packages/core/src/session/session.ts packages/core/src/session/index.ts packages/core/src/__tests__/risk/session-risk.test.ts
git commit -m "feat(core): add risk_triggers, escalation_state, escalation_plan_id to ConversationSession"
```

---

### Task 6: Emergency Router

**Files:**
- Create: `packages/core/src/risk/emergency-router.ts`
- Create: `packages/core/src/__tests__/risk/emergency-router.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/risk/emergency-router.test.ts
import { describe, it, expect, vi } from 'vitest';
import { routeEmergency } from '../../risk/emergency-router.js';
import type { EscalationPlan, EscalationPlans } from '@wo-agent/schemas';

const TEST_PLAN: EscalationPlan = {
  plan_id: 'plan-001',
  building_id: 'bldg-001',
  contact_chain: [
    { role: 'building_manager', contact_id: 'c-1', name: 'BM', phone: '+1111' },
    { role: 'property_manager', contact_id: 'c-2', name: 'PM', phone: '+2222' },
    { role: 'fallback_after_hours', contact_id: 'c-3', name: 'Fallback', phone: '+3333' },
  ],
  exhaustion_behavior: {
    internal_alert: true,
    tenant_message_template: 'Unable to reach management. Call 911 if life-threatening.',
    retry_after_minutes: 15,
  },
};

const TEST_PLANS: EscalationPlans = { version: '1.0.0', plans: [TEST_PLAN] };

describe('routeEmergency', () => {
  it('returns completed when first contact answers', async () => {
    const contactExecutor = vi.fn().mockResolvedValue(true); // answered
    const result = await routeEmergency({
      buildingId: 'bldg-001',
      escalationPlans: TEST_PLANS,
      contactExecutor,
      clock: () => '2026-03-03T00:00:00Z',
    });

    expect(result.state).toBe('completed');
    expect(result.answered_by).toBeDefined();
    expect(result.answered_by!.contact_id).toBe('c-1');
    expect(contactExecutor).toHaveBeenCalledTimes(1);
    expect(result.exhaustion_message).toBeNull();
  });

  it('iterates chain until someone answers', async () => {
    const contactExecutor = vi.fn()
      .mockResolvedValueOnce(false)  // BM doesn't answer
      .mockResolvedValueOnce(false)  // PM doesn't answer
      .mockResolvedValueOnce(true);  // Fallback answers

    const result = await routeEmergency({
      buildingId: 'bldg-001',
      escalationPlans: TEST_PLANS,
      contactExecutor,
      clock: () => '2026-03-03T00:00:00Z',
    });

    expect(result.state).toBe('completed');
    expect(result.answered_by!.contact_id).toBe('c-3');
    expect(contactExecutor).toHaveBeenCalledTimes(3);
    expect(result.attempts).toHaveLength(3);
  });

  it('returns exhausted when no one answers', async () => {
    const contactExecutor = vi.fn().mockResolvedValue(false);

    const result = await routeEmergency({
      buildingId: 'bldg-001',
      escalationPlans: TEST_PLANS,
      contactExecutor,
      clock: () => '2026-03-03T00:00:00Z',
    });

    expect(result.state).toBe('exhausted');
    expect(result.answered_by).toBeNull();
    expect(result.exhaustion_message).toBe('Unable to reach management. Call 911 if life-threatening.');
    expect(contactExecutor).toHaveBeenCalledTimes(3);
  });

  it('throws when no plan found for building', async () => {
    const contactExecutor = vi.fn();
    await expect(
      routeEmergency({
        buildingId: 'unknown-building',
        escalationPlans: TEST_PLANS,
        contactExecutor,
        clock: () => '2026-03-03T00:00:00Z',
      }),
    ).rejects.toThrow('No escalation plan found for building: unknown-building');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/risk/emergency-router.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// packages/core/src/risk/emergency-router.ts
import type {
  EscalationPlans,
  ContactChainEntry,
  EscalationAttempt,
  EscalationResult,
} from '@wo-agent/schemas';

/**
 * Contact executor port — dependency-injected function that attempts
 * to reach a contact. Returns true if answered, false if not.
 * In MVP, this is a mock. Production would make actual calls.
 */
export type ContactExecutor = (contact: ContactChainEntry) => Promise<boolean>;

export interface RouteEmergencyInput {
  readonly buildingId: string;
  readonly escalationPlans: EscalationPlans;
  readonly contactExecutor: ContactExecutor;
  readonly clock: () => string;
}

/**
 * Emergency router — call-until-answered through per-building chain (spec §1.6, §17).
 *
 * Deterministic behavior:
 * 1. Look up plan by building_id
 * 2. Iterate contact_chain in order
 * 3. Call contactExecutor for each; stop on first answer
 * 4. If chain exhausted: return exhaustion behavior
 * 5. Log every attempt (caller records events)
 */
export async function routeEmergency(input: RouteEmergencyInput): Promise<EscalationResult> {
  const { buildingId, escalationPlans, contactExecutor, clock } = input;

  const plan = escalationPlans.plans.find(p => p.building_id === buildingId);
  if (!plan) {
    throw new Error(`No escalation plan found for building: ${buildingId}`);
  }

  const attempts: EscalationAttempt[] = [];

  for (const contact of plan.contact_chain) {
    const answered = await contactExecutor(contact);
    attempts.push({
      contact_id: contact.contact_id,
      role: contact.role,
      name: contact.name,
      attempted_at: clock(),
      answered,
    });

    if (answered) {
      return {
        plan_id: plan.plan_id,
        state: 'completed',
        attempts,
        answered_by: contact,
        exhaustion_message: null,
      };
    }
  }

  // All contacts exhausted
  return {
    plan_id: plan.plan_id,
    state: 'exhausted',
    attempts,
    answered_by: null,
    exhaustion_message: plan.exhaustion_behavior.tenant_message_template,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/risk/emergency-router.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/risk/emergency-router.ts packages/core/src/__tests__/risk/emergency-router.test.ts
git commit -m "feat(core): emergency router — call-until-answered contact chain with exhaustion handling"
```

---

### Task 7: Risk Barrel Export + Add Dependencies to Orchestrator

**Files:**
- Create: `packages/core/src/risk/index.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/orchestrator/types.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/risk/barrel-export.test.ts
import { describe, it, expect } from 'vitest';
import {
  scanTextForTriggers,
  scanClassificationForTriggers,
  mergeRiskScanResults,
  resolveMitigationTemplate,
  renderMitigationMessages,
  buildRiskDetectedEvent,
  buildEscalationAttemptEvent,
  buildEscalationResultEvent,
  routeEmergency,
} from '../../risk/index.js';

describe('risk barrel export', () => {
  it('exports all risk module functions', () => {
    expect(scanTextForTriggers).toBeDefined();
    expect(scanClassificationForTriggers).toBeDefined();
    expect(mergeRiskScanResults).toBeDefined();
    expect(resolveMitigationTemplate).toBeDefined();
    expect(renderMitigationMessages).toBeDefined();
    expect(buildRiskDetectedEvent).toBeDefined();
    expect(buildEscalationAttemptEvent).toBeDefined();
    expect(buildEscalationResultEvent).toBeDefined();
    expect(routeEmergency).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/risk/barrel-export.test.ts`
Expected: FAIL

**Step 3: Create barrel export and wire dependencies**

```typescript
// packages/core/src/risk/index.ts
export {
  scanTextForTriggers,
  scanClassificationForTriggers,
  mergeRiskScanResults,
} from './trigger-scanner.js';

export {
  resolveMitigationTemplate,
  renderMitigationMessages,
} from './mitigation.js';

export {
  buildRiskDetectedEvent,
  buildEscalationAttemptEvent,
  buildEscalationResultEvent,
} from './event-builder.js';
export type {
  RiskEvent,
  RiskDetectedInput,
  EscalationAttemptInput,
  EscalationResultInput,
} from './event-builder.js';

export { routeEmergency } from './emergency-router.js';
export type { ContactExecutor, RouteEmergencyInput } from './emergency-router.js';
```

Add to `packages/core/src/index.ts`:

```typescript
// --- Risk (Phase 9) ---
export {
  scanTextForTriggers,
  scanClassificationForTriggers,
  mergeRiskScanResults,
  resolveMitigationTemplate,
  renderMitigationMessages,
  buildRiskDetectedEvent,
  buildEscalationAttemptEvent,
  buildEscalationResultEvent,
  routeEmergency,
} from './risk/index.js';
export type {
  RiskEvent,
  RiskDetectedInput,
  EscalationAttemptInput,
  EscalationResultInput,
  ContactExecutor,
  RouteEmergencyInput,
} from './risk/index.js';
```

Add to `OrchestratorDependencies` in `packages/core/src/orchestrator/types.ts`:

```typescript
import type { RiskProtocols, EscalationPlans } from '@wo-agent/schemas';
import type { ContactExecutor } from '../risk/emergency-router.js';

// Add these three fields to OrchestratorDependencies:
  readonly riskProtocols: RiskProtocols;
  readonly escalationPlans: EscalationPlans;
  readonly contactExecutor: ContactExecutor;
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/risk/barrel-export.test.ts`
Expected: PASS

**Step 5: Fix any existing tests broken by OrchestratorDependencies change**

All existing tests that construct `OrchestratorDependencies` will need the three new fields.
Add to every test helper that builds deps:

```typescript
riskProtocols: { version: '1.0.0', triggers: [], mitigation_templates: [] },
escalationPlans: { version: '1.0.0', plans: [] },
contactExecutor: async () => false,
```

Run: `cd packages/core && pnpm vitest run`
Expected: All tests pass

**Step 6: Commit**

```bash
git add packages/core/src/risk/index.ts packages/core/src/index.ts packages/core/src/orchestrator/types.ts packages/core/src/__tests__/risk/barrel-export.test.ts
# also add any test files updated with new deps fields
git commit -m "feat(core): risk barrel export + riskProtocols/escalationPlans/contactExecutor on OrchestratorDependencies"
```

---

### Task 8: Wire Risk Scanning into Submit-Initial-Message Handler

**Files:**
- Modify: `packages/core/src/orchestrator/action-handlers/submit-initial-message.ts`
- Create: `packages/core/src/__tests__/risk/submit-risk-scan.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/risk/submit-risk-scan.test.ts
import { describe, it, expect, vi } from 'vitest';
import { handleSubmitInitialMessage } from '../../orchestrator/action-handlers/submit-initial-message.js';
import { ConversationState, ActionType, ActorType } from '@wo-agent/schemas';
import type { ActionHandlerContext } from '../../orchestrator/types.js';
import { createSession } from '../../session/session.js';
import { InMemoryEventStore } from '../../events/in-memory-event-store.js';

function buildCtx(message: string, overrides?: Partial<ActionHandlerContext['deps']>): ActionHandlerContext {
  const session = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['unit-1'],
    pinned_versions: { taxonomy_version: '1', schema_version: '1', model_id: 'm', prompt_version: '1' },
  });

  return {
    session: { ...session, unit_id: 'unit-1' },
    request: {
      conversation_id: 'conv-1',
      action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT,
      tenant_input: { message },
      auth_context: { tenant_user_id: 'user-1', tenant_account_id: 'acct-1', authorized_unit_ids: ['unit-1'] },
    },
    deps: {
      eventRepo: new InMemoryEventStore(),
      sessionStore: { get: vi.fn(), getByTenantUser: vi.fn(), save: vi.fn() },
      idGenerator: () => `id-${Math.random()}`,
      clock: () => '2026-03-03T00:00:00Z',
      issueSplitter: vi.fn().mockResolvedValue({
        issue_count: 1,
        issues: [{ issue_id: 'iss-1', summary: 'Fire in kitchen', raw_excerpt: 'There is fire in my kitchen' }],
      }),
      issueClassifier: vi.fn(),
      followUpGenerator: vi.fn(),
      cueDict: { version: '1.0.0', fields: {} },
      taxonomy: { version: '1.0.0', fields: {} },
      unitResolver: { resolve: vi.fn() },
      workOrderRepo: { insertBatch: vi.fn(), getByIds: vi.fn() },
      idempotencyStore: { tryReserve: vi.fn(), complete: vi.fn() },
      riskProtocols: {
        version: '1.0.0',
        triggers: [{
          trigger_id: 'fire-001',
          name: 'Fire',
          grammar: { keyword_any: ['fire'], regex_any: [], taxonomy_path_any: [] },
          requires_confirmation: true,
          severity: 'emergency',
          mitigation_template_id: 'mit-fire',
        }],
        mitigation_templates: [{
          template_id: 'mit-fire',
          name: 'Fire Safety',
          message_template: 'If active fire, call 911.',
          safety_instructions: ['Call 911', 'Evacuate'],
        }],
      },
      escalationPlans: { version: '1.0.0', plans: [] },
      contactExecutor: vi.fn(),
      ...overrides,
    } as any,
  };
}

describe('submit-initial-message risk scanning', () => {
  it('includes mitigation message when emergency keyword detected', async () => {
    const ctx = buildCtx('There is fire in my kitchen');
    const result = await handleSubmitInitialMessage(ctx);

    // Normal split flow still works
    expect(result.newState).toBe(ConversationState.SPLIT_PROPOSED);

    // Mitigation message included
    const allContent = result.uiMessages.map(m => m.content).join(' ');
    expect(allContent).toContain('Fire Safety');
    expect(allContent).toContain('911');
  });

  it('stores risk triggers on session', async () => {
    const ctx = buildCtx('There is fire in my kitchen');
    const result = await handleSubmitInitialMessage(ctx);

    expect(result.session.risk_triggers).toHaveLength(1);
    expect(result.session.risk_triggers[0].trigger.trigger_id).toBe('fire-001');
  });

  it('records risk_detected event', async () => {
    const ctx = buildCtx('There is fire in my kitchen');
    await handleSubmitInitialMessage(ctx);

    const events = await ctx.deps.eventRepo.query({ conversation_id: 'conv-1' });
    const riskEvents = events.filter((e: any) => e.event_type === 'risk_detected');
    expect(riskEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('does NOT show mitigation for benign messages', async () => {
    const ctx = buildCtx('My faucet is dripping');
    const result = await handleSubmitInitialMessage(ctx);

    expect(result.newState).toBe(ConversationState.SPLIT_PROPOSED);
    expect(result.session.risk_triggers).toHaveLength(0);

    const allContent = result.uiMessages.map(m => m.content).join(' ');
    expect(allContent).not.toContain('Fire Safety');
  });

  it('includes emergency confirmation quick replies when requires_confirmation', async () => {
    const ctx = buildCtx('There is fire in my kitchen');
    const result = await handleSubmitInitialMessage(ctx);

    // Should have confirmation quick replies alongside normal ones
    const qrLabels = result.quickReplies?.map(qr => qr.label) ?? [];
    expect(qrLabels.some(l => l.toLowerCase().includes('emergency'))).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/risk/submit-risk-scan.test.ts`
Expected: FAIL — risk scanning not yet wired in

**Step 3: Wire risk scanning into handler**

Modify `packages/core/src/orchestrator/action-handlers/submit-initial-message.ts`:

After the successful split result is obtained (inside the `try` block, before the `return`):

```typescript
import { scanTextForTriggers } from '../../risk/trigger-scanner.js';
import { renderMitigationMessages } from '../../risk/mitigation.js';
import { buildRiskDetectedEvent } from '../../risk/event-builder.js';
import { setRiskTriggers, setEscalationState } from '../../session/session.js';

// ... inside try block, after setSplitIssues:

    // --- Risk scanning (spec §17, non-negotiable #7) ---
    const riskScan = scanTextForTriggers(input.message, deps.riskProtocols);
    let sessionAfterRisk = updatedSession;
    const additionalMessages: UIMessageInput[] = [];
    const additionalQuickReplies: QuickReplyInput[] = [];

    if (riskScan.triggers_matched.length > 0) {
      sessionAfterRisk = setRiskTriggers(updatedSession, riskScan.triggers_matched);

      // Record risk_detected event
      const riskEvent = buildRiskDetectedEvent({
        eventId: deps.idGenerator(),
        conversationId: session.conversation_id,
        triggersMatched: riskScan.triggers_matched,
        hasEmergency: riskScan.has_emergency,
        highestSeverity: riskScan.highest_severity,
        createdAt: deps.clock(),
      });
      await deps.eventRepo.insert(riskEvent);

      // Render mitigation messages
      const mitigationMessages = renderMitigationMessages(
        riskScan.triggers_matched,
        deps.riskProtocols,
      );
      for (const msg of mitigationMessages) {
        additionalMessages.push({ role: 'system', content: msg });
      }

      // If emergency requires confirmation, add quick replies
      const needsConfirmation = riskScan.triggers_matched.some(
        m => m.trigger.requires_confirmation && m.trigger.severity === 'emergency',
      );
      if (needsConfirmation) {
        sessionAfterRisk = setEscalationState(sessionAfterRisk, 'pending_confirmation');
        additionalQuickReplies.push(
          { label: 'Yes, this is an emergency', value: 'confirm_emergency' },
          { label: 'No, not an emergency', value: 'decline_emergency' },
        );
      }
    }

    // Use sessionAfterRisk instead of updatedSession in the return
```

Update the return statement to merge the additional messages and quick replies:

```typescript
    return {
      newState: ConversationState.SPLIT_PROPOSED,
      session: sessionAfterRisk,
      intermediateSteps: [intermediateStep],
      finalSystemAction: SystemEvent.LLM_SPLIT_SUCCESS,
      uiMessages: [
        ...additionalMessages,
        {
          role: 'agent',
          content: splitResult.issue_count === 1
            ? `I identified 1 issue:\n\n1. ${splitResult.issues[0].summary}\n\nPlease confirm or edit this issue.`
            : `I identified ${splitResult.issue_count} issues:\n\n${issueList}\n\nPlease confirm, edit, or merge these issues.`,
        },
      ],
      quickReplies: [
        ...additionalQuickReplies,
        { label: 'Confirm', value: 'confirm', action_type: 'CONFIRM_SPLIT' },
        { label: 'Reject (single issue)', value: 'reject', action_type: 'REJECT_SPLIT' },
      ],
      eventPayload: {
        split_result: splitResult,
        ...(riskScan.triggers_matched.length > 0 ? {
          risk_detected: true,
          risk_trigger_ids: riskScan.triggers_matched.map(t => t.trigger.trigger_id),
        } : {}),
      },
      eventType: 'state_transition',
    };
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/risk/submit-risk-scan.test.ts`
Expected: PASS

**Step 5: Run all tests to confirm no regressions**

Run: `cd packages/core && pnpm vitest run`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/core/src/orchestrator/action-handlers/submit-initial-message.ts packages/core/src/__tests__/risk/submit-risk-scan.test.ts
git commit -m "feat(core): wire risk scanning + mitigation rendering into SUBMIT_INITIAL_MESSAGE handler"
```

---

### Task 9: Wire Risk Flags into WO Creation

**Files:**
- Modify: `packages/core/src/work-order/wo-creator.ts`
- Create: `packages/core/src/__tests__/risk/wo-risk-flags.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/risk/wo-risk-flags.test.ts
import { describe, it, expect } from 'vitest';
import { createWorkOrders } from '../../work-order/wo-creator.js';
import { createSession, setRiskTriggers, setClassificationResults, setSplitIssues, setSessionScope } from '../../session/session.js';
import type { MatchedTrigger } from '@wo-agent/schemas';

describe('WO creation with risk flags', () => {
  const baseSession = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['unit-1'],
    pinned_versions: { taxonomy_version: '1', schema_version: '1', model_id: 'm', prompt_version: '1' },
  });

  function makeSession(withRisk: boolean) {
    let session = { ...baseSession, unit_id: 'unit-1' };
    session = setSessionScope(session, { property_id: 'prop-1', client_id: 'client-1' });
    session = setSplitIssues(session, [
      { issue_id: 'iss-1', summary: 'Fire in kitchen', raw_excerpt: 'There is fire' },
    ]);
    session = setClassificationResults(session, [{
      issue_id: 'iss-1',
      classifierOutput: { issue_id: 'iss-1', classification: {}, model_confidence: {}, missing_fields: [], needs_human_triage: false },
      computedConfidence: {},
      fieldsNeedingInput: [],
    }]);

    if (withRisk) {
      const triggers: MatchedTrigger[] = [{
        trigger: {
          trigger_id: 'fire-001', name: 'Fire',
          grammar: { keyword_any: [], regex_any: [], taxonomy_path_any: [] },
          requires_confirmation: true, severity: 'emergency', mitigation_template_id: 'mit-fire',
        },
        matched_keywords: ['fire'],
        matched_regex: [],
        matched_taxonomy_paths: [],
      }];
      session = setRiskTriggers(session, triggers);
    }

    return session;
  }

  it('populates risk_flags when risk triggers present', () => {
    const session = makeSession(true);
    const wos = createWorkOrders({
      session, idGenerator: () => `id-${Math.random()}`, clock: () => '2026-03-03T00:00:00Z',
    });

    expect(wos).toHaveLength(1);
    expect(wos[0].risk_flags).toBeDefined();
    expect(wos[0].risk_flags!.trigger_ids).toContain('fire-001');
    expect(wos[0].risk_flags!.highest_severity).toBe('emergency');
    expect(wos[0].risk_flags!.has_emergency).toBe(true);
  });

  it('omits risk_flags when no risk triggers', () => {
    const session = makeSession(false);
    const wos = createWorkOrders({
      session, idGenerator: () => `id-${Math.random()}`, clock: () => '2026-03-03T00:00:00Z',
    });

    expect(wos[0].risk_flags).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/risk/wo-risk-flags.test.ts`
Expected: FAIL

**Step 3: Wire risk flags into WO creator**

Modify `packages/core/src/work-order/wo-creator.ts`, inside the `map` callback where each WorkOrder is created, add after `needs_human_triage`:

```typescript
      ...(session.risk_triggers.length > 0 ? {
        risk_flags: {
          trigger_ids: session.risk_triggers.map(t => t.trigger.trigger_id),
          highest_severity: session.risk_triggers.reduce((worst, t) => {
            const rank: Record<string, number> = { emergency: 3, high: 2, medium: 1 };
            const tRank = rank[t.trigger.severity] ?? 0;
            const wRank = rank[worst] ?? 0;
            return tRank > wRank ? t.trigger.severity : worst;
          }, '' as string) || undefined,
          has_emergency: session.risk_triggers.some(t => t.trigger.severity === 'emergency'),
        },
      } : {}),
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/risk/wo-risk-flags.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/work-order/wo-creator.ts packages/core/src/__tests__/risk/wo-risk-flags.test.ts
git commit -m "feat(core): populate risk_flags on WorkOrders from session risk triggers"
```

---

### Task 10: Add Risk Data to Response Builder Snapshot

**Files:**
- Modify: `packages/schemas/src/types/orchestrator-action.ts` (ConversationSnapshot)
- Modify: `packages/core/src/orchestrator/response-builder.ts`
- Create: `packages/core/src/__tests__/risk/response-risk.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/risk/response-risk.test.ts
import { describe, it, expect } from 'vitest';
import { buildResponse } from '../../orchestrator/response-builder.js';
import { ConversationState } from '@wo-agent/schemas';
import { createSession, setRiskTriggers, setEscalationState } from '../../session/session.js';
import type { ActionHandlerResult } from '../../orchestrator/types.js';
import type { MatchedTrigger } from '@wo-agent/schemas';

describe('response builder risk data', () => {
  const baseSession = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['unit-1'],
    pinned_versions: { taxonomy_version: '1', schema_version: '1', model_id: 'm', prompt_version: '1' },
  });

  it('includes risk_summary in snapshot when triggers present', () => {
    const triggers: MatchedTrigger[] = [{
      trigger: {
        trigger_id: 'fire-001', name: 'Fire',
        grammar: { keyword_any: [], regex_any: [], taxonomy_path_any: [] },
        requires_confirmation: true, severity: 'emergency', mitigation_template_id: 'mit-fire',
      },
      matched_keywords: ['fire'],
      matched_regex: [],
      matched_taxonomy_paths: [],
    }];
    let session = setRiskTriggers(baseSession, triggers);
    session = setEscalationState(session, 'pending_confirmation');

    const result: ActionHandlerResult = {
      newState: ConversationState.SPLIT_PROPOSED,
      session,
      uiMessages: [{ role: 'agent', content: 'test' }],
    };

    const response = buildResponse(result);
    expect(response.conversation_snapshot.risk_summary).toBeDefined();
    expect(response.conversation_snapshot.risk_summary!.has_emergency).toBe(true);
    expect(response.conversation_snapshot.risk_summary!.trigger_ids).toContain('fire-001');
    expect(response.conversation_snapshot.risk_summary!.escalation_state).toBe('pending_confirmation');
  });

  it('omits risk_summary when no triggers', () => {
    const result: ActionHandlerResult = {
      newState: ConversationState.SPLIT_PROPOSED,
      session: baseSession,
      uiMessages: [{ role: 'agent', content: 'test' }],
    };

    const response = buildResponse(result);
    expect(response.conversation_snapshot.risk_summary).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/risk/response-risk.test.ts`
Expected: FAIL

**Step 3: Add risk_summary to ConversationSnapshot**

In `packages/schemas/src/types/orchestrator-action.ts`, add to `ConversationSnapshot`:

```typescript
  readonly risk_summary?: {
    readonly has_emergency: boolean;
    readonly highest_severity: string;
    readonly trigger_ids: readonly string[];
    readonly escalation_state: string;
  };
```

In `packages/core/src/orchestrator/response-builder.ts`, add risk summary:

```typescript
  const riskSummary =
    result.session.risk_triggers && result.session.risk_triggers.length > 0
      ? {
          has_emergency: result.session.risk_triggers.some(t => t.trigger.severity === 'emergency'),
          highest_severity: result.session.risk_triggers.reduce((worst: string, t) => {
            const rank: Record<string, number> = { emergency: 3, high: 2, medium: 1 };
            return (rank[t.trigger.severity] ?? 0) > (rank[worst] ?? 0)
              ? t.trigger.severity
              : worst;
          }, ''),
          trigger_ids: result.session.risk_triggers.map(t => t.trigger.trigger_id),
          escalation_state: result.session.escalation_state,
        }
      : undefined;

  // Add to snapshot:
  ...(riskSummary ? { risk_summary: riskSummary } : {}),
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/risk/response-risk.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/schemas/src/types/orchestrator-action.ts packages/core/src/orchestrator/response-builder.ts packages/core/src/__tests__/risk/response-risk.test.ts
git commit -m "feat(core): include risk_summary in ConversationSnapshot when triggers detected"
```

---

### Task 11: Integration Tests — Full Risk + Emergency Flow

**Files:**
- Create: `packages/core/src/__tests__/risk/risk-integration.test.ts`

**Step 1: Write the integration test**

```typescript
// packages/core/src/__tests__/risk/risk-integration.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createDispatcher } from '../../orchestrator/dispatcher.js';
import { InMemoryEventStore } from '../../events/in-memory-event-store.js';
import { InMemoryWorkOrderStore } from '../../work-order/in-memory-wo-store.js';
import { InMemoryIdempotencyStore } from '../../idempotency/in-memory-idempotency-store.js';
import { ActionType, ActorType, ConversationState, loadRiskProtocols } from '@wo-agent/schemas';

/**
 * Full integration test — message with emergency keyword flows through
 * risk scanning, mitigation display, split, classify, confirm, WO creation.
 */
describe('Risk + Emergency integration', () => {
  let counter = 0;
  const idGen = () => `id-${++counter}`;
  const clock = () => '2026-03-03T12:00:00Z';

  function makeDeps() {
    return {
      eventRepo: new InMemoryEventStore(),
      sessionStore: createInMemorySessionStore(),
      idGenerator: idGen,
      clock,
      issueSplitter: vi.fn().mockResolvedValue({
        issue_count: 1,
        issues: [{ issue_id: 'iss-1', summary: 'Fire in kitchen', raw_excerpt: 'There is fire in my kitchen' }],
      }),
      issueClassifier: vi.fn().mockResolvedValue({
        issue_id: 'iss-1',
        classification: { maintenance_category: 'safety', maintenance_subcategory: 'fire' },
        model_confidence: { maintenance_category: 0.95, maintenance_subcategory: 0.90 },
        missing_fields: [],
        needs_human_triage: false,
      }),
      followUpGenerator: vi.fn(),
      cueDict: { version: '1.0.0', fields: {} },
      taxonomy: { version: '1.0.0', fields: { maintenance_category: { values: ['safety'] } } },
      unitResolver: {
        resolve: vi.fn().mockResolvedValue({ property_id: 'prop-1', client_id: 'client-1', building_id: 'bldg-001' }),
      },
      workOrderRepo: new InMemoryWorkOrderStore(),
      idempotencyStore: new InMemoryIdempotencyStore(),
      riskProtocols: loadRiskProtocols(),
      escalationPlans: { version: '1.0.0', plans: [] },
      contactExecutor: vi.fn().mockResolvedValue(true),
    };
  }

  it('emergency keyword triggers mitigation in response', async () => {
    const deps = makeDeps();
    const dispatch = createDispatcher(deps);

    // 1. Create conversation
    const createResult = await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: { tenant_user_id: 'u1', tenant_account_id: 'a1', authorized_unit_ids: ['unit-1'] },
    });
    const convId = createResult.response.conversation_snapshot.conversation_id;

    // 2. Select unit
    await dispatch({
      conversation_id: convId,
      action_type: ActionType.SELECT_UNIT,
      actor: ActorType.TENANT,
      tenant_input: { unit_id: 'unit-1' },
      auth_context: { tenant_user_id: 'u1', tenant_account_id: 'a1', authorized_unit_ids: ['unit-1'] },
    });

    // 3. Submit message with emergency keyword
    const submitResult = await dispatch({
      conversation_id: convId,
      action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT,
      tenant_input: { message: 'There is fire in my kitchen and smoke everywhere' },
      auth_context: { tenant_user_id: 'u1', tenant_account_id: 'a1', authorized_unit_ids: ['unit-1'] },
    });

    // Risk mitigation should be in UI messages
    const messages = submitResult.response.ui_directive.messages ?? [];
    const allContent = messages.map(m => m.content).join(' ');
    expect(allContent).toContain('Fire Safety');
    expect(allContent).toContain('911');

    // Risk summary in snapshot
    expect(submitResult.response.conversation_snapshot.risk_summary).toBeDefined();
    expect(submitResult.response.conversation_snapshot.risk_summary!.has_emergency).toBe(true);
  });

  it('benign message has no risk data', async () => {
    const deps = makeDeps();
    deps.issueSplitter.mockResolvedValue({
      issue_count: 1,
      issues: [{ issue_id: 'iss-1', summary: 'Leaky faucet', raw_excerpt: 'My faucet is dripping' }],
    });
    const dispatch = createDispatcher(deps);

    const createResult = await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: { tenant_user_id: 'u1', tenant_account_id: 'a1', authorized_unit_ids: ['unit-1'] },
    });
    const convId = createResult.response.conversation_snapshot.conversation_id;

    await dispatch({
      conversation_id: convId,
      action_type: ActionType.SELECT_UNIT,
      actor: ActorType.TENANT,
      tenant_input: { unit_id: 'unit-1' },
      auth_context: { tenant_user_id: 'u1', tenant_account_id: 'a1', authorized_unit_ids: ['unit-1'] },
    });

    const submitResult = await dispatch({
      conversation_id: convId,
      action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT,
      tenant_input: { message: 'My faucet is dripping' },
      auth_context: { tenant_user_id: 'u1', tenant_account_id: 'a1', authorized_unit_ids: ['unit-1'] },
    });

    expect(submitResult.response.conversation_snapshot.risk_summary).toBeUndefined();
  });

  it('risk flags propagate to created WorkOrders', async () => {
    const deps = makeDeps();
    const dispatch = createDispatcher(deps);

    // Create → select unit → submit fire message → confirm split → classify → confirm submission
    const createResult = await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: { tenant_user_id: 'u1', tenant_account_id: 'a1', authorized_unit_ids: ['unit-1'] },
    });
    const convId = createResult.response.conversation_snapshot.conversation_id;

    await dispatch({
      conversation_id: convId,
      action_type: ActionType.SELECT_UNIT,
      actor: ActorType.TENANT,
      tenant_input: { unit_id: 'unit-1' },
      auth_context: { tenant_user_id: 'u1', tenant_account_id: 'a1', authorized_unit_ids: ['unit-1'] },
    });

    await dispatch({
      conversation_id: convId,
      action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT,
      tenant_input: { message: 'Gas leak in my apartment, I smell gas' },
      auth_context: { tenant_user_id: 'u1', tenant_account_id: 'a1', authorized_unit_ids: ['unit-1'] },
    });

    await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SPLIT,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: { tenant_user_id: 'u1', tenant_account_id: 'a1', authorized_unit_ids: ['unit-1'] },
    });

    // After classification + confirmation, submit
    const confirmResult = await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SUBMISSION,
      actor: ActorType.TENANT,
      tenant_input: {},
      idempotency_key: 'idem-1',
      auth_context: { tenant_user_id: 'u1', tenant_account_id: 'a1', authorized_unit_ids: ['unit-1'] },
    });

    // Check WOs in store have risk_flags
    const woIds = confirmResult.response.conversation_snapshot.work_order_ids ?? [];
    expect(woIds.length).toBeGreaterThan(0);

    const storedWos = await deps.workOrderRepo.getByIds(woIds as string[]);
    for (const wo of storedWos) {
      expect(wo.risk_flags).toBeDefined();
      expect(wo.risk_flags!.has_emergency).toBe(true);
    }
  });
});

// Minimal in-memory session store for integration tests
function createInMemorySessionStore() {
  const store = new Map<string, any>();
  return {
    get: async (id: string) => store.get(id) ?? null,
    getByTenantUser: async (userId: string) => [...store.values()].filter(s => s.tenant_user_id === userId),
    save: async (session: any) => { store.set(session.conversation_id, session); },
  };
}
```

**Step 2: Run test**

Run: `cd packages/core && pnpm vitest run src/__tests__/risk/risk-integration.test.ts`
Expected: PASS (if all prior tasks are implemented correctly)

**Note:** The integration test may need adjustments based on how the `InMemoryWorkOrderStore.getByIds` method is implemented. Check the existing `in-memory-wo-store.ts` and adapt if needed. The test's `createInMemorySessionStore` also follows the pattern used in existing integration tests — check `packages/core/src/__tests__/orchestrator-integration.test.ts` for the canonical version and use that instead if it differs.

**Step 3: Commit**

```bash
git add packages/core/src/__tests__/risk/risk-integration.test.ts
git commit -m "test(core): integration tests — risk scanning, mitigation display, WO risk flag propagation"
```

---

### Task 12: TypeScript Cleanup + Full Validation Pass

**Files:**
- Potentially modify: any files with type errors

**Step 1: Run TypeScript check**

Run: `cd packages/core && pnpm tsc --noEmit`
Expected: 0 errors

**Step 2: Run ALL tests**

Run: `cd packages/core && pnpm vitest run`
Expected: All tests pass

**Step 3: Run schema tests**

Run: `cd packages/schemas && pnpm vitest run`
Expected: All tests pass

**Step 4: Fix any issues found**

Address any type errors, test failures, or missing exports.

**Step 5: Commit**

```bash
git add -A
git commit -m "chore(core): Task 12 — TypeScript cleanup and full validation pass (phase 9)"
```

---

## Acceptance Criteria

1. `scanTextForTriggers` matches keywords (case-insensitive) and regex from `risk_protocols.json`
2. `scanClassificationForTriggers` matches taxonomy_path_any from classification output
3. Mitigation templates render safety messages with instructions for matched triggers
4. Emergency router iterates per-building contact chain, stops on first answer, handles exhaustion
5. All risk activity recorded as append-only `risk_events` (INSERT only, no UPDATE/DELETE)
6. Risk triggers stored on `ConversationSession` and surfaced in `ConversationSnapshot.risk_summary`
7. Work Orders created with `risk_flags` populated from session triggers
8. Emergency confirmation quick replies shown when `requires_confirmation` is true on emergency triggers
9. Non-emergency messages produce no risk data
10. All existing tests still pass — no regressions
