import { randomUUID } from 'crypto';
import type { IssueSplitterInput, IssueSplitterOutput } from '@wo-agent/schemas';

/**
 * Deterministic demo splitter that pattern-matches on input text to produce
 * scenario-appropriate splits. Used when USE_DEMO_FIXTURES=true.
 *
 * Scenarios:
 *   A (multi-issue): text contains "faucet" + "light" + "cockroach" → 3 issues
 *   B (emergency):   text contains "flood" or "water everywhere"   → 1 issue
 *   C (default):     anything else                                  → 1 issue
 */
export function createDemoSplitter(): (
  input: IssueSplitterInput,
) => Promise<IssueSplitterOutput> {
  return async (input: IssueSplitterInput): Promise<IssueSplitterOutput> => {
    const text = input.raw_text.toLowerCase();

    // Scenario A: multi-issue (faucet + light + cockroach)
    if (text.includes('faucet') && text.includes('light') && text.includes('cockroach')) {
      const issues = [
        {
          issue_id: randomUUID(),
          summary: 'Kitchen faucet is leaking with water pooling under the sink',
          raw_excerpt:
            'The kitchen faucet is leaking and there\'s water under the sink.',
        },
        {
          issue_id: randomUUID(),
          summary: 'Hallway light near front door is flickering on and off',
          raw_excerpt:
            'The hallway light near my front door has been flickering on and off for a week.',
        },
        {
          issue_id: randomUUID(),
          summary: 'Cockroach sighting in the bathroom',
          raw_excerpt:
            'I think I saw a cockroach in the bathroom last night.',
        },
      ];
      return { issues, issue_count: issues.length };
    }

    // Scenario B: emergency (flood keywords — risk scanner handles detection)
    if (text.includes('flood') || text.includes('water everywhere')) {
      const issues = [
        {
          issue_id: randomUUID(),
          summary: 'Major water leak — water flooding from pipe under kitchen sink',
          raw_excerpt: input.raw_text,
        },
      ];
      return { issues, issue_count: 1 };
    }

    // Scenario C: single issue (default)
    const issues = [
      {
        issue_id: randomUUID(),
        summary: input.raw_text.slice(0, 200),
        raw_excerpt: input.raw_text,
      },
    ];
    return { issues, issue_count: 1 };
  };
}
