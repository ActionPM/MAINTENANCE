import { ConversationState, DEFAULT_CONFIDENCE_CONFIG } from '@wo-agent/schemas';
import type { IssueClassifierInput, IssueClassifierOutput, ConfidenceConfig, FollowupAnswer } from '@wo-agent/schemas';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';
import { callIssueClassifier } from '../../classifier/issue-classifier.js';
import { computeCueScores } from '../../classifier/cue-scoring.js';
import { computeAllFieldConfidences, determineFieldsNeedingInput } from '../../classifier/confidence.js';
import { setClassificationResults } from '../../session/session.js';
import type { IssueClassificationResult } from '../../session/types.js';
import { SystemEvent } from '../../state-machine/system-events.js';
import { resolveLlmClassifySuccess } from '../../state-machine/guards.js';

/**
 * Handle ANSWER_FOLLOWUPS — re-classification with tenant follow-up answers (spec §11.2, §14).
 *
 * Flow:
 * 1. Extract tenant answers from request.tenant_input
 * 2. Guard: must have split_issues on session
 * 3. Enter classification_in_progress (intermediate step)
 * 4. For each split issue:
 *    a. Compute cue scores
 *    b. Build classifier input with followup_answers from tenant answers
 *    c. Call classifier
 *    d. Compute confidence
 *    e. Determine fields still needing input
 * 5. Store results via setClassificationResults
 * 6. Resolve target state via resolveLlmClassifySuccess
 */
export async function handleAnswerFollowups(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  const { session, deps } = ctx;
  const issues = session.split_issues;

  // Extract answers from tenant input
  const tenantInput = ctx.request.tenant_input as { answers?: readonly { question_id: string; answer: unknown }[] };
  const rawAnswers = tenantInput.answers ?? [];

  // Map from TenantInputAnswerFollowups format (question_id) to FollowupAnswer format (field_target)
  const followupAnswers: FollowupAnswer[] = rawAnswers.map(a => ({
    field_target: a.question_id,
    answer: a.answer as string | boolean,
  }));

  if (!issues || issues.length === 0) {
    return {
      newState: session.state,
      session,
      uiMessages: [{ role: 'agent', content: 'No issues to re-classify.' }],
      errors: [{ code: 'NO_ISSUES', message: 'Cannot re-classify: no split issues on session' }],
    };
  }

  const intermediateStep = {
    state: ConversationState.CLASSIFICATION_IN_PROGRESS,
    eventType: 'state_transition' as const,
    eventPayload: { issue_count: issues.length, followup_answer_count: followupAnswers.length },
  };

  const cueDict = deps.cueDict;
  const taxonomy = deps.taxonomy;
  const confidenceConfig: ConfidenceConfig =
    deps.confidenceConfig ?? DEFAULT_CONFIDENCE_CONFIG;

  const classificationResults: IssueClassificationResult[] = [];
  let anyFieldsNeedInput = false;
  let anyLlmError = false;

  for (const issue of issues) {
    const cueScoreMap = computeCueScores(
      `${issue.summary} ${issue.raw_excerpt}`,
      cueDict,
    );

    const cueScoresForInput: Record<string, number> = {};
    for (const [field, result] of Object.entries(cueScoreMap)) {
      cueScoresForInput[field] = result.score;
    }

    const classifierInput: IssueClassifierInput = {
      issue_id: issue.issue_id,
      issue_summary: issue.summary,
      raw_excerpt: issue.raw_excerpt,
      taxonomy_version: session.pinned_versions.taxonomy_version,
      model_id: session.pinned_versions.model_id,
      prompt_version: session.pinned_versions.prompt_version,
      cue_scores: cueScoresForInput,
      followup_answers: followupAnswers,
    };

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

    if (classifierResult.status === 'llm_fail') {
      anyLlmError = true;
      break;
    }

    let output: IssueClassifierOutput;
    if (classifierResult.status === 'needs_human_triage') {
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

    const computedConfidence = computeAllFieldConfidences({
      classification: output.classification,
      modelConfidence: output.model_confidence,
      cueResults: cueScoreMap,
      config: confidenceConfig,
    });

    const fieldsNeedingInput = output.needs_human_triage
      ? []
      : determineFieldsNeedingInput(computedConfidence, confidenceConfig, output.missing_fields);

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

  if (anyLlmError) {
    return {
      newState: ConversationState.LLM_ERROR_RETRYABLE,
      session,
      intermediateSteps: [intermediateStep],
      finalSystemAction: SystemEvent.LLM_FAIL,
      uiMessages: [{
        role: 'agent',
        content: 'I had trouble re-classifying your issue(s). Please try again.',
      }],
      errors: [{ code: 'CLASSIFIER_FAILED', message: 'Re-classification LLM call failed' }],
      eventPayload: { error: 'classifier_failed' },
      eventType: 'error_occurred',
    };
  }

  const updatedSession = setClassificationResults(session, classificationResults);

  const allFieldsNeedingInput = classificationResults.flatMap(r => [...r.fieldsNeedingInput]);
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
        ? 'Thank you. I still need a few more details to complete the work order.'
        : 'Thank you for the additional details. Please review and confirm.',
    }],
    eventPayload: {
      followup_answers: followupAnswers,
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
