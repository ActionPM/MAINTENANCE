import { ConversationState, DEFAULT_CONFIDENCE_CONFIG, DEFAULT_FOLLOWUP_CAPS } from '@wo-agent/schemas';
import type {
  IssueClassifierInput,
  IssueClassifierOutput,
  ConfidenceConfig,
  FollowUpGeneratorInput,
  FollowUpCaps,
} from '@wo-agent/schemas';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';
import { callIssueClassifier } from '../../classifier/issue-classifier.js';
import { computeCueScores } from '../../classifier/cue-scoring.js';
import { computeAllFieldConfidences, determineFieldsNeedingInput } from '../../classifier/confidence.js';
import {
  setClassificationResults,
  updateFollowUpTracking,
  setPendingFollowUpQuestions,
} from '../../session/session.js';
import type { IssueClassificationResult } from '../../session/types.js';
import { SystemEvent } from '../../state-machine/system-events.js';
import { resolveLlmClassifySuccess } from '../../state-machine/guards.js';
import { checkFollowUpCaps } from '../../followup/caps.js';
import { callFollowUpGenerator } from '../../followup/followup-generator.js';
import { buildFollowUpAnswersEvent, buildFollowUpQuestionsEvent } from '../../followup/event-builder.js';

/**
 * Handle ANSWER_FOLLOWUPS action (spec §11.2, §15).
 * Transition: needs_tenant_input → ANSWER_FOLLOWUPS → classification_in_progress
 * Then re-classify with enriched input and determine next state.
 */
export async function handleAnswerFollowups(
  ctx: ActionHandlerContext,
): Promise<ActionHandlerResult> {
  const { session, request, deps } = ctx;
  const tenantInput = request.tenant_input as { answers: Array<{ question_id: string; answer: unknown; received_at?: string }> };
  const pendingQuestions = session.pending_followup_questions;
  const issues = session.split_issues;

  // Guard: must have pending questions
  if (!pendingQuestions || pendingQuestions.length === 0) {
    return {
      newState: session.state,
      session,
      uiMessages: [],
      errors: [{ code: 'NO_PENDING_QUESTIONS', message: 'No pending follow-up questions to answer' }],
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
  const answersReceived = tenantInput.answers.map(a => ({
    question_id: a.question_id,
    answer: a.answer,
    received_at: a.received_at ?? deps.clock(),
  }));

  // Determine which issue this follow-up relates to
  const targetIssueId = session.classification_results?.find(
    r => r.fieldsNeedingInput.length > 0,
  )?.issue_id ?? issues[0].issue_id;

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
      errors: [{
        code: 'INVALID_ANSWER_QUESTION_ID',
        message: err instanceof Error ? err.message : 'Answer references unknown question_id',
      }],
    };
  }
  await deps.eventRepo.insert(answersEvent);

  // Step 2: Clear pending questions
  let updatedSession = setPendingFollowUpQuestions(session, null);

  // Step 3: Convert answers to followup_answers for classifier
  const followupAnswers = tenantInput.answers.map(a => {
    const question = pendingQuestions.find(q => q.question_id === a.question_id);
    return {
      field_target: question?.field_target ?? '',
      answer: a.answer as string | boolean,
    };
  }).filter(a => a.field_target);

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
  let anyFieldsNeedInput = false;

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
      followup_answers: issue.issue_id === targetIssueId ? followupAnswers : undefined,
      taxonomy_version: session.pinned_versions.taxonomy_version,
      model_id: session.pinned_versions.model_id,
      prompt_version: session.pinned_versions.prompt_version,
      cue_scores: cueScoresForInput,
    };

    let classifierResult;
    try {
      classifierResult = await callIssueClassifier(classifierInput, deps.issueClassifier, taxonomy);
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

    let fieldsNeedingInput = output.needs_human_triage
      ? []
      : determineFieldsNeedingInput(computedConfidence, confidenceConfig, output.missing_fields, output.classification);

    // Short-circuit: remove fields the tenant directly answered this round.
    // A tenant explicitly answering a field resolves it regardless of confidence.
    if (issue.issue_id === targetIssueId && followupAnswers.length > 0) {
      const answeredFields = new Set(followupAnswers.map(a => a.field_target));
      fieldsNeedingInput = fieldsNeedingInput.filter(f => !answeredFields.has(f));
    }

    if (fieldsNeedingInput.length > 0) anyFieldsNeedInput = true;

    classificationResults.push({
      issue_id: issue.issue_id,
      classifierOutput: output,
      computedConfidence,
      fieldsNeedingInput,
    });
  }

  updatedSession = setClassificationResults(updatedSession, classificationResults);

  // Step 5: If fields still need input, check caps and generate follow-ups
  if (anyFieldsNeedInput) {
    const allFieldsNeedingInput = classificationResults.flatMap(r => [...r.fieldsNeedingInput]);

    const capsCheck = checkFollowUpCaps({
      turnNumber: updatedSession.followup_turn_number + 1,
      totalQuestionsAsked: updatedSession.total_questions_asked,
      previousQuestions: updatedSession.previous_questions,
      fieldsNeedingInput: allFieldsNeedingInput,
      caps: followUpCaps,
    });

    if (capsCheck.escapeHatch) {
      // Escape hatch: mark needs_human_triage
      const triageResults = classificationResults.map(r => ({
        ...r,
        classifierOutput: { ...r.classifierOutput, needs_human_triage: true },
        fieldsNeedingInput: [] as string[],
      }));
      updatedSession = setClassificationResults(updatedSession, triageResults);

      return {
        newState: ConversationState.TENANT_CONFIRMATION_PENDING,
        session: updatedSession,
        intermediateSteps: [intermediateStep],
        finalSystemAction: SystemEvent.LLM_CLASSIFY_SUCCESS,
        uiMessages: [{
          role: 'agent',
          content: 'Thank you for your answers. Some details still need review — a human will follow up.',
        }],
        eventPayload: { escape_hatch: true, reason: capsCheck.reason },
        eventType: 'state_transition',
      };
    }

    // Generate next round of follow-up questions
    const targetResult = classificationResults.find(r => r.fieldsNeedingInput.length > 0)!;
    const targetIssueData = issues.find(i => i.issue_id === targetResult.issue_id);
    const followUpInput: FollowUpGeneratorInput = {
      issue_id: targetResult.issue_id,
      classification: targetResult.classifierOutput.classification,
      confidence_by_field: targetResult.computedConfidence,
      missing_fields: [...targetResult.classifierOutput.missing_fields],
      fields_needing_input: [...capsCheck.eligibleFields],
      previous_questions: [...updatedSession.previous_questions],
      turn_number: updatedSession.followup_turn_number + 1,
      total_questions_asked: updatedSession.total_questions_asked,
      taxonomy_version: session.pinned_versions.taxonomy_version,
      prompt_version: session.pinned_versions.prompt_version,
      original_text: targetIssueData?.raw_excerpt,
    };

    let nextQuestions;
    try {
      const followUpResult = await callFollowUpGenerator(
        followUpInput,
        deps.followUpGenerator,
        capsCheck.remainingQuestionBudget,
      );
      if (followUpResult.status === 'ok') {
        nextQuestions = followUpResult.output!.questions;
      }
    } catch {
      // FollowUp generation failed — escape hatch
    }

    if (!nextQuestions || nextQuestions.length === 0) {
      // Escape hatch
      const triageResults = classificationResults.map(r => ({
        ...r,
        classifierOutput: { ...r.classifierOutput, needs_human_triage: true },
        fieldsNeedingInput: [] as string[],
      }));
      updatedSession = setClassificationResults(updatedSession, triageResults);

      return {
        newState: ConversationState.TENANT_CONFIRMATION_PENDING,
        session: updatedSession,
        intermediateSteps: [intermediateStep],
        finalSystemAction: SystemEvent.LLM_CLASSIFY_SUCCESS,
        uiMessages: [{ role: 'agent', content: 'Thank you. A human will review the remaining details.' }],
        eventPayload: { escape_hatch: true },
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
      uiMessages: [{
        role: 'agent',
        content: 'Thanks for that info. I still need a few more details.',
      }],
      eventPayload: {
        reclassification: true,
        new_followup_turn: updatedSession.followup_turn_number,
      },
      eventType: 'state_transition',
    };
  }

  // All fields resolved — proceed to confirmation
  return {
    newState: ConversationState.TENANT_CONFIRMATION_PENDING,
    session: updatedSession,
    intermediateSteps: [intermediateStep],
    finalSystemAction: SystemEvent.LLM_CLASSIFY_SUCCESS,
    uiMessages: [{
      role: 'agent',
      content: 'Thank you! I\'ve updated the classification. Please review and confirm.',
    }],
    eventPayload: {
      reclassification: true,
      all_fields_resolved: true,
    },
    eventType: 'state_transition',
  };
}
