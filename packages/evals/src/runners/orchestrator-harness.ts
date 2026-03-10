import type { ClassifierAdapter } from './classifier-adapters.js';
import { runIssueReplay, type IssueReplayResult } from './issue-replay.js';

export interface OrchestratorHarnessConfig {
  readonly classifierAdapter: ClassifierAdapter;
  readonly followupAdapter: unknown | null;
}

export interface HarnessResult {
  readonly terminal_state: string;
  readonly event_trace: readonly Record<string, unknown>[];
  readonly issue_results: readonly IssueReplayResult[];
}

/**
 * Runs a lightweight orchestrator harness that replays a conversation
 * through classification without side effects.
 *
 * Since the real orchestrator has deep coupling to DB/notifications/WO creation,
 * this harness directly chains the pipeline steps:
 * 1. Split issues (use provided splits)
 * 2. For each issue: classify via adapter -> cue scoring -> constraint resolution -> confidence
 * 3. Determine terminal state based on confidence/follow-up needs
 * 4. Capture all intermediate results as event trace entries
 */
export async function runOrchestratorHarness(
  config: OrchestratorHarnessConfig,
  conversationText: string,
  splitIssues: readonly { issue_text: string }[],
  options: { example_id: string; taxonomyVersion: string },
): Promise<HarnessResult> {
  const eventTrace: Record<string, unknown>[] = [];
  const issueResults: IssueReplayResult[] = [];

  eventTrace.push({
    type: 'conversation_start',
    conversation_text: conversationText,
    split_count: splitIssues.length,
  });

  // Replay each split issue through the classification pipeline
  for (let i = 0; i < splitIssues.length; i++) {
    const split = splitIssues[i];

    eventTrace.push({
      type: 'issue_split',
      issue_index: i,
      issue_text: split.issue_text,
    });

    const result = await runIssueReplay({
      example_id: options.example_id,
      issue_index: i,
      issue_text: split.issue_text,
      expected_classification: {},  // Not used for pipeline execution
      classifierAdapter: config.classifierAdapter,
      taxonomyVersion: options.taxonomyVersion,
    });

    issueResults.push(result);

    eventTrace.push({
      type: 'issue_classified',
      issue_index: i,
      status: result.status,
      classification: result.classification,
      confidenceByField: result.confidenceByField,
      fieldsNeedingInput: result.fieldsNeedingInput,
      hierarchyValid: result.hierarchyValid,
      errors: result.errors,
    });
  }

  // Determine terminal state from aggregated issue results
  const terminalState = deriveTerminalState(issueResults);

  eventTrace.push({
    type: 'terminal_state_resolved',
    terminal_state: terminalState,
  });

  return {
    terminal_state: terminalState,
    event_trace: eventTrace,
    issue_results: issueResults,
  };
}

/**
 * Derive the terminal state from all issue replay results.
 *
 * - If any issue has needs_human_triage -> needs_human_triage
 * - If any issue has schema_fail or taxonomy_fail -> llm_error_retryable
 * - If any issue has fields needing input -> needs_tenant_input
 * - Otherwise -> tenant_confirmation_pending
 */
function deriveTerminalState(results: readonly IssueReplayResult[]): string {
  const hasHumanTriage = results.some(r => r.status === 'needs_human_triage');
  if (hasHumanTriage) return 'needs_human_triage';

  const hasError = results.some(r => r.status === 'schema_fail' || r.status === 'taxonomy_fail');
  if (hasError) return 'llm_error_retryable';

  const hasFieldsNeeding = results.some(
    r => r.fieldsNeedingInput != null && r.fieldsNeedingInput.length > 0,
  );
  if (hasFieldsNeeding) return 'needs_tenant_input';

  return 'tenant_confirmation_pending';
}
