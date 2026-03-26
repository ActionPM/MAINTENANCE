import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computeCueScores,
  computeAllFieldConfidences,
  extractFlatConfidence,
  determineFieldsNeedingInput,
  resolveConstraintImpliedFields,
  checkCompleteness,
} from '@wo-agent/core';
import type { FieldConfidenceComponents } from '@wo-agent/core';
import {
  validateClassificationAgainstTaxonomy,
  DEFAULT_CONFIDENCE_CONFIG,
  PROMPT_VERSION,
  compareSemver,
  loadTaxonomy,
  loadTaxonomyConstraints,
} from '@wo-agent/schemas';
import type { CueDictionary } from '@wo-agent/schemas';
import type { ClassifierAdapter } from './classifier-adapters.js';
import { EVIDENCE_BASED_PROMPT_VERSION } from '@wo-agent/core';

// Load taxonomy, constraints, and cue dictionary at module level
const taxonomy = loadTaxonomy();
const constraints = loadTaxonomyConstraints();

const __dirname = dirname(fileURLToPath(import.meta.url));
const cueDict: CueDictionary = JSON.parse(
  readFileSync(resolve(__dirname, '../../../schemas/classification_cues.json'), 'utf-8'),
);

export interface IssueReplayInput {
  readonly example_id: string;
  readonly issue_index: number;
  readonly issue_text: string;
  readonly expected_classification: Record<string, string>;
  readonly classifierAdapter: ClassifierAdapter;
  readonly taxonomyVersion: string;
  readonly promptVersion?: string;
}

export interface IssueReplayResult {
  readonly example_id: string;
  readonly issue_index: number;
  readonly status: 'ok' | 'schema_fail' | 'taxonomy_fail' | 'needs_human_triage';
  readonly classification?: Record<string, string>;
  readonly confidenceByField?: Record<string, number>;
  readonly confidenceComponents?: Record<string, FieldConfidenceComponents>;
  readonly fieldsNeedingInput?: string[];
  readonly hierarchyValid: boolean;
  readonly constraintImpliedFields?: Record<string, string>;
  readonly errors?: string[];
}

export async function runIssueReplay(input: IssueReplayInput): Promise<IssueReplayResult> {
  const { example_id, issue_index, issue_text, classifierAdapter, taxonomyVersion } = input;
  const issueId = `${example_id}-issue-${issue_index}`;

  try {
    const cueScores = computeCueScores(issue_text, cueDict);
    const cueScoresForInput: Record<string, number> = {};
    for (const [field, result] of Object.entries(cueScores)) {
      cueScoresForInput[field] = result.score;
    }

    // Step 1: Classify
    const output = await classifierAdapter.classify({
      issue_id: issueId,
      issue_text,
      cue_scores: cueScoresForInput,
    });

    if (output.needs_human_triage) {
      return {
        example_id,
        issue_index,
        status: 'needs_human_triage',
        classification: output.classification,
        hierarchyValid: true,
        errors: ['Classifier flagged needs_human_triage'],
      };
    }

    // Step 2: Validate against taxonomy
    const taxResult = validateClassificationAgainstTaxonomy(
      output.classification,
      taxonomy,
      taxonomyVersion,
    );
    if (!taxResult.valid) {
      const errors = [
        ...taxResult.invalidValues.map((iv) => `${iv.field}: "${iv.value}" not in taxonomy`),
        ...(taxResult.contradictory ? ['Cross-domain contradiction detected'] : []),
        ...taxResult.crossDomainViolations,
      ];
      return {
        example_id,
        issue_index,
        status: 'taxonomy_fail',
        classification: output.classification,
        hierarchyValid: false,
        errors,
      };
    }

    // Step 3: Resolve constraint-implied fields
    const impliedFields = resolveConstraintImpliedFields(
      output.classification,
      constraints,
      taxonomyVersion,
    );

    // Step 3b: Auto-normalize cross-domain fields (v2+ prompt only)
    const effectivePromptVersion = input.promptVersion ?? PROMPT_VERSION;
    const isV2 = compareSemver(effectivePromptVersion, EVIDENCE_BASED_PROMPT_VERSION) >= 0;
    let classification = { ...output.classification };

    if (isV2) {
      const category = classification.Category ?? '';
      if (category === 'management' && !classification.Maintenance_Category) {
        classification = {
          ...classification,
          Maintenance_Category: 'not_applicable',
          Maintenance_Object: 'not_applicable',
          Maintenance_Problem: 'not_applicable',
        };
      } else if (category === 'maintenance' && !classification.Management_Category) {
        classification = {
          ...classification,
          Management_Category: 'not_applicable',
          Management_Object: 'not_applicable',
        };
      }
    }

    // Step 3c: Completeness gate (v2+ prompt only)
    let completenessIncomplete: string[] = [];
    if (isV2) {
      const category = classification.Category ?? '';
      const completenessResult = checkCompleteness(classification, category);
      completenessIncomplete = [...completenessResult.incompleteFields];
    }

    // Step 5: Compute confidence
    const config = DEFAULT_CONFIDENCE_CONFIG;
    const confidenceDetail = computeAllFieldConfidences({
      classification,
      modelConfidence: output.model_confidence,
      cueResults: cueScores,
      config,
      impliedFields,
    });
    const confidenceByField = extractFlatConfidence(confidenceDetail);
    const componentsMap: Record<string, FieldConfidenceComponents> = {};
    for (const [field, detail] of Object.entries(confidenceDetail)) {
      componentsMap[field] = detail.components;
    }

    // Step 6: Determine fields needing input
    let fieldsNeedingInput = determineFieldsNeedingInput({
      confidenceByField: confidenceDetail,
      config,
      missingFields: output.missing_fields,
      classificationOutput: classification,
    });

    // Step 6b: Remove constraint-implied fields
    if (Object.keys(impliedFields).length > 0) {
      fieldsNeedingInput = fieldsNeedingInput.filter((f) => !(f in impliedFields));
    }

    // Step 6c: Merge completeness gate results
    for (const field of completenessIncomplete) {
      if (!fieldsNeedingInput.includes(field)) {
        fieldsNeedingInput.push(field);
      }
    }

    return {
      example_id,
      issue_index,
      status: 'ok',
      classification,
      confidenceByField,
      confidenceComponents: componentsMap,
      fieldsNeedingInput,
      hierarchyValid: true,
      constraintImpliedFields: impliedFields,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      example_id,
      issue_index,
      status: 'schema_fail',
      hierarchyValid: false,
      errors: [message],
    };
  }
}
