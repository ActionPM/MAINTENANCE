import type { ClassifierAdapter } from './classifier-adapters.js';
import { runOrchestratorHarness } from './orchestrator-harness.js';

export interface ConversationReplayOptions {
  readonly example_id: string;
  readonly conversation_text: string;
  readonly split_issues_expected: readonly { issue_text: string }[];
  readonly classifierAdapter: ClassifierAdapter;
  readonly followupAdapter: unknown | null;
  readonly taxonomyVersion: string;
}

export interface ConversationReplayResult {
  readonly example_id: string;
  readonly terminal_state: string;
  readonly event_trace: readonly Record<string, unknown>[];
  readonly issue_results: readonly Record<string, unknown>[];
  readonly needs_human_triage: boolean;
  readonly escape_hatch_triggered: boolean;
}

export async function runConversationReplay(
  opts: ConversationReplayOptions,
): Promise<ConversationReplayResult> {
  const harnessResult = await runOrchestratorHarness(
    {
      classifierAdapter: opts.classifierAdapter,
      followupAdapter: opts.followupAdapter,
    },
    opts.conversation_text,
    opts.split_issues_expected,
    {
      example_id: opts.example_id,
      taxonomyVersion: opts.taxonomyVersion,
    },
  );

  const needsHumanTriage = harnessResult.terminal_state === 'needs_human_triage';
  const escapeHatchTriggered =
    harnessResult.terminal_state === 'llm_error_terminal' ||
    harnessResult.terminal_state === 'needs_human_triage';

  return {
    example_id: opts.example_id,
    terminal_state: harnessResult.terminal_state,
    event_trace: harnessResult.event_trace,
    issue_results: harnessResult.issue_results,
    needs_human_triage: needsHumanTriage,
    escape_hatch_triggered: escapeHatchTriggered,
  };
}
