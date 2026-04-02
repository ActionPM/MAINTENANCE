import {
  ConversationState,
  DEFAULT_CONFIDENCE_CONFIG,
  DEFAULT_FOLLOWUP_CAPS,
  type Taxonomy,
  taxonomyConstraints,
  validateHierarchicalConstraints,
} from '@wo-agent/schemas';
import type {
  IssueClassifierInput,
  IssueClassifierOutput,
  ConfidenceConfig,
  FollowUpGeneratorInput,
  FollowUpCaps,
} from '@wo-agent/schemas';
import { resolveConstraintImpliedFields } from '../../classifier/constraint-resolver.js';
import { checkCompleteness } from '../../classifier/completeness-gate.js';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';
import { callIssueClassifier } from '../../classifier/issue-classifier.js';
import { computeCueScores } from '../../classifier/cue-scoring.js';
import { applyDirectAnchorBoost } from '../../classifier/direct-anchors.js';
import {
  ClassifierTriageReason,
  RoutingReason,
  computeRecoverableViaFollowup,
  normalizeCrossDomainClassification,
} from '../../classifier/triage-routing.js';
import {
  computeAllFieldConfidences,
  extractFlatConfidence,
  determineFieldsNeedingInput,
} from '../../classifier/confidence.js';
import {
  setClassificationResults,
  updateFollowUpTracking,
  setPendingFollowUpQuestions,
  setConfirmationTracking,
} from '../../session/session.js';
import { computeContentHash } from '../../confirmation/payload-builder.js';
import type { IssueClassificationResult } from '../../session/types.js';
import type { ConversationSession } from '../../session/types.js';
import type { SplitIssue } from '@wo-agent/schemas';
import { SystemEvent } from '../../state-machine/system-events.js';
import { checkFollowUpCaps } from '../../followup/caps.js';
import { callFollowUpGenerator } from '../../followup/followup-generator.js';
import { buildFollowUpQuestionsEvent } from '../../followup/event-builder.js';

/**
 * Apply confirmation tracking fields to a session before transitioning
 * to tenant_confirmation_pending.
 */
function applyConfirmationTracking(
  session: ConversationSession,
  issues: readonly SplitIssue[],
  clock: () => string,
): ConversationSession {
  const sourceHash = computeContentHash(issues.map((i) => i.raw_excerpt).join('|'));
  const splitHash = computeContentHash(
    JSON.stringify(issues.map((i) => ({ id: i.issue_id, summary: i.summary }))),
  );
  return setConfirmationTracking(session, {
    confirmationEnteredAt: clock(),
    sourceTextHash: sourceHash,
    splitHash,
  });
}

function serializeClassificationResults(results: readonly IssueClassificationResult[]) {
  return results.map((result) => ({
    issue_id: result.issue_id,
    classification: result.classifierOutput.classification,
    computed_confidence: result.computedConfidence,
    fields_needing_input: result.fieldsNeedingInput,
    needs_human_triage: result.classifierOutput.needs_human_triage,
    recoverable_via_followup: result.recoverable_via_followup,
    classifier_triage_reason: result.classifier_triage_reason,
    routing_reason: result.routing_reason,
  }));
}

function assignRoutingReason(
  results: readonly IssueClassificationResult[],
  routingReason: RoutingReason,
  predicate?: (result: IssueClassificationResult) => boolean,
): IssueClassificationResult[] {
  return results.map((result) =>
    predicate && !predicate(result)
      ? result
      : {
          ...result,
          routing_reason: routingReason,
        },
  );
}

function forceReviewRouting(
  results: readonly IssueClassificationResult[],
  routingReason: RoutingReason,
): IssueClassificationResult[] {
  return results.map((result) => ({
    ...result,
    classifierOutput: { ...result.classifierOutput, needs_human_triage: true },
    fieldsNeedingInput: [],
    shouldAskFollowup: false,
    followupTypes: {},
    recoverable_via_followup: false,
    routing_reason: routingReason,
  }));
}

/**
 * Handle START_CLASSIFICATION (spec §11.2, §14).
 *
 * Matrix-compliant flow:
 * 1. Guard: must have split_issues on session
 * 2. Enter classification_in_progress (intermediate — recorded as event)
 * 3. For each split issue: cue scoring → classifier call → confidence heuristic
 * 4. On success: LLM_CLASSIFY_SUCCESS → tenant_confirmation_pending or needs_tenant_input
 * 5. On failure: LLM_FAIL → llm_error_retryable
 */
export async function handleStartClassification(
  ctx: ActionHandlerContext,
): Promise<ActionHandlerResult> {
  const { session, deps } = ctx;
  const issues = session.split_issues;
  const obsCtx = ctx.request_id
    ? { request_id: ctx.request_id, timestamp: deps.clock() }
    : undefined;

  if (!issues || issues.length === 0) {
    return {
      newState: session.state,
      session,
      uiMessages: [{ role: 'agent', content: 'No issues to classify.' }],
      errors: [{ code: 'NO_ISSUES', message: 'Cannot classify: no split issues on session' }],
    };
  }

  const intermediateStep = {
    state: ConversationState.CLASSIFICATION_IN_PROGRESS,
    eventType: 'state_transition' as const,
    eventPayload: { issue_count: issues.length },
  };

  const cueDict = deps.cueDict;
  const taxonomy = deps.taxonomy;
  const confidenceConfig: ConfidenceConfig = deps.confidenceConfig ?? DEFAULT_CONFIDENCE_CONFIG;

  const classificationResults: IssueClassificationResult[] = [];
  let anyFieldsNeedInput = false;
  let anyLlmError = false;

  for (const issue of issues) {
    const cueScoreMap = computeCueScores(`${issue.summary} ${issue.raw_excerpt}`, cueDict);

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
      cue_version: session.pinned_versions.cue_version,
      cue_scores: cueScoresForInput,
    };

    const taxonomyVersion = session.pinned_versions.taxonomy_version;
    let classifierResult;
    try {
      classifierResult = await callIssueClassifier(
        classifierInput,
        deps.issueClassifier,
        taxonomy,
        taxonomyVersion,
        deps.metricsRecorder,
        obsCtx,
      );
    } catch (_err) {
      anyLlmError = true;
      break;
    }

    if (classifierResult.status === 'llm_fail') {
      anyLlmError = true;
      break;
    }

    let output: IssueClassifierOutput;
    let classifierTriageReason = classifierResult.triage_reason;
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

    // Step A: Validate hierarchical constraints (I7)
    if (!output.needs_human_triage) {
      const hierarchyResult = validateHierarchicalConstraints(
        output.classification,
        taxonomyConstraints,
        taxonomyVersion,
      );
      if (!hierarchyResult.valid) {
        // One constrained retry with constraint hint
        const constraintHint = `Hierarchical violations: ${hierarchyResult.violations.join('; ')}`;
        try {
          const retryInput: IssueClassifierInput = {
            ...classifierInput,
            retry_context: constraintHint,
          };
          const retryResult = await callIssueClassifier(
            retryInput,
            deps.issueClassifier,
            taxonomy,
            taxonomyVersion,
            deps.metricsRecorder,
            obsCtx,
          );
          if (retryResult.status === 'ok' && retryResult.output) {
            const retryHierarchy = validateHierarchicalConstraints(
              retryResult.output.classification,
              taxonomyConstraints,
              taxonomyVersion,
            );
            if (retryHierarchy.valid) {
              output = retryResult.output;
            }
          }
        } catch {
          // Retry failed, continue with original output
        }
        // If still invalid after retry, log violation and escalate
        const postRetryCheck = validateHierarchicalConstraints(
          output.classification,
          taxonomyConstraints,
          taxonomyVersion,
        );
        if (!postRetryCheck.valid) {
          output = { ...output, needs_human_triage: true };
          classifierTriageReason = ClassifierTriageReason.CONSTRAINT_RETRY_FAILED;
          await deps.eventRepo.insert({
            event_id: deps.idGenerator(),
            event_type: 'classification_hierarchy_violation_unresolved',
            conversation_id: session.conversation_id,
            issue_id: issue.issue_id,
            payload: { violations: postRetryCheck.violations },
            created_at: deps.clock(),
          });
        }
      }
    }

    // Step B: Resolve implied fields (C1 — only missing/vague, logged)
    const impliedFields = output.needs_human_triage
      ? {}
      : resolveConstraintImpliedFields(output.classification, taxonomyConstraints, taxonomyVersion);
    if (Object.keys(impliedFields).length > 0) {
      output = { ...output, classification: { ...output.classification, ...impliedFields } };
      await deps.eventRepo.insert({
        event_id: deps.idGenerator(),
        event_type: 'classification_constraint_resolution',
        conversation_id: session.conversation_id,
        issue_id: issue.issue_id,
        payload: { resolved_fields: impliedFields },
        created_at: deps.clock(),
      });
    }

    // Step C: Completeness gate — check for blank meaningful fields
    let completenessIncomplete: string[] = [];
    let completenessFollowupTypes: Record<string, string> = {};

    output = {
      ...output,
      classification: normalizeCrossDomainClassification(output.classification),
    };
    const category = output.classification.Category ?? '';
    const completenessResult = checkCompleteness(output.classification, category);
    completenessIncomplete = [...completenessResult.incompleteFields];
    completenessFollowupTypes = { ...completenessResult.followupTypes };

    // Step D: Confidence with constraint boost (C2) — only on populated fields
    const boostedCueScoreMap = applyDirectAnchorBoost(cueScoreMap, confidenceConfig);
    const confidenceDetail = computeAllFieldConfidences({
      classification: output.classification,
      modelConfidence: output.model_confidence,
      cueResults: boostedCueScoreMap,
      config: confidenceConfig,
      impliedFields,
    });
    const computedConfidence = extractFlatConfidence(confidenceDetail);

    let fieldsNeedingInput = determineFieldsNeedingInput({
      confidenceByField: confidenceDetail,
      config: confidenceConfig,
      missingFields: output.missing_fields,
      classificationOutput: output.classification,
    });

    // Short-circuit: remove constraint-implied fields — deterministically resolved.
    if (Object.keys(impliedFields).length > 0) {
      fieldsNeedingInput = fieldsNeedingInput.filter((f) => !(f in impliedFields));
    }

    // Merge completeness gate results with confidence-band results (deduplicated)
    for (const field of completenessIncomplete) {
      if (!fieldsNeedingInput.includes(field)) {
        fieldsNeedingInput.push(field);
      }
    }

    if (fieldsNeedingInput.length > 0) {
      anyFieldsNeedInput = true;
    }

    const recoverableViaFollowup = computeRecoverableViaFollowup({
      needsHumanTriage: output.needs_human_triage,
      fieldsNeedingInput,
      classification: output.classification,
      taxonomy: taxonomy as Taxonomy,
      taxonomyVersion,
    });

    classificationResults.push({
      issue_id: issue.issue_id,
      classifierOutput: output,
      computedConfidence,
      fieldsNeedingInput,
      shouldAskFollowup: fieldsNeedingInput.length > 0,
      followupTypes: completenessFollowupTypes,
      constraintPassed: !output.needs_human_triage,
      recoverable_via_followup: recoverableViaFollowup,
      classifier_triage_reason: classifierTriageReason,
    });
  }

  if (anyLlmError) {
    return {
      newState: ConversationState.LLM_ERROR_RETRYABLE,
      session,
      intermediateSteps: [intermediateStep],
      finalSystemAction: SystemEvent.LLM_FAIL,
      uiMessages: [
        {
          role: 'agent',
          content: 'I had trouble classifying your issue(s). Please try again.',
        },
      ],
      errors: [{ code: 'CLASSIFIER_FAILED', message: 'Classification LLM call failed' }],
      eventPayload: { error: 'classifier_failed' },
      eventType: 'error_occurred',
    };
  }

  let updatedSession = setClassificationResults(session, classificationResults);
  const anyRecoverableTriageIssue = classificationResults.some(
    (result) => result.classifierOutput.needs_human_triage && result.recoverable_via_followup,
  );
  const anyUnrecoverableTriageIssue = classificationResults.some(
    (result) => result.classifierOutput.needs_human_triage && !result.recoverable_via_followup,
  );

  if (anyUnrecoverableTriageIssue) {
    // Review routing is conversation-scoped by product decision. Preserve per-issue
    // recoverability in recoverable_via_followup so observers can still identify
    // which issues were individually recoverable after the whole conversation is
    // forced onto the review path.
    const routedResults = assignRoutingReason(
      classificationResults,
      RoutingReason.UNRECOVERABLE_CLASSIFICATION,
    );
    updatedSession = setClassificationResults(updatedSession, routedResults);
    updatedSession = applyConfirmationTracking(updatedSession, issues, deps.clock);

    return {
      newState: ConversationState.TENANT_CONFIRMATION_PENDING,
      session: updatedSession,
      intermediateSteps: [intermediateStep],
      finalSystemAction: SystemEvent.LLM_CLASSIFY_SUCCESS,
      uiMessages: [
        {
          role: 'agent',
          content:
            "I've classified your issue(s), but some details still need human review. Please review and submit this request for review.",
        },
      ],
      eventPayload: {
        classification_results: serializeClassificationResults(routedResults),
      },
      eventType: 'state_transition',
    };
  }

  // --- Follow-up generation when fields need input ---
  if (anyFieldsNeedInput) {
    const routedResults = anyRecoverableTriageIssue
      ? assignRoutingReason(
          classificationResults,
          RoutingReason.RECOVERED_VIA_FOLLOWUP,
          (result) => result.classifierOutput.needs_human_triage && result.recoverable_via_followup,
        )
      : [...classificationResults];
    updatedSession = setClassificationResults(updatedSession, routedResults);

    const followUpCaps: FollowUpCaps = deps.followUpCaps ?? DEFAULT_FOLLOWUP_CAPS;
    const allFieldsNeedingInput = routedResults.flatMap((r) => [...r.fieldsNeedingInput]);

    const capsCheck = checkFollowUpCaps({
      turnNumber: updatedSession.followup_turn_number + 1,
      totalQuestionsAsked: updatedSession.total_questions_asked,
      previousQuestions: updatedSession.previous_questions,
      fieldsNeedingInput: allFieldsNeedingInput,
      caps: followUpCaps,
    });

    if (capsCheck.escapeHatch) {
      const triageResults = forceReviewRouting(routedResults, RoutingReason.CAPS_EXHAUSTED);
      updatedSession = setClassificationResults(updatedSession, triageResults);
      updatedSession = applyConfirmationTracking(updatedSession, issues, deps.clock);

      return {
        newState: ConversationState.TENANT_CONFIRMATION_PENDING,
        session: updatedSession,
        intermediateSteps: [intermediateStep],
        finalSystemAction: SystemEvent.LLM_CLASSIFY_SUCCESS,
        uiMessages: [
          {
            role: 'agent',
            content:
              "I've classified your issue(s), but I can't ask more follow-up questions in this flow. Please review and submit this request for human review.",
          },
        ],
        eventPayload: {
          escape_hatch: true,
          reason: capsCheck.reason,
          classification_results: serializeClassificationResults(triageResults),
        },
        eventType: 'state_transition',
      };
    }

    // Call FollowUpGenerator for the first issue with fields needing input
    const targetIssue = routedResults.find((r) => r.fieldsNeedingInput.length > 0)!;
    const targetIssueData = issues.find((i) => i.issue_id === targetIssue.issue_id);
    const followUpInput: FollowUpGeneratorInput = {
      issue_id: targetIssue.issue_id,
      classification: targetIssue.classifierOutput.classification,
      confidence_by_field: targetIssue.computedConfidence,
      missing_fields: [...targetIssue.classifierOutput.missing_fields],
      fields_needing_input: [...capsCheck.eligibleFields],
      previous_questions: [...updatedSession.previous_questions],
      turn_number: updatedSession.followup_turn_number + 1,
      total_questions_asked: updatedSession.total_questions_asked,
      taxonomy_version: session.pinned_versions.taxonomy_version,
      prompt_version: session.pinned_versions.prompt_version,
      cue_version: session.pinned_versions.cue_version,
      original_text: targetIssueData?.raw_excerpt,
    };

    let followUpQuestions;
    try {
      const followUpResult = await callFollowUpGenerator(
        followUpInput,
        deps.followUpGenerator,
        capsCheck.remainingQuestionBudget,
        deps.metricsRecorder,
        obsCtx,
      );

      if (followUpResult.status === 'llm_fail') {
        const triageResults = forceReviewRouting(
          routedResults,
          RoutingReason.FOLLOWUP_GENERATION_FAILED,
        );
        updatedSession = setClassificationResults(updatedSession, triageResults);
        updatedSession = applyConfirmationTracking(updatedSession, issues, deps.clock);

        return {
          newState: ConversationState.TENANT_CONFIRMATION_PENDING,
          session: updatedSession,
          intermediateSteps: [intermediateStep],
          finalSystemAction: SystemEvent.LLM_CLASSIFY_SUCCESS,
          uiMessages: [
            {
              role: 'agent',
              content:
                "I've classified your issue(s), but I couldn't generate the follow-up questions needed to finish intake. Please review and submit this request for human review.",
            },
          ],
          eventPayload: {
            followup_generation_failed: true,
            classification_results: serializeClassificationResults(triageResults),
          },
          eventType: 'state_transition',
        };
      }

      followUpQuestions = followUpResult.output!.questions;

      // Bug fix: if questions are filtered/truncated to empty, route to escape hatch
      // instead of transitioning to needs_tenant_input with an empty pending list
      // (which would deadlock because ANSWER_FOLLOWUPS rejects NO_PENDING_QUESTIONS).
      if (followUpQuestions.length === 0) {
        const triageResults = forceReviewRouting(
          routedResults,
          RoutingReason.FOLLOWUP_GENERATION_FAILED,
        );
        updatedSession = setClassificationResults(updatedSession, triageResults);
        updatedSession = applyConfirmationTracking(updatedSession, issues, deps.clock);

        return {
          newState: ConversationState.TENANT_CONFIRMATION_PENDING,
          session: updatedSession,
          intermediateSteps: [intermediateStep],
          finalSystemAction: SystemEvent.LLM_CLASSIFY_SUCCESS,
          uiMessages: [
            {
              role: 'agent',
              content:
                "I've classified your issue(s), but I couldn't generate the follow-up questions needed to finish intake. Please review and submit this request for human review.",
            },
          ],
          eventPayload: {
            escape_hatch: true,
            reason: 'followup_generator_returned_empty_questions',
            classification_results: serializeClassificationResults(triageResults),
          },
          eventType: 'state_transition',
        };
      }
    } catch {
      const triageResults = forceReviewRouting(
        routedResults,
        RoutingReason.FOLLOWUP_GENERATION_FAILED,
      );
      updatedSession = setClassificationResults(updatedSession, triageResults);
      updatedSession = applyConfirmationTracking(updatedSession, issues, deps.clock);

      return {
        newState: ConversationState.TENANT_CONFIRMATION_PENDING,
        session: updatedSession,
        intermediateSteps: [intermediateStep],
        finalSystemAction: SystemEvent.LLM_CLASSIFY_SUCCESS,
        uiMessages: [
          {
            role: 'agent',
            content:
              "I've classified your issue(s), but I couldn't generate the follow-up questions needed to finish intake. Please review and submit this request for human review.",
          },
        ],
        eventPayload: {
          followup_generation_error: true,
          classification_results: serializeClassificationResults(triageResults),
        },
        eventType: 'state_transition',
      };
    }

    // Record followup_event (questions asked, answers null)
    const followUpEvent = buildFollowUpQuestionsEvent({
      eventId: deps.idGenerator(),
      conversationId: session.conversation_id,
      issueId: targetIssue.issue_id,
      turnNumber: updatedSession.followup_turn_number + 1,
      questions: followUpQuestions,
      createdAt: deps.clock(),
    });
    await deps.eventRepo.insert(followUpEvent);

    // Update session tracking
    updatedSession = updateFollowUpTracking(updatedSession, followUpQuestions);
    updatedSession = setPendingFollowUpQuestions(updatedSession, followUpQuestions);

    return {
      newState: ConversationState.NEEDS_TENANT_INPUT,
      session: updatedSession,
      intermediateSteps: [intermediateStep],
      finalSystemAction: SystemEvent.LLM_CLASSIFY_SUCCESS,
      uiMessages: [
        {
          role: 'agent',
          content:
            "I've classified your issue(s) but need a few more details to complete the work order.",
        },
      ],
      eventPayload: {
        classification_results: serializeClassificationResults(routedResults),
      },
      eventType: 'state_transition',
    };
  }

  // All fields resolved — proceed to confirmation
  updatedSession = applyConfirmationTracking(updatedSession, issues, deps.clock);

  return {
    newState: ConversationState.TENANT_CONFIRMATION_PENDING,
    session: updatedSession,
    intermediateSteps: [intermediateStep],
    finalSystemAction: SystemEvent.LLM_CLASSIFY_SUCCESS,
    uiMessages: [
      {
        role: 'agent',
        content: "I've classified your issue(s). Please review and confirm.",
      },
    ],
    eventPayload: {
      classification_results: serializeClassificationResults(classificationResults),
    },
    eventType: 'state_transition',
  };
}
