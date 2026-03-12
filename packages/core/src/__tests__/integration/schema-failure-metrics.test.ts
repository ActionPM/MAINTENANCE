/**
 * Integration test: schema_validation_failure_total metric is emitted (and awaited)
 * from real LLM tool caller code paths (spec §25, S25-02).
 *
 * These tests exercise callIssueSplitter, callIssueClassifier, and
 * callFollowUpGenerator with invalid LLM outputs and verify the metric
 * is recorded in the provided MetricsRecorder before the function returns.
 */
import { describe, it, expect } from 'vitest';
import { callIssueSplitter } from '../../splitter/issue-splitter.js';
import { callIssueClassifier } from '../../classifier/issue-classifier.js';
import { callFollowUpGenerator } from '../../followup/followup-generator.js';
import { InMemoryMetricsRecorder } from '../../observability/index.js';
import { loadTaxonomy } from '@wo-agent/schemas';
import type {
  IssueSplitterInput,
  IssueClassifierInput,
  FollowUpGeneratorInput,
} from '@wo-agent/schemas';

const taxonomy = loadTaxonomy();

describe('schema_validation_failure_total metric emission', () => {
  it('splitter emits metric when LLM returns invalid schema (both attempts)', async () => {
    const metrics = new InMemoryMetricsRecorder();
    const input: IssueSplitterInput = {
      raw_text: 'Toilet leaking',
      conversation_id: 'conv-1',
      taxonomy_version: '1.0.0',
      model_id: 'test',
      prompt_version: '1.0.0',
    };

    // LLM always returns invalid output (not matching schema)
    const badLlm = async () => ({ invalid: true });

    await expect(callIssueSplitter(input, badLlm, metrics)).rejects.toThrow();

    // Should have 2 metric records (one per failed attempt)
    const schemaMetrics = metrics.observations.filter(
      (o) => o.metric_name === 'schema_validation_failure_total',
    );
    expect(schemaMetrics).toHaveLength(2);
    expect(schemaMetrics[0].component).toBe('splitter');
    expect(schemaMetrics[0].conversation_id).toBe('conv-1');
  });

  it('classifier emits metric when LLM returns invalid schema (both attempts)', async () => {
    const metrics = new InMemoryMetricsRecorder();
    const input: IssueClassifierInput = {
      issue_id: 'iss-1',
      issue_summary: 'Toilet leaking',
      raw_excerpt: 'Toilet leaking in bathroom',
      taxonomy_version: '1.0.0',
      model_id: 'test',
      prompt_version: '1.0.0',
    };

    const badLlm = async () => ({ not_valid: true });

    const result = await callIssueClassifier(input, badLlm, taxonomy, '1.0.0', metrics);
    expect(result.status).toBe('llm_fail');

    const schemaMetrics = metrics.observations.filter(
      (o) => o.metric_name === 'schema_validation_failure_total',
    );
    expect(schemaMetrics).toHaveLength(2);
    expect(schemaMetrics[0].component).toBe('classifier');
    expect(schemaMetrics[0].tags?.issue_id).toBe('iss-1');
  });

  it('followup generator emits metric when LLM returns invalid schema', async () => {
    const metrics = new InMemoryMetricsRecorder();
    const input: FollowUpGeneratorInput = {
      issue_id: 'iss-1',
      classification: { Category: 'maintenance' },
      confidence_by_field: { Category: 0.5 },
      missing_fields: ['Maintenance_Category'],
      fields_needing_input: ['Maintenance_Category'],
      previous_questions: [],
      turn_number: 1,
      total_questions_asked: 0,
      taxonomy_version: '1.0.0',
      prompt_version: '1.0.0',
    };

    const badLlm = async () => ({ wrong_shape: true });

    const result = await callFollowUpGenerator(input, badLlm, 3, metrics);
    expect(result.status).toBe('llm_fail');

    const schemaMetrics = metrics.observations.filter(
      (o) => o.metric_name === 'schema_validation_failure_total',
    );
    expect(schemaMetrics).toHaveLength(2);
    expect(schemaMetrics[0].component).toBe('followup_generator');
    expect(schemaMetrics[0].tags?.issue_id).toBe('iss-1');
  });

  it('metric record() is awaited — async store completes before function returns', async () => {
    const recordCalls: string[] = [];
    // Async recorder that tracks completion order
    const slowRecorder = {
      record: async () => {
        await new Promise((r) => setTimeout(r, 10));
        recordCalls.push('recorded');
      },
    };

    const input: IssueSplitterInput = {
      raw_text: 'Test',
      conversation_id: 'conv-1',
      taxonomy_version: '1.0.0',
      model_id: 'test',
      prompt_version: '1.0.0',
    };

    const badLlm = async () => ({ invalid: true });

    await expect(callIssueSplitter(input, badLlm, slowRecorder)).rejects.toThrow();

    // If record() is properly awaited, both calls complete before the throw
    expect(recordCalls).toHaveLength(2);
  });
});
