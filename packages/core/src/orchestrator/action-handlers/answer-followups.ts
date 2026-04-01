import {
  ConversationState,
  DEFAULT_CONFIDENCE_CONFIG,
  DEFAULT_FOLLOWUP_CAPS,
  type Taxonomy,
  taxonomyConstraints,
  validateClassificationAgainstTaxonomy,
  validateHierarchicalConstraints,
} from '@wo-agent/schemas';
import { resolveConstraintImpliedFields } from '../../classifier/constraint-resolver.js';
import { checkCompleteness } from '../../classifier/completeness-gate.js';
import type {
  IssueClassifierInput,
  IssueClassifierOutput,
  ConfidenceConfig,
  FollowUpGeneratorInput,
  FollowUpCaps,
  FollowUpQuestion,
} from '@wo-agent/schemas';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';
import { callIssueClassifier } from '../../classifier/issue-classifier.js';
import { computeCueScores, buildEnrichedCueText } from '../../classifier/cue-scoring.js';
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
  type FieldConfidenceDetail,
} from '../../classifier/confidence.js';
import {
  setClassificationResults,
  updateFollowUpTracking,
  setPendingFollowUpQuestions,
  setConfirmationTracking,
  mergeConfirmedFollowupAnswers,
  removeConfirmedFollowupAnswers,
} from '../../session/session.js';
import {
  invalidateStaleDescendants,
  getForwardDescendants,
  type InvalidationResult,
  type ClearedField,
} from '../../classifier/descendant-invalidation.js';
import { buildHierarchyConflictQuestion } from '../../followup/hierarchy-conflict-questions.js';
import type { IssueClassificationResult } from '../../session/types.js';
import { SystemEvent } from '../../state-machine/system-events.js';
import { checkFollowUpCaps } from '../../followup/caps.js';
import { callFollowUpGenerator } from '../../followup/followup-generator.js';
import { computeContentHash } from '../../confirmation/payload-builder.js';
import {
  buildFollowUpAnswersEvent,
  buildFollowUpQuestionsEvent,
} from '../../followup/event-builder.js';
import type { SplitIssue } from '@wo-agent/schemas';
import type { ConversationSession } from '../../session/types.js';

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
 * Handle ANSWER_FOLLOWUPS action (spec §11.2, §15).
 * Transition: needs_tenant_input → ANSWER_FOLLOWUPS → classification_in_progress
 * Then re-classify with enriched input and determine next state.
 */
export async function handleAnswerFollowups(
  ctx: ActionHandlerContext,
): Promise<ActionHandlerResult> {
  const { session, request, deps } = ctx;
  const obsCtx = ctx.request_id
    ? { request_id: ctx.request_id, timestamp: deps.clock() }
    : undefined;
  const tenantInput = request.tenant_input as {
    answers: Array<{ question_id: string; answer: unknown; received_at?: string }>;
  };
  const pendingQuestions = session.pending_followup_questions;
  const issues = session.split_issues;

  // Guard: must have pending questions
  if (!pendingQuestions || pendingQuestions.length === 0) {
    return {
      newState: session.state,
      session,
      uiMessages: [],
      errors: [
        { code: 'NO_PENDING_QUESTIONS', message: 'No pending follow-up questions to answer' },
      ],
    };
  }

  // Guard: must have issues
  if (!issues || issues.length === 0) {
    return {
      newState: session.state,
      session,
      uiMessages: [{ role: 'agent', content: 'No issues to re-classify.' }],
      errors: [{ code: 'NO_ISSUES', message: 'No issues to re-classify' }],
    };
  }

  // Step 1: Record followup_event with questions + answers (append-only)
  const answersReceived = tenantInput.answers.map((a) => ({
    question_id: a.question_id,
    answer: a.answer,
    received_at: a.received_at ?? deps.clock(),
  }));

  // Determine which issue this follow-up relates to
  const targetIssueId =
    session.classification_results?.find((r) => r.fieldsNeedingInput.length > 0)?.issue_id ??
    issues[0].issue_id;

  let answersEvent;
  try {
    answersEvent = buildFollowUpAnswersEvent({
      eventId: deps.idGenerator(),
      conversationId: session.conversation_id,
      issueId: targetIssueId,
      turnNumber: session.followup_turn_number,
      questions: pendingQuestions,
      answers: answersReceived,
      createdAt: deps.clock(),
    });
  } catch (err) {
    // Stale or mismatched question_ids in the client payload — return
    // a deterministic validation error instead of bubbling an exception.
    return {
      newState: session.state,
      session,
      uiMessages: [],
      errors: [
        {
          code: 'INVALID_ANSWER_QUESTION_ID',
          message: err instanceof Error ? err.message : 'Answer references unknown question_id',
        },
      ],
    };
  }
  await deps.eventRepo.insert(answersEvent);

  // Step 2: Clear pending questions
  let updatedSession = setPendingFollowUpQuestions(session, null);

  // Step 3: Convert answers to followup_answers for classifier
  const followupAnswers = tenantInput.answers
    .map((a) => {
      const question = pendingQuestions.find((q) => q.question_id === a.question_id);
      return {
        field_target: question?.field_target ?? '',
        answer: a.answer as string | boolean,
      };
    })
    .filter((a) => a.field_target);

  // Pin enum answers from this round onto the session so later rounds cannot
  // overwrite tenant-confirmed taxonomy values.
  const newPinnedAnswers: Record<string, string> = {};
  for (const answer of tenantInput.answers) {
    const question = pendingQuestions.find((q) => q.question_id === answer.question_id);
    if (
      question &&
      question.answer_type === 'enum' &&
      typeof answer.answer === 'string' &&
      answer.answer.trim() !== ''
    ) {
      newPinnedAnswers[question.field_target] = answer.answer;
    }
  }
  if (Object.keys(newPinnedAnswers).length > 0) {
    updatedSession = mergeConfirmedFollowupAnswers(updatedSession, targetIssueId, newPinnedAnswers);
  }

  // Detect which fields were newly pinned this round (for invalidation triggers).
  // A field is a "changed parent" if it was pinned this round AND either:
  //   (a) it had no prior pin, OR
  //   (b) the prior pin value was different.
  // Compare against the PRE-merge session pins (the original `session`, not
  // `updatedSession` which already has this round's merges).
  const priorPinsForTarget = session.confirmed_followup_answers?.[targetIssueId] ?? {};
  const changedParentFields: Array<{ field: string; newValue: string }> = [];
  for (const [field, value] of Object.entries(newPinnedAnswers)) {
    const priorPinValue = priorPinsForTarget[field];
    if (priorPinValue !== value) {
      changedParentFields.push({ field, newValue: value });
    }
  }

  // Intermediate step: needs_tenant_input → classification_in_progress
  const intermediateStep = {
    state: ConversationState.CLASSIFICATION_IN_PROGRESS,
    eventType: 'state_transition' as const,
    eventPayload: { action: 'answer_followups', answers_count: tenantInput.answers.length },
  };

  // Step 4: Re-classify each issue with enriched input
  const cueDict = deps.cueDict;
  const taxonomy = deps.taxonomy;
  const confidenceConfig: ConfidenceConfig = deps.confidenceConfig ?? DEFAULT_CONFIDENCE_CONFIG;
  const followUpCaps: FollowUpCaps = deps.followUpCaps ?? DEFAULT_FOLLOWUP_CAPS;

  const classificationResults: IssueClassificationResult[] = [];
  // Collect per-issue invalidation results for use in follow-up generation.
  const invalidationResults = new Map<string, InvalidationResult>();
  let anyFieldsNeedInput = false;

  for (const issue of issues) {
    const enrichedText = buildEnrichedCueText(
      issue.summary,
      issue.raw_excerpt,
      issue.issue_id === targetIssueId ? followupAnswers : undefined,
    );
    const cueScoreMap = computeCueScores(enrichedText, cueDict);
    const cueScoresForInput: Record<string, number> = {};
    for (const [field, result] of Object.entries(cueScoreMap)) {
      cueScoresForInput[field] = result.score;
    }

    const classifierInput: IssueClassifierInput = {
      issue_id: issue.issue_id,
      issue_summary: issue.summary,
      raw_excerpt: issue.raw_excerpt,
      followup_answers: issue.issue_id === targetIssueId ? followupAnswers : undefined,
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
    } catch {
      return {
        newState: ConversationState.LLM_ERROR_RETRYABLE,
        session: updatedSession,
        intermediateSteps: [intermediateStep],
        finalSystemAction: SystemEvent.LLM_FAIL,
        uiMessages: [{ role: 'agent', content: 'I had trouble re-classifying. Please try again.' }],
        errors: [{ code: 'CLASSIFIER_FAILED', message: 'Re-classification failed' }],
      };
    }

    if (classifierResult.status === 'llm_fail') {
      return {
        newState: ConversationState.LLM_ERROR_RETRYABLE,
        session: updatedSession,
        intermediateSteps: [intermediateStep],
        finalSystemAction: SystemEvent.LLM_FAIL,
        uiMessages: [{ role: 'agent', content: 'I had trouble re-classifying. Please try again.' }],
        errors: [{ code: 'CLASSIFIER_FAILED', message: 'Re-classification failed' }],
      };
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

    // Capture raw classifier output before pin overlay (needed for audit trail).
    const classifierRawClassification = { ...output.classification };

    // Step A2: Overlay tenant-confirmed answers before normalization and implication
    // so pinned parent values can drive downstream constraint resolution.
    let pinnedForIssue = updatedSession.confirmed_followup_answers?.[issue.issue_id] ?? {};
    const pinnedFieldSet = new Set(Object.keys(pinnedForIssue));
    if (pinnedFieldSet.size > 0) {
      output = {
        ...output,
        classification: { ...output.classification, ...pinnedForIssue },
        missing_fields: output.missing_fields.filter((field) => !pinnedFieldSet.has(field)),
      };
    }

    // Step A3: Descendant invalidation (Bug-009 Phase 3).
    // When a newly confirmed parent makes descendant values invalid,
    // clear those descendants and remove stale pins.
    //
    // Source attribution is 2-way (pinned vs unpinned). The session does not
    // persist per-field provenance for constraint-implied vs classifier values,
    // so we check only `confirmed_followup_answers`. Unpinned values that were
    // previously constraint-implied will silently re-derive in Step C' if the
    // new ancestry still narrows to one option.
    if (issue.issue_id === targetIssueId && changedParentFields.length > 0) {
      // Accumulate cleared fields across all changed parents for this issue.
      // Multiple parents can change in one round (e.g., tenant answers both
      // Location and Sub_Location). Each parent's invalidation runs against
      // the progressively-cleared classification, so later parents see the
      // effects of earlier clears. Results are merged, not replaced.
      const allCleared: ClearedField[] = [];
      const allClearedPinFields: string[] = [];

      for (const { field: parentField, newValue } of changedParentFields) {
        const result = invalidateStaleDescendants(
          parentField,
          output.classification,
          pinnedForIssue,
          taxonomyConstraints,
        );

        if (result.clearedFields.length > 0) {
          // Remove invalidated pins from session
          if (result.clearedPinFields.length > 0) {
            updatedSession = removeConfirmedFollowupAnswers(
              updatedSession,
              issue.issue_id,
              result.clearedPinFields,
            );
            // Update the pinnedForIssue/pinnedFieldSet for remaining pipeline steps
            for (const f of result.clearedPinFields) {
              pinnedFieldSet.delete(f);
            }
            allClearedPinFields.push(...result.clearedPinFields);
          }

          // Clear invalidated values from effective classification.
          // This mutates `output` so subsequent parents in the loop see
          // the cleared state (correct: later parents validate against
          // already-cleared descendants).
          const clearedClassification = { ...output.classification };
          for (const cleared of result.clearedFields) {
            clearedClassification[cleared.field] = '';
          }
          output = { ...output, classification: clearedClassification };

          allCleared.push(...result.clearedFields);

          // Record per-parent invalidation event (one event per parent change
          // for audit clarity; the merged result is used for question building).
          const priorResult = session.classification_results?.find(
            (r) => r.issue_id === issue.issue_id,
          );
          const priorEffectiveValue =
            priorResult?.classifierOutput.classification[parentField] ??
            priorPinsForTarget[parentField] ??
            classifierRawClassification[parentField] ??
            '';
          await deps.eventRepo.insert({
            event_id: deps.idGenerator(),
            event_type: 'classification_descendant_invalidation',
            conversation_id: session.conversation_id,
            issue_id: issue.issue_id,
            payload: {
              parent_field: parentField,
              parent_old_value: priorEffectiveValue,
              parent_new_value: newValue,
              cleared_fields: result.clearedFields,
            },
            created_at: deps.clock(),
          });
        }
      }

      // Build merged invalidation result for follow-up generation.
      // Deduplicate by field name (a field can only appear once in the
      // hierarchy, but two parent changes could theoretically touch it
      // if one parent is an ancestor of the other).
      if (allCleared.length > 0) {
        const seenFields = new Set<string>();
        const deduped = allCleared.filter((c) => {
          if (seenFields.has(c.field)) return false;
          seenFields.add(c.field);
          return true;
        });
        const mergedPinFields = [...new Set(allClearedPinFields)];
        const earliestPin = deduped.find((c) => c.wasPinned) ?? null;

        invalidationResults.set(issue.issue_id, {
          clearedFields: deduped,
          clearedPinFields: mergedPinFields,
          earliestClearedPin: earliestPin,
        });
      }

      // Refresh pinnedForIssue to reflect post-invalidation state.
      // Step C2 logs pinned_fields in its contradiction event — using the
      // pre-removal snapshot would misattribute cleared pins as still active.
      pinnedForIssue = updatedSession.confirmed_followup_answers?.[issue.issue_id] ?? {};
    }

    // Step B': Normalize cross-domain blanks on the merged classification.
    // This intentionally differs from start-classification: with pinning active,
    // normalization must happen before implication so pinned parent values can
    // participate in implication without leaving cross-domain blanks behind.
    output = {
      ...output,
      classification: normalizeCrossDomainClassification(output.classification),
    };

    // Step C': Resolve implied fields after pinned values have been overlaid.
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

    // Step C2: Re-validate after overlay to catch stale cross-domain pins.
    if (!output.needs_human_triage && pinnedFieldSet.size > 0) {
      const postOverlayDomain = validateClassificationAgainstTaxonomy(
        output.classification,
        taxonomy,
        taxonomyVersion,
      );
      const postOverlayHierarchy = validateHierarchicalConstraints(
        output.classification,
        taxonomyConstraints,
        taxonomyVersion,
      );
      // Filter out empty-string invalid values: fields cleared by descendant
      // invalidation (Step A3) have '' which is not in the taxonomy but is not
      // a genuine contradiction — it's a field awaiting re-resolution.
      const substantiveInvalidValues = postOverlayDomain.invalidValues.filter(
        (entry) => entry.value !== '',
      );
      const postOverlayViolations = [
        ...postOverlayDomain.crossDomainViolations,
        ...substantiveInvalidValues.map(
          (entry) => `${entry.field} "${entry.value}" is not in taxonomy`,
        ),
        ...postOverlayHierarchy.violations,
      ];
      const hasSubstantiveViolations =
        postOverlayDomain.crossDomainViolations.length > 0 ||
        substantiveInvalidValues.length > 0 ||
        !postOverlayHierarchy.valid;
      if (hasSubstantiveViolations) {
        output = { ...output, needs_human_triage: true };
        classifierTriageReason = ClassifierTriageReason.CONSTRAINT_RETRY_FAILED;
        await deps.eventRepo.insert({
          event_id: deps.idGenerator(),
          event_type: 'classification_pinned_answer_contradiction',
          conversation_id: session.conversation_id,
          issue_id: issue.issue_id,
          payload: {
            violations: postOverlayViolations,
            pinned_fields: pinnedForIssue,
          },
          created_at: deps.clock(),
        });
      }
    }

    // Step D: Completeness gate
    let completenessIncomplete: string[] = [];
    let completenessFollowupTypes: Record<string, string> = {};
    const category = output.classification.Category ?? '';
    const completenessResult = checkCompleteness(output.classification, category);
    completenessIncomplete = [...completenessResult.incompleteFields];
    completenessFollowupTypes = { ...completenessResult.followupTypes };

    // Step E: Confidence with constraint boost (C2)
    const rawConfidenceDetail = computeAllFieldConfidences({
      classification: output.classification,
      modelConfidence: output.model_confidence,
      cueResults: cueScoreMap,
      config: confidenceConfig,
      impliedFields,
    });
    const confidenceDetail: Record<string, FieldConfidenceDetail> = { ...rawConfidenceDetail };
    for (const field of pinnedFieldSet) {
      if (field in confidenceDetail) {
        confidenceDetail[field] = {
          confidence: 1.0,
          components: confidenceDetail[field].components,
        };
      }
    }
    const computedConfidence = extractFlatConfidence(confidenceDetail);

    let fieldsNeedingInput = determineFieldsNeedingInput({
      confidenceByField: confidenceDetail,
      config: confidenceConfig,
      missingFields: output.missing_fields,
      classificationOutput: output.classification,
      confirmedFields: pinnedFieldSet,
    });

    if (pinnedFieldSet.size > 0) {
      fieldsNeedingInput = fieldsNeedingInput.filter((field) => !pinnedFieldSet.has(field));
    }

    // Short-circuit: remove fields the tenant directly answered this round.
    // This is intentionally a second pass after pinned-field filtering above:
    // the first pass removes accumulated enum pins from prior rounds, while this
    // pass also suppresses same-round yes_no/text answers that inform the
    // classifier but do not become pinned taxonomy values.
    if (issue.issue_id === targetIssueId && followupAnswers.length > 0) {
      const answeredFields = new Set(followupAnswers.map((a) => a.field_target));
      fieldsNeedingInput = fieldsNeedingInput.filter((f) => !answeredFields.has(f));
    }

    // Short-circuit: remove constraint-implied fields — deterministically resolved.
    if (Object.keys(impliedFields).length > 0) {
      fieldsNeedingInput = fieldsNeedingInput.filter((f) => !(f in impliedFields));
    }

    // Merge completeness gate results (deduplicated)
    for (const field of completenessIncomplete) {
      if (!fieldsNeedingInput.includes(field)) {
        fieldsNeedingInput.push(field);
      }
    }

    if (fieldsNeedingInput.length > 0) anyFieldsNeedInput = true;

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

  updatedSession = setClassificationResults(updatedSession, classificationResults);
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
            "Thank you. I've updated the classification, but some details still need human review. Please review and submit this request for review.",
        },
      ],
      eventPayload: {
        reclassification: true,
        classification_results: serializeClassificationResults(routedResults),
      },
      eventType: 'state_transition',
    };
  }

  // Step 5: If fields still need input, check caps and generate follow-ups
  if (anyFieldsNeedInput) {
    const routedResults = anyRecoverableTriageIssue
      ? assignRoutingReason(
          classificationResults,
          RoutingReason.RECOVERED_VIA_FOLLOWUP,
          (result) => result.classifierOutput.needs_human_triage && result.recoverable_via_followup,
        )
      : [...classificationResults];
    updatedSession = setClassificationResults(updatedSession, routedResults);

    const allFieldsNeedingInput = routedResults.flatMap((r) => [...r.fieldsNeedingInput]);

    const capsCheck = checkFollowUpCaps({
      turnNumber: updatedSession.followup_turn_number + 1,
      totalQuestionsAsked: updatedSession.total_questions_asked,
      previousQuestions: updatedSession.previous_questions,
      fieldsNeedingInput: allFieldsNeedingInput,
      caps: followUpCaps,
    });

    if (capsCheck.escapeHatch) {
      // Escape hatch: mark needs_human_triage
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
              'Thank you for your answers. Some details still need review — a human will follow up.',
          },
        ],
        eventPayload: {
          escape_hatch: true,
          reason: capsCheck.reason,
          reclassification: true,
          classification_results: serializeClassificationResults(triageResults),
        },
        eventType: 'state_transition',
      };
    }

    // Generate next round of follow-up questions
    const targetResult = routedResults.find((r) => r.fieldsNeedingInput.length > 0)!;
    const targetIssueData = issues.find((i) => i.issue_id === targetResult.issue_id);

    // Scope eligible fields to the target issue.
    // capsCheck.eligibleFields is conversation-wide (flatMap across all issues).
    // The FollowUpGenerator receives a single issue's classification, so feeding
    // it fields from other issues would produce nonsensical questions.
    // Intersect with targetResult.fieldsNeedingInput to restrict to the target issue.
    const targetScopedFields = capsCheck.eligibleFields.filter((f) =>
      targetResult.fieldsNeedingInput.includes(f),
    );

    // Build contradiction question if invalidation cleared a stale pin for
    // the issue we're about to generate follow-ups for.
    const targetInvalidation = invalidationResults.get(targetResult.issue_id) ?? null;
    let conflictQuestion: FollowUpQuestion | null = null;
    let adjustedBudget = capsCheck.remainingQuestionBudget;
    let adjustedEligibleFields = [...targetScopedFields];

    if (targetInvalidation?.earliestClearedPin) {
      const cleared = targetInvalidation.earliestClearedPin;

      // The contradiction question's field_target MUST be in the scoped eligible set.
      // If it's maxed on re-asks, the field is ineligible and the normal escape
      // hatch will handle it — no contradiction question generated.
      const fieldIsEligible = adjustedEligibleFields.includes(cleared.field);

      if (fieldIsEligible) {
        // Find the parent that triggered this invalidation
        const triggerParent = changedParentFields.find((p) => {
          const descendants = getForwardDescendants(p.field);
          return descendants.includes(cleared.field);
        });

        if (triggerParent) {
          conflictQuestion = buildHierarchyConflictQuestion(
            cleared,
            triggerParent.field,
            triggerParent.newValue,
            targetResult.classifierOutput.classification,
            taxonomyConstraints,
            deps.idGenerator,
          );
        }

        if (conflictQuestion) {
          // Consume 1 from the budget so the LLM generator gets the correct remainder
          adjustedBudget = Math.max(0, adjustedBudget - 1);
          // Remove the field from eligible set so the LLM doesn't also ask about it
          adjustedEligibleFields = adjustedEligibleFields.filter((f) => f !== cleared.field);
        }
      }
    }

    const followUpInput: FollowUpGeneratorInput = {
      issue_id: targetResult.issue_id,
      classification: targetResult.classifierOutput.classification,
      confidence_by_field: targetResult.computedConfidence,
      missing_fields: [...targetResult.classifierOutput.missing_fields],
      fields_needing_input: [...adjustedEligibleFields],
      previous_questions: [...updatedSession.previous_questions],
      turn_number: updatedSession.followup_turn_number + 1,
      total_questions_asked: updatedSession.total_questions_asked,
      taxonomy_version: session.pinned_versions.taxonomy_version,
      prompt_version: session.pinned_versions.prompt_version,
      cue_version: session.pinned_versions.cue_version,
      original_text: targetIssueData?.raw_excerpt,
    };

    let nextQuestions: readonly FollowUpQuestion[] | undefined;
    if (adjustedBudget === 0 && conflictQuestion) {
      // Contradiction question consumed the entire budget — skip LLM call
      nextQuestions = [conflictQuestion];
    } else {
      try {
        const followUpResult = await callFollowUpGenerator(
          followUpInput,
          deps.followUpGenerator,
          adjustedBudget,
          deps.metricsRecorder,
          obsCtx,
        );
        if (followUpResult.status === 'ok') {
          const llmQuestions = followUpResult.output!.questions;
          // Prepend contradiction question, then LLM questions
          nextQuestions = conflictQuestion ? [conflictQuestion, ...llmQuestions] : llmQuestions;
        }
      } catch {
        // FollowUp generation failed — escape hatch
      }
    }

    if (!nextQuestions || nextQuestions.length === 0) {
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
              "Thank you. I couldn't generate the follow-up questions needed to finish intake, so please review and submit this request for human review.",
          },
        ],
        eventPayload: {
          escape_hatch: true,
          reclassification: true,
          classification_results: serializeClassificationResults(triageResults),
        },
        eventType: 'state_transition',
      };
    }

    // Record followup_event for new questions
    const questionsEvent = buildFollowUpQuestionsEvent({
      eventId: deps.idGenerator(),
      conversationId: session.conversation_id,
      issueId: targetResult.issue_id,
      turnNumber: updatedSession.followup_turn_number + 1,
      questions: nextQuestions,
      createdAt: deps.clock(),
    });
    await deps.eventRepo.insert(questionsEvent);

    // Update session tracking
    updatedSession = updateFollowUpTracking(updatedSession, nextQuestions);
    updatedSession = setPendingFollowUpQuestions(updatedSession, nextQuestions);

    return {
      newState: ConversationState.NEEDS_TENANT_INPUT,
      session: updatedSession,
      intermediateSteps: [intermediateStep],
      finalSystemAction: SystemEvent.LLM_CLASSIFY_SUCCESS,
      uiMessages: [
        {
          role: 'agent',
          content: 'Thanks for that info. I still need a few more details.',
        },
      ],
      eventPayload: {
        reclassification: true,
        new_followup_turn: updatedSession.followup_turn_number,
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
        content: "Thank you! I've updated the classification. Please review and confirm.",
      },
    ],
    eventPayload: {
      reclassification: true,
      all_fields_resolved: true,
      classification_results: serializeClassificationResults(classificationResults),
    },
    eventType: 'state_transition',
  };
}
