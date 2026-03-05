# Phase 5: Classifier + classification_cues.json + Category Gating Retry + Confidence Heuristic + Tests

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:executing-plans to implement this plan task-by-task.

**Goal:** Implement the IssueClassifier LLM tool with cue-dictionary scoring, the confidence heuristic (spec 14.3), category gating retry logic (spec 5.3), and wire it into the orchestrator so that `split_finalized` triggers classification with full validation pipeline.

**Architecture:** The IssueClassifier is injected into the orchestrator as a dependency (`OrchestratorDependencies.issueClassifier`). When split is finalized, the dispatcher fires `START_CLASSIFICATION` which transitions to `classification_in_progress`. A `handleStartClassification` handler loops over each finalized issue: (1) computes cue scores from `classification_cues.json`, (2) calls the classifier LLM, (3) validates output (schema + taxonomy + category gating), (4) computes per-field confidence via the heuristic, (5) determines which fields need tenant input. The handler transitions to `needs_tenant_input` or `tenant_confirmation_pending` based on whether any fields fall below confidence thresholds. Re-entry from `ANSWER_FOLLOWUPS` re-classifies with enriched input.

**Tech Stack:** TypeScript, Vitest, Ajv (JSON Schema validation), `@wo-agent/schemas` validators

**Prerequisite:** Phase 4 splitter must be merged. This plan branches from `feature/phase-04-splitter`.

**Spec references:** 2 (non-negotiables), 5.3 (category gating), 10 (orchestrator contract), 11.2 (transition matrix), 14 (classification, cues, confidence)

**Skills that apply during execution:**
- `@test-driven-development` -- every task follows red-green-refactor
- `@state-machine-implementation` -- any state transition changes
- `@schema-first-development` -- all model outputs validated
- `@llm-tool-contracts` -- IssueClassifier schema-lock, retry logic, confidence heuristic, cue dictionary
- `@append-only-events` -- event table writes
- `@project-conventions` -- naming, structure, commands

---

## Task 0: Create worktree and branch from Phase 4

**Files:**
- N/A (git operations only)

**Step 1: Create worktree branching from Phase 4 splitter**

```bash
cd /workspaces/MAINTENANCE
git worktree add .worktrees/phase-05-classifier feature/phase-04-splitter -b feature/phase-05-classifier
```

**Step 2: Verify the worktree has Phase 4 code**

```bash
ls .worktrees/phase-05-classifier/packages/core/src/splitter/
```

Expected: `issue-splitter.ts`, `input-sanitizer.ts`, `index.ts`

**Step 3: Install dependencies**

```bash
cd .worktrees/phase-05-classifier && pnpm install
```

**Step 4: Run existing tests to confirm green baseline**

```bash
pnpm -r test
```

Expected: All tests pass.

**Step 5: Commit -- no code changes, just branch creation**

No commit needed -- branch created from Phase 4 HEAD.

---

## Task 1: Implement cue-scoring function

**Files:**
- Create: `packages/core/src/classifier/cue-scoring.ts`
- Test: `packages/core/src/__tests__/classifier/cue-scoring.test.ts`

**Context:** The cue-scoring function is the first building block. It takes issue text and the cue dictionary, then computes per-field `cue_strength` scores (0..1) and identifies the top-scoring label per field. This is pure deterministic code -- no LLM involved. The cue dictionary already exists at `packages/schemas/classification_cues.json` and has been validated by `cue-dictionary-validator.ts`.

**Spec reference:** 14.4 -- "keyword hits and regex matches contribute to a normalized 0..1 score per candidate label; take the top score for cue_strength."

**Step 1: Write the failing test**

Create `packages/core/src/__tests__/classifier/cue-scoring.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeCueScores, computeCueStrengthForField } from '../../classifier/cue-scoring.js';
import type { CueDictionary } from '@wo-agent/schemas';

const MINI_CUES: CueDictionary = {
  version: '1.0.0',
  fields: {
    Maintenance_Category: {
      plumbing: { keywords: ['leak', 'toilet', 'sink', 'drain', 'pipe'], regex: [] },
      electrical: { keywords: ['breaker', 'outlet', 'switch', 'sparks', 'power'], regex: [] },
      hvac: { keywords: ['heat', 'ac', 'furnace', 'thermostat'], regex: [] },
    },
    Maintenance_Object: {
      toilet: { keywords: ['toilet', 'wc', 'commode'], regex: [] },
      sink: { keywords: ['sink', 'basin'], regex: [] },
    },
  },
};

describe('computeCueStrengthForField', () => {
  it('returns 0 when no cues match', () => {
    const result = computeCueStrengthForField('my cat is cute', 'Maintenance_Category', MINI_CUES);
    expect(result.score).toBe(0);
    expect(result.topLabel).toBeNull();
  });

  it('returns normalized score for keyword hits', () => {
    const result = computeCueStrengthForField('my toilet is leaking water from the pipe', 'Maintenance_Category', MINI_CUES);
    // plumbing: leak(1) + toilet(1) + pipe(1) = 3/5 = 0.6
    expect(result.score).toBeCloseTo(0.6);
    expect(result.topLabel).toBe('plumbing');
  });

  it('returns top label when multiple labels match', () => {
    const result = computeCueStrengthForField('the outlet sparks when I plug in the toilet', 'Maintenance_Category', MINI_CUES);
    // plumbing: toilet(1) = 1/5 = 0.2
    // electrical: outlet(1) + sparks(1) = 2/5 = 0.4
    expect(result.topLabel).toBe('electrical');
    expect(result.score).toBeCloseTo(0.4);
  });

  it('returns 0 for a field not in cue dictionary', () => {
    const result = computeCueStrengthForField('toilet leak', 'Location', MINI_CUES);
    expect(result.score).toBe(0);
    expect(result.topLabel).toBeNull();
  });

  it('is case-insensitive for keyword matching', () => {
    const result = computeCueStrengthForField('TOILET LEAK', 'Maintenance_Category', MINI_CUES);
    expect(result.score).toBeGreaterThan(0);
    expect(result.topLabel).toBe('plumbing');
  });

  it('supports regex patterns', () => {
    const cues: CueDictionary = {
      version: '1.0.0',
      fields: {
        Maintenance_Problem: {
          leak: { keywords: [], regex: ['\\bleak(s|ing|ed)?\\b'] },
        },
      },
    };
    const result = computeCueStrengthForField('the faucet is leaking badly', 'Maintenance_Problem', cues);
    expect(result.score).toBe(1.0);
    expect(result.topLabel).toBe('leak');
  });

  it('handles regex errors gracefully', () => {
    const cues: CueDictionary = {
      version: '1.0.0',
      fields: {
        Maintenance_Problem: {
          leak: { keywords: ['leak'], regex: ['[invalid('] },
        },
      },
    };
    // Should not throw, regex error is skipped
    const result = computeCueStrengthForField('there is a leak', 'Maintenance_Problem', cues);
    expect(result.score).toBeCloseTo(0.5); // 1 keyword hit / 2 total cues
  });
});

describe('computeCueScores', () => {
  it('returns cue_strength and topLabel for all cue dictionary fields', () => {
    const result = computeCueScores('my toilet is leaking', MINI_CUES);
    expect(result.Maintenance_Category.score).toBeGreaterThan(0);
    expect(result.Maintenance_Category.topLabel).toBe('plumbing');
    expect(result.Maintenance_Object.score).toBeGreaterThan(0);
    expect(result.Maintenance_Object.topLabel).toBe('toilet');
  });

  it('returns empty object when text matches nothing', () => {
    const result = computeCueScores('hello world', MINI_CUES);
    expect(result.Maintenance_Category.score).toBe(0);
    expect(result.Maintenance_Object.score).toBe(0);
  });

  it('computes ambiguity when top-2 scores are close', () => {
    // Both plumbing and electrical get similar hits
    const result = computeCueScores('the pipe outlet is leaking sparks', MINI_CUES);
    // plumbing: leak(1) + pipe(1) = 2/5 = 0.4
    // electrical: outlet(1) + sparks(1) = 2/5 = 0.4
    expect(result.Maintenance_Category.ambiguity).toBeGreaterThan(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/classifier/cue-scoring.test.ts`
Expected: FAIL -- module not found

**Step 3: Write minimal implementation**

Create `packages/core/src/classifier/cue-scoring.ts`:

```typescript
import type { CueDictionary } from '@wo-agent/schemas';

export interface CueFieldResult {
  /** Top cue_strength score across all candidate labels for this field (0..1) */
  readonly score: number;
  /** The label that scored highest, or null if no matches */
  readonly topLabel: string | null;
  /** Ambiguity: how close the top-2 labels are in score (0..1, higher = more ambiguous) */
  readonly ambiguity: number;
  /** All label scores for disagreement detection */
  readonly labelScores: ReadonlyArray<{ label: string; score: number }>;
}

export type CueScoreMap = Record<string, CueFieldResult>;

/**
 * Compute cue_strength for a single taxonomy field (spec 14.4).
 * Keyword hits and regex matches contribute to a normalized 0..1 score
 * per candidate label; the top score becomes cue_strength.
 */
export function computeCueStrengthForField(
  text: string,
  fieldName: string,
  cueDict: CueDictionary,
): CueFieldResult {
  const fieldCues = cueDict.fields[fieldName];
  if (!fieldCues) {
    return { score: 0, topLabel: null, ambiguity: 0, labelScores: [] };
  }

  const scores: Array<{ label: string; score: number }> = [];
  const lowerText = text.toLowerCase();

  for (const [label, cues] of Object.entries(fieldCues)) {
    const totalCues = cues.keywords.length + cues.regex.length;
    if (totalCues === 0) continue;

    let hits = 0;

    // Keyword hits (case-insensitive)
    for (const keyword of cues.keywords) {
      if (lowerText.includes(keyword.toLowerCase())) hits++;
    }

    // Regex hits (case-insensitive, skip invalid patterns)
    for (const pattern of cues.regex) {
      try {
        if (new RegExp(pattern, 'i').test(text)) hits++;
      } catch {
        // Invalid regex pattern -- skip silently
      }
    }

    scores.push({ label, score: hits / totalCues });
  }

  if (scores.length === 0) {
    return { score: 0, topLabel: null, ambiguity: 0, labelScores: [] };
  }

  // Sort descending by score
  scores.sort((a, b) => b.score - a.score);

  const topScore = scores[0].score;
  const topLabel = topScore > 0 ? scores[0].label : null;

  // Ambiguity: how close the top-2 scores are (1.0 = identical, 0.0 = no second candidate)
  let ambiguity = 0;
  if (scores.length >= 2 && topScore > 0) {
    const secondScore = scores[1].score;
    // If top and second are both > 0 and close together, high ambiguity
    ambiguity = secondScore > 0 ? 1 - (topScore - secondScore) / topScore : 0;
  }

  return { score: topScore, topLabel, ambiguity, labelScores: scores };
}

/**
 * Compute cue scores for ALL fields in the cue dictionary (spec 14.4).
 * Returns a map of field name to CueFieldResult.
 */
export function computeCueScores(text: string, cueDict: CueDictionary): CueScoreMap {
  const result: Record<string, CueFieldResult> = {};

  for (const fieldName of Object.keys(cueDict.fields)) {
    result[fieldName] = computeCueStrengthForField(text, fieldName, cueDict);
  }

  return result;
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/classifier/cue-scoring.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `pnpm -r test`
Expected: All pass.

**Step 6: Commit**

```bash
git add packages/core/src/classifier/cue-scoring.ts packages/core/src/__tests__/classifier/cue-scoring.test.ts
git commit -m "feat(core): add cue-scoring function for classification_cues.json"
```

---

## Task 2: Implement confidence heuristic

**Files:**
- Create: `packages/core/src/classifier/confidence.ts`
- Test: `packages/core/src/__tests__/classifier/confidence.test.ts`

**Context:** The confidence heuristic is pure deterministic code that blends cue_strength, completeness, model_hint, disagreement, and ambiguity_penalty into a per-field confidence score. It uses `DEFAULT_CONFIDENCE_CONFIG` from `@wo-agent/schemas`. This is computed AFTER the classifier output passes validation -- it never runs inside the LLM.

**Spec reference:** 14.3 -- `conf = clamp01(0.40*cue_strength + 0.25*completeness + 0.20*model_hint - 0.10*disagreement - 0.05*ambiguity_penalty)`. Model hint clamped to [0.2, 0.95].

**Step 1: Write the failing test**

Create `packages/core/src/__tests__/classifier/confidence.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  computeFieldConfidence,
  computeAllFieldConfidences,
  classifyConfidenceBand,
  determineFieldsNeedingInput,
} from '../../classifier/confidence.js';
import { DEFAULT_CONFIDENCE_CONFIG } from '@wo-agent/schemas';
import type { CueFieldResult } from '../../classifier/cue-scoring.js';

describe('computeFieldConfidence', () => {
  const config = DEFAULT_CONFIDENCE_CONFIG;

  it('computes confidence using the formula from spec 14.3', () => {
    const result = computeFieldConfidence({
      cueStrength: 0.8,
      completeness: 1.0,
      modelHint: 0.9,
      disagreement: 0,
      ambiguityPenalty: 0,
      config,
    });
    // 0.40*0.8 + 0.25*1.0 + 0.20*0.9 - 0.10*0 - 0.05*0
    // = 0.32 + 0.25 + 0.18 = 0.75
    expect(result).toBeCloseTo(0.75);
  });

  it('clamps model hint to [0.2, 0.95]', () => {
    // Model hint 1.0 should be clamped to 0.95
    const highHint = computeFieldConfidence({
      cueStrength: 0.5,
      completeness: 0.5,
      modelHint: 1.0,
      disagreement: 0,
      ambiguityPenalty: 0,
      config,
    });
    // 0.40*0.5 + 0.25*0.5 + 0.20*0.95 = 0.20 + 0.125 + 0.19 = 0.515
    expect(highHint).toBeCloseTo(0.515);

    // Model hint 0.0 should be clamped to 0.2
    const lowHint = computeFieldConfidence({
      cueStrength: 0.5,
      completeness: 0.5,
      modelHint: 0.0,
      disagreement: 0,
      ambiguityPenalty: 0,
      config,
    });
    // 0.40*0.5 + 0.25*0.5 + 0.20*0.2 = 0.20 + 0.125 + 0.04 = 0.365
    expect(lowHint).toBeCloseTo(0.365);
  });

  it('subtracts disagreement penalty', () => {
    const noDisagree = computeFieldConfidence({
      cueStrength: 0.8,
      completeness: 1.0,
      modelHint: 0.9,
      disagreement: 0,
      ambiguityPenalty: 0,
      config,
    });
    const withDisagree = computeFieldConfidence({
      cueStrength: 0.8,
      completeness: 1.0,
      modelHint: 0.9,
      disagreement: 1,
      ambiguityPenalty: 0,
      config,
    });
    expect(withDisagree).toBeCloseTo(noDisagree - 0.10);
  });

  it('subtracts ambiguity penalty', () => {
    const noAmbiguity = computeFieldConfidence({
      cueStrength: 0.8,
      completeness: 1.0,
      modelHint: 0.9,
      disagreement: 0,
      ambiguityPenalty: 0,
      config,
    });
    const withAmbiguity = computeFieldConfidence({
      cueStrength: 0.8,
      completeness: 1.0,
      modelHint: 0.9,
      disagreement: 0,
      ambiguityPenalty: 0.8,
      config,
    });
    expect(withAmbiguity).toBeCloseTo(noAmbiguity - 0.05 * 0.8);
  });

  it('clamps result to [0, 1]', () => {
    const tooLow = computeFieldConfidence({
      cueStrength: 0,
      completeness: 0,
      modelHint: 0,
      disagreement: 1,
      ambiguityPenalty: 1,
      config,
    });
    expect(tooLow).toBeGreaterThanOrEqual(0);

    const tooHigh = computeFieldConfidence({
      cueStrength: 1,
      completeness: 1,
      modelHint: 1,
      disagreement: 0,
      ambiguityPenalty: 0,
      config,
    });
    expect(tooHigh).toBeLessThanOrEqual(1);
  });
});

describe('classifyConfidenceBand', () => {
  const config = DEFAULT_CONFIDENCE_CONFIG;

  it('returns high for >= 0.85', () => {
    expect(classifyConfidenceBand(0.85, config)).toBe('high');
    expect(classifyConfidenceBand(0.95, config)).toBe('high');
  });

  it('returns medium for 0.65-0.84', () => {
    expect(classifyConfidenceBand(0.65, config)).toBe('medium');
    expect(classifyConfidenceBand(0.84, config)).toBe('medium');
  });

  it('returns low for < 0.65', () => {
    expect(classifyConfidenceBand(0.64, config)).toBe('low');
    expect(classifyConfidenceBand(0.0, config)).toBe('low');
  });
});

describe('determineFieldsNeedingInput', () => {
  it('includes low-confidence fields', () => {
    const confidences = { Category: 0.9, Maintenance_Category: 0.5 };
    const result = determineFieldsNeedingInput(confidences, DEFAULT_CONFIDENCE_CONFIG);
    expect(result).toContain('Maintenance_Category');
    expect(result).not.toContain('Category');
  });

  it('returns empty array when all fields are high confidence', () => {
    const confidences = { Category: 0.9, Maintenance_Category: 0.88 };
    const result = determineFieldsNeedingInput(confidences, DEFAULT_CONFIDENCE_CONFIG);
    expect(result).toEqual([]);
  });

  it('includes medium-confidence fields', () => {
    // Medium fields are asked if required or risk-relevant (always ask in MVP)
    const confidences = { Category: 0.9, Maintenance_Category: 0.7 };
    const result = determineFieldsNeedingInput(confidences, DEFAULT_CONFIDENCE_CONFIG);
    expect(result).toContain('Maintenance_Category');
  });
});

describe('computeAllFieldConfidences', () => {
  it('computes confidence for all classified fields', () => {
    const classification = { Category: 'maintenance', Maintenance_Category: 'plumbing' };
    const modelConfidence = { Category: 0.95, Maintenance_Category: 0.8 };
    const cueResults: Record<string, CueFieldResult> = {
      Maintenance_Category: {
        score: 0.6,
        topLabel: 'plumbing',
        ambiguity: 0.2,
        labelScores: [{ label: 'plumbing', score: 0.6 }],
      },
    };

    const result = computeAllFieldConfidences({
      classification,
      modelConfidence,
      cueResults,
      config: DEFAULT_CONFIDENCE_CONFIG,
    });

    expect(result.Category).toBeGreaterThan(0);
    expect(result.Maintenance_Category).toBeGreaterThan(0);
  });

  it('sets disagreement=1 when cue top label differs from model label', () => {
    const classification = { Maintenance_Category: 'electrical' };
    const modelConfidence = { Maintenance_Category: 0.8 };
    const cueResults: Record<string, CueFieldResult> = {
      Maintenance_Category: {
        score: 0.6,
        topLabel: 'plumbing', // disagrees with model's "electrical"
        ambiguity: 0,
        labelScores: [{ label: 'plumbing', score: 0.6 }],
      },
    };

    const agreeResult = computeAllFieldConfidences({
      classification: { Maintenance_Category: 'plumbing' },
      modelConfidence: { Maintenance_Category: 0.8 },
      cueResults,
      config: DEFAULT_CONFIDENCE_CONFIG,
    });

    const disagreeResult = computeAllFieldConfidences({
      classification,
      modelConfidence,
      cueResults,
      config: DEFAULT_CONFIDENCE_CONFIG,
    });

    // Disagreement should lower confidence
    expect(disagreeResult.Maintenance_Category).toBeLessThan(agreeResult.Maintenance_Category);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/classifier/confidence.test.ts`
Expected: FAIL -- module not found

**Step 3: Write minimal implementation**

Create `packages/core/src/classifier/confidence.ts`:

```typescript
import type { ConfidenceConfig } from '@wo-agent/schemas';
import type { CueFieldResult } from './cue-scoring.js';

export type ConfidenceBand = 'high' | 'medium' | 'low';

export interface FieldConfidenceInput {
  readonly cueStrength: number;
  readonly completeness: number;
  readonly modelHint: number;
  readonly disagreement: number;      // 0 or 1
  readonly ambiguityPenalty: number;   // 0..1
  readonly config: ConfidenceConfig;
}

export interface ComputeAllInput {
  readonly classification: Record<string, string>;
  readonly modelConfidence: Record<string, number>;
  readonly cueResults: Record<string, CueFieldResult>;
  readonly config: ConfidenceConfig;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Compute per-field confidence using the spec 14.3 formula.
 * conf = clamp01(0.40*cue_strength + 0.25*completeness + 0.20*model_hint
 *               - 0.10*disagreement - 0.05*ambiguity_penalty)
 * Model hint is clamped to [0.2, 0.95] before use.
 */
export function computeFieldConfidence(input: FieldConfidenceInput): number {
  const { cueStrength, completeness, modelHint, disagreement, ambiguityPenalty, config } = input;

  // Clamp model hint (spec 14.3: "Model hint clamped to [0.2, 0.95] and scaled")
  const clampedHint = Math.max(config.model_hint_min, Math.min(config.model_hint_max, modelHint));

  const raw =
    config.weights.cue_strength * cueStrength +
    config.weights.completeness * completeness +
    config.weights.model_hint * clampedHint -
    config.weights.disagreement * disagreement -
    config.weights.ambiguity_penalty * ambiguityPenalty;

  return clamp01(raw);
}

/**
 * Classify a confidence score into high/medium/low bands (spec 14.3).
 */
export function classifyConfidenceBand(confidence: number, config: ConfidenceConfig): ConfidenceBand {
  if (confidence >= config.high_threshold) return 'high';
  if (confidence >= config.medium_threshold) return 'medium';
  return 'low';
}

/**
 * Compute confidence for all classified fields, using cue results and model output.
 */
export function computeAllFieldConfidences(input: ComputeAllInput): Record<string, number> {
  const { classification, modelConfidence, cueResults, config } = input;
  const result: Record<string, number> = {};

  for (const field of Object.keys(classification)) {
    const cueResult = cueResults[field];
    const rawModelHint = modelConfidence[field] ?? 0;
    const modelLabel = classification[field];

    // cue_strength: top score from cue dictionary for this field
    const cueStrength = cueResult?.score ?? 0;

    // completeness: 1.0 if model provided a classification, 0 otherwise
    // (enriched in follow-up rounds when answers fill gaps)
    const completeness = modelLabel ? 1.0 : 0;

    // disagreement: 1 if cue top label differs from model's chosen label
    const disagreement =
      cueResult?.topLabel != null && cueResult.topLabel !== modelLabel ? 1 : 0;

    // ambiguity_penalty: from cue scoring (how close top-2 labels are)
    const ambiguityPenalty = cueResult?.ambiguity ?? 0;

    result[field] = computeFieldConfidence({
      cueStrength,
      completeness,
      modelHint: rawModelHint,
      disagreement,
      ambiguityPenalty,
      config,
    });
  }

  return result;
}

/**
 * Determine which fields need tenant input based on confidence bands.
 * Low-confidence fields always need input.
 * Medium-confidence fields need input (asked if required/risk-relevant -- MVP asks all).
 * High-confidence fields are accepted.
 */
export function determineFieldsNeedingInput(
  confidences: Record<string, number>,
  config: ConfidenceConfig,
): string[] {
  const fields: string[] = [];

  for (const [field, confidence] of Object.entries(confidences)) {
    const band = classifyConfidenceBand(confidence, config);
    if (band === 'low' || band === 'medium') {
      fields.push(field);
    }
  }

  return fields;
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/classifier/confidence.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `pnpm -r test`
Expected: All pass.

**Step 6: Commit**

```bash
git add packages/core/src/classifier/confidence.ts packages/core/src/__tests__/classifier/confidence.test.ts
git commit -m "feat(core): add confidence heuristic (spec 14.3)"
```

---

## Task 3: Implement IssueClassifier wrapper with schema validation, category gating retry, and error handling

**Files:**
- Create: `packages/core/src/classifier/issue-classifier.ts`
- Test: `packages/core/src/__tests__/classifier/issue-classifier.test.ts`

**Context:** This wraps the raw LLM call with the full validation pipeline from the llm-tool-contracts skill: JSON parse -> schema validate -> taxonomy domain validate -> category gating check -> accept or retry -> fail safe. It follows the same pattern as `callIssueSplitter` in `packages/core/src/splitter/issue-splitter.ts` but adds: (1) taxonomy cross-validation via `validateClassificationAgainstTaxonomy`, (2) category gating retry with hard constraint, (3) `needs_human_triage` escape hatch when gating retry fails.

**Spec references:** 5.3 (category gating), 14.2 (category gating error path), llm-tool-contracts skill (validation pipeline, retry logic)

**Step 1: Write the failing test**

Create `packages/core/src/__tests__/classifier/issue-classifier.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import {
  callIssueClassifier,
  ClassifierError,
  ClassifierErrorCode,
} from '../../classifier/issue-classifier.js';
import type { IssueClassifierInput, IssueClassifierOutput } from '@wo-agent/schemas';
import { loadTaxonomy } from '@wo-agent/schemas';

const taxonomy = loadTaxonomy();

const VALID_INPUT: IssueClassifierInput = {
  issue_id: 'issue-1',
  issue_summary: 'Toilet is leaking',
  raw_excerpt: 'My toilet is leaking water onto the floor',
  taxonomy_version: '1.0.0',
  model_id: 'test-model',
  prompt_version: '1.0.0',
};

const VALID_OUTPUT: IssueClassifierOutput = {
  issue_id: 'issue-1',
  classification: {
    Category: 'maintenance',
    Location: 'suite',
    Sub_Location: 'bathroom',
    Maintenance_Category: 'plumbing',
    Maintenance_Object: 'toilet',
    Maintenance_Problem: 'leak',
    Management_Category: 'other_mgmt_cat',
    Management_Object: 'other_mgmt_obj',
    Priority: 'normal',
  },
  model_confidence: {
    Category: 0.95,
    Location: 0.9,
    Sub_Location: 0.85,
    Maintenance_Category: 0.92,
    Maintenance_Object: 0.95,
    Maintenance_Problem: 0.88,
    Management_Category: 0.0,
    Management_Object: 0.0,
    Priority: 0.7,
  },
  missing_fields: [],
  needs_human_triage: false,
};

describe('callIssueClassifier', () => {
  it('returns valid output on first attempt', async () => {
    const llmCall = vi.fn().mockResolvedValue(VALID_OUTPUT);
    const result = await callIssueClassifier(VALID_INPUT, llmCall, taxonomy);
    expect(result.status).toBe('ok');
    expect(result.output!.issue_id).toBe('issue-1');
    expect(llmCall).toHaveBeenCalledTimes(1);
  });

  it('retries once on schema validation failure then succeeds', async () => {
    const badOutput = { ...VALID_OUTPUT, issue_id: undefined }; // missing required field
    const llmCall = vi.fn()
      .mockResolvedValueOnce(badOutput)
      .mockResolvedValueOnce(VALID_OUTPUT);
    const result = await callIssueClassifier(VALID_INPUT, llmCall, taxonomy);
    expect(result.status).toBe('ok');
    expect(llmCall).toHaveBeenCalledTimes(2);
  });

  it('returns llm_fail after two schema validation failures', async () => {
    const badOutput = { ...VALID_OUTPUT, issue_id: undefined };
    const llmCall = vi.fn().mockResolvedValue(badOutput);
    const result = await callIssueClassifier(VALID_INPUT, llmCall, taxonomy);
    expect(result.status).toBe('llm_fail');
    expect(llmCall).toHaveBeenCalledTimes(2);
  });

  it('throws ClassifierError on LLM call exception', async () => {
    const llmCall = vi.fn().mockRejectedValue(new Error('LLM timeout'));
    await expect(callIssueClassifier(VALID_INPUT, llmCall, taxonomy)).rejects.toThrow(ClassifierError);
  });

  it('detects category gating contradiction and retries with constraint', async () => {
    const contradictory: IssueClassifierOutput = {
      ...VALID_OUTPUT,
      classification: {
        ...VALID_OUTPUT.classification,
        Category: 'management',
        // But has populated maintenance fields -- contradictory!
        Maintenance_Category: 'plumbing',
        Maintenance_Object: 'toilet',
      },
    };
    const fixed: IssueClassifierOutput = {
      ...VALID_OUTPUT,
      classification: {
        ...VALID_OUTPUT.classification,
        Category: 'management',
        Maintenance_Category: 'other_maintenance_category',
        Maintenance_Object: 'other_maintenance_object',
        Maintenance_Problem: 'other_problem',
        Management_Category: 'accounting',
        Management_Object: 'rent_charges',
      },
    };
    const llmCall = vi.fn()
      .mockResolvedValueOnce(contradictory)
      .mockResolvedValueOnce(fixed);
    const result = await callIssueClassifier(VALID_INPUT, llmCall, taxonomy);
    expect(result.status).toBe('ok');
    expect(llmCall).toHaveBeenCalledTimes(2);
  });

  it('sets needs_human_triage when gating retry still contradictory', async () => {
    const contradictory: IssueClassifierOutput = {
      ...VALID_OUTPUT,
      classification: {
        ...VALID_OUTPUT.classification,
        Category: 'management',
        Maintenance_Category: 'plumbing',
      },
    };
    const llmCall = vi.fn().mockResolvedValue(contradictory);
    const result = await callIssueClassifier(VALID_INPUT, llmCall, taxonomy);
    expect(result.status).toBe('needs_human_triage');
    expect(result.conflicting).toHaveLength(2);
    expect(llmCall).toHaveBeenCalledTimes(2);
  });

  it('validates classification values against taxonomy', async () => {
    const invalidTaxonomy: IssueClassifierOutput = {
      ...VALID_OUTPUT,
      classification: {
        ...VALID_OUTPUT.classification,
        Maintenance_Category: 'nonexistent_category',
      },
    };
    const llmCall = vi.fn().mockResolvedValue(invalidTaxonomy);
    // Invalid taxonomy values are treated as schema-level failures -> retry
    const result = await callIssueClassifier(VALID_INPUT, llmCall, taxonomy);
    expect(result.status).toBe('llm_fail');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/classifier/issue-classifier.test.ts`
Expected: FAIL -- module not found

**Step 3: Write minimal implementation**

Create `packages/core/src/classifier/issue-classifier.ts`:

```typescript
import type { IssueClassifierInput, IssueClassifierOutput, Taxonomy } from '@wo-agent/schemas';
import {
  validateClassifierOutput,
  validateClassificationAgainstTaxonomy,
} from '@wo-agent/schemas';

export enum ClassifierErrorCode {
  SCHEMA_VALIDATION_FAILED = 'SCHEMA_VALIDATION_FAILED',
  LLM_CALL_FAILED = 'LLM_CALL_FAILED',
  TAXONOMY_VALIDATION_FAILED = 'TAXONOMY_VALIDATION_FAILED',
}

export class ClassifierError extends Error {
  constructor(
    public readonly code: ClassifierErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ClassifierError';
  }
}

export interface ClassifierResult {
  readonly status: 'ok' | 'llm_fail' | 'needs_human_triage';
  readonly output?: IssueClassifierOutput;
  /** Both attempts stored for audit when needs_human_triage */
  readonly conflicting?: readonly IssueClassifierOutput[];
  readonly error?: string;
}

type LlmClassifierFn = (
  input: IssueClassifierInput,
  retryContext?: { retryHint: string; constraint?: string },
) => Promise<unknown>;

/**
 * Call the IssueClassifier LLM tool with full validation pipeline (llm-tool-contracts skill).
 *
 * Pipeline: LLM call -> schema validate -> taxonomy validate -> category gating check
 *           -> accept or retry(1x per failure type) -> fail safe
 *
 * - Parse/schema failure: one retry with error context
 * - Domain failure (contradictory gating): one constrained retry -> needs_human_triage
 * - LLM exception: throw immediately (no retry)
 */
export async function callIssueClassifier(
  input: IssueClassifierInput,
  llmCall: LlmClassifierFn,
  taxonomy: Taxonomy,
): Promise<ClassifierResult> {
  // --- Phase 1: Schema validation with one retry ---
  let validated: IssueClassifierOutput | null = null;
  let lastSchemaError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: unknown;
    try {
      raw = await llmCall(
        input,
        attempt > 0 ? { retryHint: 'schema_errors' } : undefined,
      );
    } catch (err) {
      throw new ClassifierError(
        ClassifierErrorCode.LLM_CALL_FAILED,
        `IssueClassifier LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    // Schema validation
    const schemaResult = validateClassifierOutput(raw);
    if (!schemaResult.valid) {
      lastSchemaError = schemaResult.errors;
      continue;
    }

    // Taxonomy domain validation (values exist in taxonomy.json)
    const domainResult = validateClassificationAgainstTaxonomy(
      schemaResult.data!.classification,
      taxonomy,
    );
    if (domainResult.invalidValues.length > 0) {
      lastSchemaError = domainResult.invalidValues;
      continue;
    }

    validated = schemaResult.data!;
    break;
  }

  if (validated === null) {
    return {
      status: 'llm_fail',
      error: `IssueClassifier output failed schema/taxonomy validation after retry: ${JSON.stringify(lastSchemaError)}`,
    };
  }

  // --- Phase 2: Category gating check (spec 5.3) ---
  const gatingResult = validateClassificationAgainstTaxonomy(validated.classification, taxonomy);

  if (!gatingResult.contradictory) {
    // No contradiction -- accept
    return { status: 'ok', output: validated };
  }

  // Contradictory -- one constrained retry
  const category = validated.classification['Category'];
  const constraint = category === 'management'
    ? 'Set all maintenance-domain fields (Maintenance_Category, Maintenance_Object, Maintenance_Problem) to their not-applicable equivalents.'
    : 'Set all management-domain fields (Management_Category, Management_Object) to their not-applicable equivalents.';

  let retryRaw: unknown;
  try {
    retryRaw = await llmCall(input, {
      retryHint: 'domain_constraint',
      constraint,
    });
  } catch {
    return {
      status: 'needs_human_triage',
      conflicting: [validated],
      error: 'LLM call failed on category gating retry',
    };
  }

  // Validate retry output through full pipeline
  const retrySchema = validateClassifierOutput(retryRaw);
  if (!retrySchema.valid) {
    return {
      status: 'needs_human_triage',
      conflicting: [validated],
      error: 'Category gating retry failed schema validation',
    };
  }

  const retryTaxonomy = validateClassificationAgainstTaxonomy(
    retrySchema.data!.classification,
    taxonomy,
  );
  if (retryTaxonomy.invalidValues.length > 0 || retryTaxonomy.contradictory) {
    // Still contradictory after retry -- needs human triage (spec 5.3 step 3)
    return {
      status: 'needs_human_triage',
      conflicting: [validated, retrySchema.data!],
      error: 'Category gating still contradictory after constrained retry',
    };
  }

  return { status: 'ok', output: retrySchema.data! };
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/classifier/issue-classifier.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `pnpm -r test`
Expected: All pass.

**Step 6: Commit**

```bash
git add packages/core/src/classifier/issue-classifier.ts packages/core/src/__tests__/classifier/issue-classifier.test.ts
git commit -m "feat(core): add IssueClassifier wrapper with category gating retry"
```

---

## Task 4: Create classifier barrel export and add issueClassifier port to OrchestratorDependencies

**Files:**
- Create: `packages/core/src/classifier/index.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/orchestrator/types.ts`
- Test: Existing orchestrator tests must still pass with updated deps

**Context:** Wire the classifier module into the core package exports and add the `issueClassifier` port to `OrchestratorDependencies` so the orchestrator can call it. Follow the same pattern as the `issueSplitter` port.

**Step 1: Create barrel export for classifier module**

Create `packages/core/src/classifier/index.ts`:

```typescript
export {
  computeCueScores,
  computeCueStrengthForField,
} from './cue-scoring.js';
export type { CueFieldResult, CueScoreMap } from './cue-scoring.js';

export {
  computeFieldConfidence,
  computeAllFieldConfidences,
  classifyConfidenceBand,
  determineFieldsNeedingInput,
} from './confidence.js';
export type { ConfidenceBand, FieldConfidenceInput, ComputeAllInput } from './confidence.js';

export {
  callIssueClassifier,
  ClassifierError,
  ClassifierErrorCode,
} from './issue-classifier.js';
export type { ClassifierResult } from './issue-classifier.js';
```

**Step 2: Add classifier exports to packages/core/src/index.ts**

Add to the barrel export:

```typescript
// --- Classifier ---
export {
  computeCueScores,
  computeCueStrengthForField,
  computeFieldConfidence,
  computeAllFieldConfidences,
  classifyConfidenceBand,
  determineFieldsNeedingInput,
  callIssueClassifier,
  ClassifierError,
  ClassifierErrorCode,
} from './classifier/index.js';
export type {
  CueFieldResult,
  CueScoreMap,
  ConfidenceBand,
  FieldConfidenceInput,
  ComputeAllInput,
  ClassifierResult,
} from './classifier/index.js';
```

**Step 3: Add issueClassifier port to OrchestratorDependencies**

In `packages/core/src/orchestrator/types.ts`, add to the `OrchestratorDependencies` interface:

```typescript
readonly issueClassifier: (
  input: IssueClassifierInput,
  retryContext?: { retryHint: string; constraint?: string },
) => Promise<unknown>;
```

Add the import:

```typescript
import type { IssueClassifierInput } from '@wo-agent/schemas';
```

**Step 4: Update all test fixtures that create OrchestratorDependencies**

In every test file that creates a `deps` object (e.g., orchestrator-integration.test.ts, dispatcher.test.ts, action-handler tests), add the stub:

```typescript
issueClassifier: async () => ({
  issue_id: 'issue-1',
  classification: { Category: 'maintenance' },
  model_confidence: { Category: 0.9 },
  missing_fields: [],
  needs_human_triage: false,
}),
```

**Step 5: Run full test suite to verify no regressions**

Run: `pnpm -r test`
Expected: All pass.

**Step 6: Commit**

```bash
git add packages/core/src/classifier/index.ts packages/core/src/index.ts packages/core/src/orchestrator/types.ts
git add -u # any test fixture updates
git commit -m "feat(core): add classifier barrel export and issueClassifier port to orchestrator"
```

---

## Task 5: Extend ConversationSession with classification results storage

**Files:**
- Modify: `packages/core/src/session/types.ts`
- Modify: `packages/core/src/session/session.ts`
- Modify: `packages/core/src/session/index.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/classifier/session-classification.test.ts`

**Context:** The session needs to store per-issue classification results so they persist across the classification -> follow-up -> re-classification cycle. Follow the same pattern as `split_issues` / `setSplitIssues`.

**Step 1: Define the classification result type**

Add to `packages/core/src/session/types.ts`:

```typescript
import type { SplitIssue, PinnedVersions, IssueClassifierOutput } from '@wo-agent/schemas';

/**
 * Per-issue classification result stored on the session.
 * Includes the classifier output plus the computed confidence scores.
 */
export interface IssueClassificationResult {
  readonly issue_id: string;
  readonly classifierOutput: IssueClassifierOutput;
  readonly computedConfidence: Record<string, number>;
  readonly fieldsNeedingInput: readonly string[];
}
```

Add to `ConversationSession`:

```typescript
readonly classification_results: readonly IssueClassificationResult[] | null;
```

**Step 2: Write the failing test**

Create `packages/core/src/__tests__/classifier/session-classification.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createSession, setClassificationResults } from '../../session/session.js';
import type { IssueClassificationResult } from '../../session/types.js';

const VERSIONS = { taxonomy_version: '1.0.0', schema_version: '1.0.0', model_id: 'test', prompt_version: '1.0.0' };

describe('setClassificationResults', () => {
  it('stores classification results on session', () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: VERSIONS,
    });
    expect(session.classification_results).toBeNull();

    const results: IssueClassificationResult[] = [
      {
        issue_id: 'i1',
        classifierOutput: {
          issue_id: 'i1',
          classification: { Category: 'maintenance' },
          model_confidence: { Category: 0.9 },
          missing_fields: [],
          needs_human_triage: false,
        },
        computedConfidence: { Category: 0.85 },
        fieldsNeedingInput: [],
      },
    ];
    const updated = setClassificationResults(session, results);
    expect(updated.classification_results).toEqual(results);
    expect(updated.classification_results).not.toBe(results);
    expect(updated.last_activity_at).not.toBe(session.last_activity_at);
  });

  it('allows clearing classification results with null', () => {
    let session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: VERSIONS,
    });
    session = setClassificationResults(session, [{
      issue_id: 'i1',
      classifierOutput: {
        issue_id: 'i1',
        classification: { Category: 'maintenance' },
        model_confidence: { Category: 0.9 },
        missing_fields: [],
        needs_human_triage: false,
      },
      computedConfidence: { Category: 0.85 },
      fieldsNeedingInput: [],
    }]);
    const cleared = setClassificationResults(session, null);
    expect(cleared.classification_results).toBeNull();
  });
});
```

**Step 3: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/classifier/session-classification.test.ts`
Expected: FAIL -- `setClassificationResults` not found

**Step 4: Implement**

In `packages/core/src/session/session.ts`, add:

```typescript
import type { IssueClassificationResult } from './types.js';

export function setClassificationResults(
  session: ConversationSession,
  results: readonly IssueClassificationResult[] | null,
): ConversationSession {
  return {
    ...session,
    classification_results: results ? [...results] : null,
    last_activity_at: new Date().toISOString(),
  };
}
```

In `createSession()`, add `classification_results: null` to the initial session object.

Export from `packages/core/src/session/index.ts` and `packages/core/src/index.ts`.

Also export `IssueClassificationResult` type from both.

**Step 5: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/classifier/session-classification.test.ts`
Expected: PASS

**Step 6: Fix any existing tests that do deep equality on session shape**

Run: `pnpm -r test`

If any tests fail because they assert exact session shape, add `classification_results: null` to their expected values.

**Step 7: Commit**

```bash
git add packages/core/src/session/types.ts packages/core/src/session/session.ts packages/core/src/session/index.ts packages/core/src/index.ts packages/core/src/__tests__/classifier/session-classification.test.ts
git commit -m "feat(core): add classification_results field to ConversationSession"
```

---

## Task 6: Implement handleStartClassification action handler

**Files:**
- Create: `packages/core/src/orchestrator/action-handlers/start-classification.ts`
- Modify: `packages/core/src/orchestrator/action-handlers/index.ts` (register handler)
- Test: `packages/core/src/__tests__/classifier/start-classification.test.ts`

**Context:** This is the core handler that bridges split finalization to classification. When `CONFIRM_SPLIT` succeeds (state = `split_finalized`), the dispatcher fires `START_CLASSIFICATION` as a system event. This handler: (1) loads the cue dictionary, (2) for each split issue, computes cue scores, calls the classifier, validates, computes confidence, (3) aggregates results, (4) transitions to `needs_tenant_input` or `tenant_confirmation_pending`.

The handler follows the same pattern as `handleSubmitInitialMessage` -- it uses intermediate steps for matrix compliance and `finalSystemAction` for the system event.

**Important:** The handler is triggered by the dispatcher as a system event after `CONFIRM_SPLIT`, not directly by the tenant. The transition matrix says: `split_finalized -> START_CLASSIFICATION -> classification_in_progress`. Then the handler's outcome triggers `LLM_CLASSIFY_SUCCESS` -> `needs_tenant_input` or `tenant_confirmation_pending`.

**Spec references:** 11.2 (transition matrix), 14.1-14.4 (classification output, gating, confidence, cues)

**Step 1: Write the failing test**

Create `packages/core/src/__tests__/classifier/start-classification.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { handleStartClassification } from '../../orchestrator/action-handlers/start-classification.js';
import { createSession, updateSessionState, setSplitIssues } from '../../session/session.js';
import { ConversationState, ActorType, loadTaxonomy } from '@wo-agent/schemas';
import type { SplitIssue, IssueClassifierOutput } from '@wo-agent/schemas';
import type { ActionHandlerContext } from '../../orchestrator/types.js';
import type { CueDictionary } from '@wo-agent/schemas';

const taxonomy = loadTaxonomy();

const VERSIONS = {
  taxonomy_version: '1.0.0',
  schema_version: '1.0.0',
  model_id: 'test-model',
  prompt_version: '1.0.0',
};

const VALID_CLASSIFICATION: IssueClassifierOutput = {
  issue_id: 'i1',
  classification: {
    Category: 'maintenance',
    Location: 'suite',
    Sub_Location: 'bathroom',
    Maintenance_Category: 'plumbing',
    Maintenance_Object: 'toilet',
    Maintenance_Problem: 'leak',
    Management_Category: 'other_mgmt_cat',
    Management_Object: 'other_mgmt_obj',
    Priority: 'normal',
  },
  model_confidence: {
    Category: 0.95,
    Location: 0.9,
    Sub_Location: 0.85,
    Maintenance_Category: 0.92,
    Maintenance_Object: 0.95,
    Maintenance_Problem: 0.88,
    Management_Category: 0.0,
    Management_Object: 0.0,
    Priority: 0.7,
  },
  missing_fields: [],
  needs_human_triage: false,
};

const MINI_CUES: CueDictionary = {
  version: '1.0.0',
  fields: {
    Maintenance_Category: {
      plumbing: { keywords: ['leak', 'toilet'], regex: [] },
    },
  },
};

function makeContext(overrides?: {
  issues?: readonly SplitIssue[];
  classifierFn?: (...args: unknown[]) => Promise<unknown>;
  cueDict?: CueDictionary;
}): ActionHandlerContext {
  let counter = 0;
  const issues = overrides?.issues ?? [
    { issue_id: 'i1', summary: 'Toilet leaking', raw_excerpt: 'My toilet is leaking' },
  ];

  let session = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['u1'],
    pinned_versions: VERSIONS,
  });
  session = updateSessionState(session, ConversationState.SPLIT_FINALIZED);
  session = setSplitIssues(session, issues as SplitIssue[]);

  return {
    session,
    request: {
      conversation_id: 'conv-1',
      action_type: 'START_CLASSIFICATION' as any,
      actor: ActorType.SYSTEM,
      tenant_input: {},
      auth_context: {
        tenant_user_id: 'user-1',
        tenant_account_id: 'acct-1',
        authorized_unit_ids: ['u1'],
      },
    },
    deps: {
      eventRepo: { append: vi.fn(), query: vi.fn().mockResolvedValue([]) },
      sessionStore: {
        get: vi.fn().mockResolvedValue(null),
        getByTenantUser: vi.fn().mockResolvedValue([]),
        save: vi.fn(),
      },
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-02-24T12:00:00Z',
      issueSplitter: vi.fn(),
      issueClassifier: overrides?.classifierFn ?? vi.fn().mockResolvedValue(VALID_CLASSIFICATION),
      cueDict: overrides?.cueDict ?? MINI_CUES,
      taxonomy,
      confidenceConfig: undefined, // uses DEFAULT_CONFIDENCE_CONFIG
    } as any,
  };
}

describe('handleStartClassification', () => {
  it('classifies all issues and transitions to tenant_confirmation_pending when all high confidence', async () => {
    const ctx = makeContext();
    const result = await handleStartClassification(ctx);
    expect(result.newState).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
    expect(result.session.classification_results).toHaveLength(1);
    expect(result.session.classification_results![0].issue_id).toBe('i1');
  });

  it('transitions to needs_tenant_input when some fields have low confidence', async () => {
    const lowConfOutput: IssueClassifierOutput = {
      ...VALID_CLASSIFICATION,
      model_confidence: {
        ...VALID_CLASSIFICATION.model_confidence,
        Maintenance_Category: 0.3, // Very low
        Priority: 0.2,
      },
    };
    const ctx = makeContext({
      classifierFn: vi.fn().mockResolvedValue(lowConfOutput),
    });
    const result = await handleStartClassification(ctx);
    expect(result.newState).toBe(ConversationState.NEEDS_TENANT_INPUT);
    expect(result.session.classification_results![0].fieldsNeedingInput.length).toBeGreaterThan(0);
  });

  it('classifies multiple issues', async () => {
    const issues: SplitIssue[] = [
      { issue_id: 'i1', summary: 'Toilet leaking', raw_excerpt: 'toilet leak' },
      { issue_id: 'i2', summary: 'Light broken', raw_excerpt: 'kitchen light broken' },
    ];
    let callCount = 0;
    const ctx = makeContext({
      issues,
      classifierFn: vi.fn().mockImplementation(async () => ({
        ...VALID_CLASSIFICATION,
        issue_id: `i${++callCount}`,
      })),
    });
    const result = await handleStartClassification(ctx);
    expect(result.session.classification_results).toHaveLength(2);
  });

  it('returns error when split_issues is null', async () => {
    const ctx = makeContext();
    ctx.session = setSplitIssues(ctx.session, null) as any;
    const result = await handleStartClassification(ctx);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('handles needs_human_triage from category gating failure', async () => {
    const contradictory: IssueClassifierOutput = {
      ...VALID_CLASSIFICATION,
      classification: {
        ...VALID_CLASSIFICATION.classification,
        Category: 'management',
        Maintenance_Category: 'plumbing',
      },
    };
    // Both attempts return contradictory
    const ctx = makeContext({
      classifierFn: vi.fn().mockResolvedValue(contradictory),
    });
    const result = await handleStartClassification(ctx);
    // Should still transition (escape hatch) but mark needs_human_triage
    expect(result.session.classification_results![0].classifierOutput.needs_human_triage).toBe(true);
  });

  it('handles LLM failure gracefully', async () => {
    const ctx = makeContext({
      classifierFn: vi.fn().mockRejectedValue(new Error('LLM down')),
    });
    const result = await handleStartClassification(ctx);
    expect(result.newState).toBe(ConversationState.LLM_ERROR_RETRYABLE);
  });

  it('uses finalSystemAction LLM_CLASSIFY_SUCCESS on success', async () => {
    const ctx = makeContext();
    const result = await handleStartClassification(ctx);
    expect(result.finalSystemAction).toBe('LLM_CLASSIFY_SUCCESS');
  });

  it('uses intermediateSteps for matrix compliance', async () => {
    const ctx = makeContext();
    const result = await handleStartClassification(ctx);
    // Should have intermediate step: split_finalized -> classification_in_progress
    expect(result.intermediateSteps).toBeDefined();
    expect(result.intermediateSteps!.length).toBeGreaterThanOrEqual(1);
    expect(result.intermediateSteps![0].state).toBe(ConversationState.CLASSIFICATION_IN_PROGRESS);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/classifier/start-classification.test.ts`
Expected: FAIL -- module not found

**Step 3: Write the handler implementation**

Create `packages/core/src/orchestrator/action-handlers/start-classification.ts`:

```typescript
import { ConversationState, DEFAULT_CONFIDENCE_CONFIG } from '@wo-agent/schemas';
import type { IssueClassifierInput, IssueClassifierOutput, ConfidenceConfig } from '@wo-agent/schemas';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';
import { callIssueClassifier, ClassifierError } from '../../classifier/issue-classifier.js';
import { computeCueScores } from '../../classifier/cue-scoring.js';
import { computeAllFieldConfidences, determineFieldsNeedingInput } from '../../classifier/confidence.js';
import { setClassificationResults } from '../../session/session.js';
import type { IssueClassificationResult } from '../../session/types.js';
import { SystemEvent } from '../../state-machine/system-events.js';
import { resolveLlmClassifySuccess } from '../../state-machine/guards.js';

/**
 * Handle START_CLASSIFICATION system event (spec 11.2).
 * Triggered after split is finalized. Classifies each issue, computes confidence,
 * and determines whether follow-up questions are needed.
 */
export async function handleStartClassification(
  ctx: ActionHandlerContext,
): Promise<ActionHandlerResult> {
  const { session, deps } = ctx;
  const issues = session.split_issues;

  // Guard: must have split issues
  if (!issues || issues.length === 0) {
    return {
      newState: session.state,
      session,
      uiMessages: [{ role: 'agent', content: 'No issues to classify.' }],
      errors: [{ code: 'NO_ISSUES', message: 'Cannot classify: no split issues on session' }],
    };
  }

  // Intermediate step: split_finalized -> classification_in_progress (matrix compliance)
  const intermediateStep = {
    state: ConversationState.CLASSIFICATION_IN_PROGRESS,
    eventType: 'state_transition' as const,
    eventPayload: { issue_count: issues.length },
  };

  const cueDict = (deps as any).cueDict;
  const taxonomy = (deps as any).taxonomy;
  const confidenceConfig: ConfidenceConfig = (deps as any).confidenceConfig ?? DEFAULT_CONFIDENCE_CONFIG;

  const classificationResults: IssueClassificationResult[] = [];
  let anyFieldsNeedInput = false;
  let anyLlmError = false;

  for (const issue of issues) {
    // Step 1: Compute cue scores before calling classifier (spec 14.4)
    const cueScoreMap = computeCueScores(
      `${issue.summary} ${issue.raw_excerpt}`,
      cueDict,
    );

    // Build cue_scores for classifier input (field -> top cue score)
    const cueScoresForInput: Record<string, number> = {};
    for (const [field, result] of Object.entries(cueScoreMap)) {
      cueScoresForInput[field] = result.score;
    }

    // Step 2: Build classifier input with pinned versions
    const classifierInput: IssueClassifierInput = {
      issue_id: issue.issue_id,
      issue_summary: issue.summary,
      raw_excerpt: issue.raw_excerpt,
      taxonomy_version: session.pinned_versions.taxonomy_version,
      model_id: session.pinned_versions.model_id,
      prompt_version: session.pinned_versions.prompt_version,
      cue_scores: cueScoresForInput,
    };

    // Step 3: Call classifier with full validation pipeline
    let classifierResult;
    try {
      classifierResult = await callIssueClassifier(
        classifierInput,
        deps.issueClassifier,
        taxonomy,
      );
    } catch (err) {
      anyLlmError = true;
      break;
    }

    // Step 4: Handle result
    if (classifierResult.status === 'llm_fail') {
      anyLlmError = true;
      break;
    }

    let output: IssueClassifierOutput;
    if (classifierResult.status === 'needs_human_triage') {
      // Escape hatch: create a triage result with the first attempt's output
      output = {
        ...(classifierResult.conflicting?.[0] ?? {
          issue_id: issue.issue_id,
          classification: {},
          model_confidence: {},
          missing_fields: [],
          needs_human_triage: true,
        }),
        needs_human_triage: true,
      };
    } else {
      output = classifierResult.output!;
    }

    // Step 5: Compute confidence heuristic (spec 14.3)
    const computedConfidence = computeAllFieldConfidences({
      classification: output.classification,
      modelConfidence: output.model_confidence,
      cueResults: cueScoreMap,
      config: confidenceConfig,
    });

    const fieldsNeedingInput = output.needs_human_triage
      ? [] // Human triage handles these
      : determineFieldsNeedingInput(computedConfidence, confidenceConfig);

    if (fieldsNeedingInput.length > 0) {
      anyFieldsNeedInput = true;
    }

    classificationResults.push({
      issue_id: issue.issue_id,
      classifierOutput: output,
      computedConfidence,
      fieldsNeedingInput,
    });
  }

  // Handle LLM error
  if (anyLlmError) {
    return {
      newState: ConversationState.LLM_ERROR_RETRYABLE,
      session,
      intermediateSteps: [intermediateStep],
      finalSystemAction: SystemEvent.LLM_FAIL,
      uiMessages: [{
        role: 'agent',
        content: 'I had trouble classifying your issue(s). Please try again.',
      }],
      errors: [{ code: 'CLASSIFIER_FAILED', message: 'Classification LLM call failed' }],
      transitionContext: { prior_state: ConversationState.CLASSIFICATION_IN_PROGRESS },
      eventPayload: { error: 'classifier_failed' },
      eventType: 'error_occurred',
    };
  }

  // Store classification results on session
  const updatedSession = setClassificationResults(session, classificationResults);

  // Determine target state via guard (spec 11.2)
  const allFieldsNeedingInput = classificationResults.flatMap(r => r.fieldsNeedingInput);
  const targetState = resolveLlmClassifySuccess({
    fields_needing_input: allFieldsNeedingInput,
  });

  return {
    newState: targetState,
    session: updatedSession,
    intermediateSteps: [intermediateStep],
    finalSystemAction: SystemEvent.LLM_CLASSIFY_SUCCESS,
    uiMessages: [{
      role: 'agent',
      content: anyFieldsNeedInput
        ? 'I\'ve classified your issue(s) but need a few more details to complete the work order.'
        : 'I\'ve classified your issue(s). Please review and confirm.',
    }],
    eventPayload: {
      classification_results: classificationResults.map(r => ({
        issue_id: r.issue_id,
        classification: r.classifierOutput.classification,
        computed_confidence: r.computedConfidence,
        needs_human_triage: r.classifierOutput.needs_human_triage,
      })),
    },
    eventType: 'state_transition',
  };
}
```

**Step 4: Register handler in action-handlers/index.ts**

Add import and register:

```typescript
import { handleStartClassification } from './start-classification.js';
```

Add to `HANDLER_MAP`:

```typescript
[SystemEvent.START_CLASSIFICATION]: handleStartClassification,
```

**Step 5: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/classifier/start-classification.test.ts`
Expected: PASS

**Step 6: Run full test suite**

Run: `pnpm -r test`
Expected: All pass.

**Step 7: Commit**

```bash
git add packages/core/src/orchestrator/action-handlers/start-classification.ts packages/core/src/orchestrator/action-handlers/index.ts packages/core/src/__tests__/classifier/start-classification.test.ts
git commit -m "feat(core): add handleStartClassification action handler"
```

---

## Task 7: Wire CONFIRM_SPLIT to auto-trigger START_CLASSIFICATION

**Files:**
- Modify: `packages/core/src/orchestrator/action-handlers/split-actions.ts`
- Modify: `packages/core/src/orchestrator/dispatcher.ts` (if needed for system event chaining)
- Test: `packages/core/src/__tests__/classifier/classification-flow.test.ts`

**Context:** Per spec 11.2, after `CONFIRM_SPLIT` transitions to `split_finalized`, the system fires `START_CLASSIFICATION` automatically. This may already be handled by the dispatcher (system event chaining) or may need explicit wiring. Check how the dispatcher handles `finalSystemAction` and whether a second system event can chain from the `split_finalized` state.

The key question: does `handleConfirmSplit` need to trigger `START_CLASSIFICATION` explicitly, or does the dispatcher auto-chain system events after transitioning to `split_finalized`?

Looking at the transition matrix: `split_finalized -> START_CLASSIFICATION -> classification_in_progress`. The dispatcher should auto-fire `START_CLASSIFICATION` after the session lands in `split_finalized`.

**Approach:** Either (a) modify `handleConfirmSplit` to return a second intermediate step that chains into `START_CLASSIFICATION`, or (b) modify the dispatcher to auto-fire pending system events. Choose whichever matches the existing pattern.

**Step 1: Write an integration test that exercises the full flow**

Create `packages/core/src/__tests__/classifier/classification-flow.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createDispatcher } from '../../orchestrator/dispatcher.js';
import { ActionType, ActorType, ConversationState } from '@wo-agent/schemas';
import { loadTaxonomy } from '@wo-agent/schemas';
import type { IssueClassifierOutput, CueDictionary } from '@wo-agent/schemas';

const taxonomy = loadTaxonomy();

const VALID_CLASSIFICATION: IssueClassifierOutput = {
  issue_id: 'i1',
  classification: {
    Category: 'maintenance',
    Location: 'suite',
    Sub_Location: 'bathroom',
    Maintenance_Category: 'plumbing',
    Maintenance_Object: 'toilet',
    Maintenance_Problem: 'leak',
    Management_Category: 'other_mgmt_cat',
    Management_Object: 'other_mgmt_obj',
    Priority: 'normal',
  },
  model_confidence: {
    Category: 0.95,
    Location: 0.9,
    Sub_Location: 0.85,
    Maintenance_Category: 0.92,
    Maintenance_Object: 0.95,
    Maintenance_Problem: 0.88,
    Management_Category: 0.0,
    Management_Object: 0.0,
    Priority: 0.7,
  },
  missing_fields: [],
  needs_human_triage: false,
};

const MINI_CUES: CueDictionary = {
  version: '1.0.0',
  fields: {
    Maintenance_Category: {
      plumbing: { keywords: ['leak', 'toilet'], regex: [] },
    },
  },
};

function makeDeps() {
  let counter = 0;
  return {
    eventRepo: {
      append: vi.fn(),
      query: vi.fn().mockResolvedValue([]),
    },
    sessionStore: {
      sessions: new Map(),
      async get(id: string) { return this.sessions.get(id) ?? null; },
      async getByTenantUser() { return []; },
      async save(session: any) { this.sessions.set(session.conversation_id, session); },
    },
    idGenerator: () => `id-${++counter}`,
    clock: () => '2026-02-24T12:00:00Z',
    issueSplitter: vi.fn().mockResolvedValue({
      issues: [{ issue_id: 'i1', summary: 'Toilet leaking', raw_excerpt: 'My toilet is leaking' }],
      issue_count: 1,
    }),
    issueClassifier: vi.fn().mockResolvedValue(VALID_CLASSIFICATION),
    cueDict: MINI_CUES,
    taxonomy,
  };
}

const AUTH = {
  tenant_user_id: 'user-1',
  tenant_account_id: 'acct-1',
  authorized_unit_ids: ['u1'],
};

describe('Classification flow integration', () => {
  it('walks CREATE -> SELECT_UNIT -> SUBMIT_INITIAL_MESSAGE -> CONFIRM_SPLIT -> classification -> confirmation', async () => {
    const deps = makeDeps();
    const dispatch = createDispatcher(deps as any);

    // Create conversation
    const r1 = await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });
    const convId = r1.response.conversation_snapshot.conversation_id;

    // Select unit
    await dispatch({
      conversation_id: convId,
      action_type: ActionType.SELECT_UNIT,
      actor: ActorType.TENANT,
      tenant_input: { unit_id: 'u1' },
      auth_context: AUTH,
    });

    // Submit initial message -> split_proposed
    await dispatch({
      conversation_id: convId,
      action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT,
      tenant_input: { message: 'My toilet is leaking' },
      auth_context: AUTH,
    });

    // Confirm split -> triggers START_CLASSIFICATION -> classification result
    const r4 = await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SPLIT,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });

    // Should end in tenant_confirmation_pending (all high confidence)
    // or the split may land at split_finalized if auto-chaining is needed separately
    const finalState = r4.response.conversation_snapshot.state;
    expect([
      ConversationState.SPLIT_FINALIZED,
      ConversationState.TENANT_CONFIRMATION_PENDING,
      ConversationState.NEEDS_TENANT_INPUT,
    ]).toContain(finalState);
  });
});
```

**Step 2: Run test, analyze results, then implement the wiring**

The test will reveal whether auto-chaining is already handled or needs implementation. Adjust the wiring accordingly.

**Step 3: If auto-chaining needed, modify dispatcher or CONFIRM_SPLIT handler**

Two approaches:

**Option A** -- Modify dispatcher to auto-fire system events:
After any handler completes and the session state is `split_finalized`, check the transition matrix for automatic system events and fire them.

**Option B** -- Modify `handleConfirmSplit` to directly call classification:
Have the confirm handler call `handleStartClassification` inline, returning a combined result with intermediate steps.

Choose whichever the existing code best supports. The test will guide you.

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/classifier/classification-flow.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `pnpm -r test`
Expected: All pass.

**Step 6: Commit**

```bash
git add -u
git add packages/core/src/__tests__/classifier/classification-flow.test.ts
git commit -m "feat(core): wire CONFIRM_SPLIT to trigger START_CLASSIFICATION"
```

---

## Task 8: Add cueDict and taxonomy to OrchestratorDependencies and wire into factory

**Files:**
- Modify: `packages/core/src/orchestrator/types.ts`
- Modify: `apps/web/` orchestrator factory (if it exists)
- Test: Existing tests must pass with updated deps

**Context:** The `handleStartClassification` handler needs access to the cue dictionary and taxonomy. These should be injected via `OrchestratorDependencies` rather than imported directly, allowing test isolation. Add `cueDict` and `taxonomy` as dependencies.

**Step 1: Add to OrchestratorDependencies**

In `packages/core/src/orchestrator/types.ts`:

```typescript
import type { CueDictionary, Taxonomy, ConfidenceConfig } from '@wo-agent/schemas';

// Add to OrchestratorDependencies:
readonly cueDict: CueDictionary;
readonly taxonomy: Taxonomy;
readonly confidenceConfig?: ConfidenceConfig; // optional, defaults to DEFAULT_CONFIDENCE_CONFIG
```

**Step 2: Update test fixtures**

All test `makeDeps()` functions must include `cueDict`, `taxonomy`.

**Step 3: Update apps/web orchestrator factory**

If `apps/web/` has an orchestrator factory, add cue dictionary loading:

```typescript
import cueDictRaw from '@wo-agent/schemas/classification_cues.json';
import { loadTaxonomy } from '@wo-agent/schemas';

// In factory:
cueDict: cueDictRaw as CueDictionary,
taxonomy: loadTaxonomy(),
```

**Step 4: Run full test suite**

Run: `pnpm -r test`
Expected: All pass.

**Step 5: Commit**

```bash
git add -u
git commit -m "feat(core): add cueDict and taxonomy to OrchestratorDependencies"
```

---

## Task 9: Handle ANSWER_FOLLOWUPS re-classification entry point

**Files:**
- Modify: `packages/core/src/orchestrator/action-handlers/answer-followups.ts` (if it exists)
- Test: `packages/core/src/__tests__/classifier/reclassification.test.ts`

**Context:** When the tenant answers follow-up questions (state `needs_tenant_input`, action `ANSWER_FOLLOWUPS`), the transition matrix says: `needs_tenant_input -> ANSWER_FOLLOWUPS -> classification_in_progress`. This re-triggers classification with the follow-up answers enriching the input. The `handleAnswerFollowups` handler must: (1) store the answers, (2) build enriched classifier input including `followup_answers`, (3) re-call the classifier, (4) re-compute confidence, (5) transition to `needs_tenant_input` again or `tenant_confirmation_pending`.

This is the re-classification loop. The handler can reuse `handleStartClassification` or call the classifier directly with enriched input.

**Step 1: Write the failing test**

Create `packages/core/src/__tests__/classifier/reclassification.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { handleAnswerFollowups } from '../../orchestrator/action-handlers/answer-followups.js';
import { createSession, updateSessionState, setSplitIssues, setClassificationResults } from '../../session/session.js';
import { ConversationState, ActorType, loadTaxonomy } from '@wo-agent/schemas';
import type { IssueClassifierOutput, CueDictionary } from '@wo-agent/schemas';
import type { IssueClassificationResult } from '../../session/types.js';

const taxonomy = loadTaxonomy();

const VERSIONS = {
  taxonomy_version: '1.0.0',
  schema_version: '1.0.0',
  model_id: 'test-model',
  prompt_version: '1.0.0',
};

const HIGH_CONFIDENCE_OUTPUT: IssueClassifierOutput = {
  issue_id: 'i1',
  classification: {
    Category: 'maintenance',
    Maintenance_Category: 'plumbing',
    Maintenance_Object: 'toilet',
    Maintenance_Problem: 'leak',
    Priority: 'normal',
    Location: 'suite',
    Sub_Location: 'bathroom',
    Management_Category: 'other_mgmt_cat',
    Management_Object: 'other_mgmt_obj',
  },
  model_confidence: {
    Category: 0.95,
    Maintenance_Category: 0.95,
    Maintenance_Object: 0.95,
    Maintenance_Problem: 0.95,
    Priority: 0.9,
    Location: 0.9,
    Sub_Location: 0.9,
    Management_Category: 0.0,
    Management_Object: 0.0,
  },
  missing_fields: [],
  needs_human_triage: false,
};

const MINI_CUES: CueDictionary = {
  version: '1.0.0',
  fields: {
    Maintenance_Category: {
      plumbing: { keywords: ['leak', 'toilet'], regex: [] },
    },
  },
};

function makeFollowupContext() {
  let counter = 0;
  const priorResults: IssueClassificationResult[] = [{
    issue_id: 'i1',
    classifierOutput: {
      ...HIGH_CONFIDENCE_OUTPUT,
      model_confidence: { ...HIGH_CONFIDENCE_OUTPUT.model_confidence, Priority: 0.3 },
    },
    computedConfidence: { Category: 0.9, Priority: 0.4 },
    fieldsNeedingInput: ['Priority'],
  }];

  let session = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['u1'],
    pinned_versions: VERSIONS,
  });
  session = updateSessionState(session, ConversationState.NEEDS_TENANT_INPUT);
  session = setSplitIssues(session, [
    { issue_id: 'i1', summary: 'Toilet leaking', raw_excerpt: 'My toilet is leaking' },
  ]);
  session = setClassificationResults(session, priorResults);

  return {
    session,
    request: {
      conversation_id: 'conv-1',
      action_type: 'ANSWER_FOLLOWUPS' as any,
      actor: ActorType.TENANT,
      tenant_input: {
        answers: [{ field_target: 'Priority', answer: 'normal' }],
      },
      auth_context: {
        tenant_user_id: 'user-1',
        tenant_account_id: 'acct-1',
        authorized_unit_ids: ['u1'],
      },
    },
    deps: {
      eventRepo: { append: vi.fn(), query: vi.fn().mockResolvedValue([]) },
      sessionStore: { get: vi.fn(), getByTenantUser: vi.fn(), save: vi.fn() },
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-02-24T12:00:00Z',
      issueSplitter: vi.fn(),
      issueClassifier: vi.fn().mockResolvedValue(HIGH_CONFIDENCE_OUTPUT),
      cueDict: MINI_CUES,
      taxonomy,
    } as any,
  };
}

describe('handleAnswerFollowups (re-classification)', () => {
  it('re-classifies with followup answers and transitions to tenant_confirmation_pending', async () => {
    const ctx = makeFollowupContext();
    const result = await handleAnswerFollowups(ctx);
    // After re-classification with enriched input, should reach confirmation
    expect(result.newState).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
  });

  it('passes followup_answers to classifier input', async () => {
    const ctx = makeFollowupContext();
    await handleAnswerFollowups(ctx);
    // Verify the classifier was called with followup_answers
    expect(ctx.deps.issueClassifier).toHaveBeenCalledWith(
      expect.objectContaining({
        followup_answers: expect.arrayContaining([
          expect.objectContaining({ field_target: 'Priority', answer: 'normal' }),
        ]),
      }),
      undefined,
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/classifier/reclassification.test.ts`
Expected: FAIL

**Step 3: Implement or modify handleAnswerFollowups**

The handler should:
1. Extract answers from `tenant_input`
2. For each issue with `fieldsNeedingInput`, rebuild the classifier input with `followup_answers`
3. Re-call classifier, re-validate, re-compute confidence
4. Update session with new classification results
5. Transition via `resolveLlmClassifySuccess`

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/classifier/reclassification.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `pnpm -r test`
Expected: All pass.

**Step 6: Commit**

```bash
git add -u
git add packages/core/src/__tests__/classifier/reclassification.test.ts
git commit -m "feat(core): handle ANSWER_FOLLOWUPS re-classification with enriched input"
```

---

## Task 10: Update response builder and snapshot with classification data

**Files:**
- Modify: `packages/core/src/orchestrator/response-builder.ts`
- Modify: `packages/schemas/src/types/orchestrator-action.ts` (if `ConversationSnapshot` needs classification fields)
- Test: `packages/core/src/__tests__/classifier/response-builder.test.ts`

**Context:** The `ConversationSnapshot` in `OrchestratorActionResponse` should include classification results when available, so the client can render them. Add classification data to the snapshot building logic.

**Step 1: Write the failing test**

Create `packages/core/src/__tests__/classifier/response-builder.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildResponse } from '../../orchestrator/response-builder.js';
import { ConversationState } from '@wo-agent/schemas';
import { createSession, setClassificationResults, setSplitIssues } from '../../session/session.js';
import type { IssueClassificationResult } from '../../session/types.js';

describe('buildResponse with classification', () => {
  it('includes classification_results in snapshot when present', () => {
    const results: IssueClassificationResult[] = [{
      issue_id: 'i1',
      classifierOutput: {
        issue_id: 'i1',
        classification: { Category: 'maintenance' },
        model_confidence: { Category: 0.9 },
        missing_fields: [],
        needs_human_triage: false,
      },
      computedConfidence: { Category: 0.85 },
      fieldsNeedingInput: [],
    }];

    let session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'test',
        prompt_version: '1.0.0',
      },
    });
    session = setClassificationResults(session, results);

    const response = buildResponse({
      newState: ConversationState.TENANT_CONFIRMATION_PENDING,
      session,
      uiMessages: [{ role: 'agent', content: 'Review and confirm.' }],
    });

    expect(response.conversation_snapshot.classification_results).toBeDefined();
    expect(response.conversation_snapshot.classification_results).toHaveLength(1);
  });

  it('omits classification_results from snapshot when null', () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'test',
        prompt_version: '1.0.0',
      },
    });

    const response = buildResponse({
      newState: ConversationState.INTAKE_STARTED,
      session,
      uiMessages: [{ role: 'agent', content: 'Hello.' }],
    });

    expect(response.conversation_snapshot.classification_results).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm vitest run src/__tests__/classifier/response-builder.test.ts`
Expected: FAIL

**Step 3: Modify response builder**

In `response-builder.ts`, add classification_results to the snapshot spread:

```typescript
...(result.session.classification_results
  ? { classification_results: result.session.classification_results }
  : {}),
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/classifier/response-builder.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `pnpm -r test`
Expected: All pass.

**Step 6: Commit**

```bash
git add -u
git add packages/core/src/__tests__/classifier/response-builder.test.ts
git commit -m "feat(core): include classification results in OrchestratorActionResponse snapshot"
```

---

## Task 11: Add classification_events recording

**Files:**
- Modify: `packages/core/src/events/types.ts` (add `classification_completed` event type if needed)
- Modify: `packages/core/src/orchestrator/action-handlers/start-classification.ts` (ensure events include versions)
- Test: `packages/core/src/__tests__/classifier/classification-events.test.ts`

**Context:** Per spec 7, classification results must be recorded in `classification_events`. Per llm-tool-contracts skill, when `needs_human_triage` is set, both original and retry attempts must be stored. Events must record `taxonomy_version`, `model_id`, and `prompt_version`.

**Step 1: Write the failing test**

Create `packages/core/src/__tests__/classifier/classification-events.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
// Test that classification events are properly recorded with:
// - All pinned versions (taxonomy_version, model_id, prompt_version)
// - Full classification output
// - Computed confidence scores
// - Both attempts on needs_human_triage

describe('classification event recording', () => {
  it('records classification event with pinned versions', async () => {
    // Use integration test setup (dispatch through full flow)
    // Verify eventRepo.append was called with classification event
    // containing taxonomy_version, model_id, prompt_version
  });

  it('records both attempts when needs_human_triage', async () => {
    // Mock classifier to return contradictory both times
    // Verify eventRepo.append stores conflicting outputs in payload
  });
});
```

Fill in with concrete implementation following the integration test pattern from Task 7.

**Step 2: Implement event recording**

Ensure `start-classification.ts` includes version info and conflicting outputs in `eventPayload`.

**Step 3: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/classifier/classification-events.test.ts`
Expected: PASS

**Step 4: Run full test suite**

Run: `pnpm -r test`
Expected: All pass.

**Step 5: Commit**

```bash
git add -u
git add packages/core/src/__tests__/classifier/classification-events.test.ts
git commit -m "feat(core): record classification_events with pinned versions and audit trail"
```

---

## Task 12: Full integration test for happy path and edge cases

**Files:**
- Test: `packages/core/src/__tests__/classifier/integration.test.ts`

**Context:** Comprehensive integration test that exercises the entire classification flow end-to-end through the dispatcher: CREATE -> SELECT_UNIT -> SUBMIT_INITIAL_MESSAGE -> CONFIRM_SPLIT -> classification -> confirmation/follow-up. Tests happy path, multi-issue, LLM failure, category gating, re-classification after follow-ups.

**Step 1: Write the integration test**

Create `packages/core/src/__tests__/classifier/integration.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createDispatcher } from '../../orchestrator/dispatcher.js';
import { ActionType, ActorType, ConversationState, loadTaxonomy } from '@wo-agent/schemas';
import type { IssueClassifierOutput, CueDictionary } from '@wo-agent/schemas';

const taxonomy = loadTaxonomy();

// Full integration tests exercising:
// 1. Happy path: single issue, high confidence -> tenant_confirmation_pending
// 2. Multi-issue: two issues classified independently
// 3. Low confidence: some fields need follow-up -> needs_tenant_input
// 4. Category gating: contradictory -> retry -> success
// 5. Category gating: contradictory -> retry fails -> needs_human_triage
// 6. LLM failure: classifier throws -> llm_error_retryable
// 7. Re-classification: ANSWER_FOLLOWUPS -> re-classify -> tenant_confirmation_pending
// 8. Event recording: verify classification_events in eventRepo

describe('Classification integration', () => {
  // Helper to walk conversation to split_proposed state
  async function walkToSplitProposed(dispatch: any, convId: string, auth: any) {
    await dispatch({
      conversation_id: convId,
      action_type: ActionType.SELECT_UNIT,
      actor: ActorType.TENANT,
      tenant_input: { unit_id: 'u1' },
      auth_context: auth,
    });
    await dispatch({
      conversation_id: convId,
      action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT,
      tenant_input: { message: 'My toilet is leaking' },
      auth_context: auth,
    });
    return dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SPLIT,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: auth,
    });
  }

  it('happy path: single issue, high confidence -> tenant_confirmation_pending', async () => {
    // ... full test
  });

  it('low confidence fields trigger needs_tenant_input', async () => {
    // ... full test with low model confidence
  });

  it('category gating retry resolves contradiction', async () => {
    // ... test with contradictory first attempt, clean second
  });

  it('LLM failure transitions to llm_error_retryable', async () => {
    // ... test with classifier throwing
  });
});
```

**Step 2: Run test to verify it passes**

Run: `cd packages/core && pnpm vitest run src/__tests__/classifier/integration.test.ts`
Expected: PASS

**Step 3: Run full test suite**

Run: `pnpm -r test`
Expected: All pass.

**Step 4: Commit**

```bash
git add packages/core/src/__tests__/classifier/integration.test.ts
git commit -m "test(core): add classification integration tests for full lifecycle"
```

---

## Task 13: Update apps/web orchestrator factory with classifier stub

**Files:**
- Modify: `apps/web/` orchestrator factory (e.g., `apps/web/app/api/orchestrator-factory.ts` or similar)
- Test: Manual verification

**Context:** The web app's orchestrator factory needs to include the `issueClassifier` stub, `cueDict`, and `taxonomy` in the dependencies it constructs. For MVP, the classifier stub can return a mock classification. The real LLM integration will come later when the actual model is wired in.

**Step 1: Add classifier stub to web orchestrator factory**

```typescript
import classificationCues from '@wo-agent/schemas/classification_cues.json';
import { loadTaxonomy } from '@wo-agent/schemas';
import type { CueDictionary, IssueClassifierInput } from '@wo-agent/schemas';

// Add to deps:
issueClassifier: async (input: IssueClassifierInput) => ({
  issue_id: input.issue_id,
  classification: {
    Category: 'maintenance',
    Location: 'suite',
    Sub_Location: 'general',
    Maintenance_Category: 'general_maintenance',
    Maintenance_Object: 'other_object',
    Maintenance_Problem: 'not_working',
    Management_Category: 'other_mgmt_cat',
    Management_Object: 'other_mgmt_obj',
    Priority: 'normal',
  },
  model_confidence: {
    Category: 0.7,
    Location: 0.5,
    Sub_Location: 0.5,
    Maintenance_Category: 0.6,
    Maintenance_Object: 0.5,
    Maintenance_Problem: 0.5,
    Management_Category: 0.0,
    Management_Object: 0.0,
    Priority: 0.5,
  },
  missing_fields: [],
  needs_human_triage: false,
}),
cueDict: classificationCues as CueDictionary,
taxonomy: loadTaxonomy(),
```

**Step 2: Run full test suite**

Run: `pnpm -r test`
Expected: All pass. If web app has type errors, fix them.

**Step 3: Commit**

```bash
git add -u
git commit -m "chore: add issueClassifier stub to web orchestrator factory"
```

---

## Task 14: Final verification and cleanup

**Files:**
- All files modified in this plan

**Step 1: Run full test suite**

Run: `pnpm -r test`
Expected: All tests pass.

**Step 2: Run type check**

Run: `pnpm typecheck` or `cd packages/core && npx tsc --noEmit && cd ../schemas && npx tsc --noEmit`
Expected: No type errors.

**Step 3: Verify exports are clean**

Check that `packages/core/src/index.ts` exports all new classifier functionality.

**Step 4: Review all changes**

```bash
git diff feature/phase-04-splitter...HEAD --stat
```

Verify: no unintended changes, no debug code left behind.

**Step 5: Commit any cleanup**

```bash
git add -u
git commit -m "chore: Phase 5 final cleanup and verification"
```
