import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computeCueScores,
  computeAllFieldConfidences,
  determineFieldsNeedingInput,
  resolveConstraintImpliedFields,
} from '@wo-agent/core';
import {
  validateClassificationAgainstTaxonomy,
  DEFAULT_CONFIDENCE_CONFIG,
  loadTaxonomy,
  loadTaxonomyConstraints,
} from '@wo-agent/schemas';
import type { CueDictionary } from '@wo-agent/schemas';
import type { ClassifierAdapter } from './classifier-adapters.js';

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
}

export interface IssueReplayResult {
  readonly example_id: string;
  readonly issue_index: number;
  readonly status: 'ok' | 'schema_fail' | 'taxonomy_fail' | 'needs_human_triage';
  readonly classification?: Record<string, string>;
  readonly confidenceByField?: Record<string, number>;
  readonly fieldsNeedingInput?: string[];
  readonly hierarchyValid: boolean;
  readonly constraintImpliedFields?: Record<string, string>;
  readonly errors?: string[];
}

export async function runIssueReplay(input: IssueReplayInput): Promise<IssueReplayResult> {
  const { example_id, issue_index, issue_text, classifierAdapter, taxonomyVersion } = input;
  const issueId = `${example_id}-issue-${issue_index}`;

  try {
    // Step 1: Classify
    const output = await classifierAdapter.classify({
      issue_id: issueId,
      issue_text,
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

    // Step 4: Compute cue scores
    const cueScores = computeCueScores(issue_text, cueDict);

    // Step 5: Compute confidence
    const config = DEFAULT_CONFIDENCE_CONFIG;
    const confidenceByField = computeAllFieldConfidences({
      classification: output.classification,
      modelConfidence: output.model_confidence,
      cueResults: cueScores,
      config,
      impliedFields,
    });

    // Step 6: Determine fields needing input
    const fieldsNeedingInput = determineFieldsNeedingInput({
      confidenceByField,
      config,
      missingFields: output.missing_fields,
      classificationOutput: output.classification,
    });

    return {
      example_id,
      issue_index,
      status: 'ok',
      classification: output.classification,
      confidenceByField,
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
