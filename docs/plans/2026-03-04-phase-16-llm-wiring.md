# Phase 16: Wire Real LLM (Anthropic Claude) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:executing-plans to implement this plan task-by-task.

**Goal:** Replace the three hardcoded LLM stubs in `orchestrator-factory.ts` with real Anthropic Claude API calls so that IssueSplitter, IssueClassifier, and FollowUpGenerator produce actual AI-driven results.

**Architecture:** Create an LLM adapter layer in `packages/core/src/llm/` that wraps the `@anthropic-ai/sdk`, builds tool-specific system prompts, and returns raw parsed JSON for the existing validation pipelines to enforce. The adapter factory produces the three dependency functions consumed by `OrchestratorDependencies`. No changes to existing validation, retry, or state machine logic — the adapter slots in via dependency injection.

**Tech Stack:** `@anthropic-ai/sdk`, TypeScript, Vitest (mocked SDK for tests)

---

### Task 0: Install `@anthropic-ai/sdk` dependency

**Files:**
- Modify: `packages/core/package.json`

**Step 1: Add the dependency**

Run: `cd /workspaces/MAINTENANCE && pnpm --filter @wo-agent/core add @anthropic-ai/sdk`

Expected: `@anthropic-ai/sdk` appears in `packages/core/package.json` dependencies.

**Step 2: Verify install**

Run: `cd /workspaces/MAINTENANCE && pnpm ls --filter @wo-agent/core @anthropic-ai/sdk`
Expected: Shows `@anthropic-ai/sdk` version

**Step 3: Verify existing tests still pass**

Run: `cd /workspaces/MAINTENANCE && pnpm --filter @wo-agent/core test`
Expected: All existing tests PASS

**Step 4: Commit**

```bash
git add packages/core/package.json pnpm-lock.yaml
git commit -m "chore: add @anthropic-ai/sdk dependency to @wo-agent/core"
```

---

### Task 1: Create JSON response parser

**Files:**
- Create: `packages/core/src/llm/parse-response.ts`
- Create: `packages/core/src/llm/__tests__/parse-response.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/llm/__tests__/parse-response.test.ts
import { describe, it, expect } from 'vitest';
import { extractJsonFromResponse } from '../parse-response.js';

describe('extractJsonFromResponse', () => {
  it('parses a plain JSON string', () => {
    const input = '{"issues": [], "issue_count": 0}';
    expect(extractJsonFromResponse(input)).toEqual({ issues: [], issue_count: 0 });
  });

  it('extracts JSON from a markdown code block', () => {
    const input = 'Here is the result:\n```json\n{"issues": [], "issue_count": 0}\n```';
    expect(extractJsonFromResponse(input)).toEqual({ issues: [], issue_count: 0 });
  });

  it('extracts JSON from a code block without language tag', () => {
    const input = 'Result:\n```\n{"key": "value"}\n```';
    expect(extractJsonFromResponse(input)).toEqual({ key: 'value' });
  });

  it('extracts the first JSON object when surrounded by text', () => {
    const input = 'I analyzed the text. {"issue_count": 1, "issues": [{"issue_id": "x", "summary": "leak", "raw_excerpt": "leak"}]} That is my answer.';
    const result = extractJsonFromResponse(input);
    expect(result).toHaveProperty('issue_count', 1);
  });

  it('throws on empty string', () => {
    expect(() => extractJsonFromResponse('')).toThrow('No JSON found');
  });

  it('throws on non-JSON text', () => {
    expect(() => extractJsonFromResponse('I cannot help with that.')).toThrow('No JSON found');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /workspaces/MAINTENANCE && pnpm --filter @wo-agent/core exec vitest run src/llm/__tests__/parse-response.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// packages/core/src/llm/parse-response.ts

/**
 * Extract a JSON object from an LLM text response.
 *
 * Handles:
 * - Pure JSON responses
 * - JSON wrapped in ```json ... ``` or ``` ... ``` code blocks
 * - JSON embedded in surrounding prose (first { ... } match)
 *
 * Throws if no valid JSON object is found.
 */
export function extractJsonFromResponse(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('No JSON found in empty response');

  // Try 1: direct parse (pure JSON)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Fall through to other strategies
    }
  }

  // Try 2: extract from markdown code block
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // Fall through
    }
  }

  // Try 3: find first { ... } balanced braces
  const firstBrace = trimmed.indexOf('{');
  if (firstBrace !== -1) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = firstBrace; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(trimmed.slice(firstBrace, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }

  throw new Error('No JSON found in LLM response');
}
```

**Step 4: Run test to verify it passes**

Run: `cd /workspaces/MAINTENANCE && pnpm --filter @wo-agent/core exec vitest run src/llm/__tests__/parse-response.test.ts`
Expected: All 6 tests PASS

**Step 5: Commit**

```bash
git add packages/core/src/llm/parse-response.ts packages/core/src/llm/__tests__/parse-response.test.ts
git commit -m "feat(llm): add JSON response parser for LLM output extraction"
```

---

### Task 2: Create the Anthropic client wrapper

**Files:**
- Create: `packages/core/src/llm/anthropic-client.ts`
- Create: `packages/core/src/llm/__tests__/anthropic-client.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/llm/__tests__/anthropic-client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAnthropicClient, type LlmClient } from '../anthropic-client.js';

// Mock the SDK
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: '{"result": true}' }],
        }),
      };
    },
  };
});

describe('createAnthropicClient', () => {
  it('creates a client with required config', () => {
    const client = createAnthropicClient({ apiKey: 'test-key' });
    expect(client).toBeDefined();
    expect(client.complete).toBeTypeOf('function');
  });

  it('calls the SDK and returns the text content', async () => {
    const client = createAnthropicClient({ apiKey: 'test-key' });
    const result = await client.complete({
      system: 'You are a helper.',
      userMessage: 'Hello',
      model: 'claude-sonnet-4-20250514',
      maxTokens: 1024,
    });
    expect(result).toBe('{"result": true}');
  });

  it('throws if no text content in response', async () => {
    const { default: MockAnthropic } = await import('@anthropic-ai/sdk');
    const mockCreate = vi.fn().mockResolvedValue({ content: [] });
    vi.mocked(MockAnthropic).mockImplementationOnce(
      () => ({ messages: { create: mockCreate } }) as any,
    );

    const client = createAnthropicClient({ apiKey: 'test-key' });
    // Re-mock for this specific call
    (client as any)._sdk.messages.create = mockCreate;
    await expect(client.complete({
      system: 'test',
      userMessage: 'test',
      model: 'claude-sonnet-4-20250514',
      maxTokens: 1024,
    })).rejects.toThrow('No text content');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /workspaces/MAINTENANCE && pnpm --filter @wo-agent/core exec vitest run src/llm/__tests__/anthropic-client.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// packages/core/src/llm/anthropic-client.ts
import Anthropic from '@anthropic-ai/sdk';

export interface LlmClientConfig {
  readonly apiKey: string;
  readonly defaultModel?: string;
  readonly defaultMaxTokens?: number;
  /** API request timeout in ms (default: 30000) */
  readonly timeout?: number;
}

export interface CompletionRequest {
  readonly system: string;
  readonly userMessage: string;
  readonly model?: string;
  readonly maxTokens?: number;
}

export interface LlmClient {
  complete(request: CompletionRequest): Promise<string>;
  /** Exposed for testing only */
  readonly _sdk: Anthropic;
}

/**
 * Create an Anthropic API client wrapper.
 * Returns a simplified interface for our LLM tools.
 */
export function createAnthropicClient(config: LlmClientConfig): LlmClient {
  const sdk = new Anthropic({ apiKey: config.apiKey, timeout: config.timeout ?? 30_000 });
  const defaultModel = config.defaultModel ?? 'claude-sonnet-4-20250514';
  const defaultMaxTokens = config.defaultMaxTokens ?? 2048;

  return {
    _sdk: sdk,
    async complete(request: CompletionRequest): Promise<string> {
      const response = await sdk.messages.create({
        model: request.model ?? defaultModel,
        max_tokens: request.maxTokens ?? defaultMaxTokens,
        system: request.system,
        messages: [{ role: 'user', content: request.userMessage }],
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('No text content in Anthropic response');
      }
      return textBlock.text;
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd /workspaces/MAINTENANCE && pnpm --filter @wo-agent/core exec vitest run src/llm/__tests__/anthropic-client.test.ts`
Expected: PASS (at least the first two tests — third test may need mock refinement during implementation)

**Step 5: Commit**

```bash
git add packages/core/src/llm/anthropic-client.ts packages/core/src/llm/__tests__/anthropic-client.test.ts
git commit -m "feat(llm): add Anthropic SDK client wrapper"
```

---

### Task 3: Create splitter prompt and adapter function

**Files:**
- Create: `packages/core/src/llm/prompts/splitter-prompt.ts`
- Create: `packages/core/src/llm/adapters/splitter-adapter.ts`
- Create: `packages/core/src/llm/__tests__/splitter-adapter.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/llm/__tests__/splitter-adapter.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createSplitterAdapter } from '../adapters/splitter-adapter.js';
import type { LlmClient } from '../anthropic-client.js';
import type { IssueSplitterInput } from '@wo-agent/schemas';

function mockClient(responseText: string): LlmClient {
  return {
    complete: vi.fn().mockResolvedValue(responseText),
    _sdk: {} as any,
  };
}

const VALID_INPUT: IssueSplitterInput = {
  raw_text: 'My toilet is leaking and the kitchen light is flickering',
  conversation_id: 'conv-1',
  taxonomy_version: '1.0.0',
  model_id: 'claude-sonnet-4-20250514',
  prompt_version: '1.0.0',
};

describe('createSplitterAdapter', () => {
  it('returns a function that calls the LLM and parses the JSON response', async () => {
    const responseJson = JSON.stringify({
      issues: [
        { issue_id: 'issue-1', summary: 'Toilet leak', raw_excerpt: 'My toilet is leaking' },
        { issue_id: 'issue-2', summary: 'Kitchen light flickering', raw_excerpt: 'the kitchen light is flickering' },
      ],
      issue_count: 2,
    });
    const client = mockClient(responseJson);
    const adapter = createSplitterAdapter(client);

    const result = await adapter(VALID_INPUT);
    expect(result).toHaveProperty('issue_count', 2);
    expect(result).toHaveProperty('issues');
    expect(client.complete).toHaveBeenCalledOnce();
  });

  it('includes raw_text in the user message', async () => {
    const client = mockClient('{"issues":[],"issue_count":0}');
    const adapter = createSplitterAdapter(client);
    await adapter(VALID_INPUT);

    const call = vi.mocked(client.complete).mock.calls[0][0];
    expect(call.userMessage).toContain('My toilet is leaking');
  });

  it('propagates LLM errors', async () => {
    const client: LlmClient = {
      complete: vi.fn().mockRejectedValue(new Error('API rate limit')),
      _sdk: {} as any,
    };
    const adapter = createSplitterAdapter(client);
    await expect(adapter(VALID_INPUT)).rejects.toThrow('API rate limit');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /workspaces/MAINTENANCE && pnpm --filter @wo-agent/core exec vitest run src/llm/__tests__/splitter-adapter.test.ts`
Expected: FAIL — module not found

**Step 3: Write the splitter prompt**

```typescript
// packages/core/src/llm/prompts/splitter-prompt.ts

/**
 * System prompt for the IssueSplitter LLM tool.
 * Spec references: §2.2 (split first), §13 (splitting), §2.3 (schema-lock)
 */
export function buildSplitterSystemPrompt(): string {
  return `You are an issue splitter for a property management service request system.

Your job: Given a tenant's message, identify each DISTINCT maintenance or management issue mentioned.

RULES:
1. Each distinct issue gets its own entry. "My toilet is leaking and the light is broken" = 2 issues.
2. Related symptoms of one root cause = 1 issue. "Water leaking from ceiling and dripping on floor" = 1 issue (water leak).
3. Generate a unique issue_id (UUID v4 format) for each issue.
4. The summary should be a concise description (under 200 chars) of the issue.
5. The raw_excerpt should be the exact portion of the tenant's text that describes this issue.
6. issue_count MUST equal the length of the issues array.
7. If there is only one issue, still return it as a single-element array.

RESPOND WITH ONLY a JSON object in this exact format (no markdown, no explanation):
{
  "issues": [
    {
      "issue_id": "<uuid>",
      "summary": "<concise description>",
      "raw_excerpt": "<exact text from tenant message>"
    }
  ],
  "issue_count": <number matching issues array length>
}`;
}

/**
 * Build the user message for the splitter.
 */
export function buildSplitterUserMessage(rawText: string): string {
  return `Tenant message:\n\n${rawText}`;
}
```

**Step 4: Write the splitter adapter**

```typescript
// packages/core/src/llm/adapters/splitter-adapter.ts
import type { IssueSplitterInput, IssueSplitterOutput } from '@wo-agent/schemas';
import type { LlmClient } from '../anthropic-client.js';
import { buildSplitterSystemPrompt, buildSplitterUserMessage } from '../prompts/splitter-prompt.js';
import { extractJsonFromResponse } from '../parse-response.js';

/**
 * Create an IssueSplitter adapter function that calls the real LLM.
 * Returns the raw parsed JSON cast to IssueSplitterOutput — the
 * callIssueSplitter validation pipeline handles actual schema validation
 * and retry logic, so the cast is safe (invalid data is caught downstream).
 */
export function createSplitterAdapter(
  client: LlmClient,
): (input: IssueSplitterInput) => Promise<IssueSplitterOutput> {
  return async (input: IssueSplitterInput): Promise<IssueSplitterOutput> => {
    const response = await client.complete({
      system: buildSplitterSystemPrompt(),
      userMessage: buildSplitterUserMessage(input.raw_text),
      model: input.model_id,
    });
    return extractJsonFromResponse(response) as IssueSplitterOutput;
  };
}
```

**Step 5: Run test to verify it passes**

Run: `cd /workspaces/MAINTENANCE && pnpm --filter @wo-agent/core exec vitest run src/llm/__tests__/splitter-adapter.test.ts`
Expected: All 3 tests PASS

**Step 6: Commit**

```bash
git add packages/core/src/llm/prompts/splitter-prompt.ts packages/core/src/llm/adapters/splitter-adapter.ts packages/core/src/llm/__tests__/splitter-adapter.test.ts
git commit -m "feat(llm): add IssueSplitter prompt and adapter for Anthropic API"
```

---

### Task 4: Create classifier prompt and adapter function

**Files:**
- Create: `packages/core/src/llm/prompts/classifier-prompt.ts`
- Create: `packages/core/src/llm/adapters/classifier-adapter.ts`
- Create: `packages/core/src/llm/__tests__/classifier-adapter.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/llm/__tests__/classifier-adapter.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createClassifierAdapter } from '../adapters/classifier-adapter.js';
import type { LlmClient } from '../anthropic-client.js';
import type { IssueClassifierInput, Taxonomy } from '@wo-agent/schemas';
import { loadTaxonomy } from '@wo-agent/schemas';

function mockClient(responseText: string): LlmClient {
  return {
    complete: vi.fn().mockResolvedValue(responseText),
    _sdk: {} as any,
  };
}

const VALID_INPUT: IssueClassifierInput = {
  issue_id: 'issue-1',
  issue_summary: 'Toilet is leaking',
  raw_excerpt: 'My toilet is leaking water onto the bathroom floor',
  taxonomy_version: '1.0.0',
  model_id: 'claude-sonnet-4-20250514',
  prompt_version: '1.0.0',
};

describe('createClassifierAdapter', () => {
  const taxonomy = loadTaxonomy();

  it('calls LLM with taxonomy in the prompt and parses response', async () => {
    const responseJson = JSON.stringify({
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
        Category: 0.95, Location: 0.85, Sub_Location: 0.9,
        Maintenance_Category: 0.92, Maintenance_Object: 0.95,
        Maintenance_Problem: 0.93, Management_Category: 0.0,
        Management_Object: 0.0, Priority: 0.7,
      },
      missing_fields: [],
      needs_human_triage: false,
    });
    const client = mockClient(responseJson);
    const adapter = createClassifierAdapter(client, taxonomy);

    const result = await adapter(VALID_INPUT);
    expect(result).toHaveProperty('issue_id', 'issue-1');
    expect(result).toHaveProperty('classification');
  });

  it('includes retry context in the prompt when provided', async () => {
    const client = mockClient('{"issue_id":"issue-1","classification":{},"model_confidence":{},"missing_fields":[],"needs_human_triage":false}');
    const adapter = createClassifierAdapter(client, taxonomy);
    await adapter(VALID_INPUT, { retryHint: 'domain_constraint', constraint: 'Set maintenance fields to N/A' });

    const call = vi.mocked(client.complete).mock.calls[0][0];
    expect(call.userMessage).toContain('domain_constraint');
    expect(call.userMessage).toContain('Set maintenance fields to N/A');
  });

  it('includes followup_answers when present', async () => {
    const client = mockClient('{"issue_id":"issue-1","classification":{},"model_confidence":{},"missing_fields":[],"needs_human_triage":false}');
    const adapter = createClassifierAdapter(client, taxonomy);
    const inputWithAnswers: IssueClassifierInput = {
      ...VALID_INPUT,
      followup_answers: [{ field_target: 'Sub_Location', answer: 'bathroom' }],
    };
    await adapter(inputWithAnswers);

    const call = vi.mocked(client.complete).mock.calls[0][0];
    expect(call.userMessage).toContain('bathroom');
    expect(call.userMessage).toContain('Sub_Location');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /workspaces/MAINTENANCE && pnpm --filter @wo-agent/core exec vitest run src/llm/__tests__/classifier-adapter.test.ts`
Expected: FAIL — module not found

**Step 3: Write the classifier prompt**

```typescript
// packages/core/src/llm/prompts/classifier-prompt.ts
import type { IssueClassifierInput, Taxonomy } from '@wo-agent/schemas';

/**
 * System prompt for the IssueClassifier LLM tool.
 * Spec references: §5.1 (taxonomy authoritative), §14 (classification), §2.1 (no free-text)
 */
export function buildClassifierSystemPrompt(taxonomy: Taxonomy): string {
  const taxonomyBlock = Object.entries(taxonomy)
    .map(([field, values]) => `${field}: ${(values as string[]).join(', ')}`)
    .join('\n');

  return `You are an issue classifier for a property management service request system.

Your job: Classify a tenant's maintenance or management issue using the EXACT taxonomy values below.

TAXONOMY (use ONLY these values):
${taxonomyBlock}

RULES:
1. Every classification field MUST use a value from the taxonomy above. No free-text.
2. If the issue is "maintenance", set Management_Category to "other_mgmt_cat" and Management_Object to "other_mgmt_obj".
3. If the issue is "management", set Maintenance_Category to "other_maintenance_category", Maintenance_Object to "other_maintenance_object", and Maintenance_Problem to "other_problem".
4. Provide a model_confidence score (0.0 to 1.0) for each field reflecting your certainty.
5. List any fields where you lack sufficient information in missing_fields.
6. Set needs_human_triage to false unless you truly cannot classify the issue.
7. The issue_id in your response MUST match the issue_id provided in the input.

RESPOND WITH ONLY a JSON object (no markdown, no explanation):
{
  "issue_id": "<same as input>",
  "classification": {
    "Category": "<value>",
    "Location": "<value>",
    "Sub_Location": "<value>",
    "Maintenance_Category": "<value>",
    "Maintenance_Object": "<value>",
    "Maintenance_Problem": "<value>",
    "Management_Category": "<value>",
    "Management_Object": "<value>",
    "Priority": "<value>"
  },
  "model_confidence": {
    "Category": <0.0-1.0>,
    "Location": <0.0-1.0>,
    "Sub_Location": <0.0-1.0>,
    "Maintenance_Category": <0.0-1.0>,
    "Maintenance_Object": <0.0-1.0>,
    "Maintenance_Problem": <0.0-1.0>,
    "Management_Category": <0.0-1.0>,
    "Management_Object": <0.0-1.0>,
    "Priority": <0.0-1.0>
  },
  "missing_fields": ["<field_name>", ...],
  "needs_human_triage": false
}`;
}

/**
 * Build the user message for the classifier.
 */
export function buildClassifierUserMessage(
  input: IssueClassifierInput,
  retryContext?: { retryHint: string; constraint?: string },
): string {
  const parts: string[] = [
    `Issue ID: ${input.issue_id}`,
    `Issue summary: ${input.issue_summary}`,
    `Raw tenant text: ${input.raw_excerpt}`,
  ];

  if (input.followup_answers && input.followup_answers.length > 0) {
    parts.push('\nTenant follow-up answers:');
    for (const answer of input.followup_answers) {
      parts.push(`- ${answer.field_target}: ${String(answer.answer)}`);
    }
  }

  if (input.cue_scores && Object.keys(input.cue_scores).length > 0) {
    parts.push('\nKeyword cue scores (for reference):');
    for (const [field, score] of Object.entries(input.cue_scores)) {
      if (score > 0) parts.push(`- ${field}: ${score.toFixed(2)}`);
    }
  }

  if (retryContext) {
    parts.push(`\nRETRY CONTEXT (${retryContext.retryHint}):`);
    if (retryContext.constraint) {
      parts.push(`CONSTRAINT: ${retryContext.constraint}`);
    }
    parts.push('Please correct your output according to the above constraint.');
  }

  return parts.join('\n');
}
```

**Step 4: Write the classifier adapter**

```typescript
// packages/core/src/llm/adapters/classifier-adapter.ts
import type { IssueClassifierInput, Taxonomy } from '@wo-agent/schemas';
import type { LlmClient } from '../anthropic-client.js';
import { buildClassifierSystemPrompt, buildClassifierUserMessage } from '../prompts/classifier-prompt.js';
import { extractJsonFromResponse } from '../parse-response.js';

/**
 * Create an IssueClassifier adapter function that calls the real LLM.
 * Returns raw parsed JSON — callIssueClassifier handles validation,
 * taxonomy checking, category gating, and retry logic.
 */
export function createClassifierAdapter(
  client: LlmClient,
  taxonomy: Taxonomy,
): (
  input: IssueClassifierInput,
  retryContext?: { retryHint: string; constraint?: string },
) => Promise<unknown> {
  const systemPrompt = buildClassifierSystemPrompt(taxonomy);

  return async (
    input: IssueClassifierInput,
    retryContext?: { retryHint: string; constraint?: string },
  ): Promise<unknown> => {
    const response = await client.complete({
      system: systemPrompt,
      userMessage: buildClassifierUserMessage(input, retryContext),
      model: input.model_id,
    });
    return extractJsonFromResponse(response);
  };
}
```

**Step 5: Run test to verify it passes**

Run: `cd /workspaces/MAINTENANCE && pnpm --filter @wo-agent/core exec vitest run src/llm/__tests__/classifier-adapter.test.ts`
Expected: All 3 tests PASS

**Step 6: Commit**

```bash
git add packages/core/src/llm/prompts/classifier-prompt.ts packages/core/src/llm/adapters/classifier-adapter.ts packages/core/src/llm/__tests__/classifier-adapter.test.ts
git commit -m "feat(llm): add IssueClassifier prompt and adapter for Anthropic API"
```

---

### Task 5: Create follow-up generator prompt and adapter function

**Files:**
- Create: `packages/core/src/llm/prompts/followup-prompt.ts`
- Create: `packages/core/src/llm/adapters/followup-adapter.ts`
- Create: `packages/core/src/llm/__tests__/followup-adapter.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/llm/__tests__/followup-adapter.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createFollowUpAdapter } from '../adapters/followup-adapter.js';
import type { LlmClient } from '../anthropic-client.js';
import type { FollowUpGeneratorInput } from '@wo-agent/schemas';

function mockClient(responseText: string): LlmClient {
  return {
    complete: vi.fn().mockResolvedValue(responseText),
    _sdk: {} as any,
  };
}

const VALID_INPUT: FollowUpGeneratorInput = {
  issue_id: 'issue-1',
  classification: { Category: 'maintenance', Maintenance_Category: 'plumbing' },
  confidence_by_field: { Sub_Location: 0.4, Maintenance_Object: 0.3 },
  missing_fields: ['Sub_Location'],
  fields_needing_input: ['Sub_Location', 'Maintenance_Object'],
  previous_questions: [],
  turn_number: 1,
  total_questions_asked: 0,
  taxonomy_version: '1.0.0',
  prompt_version: '1.0.0',
};

describe('createFollowUpAdapter', () => {
  it('calls LLM and parses follow-up questions', async () => {
    const responseJson = JSON.stringify({
      questions: [
        {
          question_id: 'q-1',
          field_target: 'Sub_Location',
          prompt: 'Where in your unit is the plumbing issue?',
          options: ['kitchen', 'bathroom', 'general'],
          answer_type: 'enum',
        },
      ],
    });
    const client = mockClient(responseJson);
    const adapter = createFollowUpAdapter(client);

    const result = await adapter(VALID_INPUT);
    expect(result).toHaveProperty('questions');
    expect((result as any).questions).toHaveLength(1);
  });

  it('includes fields_needing_input in the user message', async () => {
    const client = mockClient('{"questions":[]}');
    const adapter = createFollowUpAdapter(client);
    await adapter(VALID_INPUT);

    const call = vi.mocked(client.complete).mock.calls[0][0];
    expect(call.userMessage).toContain('Sub_Location');
    expect(call.userMessage).toContain('Maintenance_Object');
  });

  it('includes retry context when provided', async () => {
    const client = mockClient('{"questions":[]}');
    const adapter = createFollowUpAdapter(client);
    await adapter(VALID_INPUT, { retryHint: 'schema_errors' });

    const call = vi.mocked(client.complete).mock.calls[0][0];
    expect(call.userMessage).toContain('schema_errors');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /workspaces/MAINTENANCE && pnpm --filter @wo-agent/core exec vitest run src/llm/__tests__/followup-adapter.test.ts`
Expected: FAIL — module not found

**Step 3: Write the follow-up prompt**

```typescript
// packages/core/src/llm/prompts/followup-prompt.ts
import type { FollowUpGeneratorInput } from '@wo-agent/schemas';

/**
 * System prompt for the FollowUpGenerator LLM tool.
 * Spec references: §15 (follow-ups), §2.3 (schema-lock)
 */
export function buildFollowUpSystemPrompt(): string {
  return `You are a follow-up question generator for a property management service request system.

Your job: Generate targeted questions to help resolve uncertain or missing classification fields for a tenant's maintenance/management issue.

RULES:
1. Generate at most 3 questions per turn.
2. Each question MUST target exactly one field from the fields_needing_input list.
3. Do NOT generate questions for fields not in fields_needing_input.
4. Each question needs a unique question_id (UUID v4 format).
5. Prefer quick-reply options (answer_type: "enum") over free text when the field has known taxonomy values.
6. Use answer_type "yes_no" for boolean questions, "text" only when no reasonable options exist.
7. Write questions in plain, friendly language a tenant would understand.
8. Do not ask about fields the tenant has already answered (check previous_questions).

RESPOND WITH ONLY a JSON object (no markdown, no explanation):
{
  "questions": [
    {
      "question_id": "<uuid>",
      "field_target": "<field name from fields_needing_input>",
      "prompt": "<tenant-friendly question>",
      "options": ["option1", "option2", ...],
      "answer_type": "enum" | "yes_no" | "text"
    }
  ]
}`;
}

/**
 * Build the user message for the follow-up generator.
 */
export function buildFollowUpUserMessage(
  input: FollowUpGeneratorInput,
  retryContext?: { retryHint: string },
): string {
  const parts: string[] = [
    `Issue ID: ${input.issue_id}`,
    `\nCurrent classification:`,
    ...Object.entries(input.classification).map(([k, v]) => `  ${k}: ${v}`),
    `\nConfidence by field:`,
    ...Object.entries(input.confidence_by_field).map(([k, v]) => `  ${k}: ${(v as number).toFixed(2)}`),
    `\nMissing fields: ${input.missing_fields.join(', ') || 'none'}`,
    `\nFields needing input (generate questions for THESE ONLY): ${input.fields_needing_input.join(', ')}`,
    `\nTurn number: ${input.turn_number}`,
    `Total questions asked so far: ${input.total_questions_asked}`,
  ];

  if (input.previous_questions.length > 0) {
    parts.push(`\nPreviously asked (do NOT re-ask unless necessary):`);
    for (const pq of input.previous_questions) {
      parts.push(`  - ${pq.field_target} (asked ${pq.times_asked} time(s))`);
    }
  }

  if (retryContext) {
    parts.push(`\nRETRY (${retryContext.retryHint}): Please correct your output format.`);
  }

  return parts.join('\n');
}
```

**Step 4: Write the follow-up adapter**

```typescript
// packages/core/src/llm/adapters/followup-adapter.ts
import type { FollowUpGeneratorInput } from '@wo-agent/schemas';
import type { LlmClient } from '../anthropic-client.js';
import { buildFollowUpSystemPrompt, buildFollowUpUserMessage } from '../prompts/followup-prompt.js';
import { extractJsonFromResponse } from '../parse-response.js';

/**
 * Create a FollowUpGenerator adapter function that calls the real LLM.
 * Returns raw parsed JSON — callFollowUpGenerator handles validation,
 * field filtering, budget truncation, and retry logic.
 */
export function createFollowUpAdapter(
  client: LlmClient,
): (
  input: FollowUpGeneratorInput,
  retryContext?: { retryHint: string },
) => Promise<unknown> {
  const systemPrompt = buildFollowUpSystemPrompt();

  return async (
    input: FollowUpGeneratorInput,
    retryContext?: { retryHint: string },
  ): Promise<unknown> => {
    const response = await client.complete({
      system: systemPrompt,
      userMessage: buildFollowUpUserMessage(input, retryContext),
      // FollowUpGeneratorInput has no model_id field; uses client default.
      // See Task 5 note below about adding model_id to this input type.
    });
    return extractJsonFromResponse(response);
  };
}
```

**Important note:** `FollowUpGeneratorInput` does not have a `model_id` field, so the adapter omits `model` and falls back to the client's default. This means follow-up generation may not honor the session's pinned `model_id` (spec §5.2). Consider adding `model_id` to `FollowUpGeneratorInput` in a follow-up task. If the implementer adds it during this phase, pass `model: input.model_id` here.

**Step 5: Run test to verify it passes**

Run: `cd /workspaces/MAINTENANCE && pnpm --filter @wo-agent/core exec vitest run src/llm/__tests__/followup-adapter.test.ts`
Expected: All 3 tests PASS

**Step 6: Commit**

```bash
git add packages/core/src/llm/prompts/followup-prompt.ts packages/core/src/llm/adapters/followup-adapter.ts packages/core/src/llm/__tests__/followup-adapter.test.ts
git commit -m "feat(llm): add FollowUpGenerator prompt and adapter for Anthropic API"
```

---

### Task 6: Create LLM adapter factory and barrel exports

**Files:**
- Create: `packages/core/src/llm/create-llm-deps.ts`
- Create: `packages/core/src/llm/index.ts`
- Modify: `packages/core/src/index.ts` (add LLM exports)
- Create: `packages/core/src/llm/__tests__/create-llm-deps.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/llm/__tests__/create-llm-deps.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createLlmDependencies, type LlmDependencies } from '../create-llm-deps.js';

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: '{"issues":[],"issue_count":0}' }],
        }),
      };
    },
  };
});

describe('createLlmDependencies', () => {
  it('returns issueSplitter, issueClassifier, and followUpGenerator functions', () => {
    const deps = createLlmDependencies({
      apiKey: 'test-key',
      taxonomy: { Category: ['maintenance'], Location: ['suite'] } as any,
    });

    expect(deps.issueSplitter).toBeTypeOf('function');
    expect(deps.issueClassifier).toBeTypeOf('function');
    expect(deps.followUpGenerator).toBeTypeOf('function');
  });

  it('uses provided model as default', () => {
    const deps = createLlmDependencies({
      apiKey: 'test-key',
      taxonomy: {} as any,
      defaultModel: 'claude-haiku-4-5-20251001',
    });

    expect(deps).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /workspaces/MAINTENANCE && pnpm --filter @wo-agent/core exec vitest run src/llm/__tests__/create-llm-deps.test.ts`
Expected: FAIL — module not found

**Step 3: Write the factory**

```typescript
// packages/core/src/llm/create-llm-deps.ts
import type { IssueSplitterInput, IssueSplitterOutput, IssueClassifierInput, FollowUpGeneratorInput, Taxonomy } from '@wo-agent/schemas';
import { createAnthropicClient } from './anthropic-client.js';
import { createSplitterAdapter } from './adapters/splitter-adapter.js';
import { createClassifierAdapter } from './adapters/classifier-adapter.js';
import { createFollowUpAdapter } from './adapters/followup-adapter.js';

export interface CreateLlmDepsConfig {
  readonly apiKey: string;
  readonly taxonomy: Taxonomy;
  readonly defaultModel?: string;
  readonly defaultMaxTokens?: number;
}

export interface LlmDependencies {
  readonly issueSplitter: (input: IssueSplitterInput) => Promise<IssueSplitterOutput>;
  readonly issueClassifier: (
    input: IssueClassifierInput,
    retryContext?: { retryHint: string; constraint?: string },
  ) => Promise<unknown>;
  readonly followUpGenerator: (
    input: FollowUpGeneratorInput,
    retryContext?: { retryHint: string },
  ) => Promise<unknown>;
}

/**
 * Create all three LLM dependency functions wired to the Anthropic API.
 * Drop-in replacements for the stubs in orchestrator-factory.ts.
 */
export function createLlmDependencies(config: CreateLlmDepsConfig): LlmDependencies {
  const client = createAnthropicClient({
    apiKey: config.apiKey,
    defaultModel: config.defaultModel,
    defaultMaxTokens: config.defaultMaxTokens,
  });

  return {
    issueSplitter: createSplitterAdapter(client),
    issueClassifier: createClassifierAdapter(client, config.taxonomy),
    followUpGenerator: createFollowUpAdapter(client),
  };
}
```

**Step 4: Write barrel export**

```typescript
// packages/core/src/llm/index.ts
export { createAnthropicClient } from './anthropic-client.js';
export type { LlmClient, LlmClientConfig, CompletionRequest } from './anthropic-client.js';
export { createLlmDependencies } from './create-llm-deps.js';
export type { CreateLlmDepsConfig, LlmDependencies } from './create-llm-deps.js';
export { extractJsonFromResponse } from './parse-response.js';
export { createSplitterAdapter } from './adapters/splitter-adapter.js';
export { createClassifierAdapter } from './adapters/classifier-adapter.js';
export { createFollowUpAdapter } from './adapters/followup-adapter.js';
```

**Step 5: Add LLM exports to core barrel**

Append to `packages/core/src/index.ts`:

```typescript
// --- LLM Adapters (Phase 16) ---
export {
  createAnthropicClient,
  createLlmDependencies,
  extractJsonFromResponse,
  createSplitterAdapter,
  createClassifierAdapter,
  createFollowUpAdapter,
} from './llm/index.js';
export type {
  LlmClient,
  LlmClientConfig,
  CompletionRequest,
  CreateLlmDepsConfig,
  LlmDependencies,
} from './llm/index.js';
```

**Step 6: Run tests to verify everything passes**

Run: `cd /workspaces/MAINTENANCE && pnpm --filter @wo-agent/core test`
Expected: All tests PASS (existing + new)

**Step 7: Commit**

```bash
git add packages/core/src/llm/create-llm-deps.ts packages/core/src/llm/index.ts packages/core/src/llm/__tests__/create-llm-deps.test.ts packages/core/src/index.ts
git commit -m "feat(llm): add adapter factory and barrel exports for LLM wiring"
```

---

### Task 7: Wire real LLM into orchestrator-factory.ts

**Files:**
- Modify: `apps/web/src/lib/orchestrator-factory.ts:97-133`

**Step 1: Write a smoke test for the factory wiring**

```typescript
// apps/web/src/lib/__tests__/orchestrator-factory-llm.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: '{}' }],
      }),
    };
  },
}));

describe('orchestrator-factory LLM wiring', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Reset the global singleton between tests
    const g = globalThis as any;
    delete g.__wo_deps;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('initializes with stubs when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { getOrchestrator } = await import('../orchestrator-factory.js');
    const orchestrator = getOrchestrator();
    expect(orchestrator).toBeDefined();
  });

  it('initializes with real LLM when ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-for-smoke-test';
    const { getOrchestrator } = await import('../orchestrator-factory.js');
    const orchestrator = getOrchestrator();
    expect(orchestrator).toBeDefined();
  });
});
```

Run: `cd /workspaces/MAINTENANCE && pnpm --filter @wo-agent/web exec vitest run src/lib/__tests__/orchestrator-factory-llm.test.ts`
Expected: Both tests PASS

**Step 2: Update orchestrator-factory.ts**

Replace the stub LLM functions (lines 102-133) with conditional real/stub wiring:

```typescript
// At the top of the file, add import:
import { createLlmDependencies, type LlmDependencies } from '@wo-agent/core';

// Inside ensureInitialized(), replace the stub functions with:
    const taxonomy = loadTaxonomy();
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

    let llmDeps: LlmDependencies | null = null;
    if (anthropicApiKey) {
      llmDeps = createLlmDependencies({
        apiKey: anthropicApiKey,
        taxonomy,
        defaultModel: process.env.LLM_DEFAULT_MODEL,
      });
    }

    const deps: OrchestratorDependencies = {
      eventRepo: stores.eventRepo,
      sessionStore: stores.sessionStore,
      idGenerator,
      clock,
      issueSplitter: llmDeps?.issueSplitter ?? (async (input) => ({
        issues: [{ issue_id: randomUUID(), summary: input.raw_text.slice(0, 200), raw_excerpt: input.raw_text }],
        issue_count: 1,
      })),
      issueClassifier: llmDeps?.issueClassifier ?? (async (input: IssueClassifierInput) => ({
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
          Category: 0.7, Location: 0.5, Sub_Location: 0.5,
          Maintenance_Category: 0.6, Maintenance_Object: 0.5,
          Maintenance_Problem: 0.5, Management_Category: 0.0,
          Management_Object: 0.0, Priority: 0.5,
        },
        missing_fields: [],
        needs_human_triage: false,
      })),
      followUpGenerator: llmDeps?.followUpGenerator ?? (async () => ({ questions: [] })),
      cueDict: classificationCues as CueDictionary,
      taxonomy,
      // ... rest of deps unchanged
    };
```

Key changes:
- Import `createLlmDependencies` from `@wo-agent/core`
- Read `ANTHROPIC_API_KEY` from env
- If key present: use real LLM adapters
- If key absent: fall back to existing stubs (no breaking change for local dev)
- Move `loadTaxonomy()` call before deps construction (already there, but ensure it's shared with LLM deps)

**Step 3: Verify typecheck passes**

Run: `cd /workspaces/MAINTENANCE && pnpm --filter @wo-agent/web typecheck`
Expected: No type errors

**Step 4: Verify existing tests still pass**

Run: `cd /workspaces/MAINTENANCE && pnpm test`
Expected: All tests PASS across all packages

**Step 5: Commit**

```bash
git add apps/web/src/lib/orchestrator-factory.ts
git commit -m "feat(llm): wire real Anthropic LLM adapters in orchestrator factory"
```

---

### Task 8: Update environment configuration

**Files:**
- Modify: `.env.example`

**Step 1: Add LLM environment variables**

Append to `.env.example`:

```bash
# Anthropic API key for LLM tools (IssueSplitter, IssueClassifier, FollowUpGenerator)
# Get from: https://console.anthropic.com/settings/keys
# If not set, stubs with hardcoded responses are used (safe for local dev)
ANTHROPIC_API_KEY=

# Optional: override the default LLM model (default: claude-sonnet-4-20250514)
# LLM_DEFAULT_MODEL=claude-haiku-4-5-20251001
```

**Step 2: Update dev.sh to show LLM status**

Add a line to `scripts/dev.sh` after the "ready!" message to indicate LLM mode:

```bash
if [ -n "$ANTHROPIC_API_KEY" ]; then
  echo "  LLM: Anthropic (configured)"
else
  echo "  LLM: Stubs (set ANTHROPIC_API_KEY for real LLM)"
fi
```

**Step 3: Commit**

```bash
git add .env.example scripts/dev.sh
git commit -m "chore: add ANTHROPIC_API_KEY to env config and dev script"
```

---

### Task 9: End-to-end verification

**Files:** No new files

**Step 1: Run full test suite**

Run: `cd /workspaces/MAINTENANCE && pnpm test`
Expected: All tests PASS

**Step 2: Run typecheck**

Run: `cd /workspaces/MAINTENANCE && pnpm typecheck`
Expected: No type errors

**Step 3: Verify dev server starts (without API key)**

Run: `cd /workspaces/MAINTENANCE && pnpm --filter @wo-agent/web exec next build`
Expected: Build succeeds (stubs used when no API key)

**Step 4: Manual verification with API key (if available)**

Set `ANTHROPIC_API_KEY` in environment, start dev server, submit a test message through the chat UI, and verify:
- Splitter correctly identifies issues from multi-issue messages
- Classifier assigns taxonomy values from the real taxonomy
- Follow-up generator asks relevant questions for low-confidence fields

---

## Key Design Decisions

1. **Adapter layer in `packages/core`**: The LLM adapter lives in core because it's a core concern consumed by the orchestrator factory. The Anthropic SDK is a normal dependency of core.

2. **Graceful fallback**: When `ANTHROPIC_API_KEY` is not set, existing stubs are used. This is a non-breaking change — local dev without an API key continues to work identically.

3. **JSON extraction, not tool_use**: We use plain text responses and parse JSON rather than Anthropic's tool_use feature. This keeps the adapter simple and the prompts portable across providers.

4. **Prompts are code, not config**: System prompts live as TypeScript functions (not JSON files) so they can interpolate the taxonomy and be versioned alongside the code.

5. **Existing validation unchanged**: The adapter returns raw `unknown` JSON. The existing `callIssueSplitter`, `callIssueClassifier`, and `callFollowUpGenerator` pipelines handle all schema validation, taxonomy validation, category gating, confidence computation, and retry logic. Zero changes to those modules.

6. **Model pinning**: The session's `pinned_versions.model_id` flows through to the adapter, which passes it to the Anthropic SDK as the `model` parameter. The `defaultModel` config is only used when no model_id is specified.
