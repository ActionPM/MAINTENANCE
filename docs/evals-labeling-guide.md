# Evals Labeling Guide

## 1. EvalExample Schema Fields

Each evaluation example is a JSON object conforming to `eval_example.schema.json`. The fields are:

| Field                              | Type    | Description                                                                                                                                                                                                                                                                                           |
| ---------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `example_id`                       | string  | Unique identifier (e.g., `gold-001`, `hard-012`). Prefix matches the dataset type.                                                                                                                                                                                                                    |
| `dataset_type`                     | enum    | One of `gold`, `hard`, `ood`, `regression`. Determines which dataset the example belongs to.                                                                                                                                                                                                          |
| `source_type`                      | enum    | Origin of the example: `fixture` (hand-written), `production_reviewed` (derived from real conversations), or `synthetic_reviewed` (LLM-generated then human-reviewed).                                                                                                                                |
| `conversation_text`                | string  | The raw tenant message exactly as it would arrive from the chat interface.                                                                                                                                                                                                                            |
| `split_issues_expected`            | array   | Expected output of the issue splitter. Each element has an `issue_text` field. Single-issue messages have one element matching the full text. Multi-issue messages have one element per distinct issue.                                                                                               |
| `expected_classification_by_issue` | array   | 1:1 aligned with `split_issues_expected`. Each element is a classification object with taxonomy field keys (`Category`, `Location`, `Sub_Location`, etc.). Only include fields relevant to the category domain -- maintenance fields for maintenance issues, management fields for management issues. |
| `expected_missing_fields`          | array   | Taxonomy field names the classifier is expected to leave unresolved (requiring follow-up).                                                                                                                                                                                                            |
| `expected_followup_fields`         | array   | Fields for which the follow-up generator should produce questions.                                                                                                                                                                                                                                    |
| `expected_needs_human_triage`      | boolean | Whether the input should be routed to a human agent instead of automated classification.                                                                                                                                                                                                              |
| `expected_risk_flags`              | array   | Risk keywords expected to be detected (e.g., `fire`, `flood`, `gas_leak`). Empty for non-emergency inputs.                                                                                                                                                                                            |
| `slice_tags`                       | array   | Labels used for sliced metric reporting. Include the primary taxonomy category (e.g., `plumbing`, `accounting`) and the dataset type (e.g., `gold`).                                                                                                                                                  |
| `taxonomy_version`                 | string  | Semver of the taxonomy the expected values are valid against.                                                                                                                                                                                                                                         |
| `schema_version`                   | string  | Semver of the eval example schema itself.                                                                                                                                                                                                                                                             |
| `review_status`                    | enum    | Lifecycle state: `draft`, `reviewed`, or `approved_for_gate`.                                                                                                                                                                                                                                         |
| `reviewed_by`                      | string  | Identifier of the person who last reviewed the example.                                                                                                                                                                                                                                               |
| `created_at`                       | string  | ISO 8601 datetime when the example was created.                                                                                                                                                                                                                                                       |

## 2. Dataset Types

### Gold

Straightforward, unambiguous inputs with clear expected classifications. These form the accuracy gate -- regressions on the gold set block deployment. Every gold example must have `review_status: "approved_for_gate"`.

### Hard

Inputs that are intentionally challenging: ambiguous phrasing, vague descriptions, heavy slang, typos, and multi-issue messages. These test the robustness of the classifier and splitter. Slice tags should describe the difficulty dimension (e.g., `ambiguous`, `slang`, `multi_issue`).

### OOD (Out-of-Distribution)

Inputs that fall outside the taxonomy's coverage: off-topic requests, gibberish, requests for services not offered, and borderline edge cases. Most OOD examples should have `expected_needs_human_triage: true`.

### Regression

Inputs that reproduce known failure modes from test history: hierarchy violations, cross-domain confusion, confidence boundary cases, constraint resolution edge cases, and emergency routing. Each example targets a specific bug or edge case.

## 3. Assigning `slice_tags`

Every example must have at least two slice tags:

1. **Domain tag**: the primary `Maintenance_Category` or `Management_Category` value (e.g., `plumbing`, `accounting`). For OOD examples, use descriptive tags like `off_topic`, `gibberish`.
2. **Dataset tag**: the `dataset_type` value (e.g., `gold`, `hard`).
3. **Difficulty tag** (hard/regression only): a label describing why the example is difficult (e.g., `ambiguous`, `typo`, `hierarchy_violation`, `emergency`).

## 4. Review Workflow

```
draft  -->  reviewed  -->  approved_for_gate
```

1. **draft**: Initial creation. The example has not been verified by a second person.
2. **reviewed**: A reviewer has checked that (a) the conversation text is realistic, (b) all taxonomy values are valid, (c) the expected classification is correct, and (d) slice tags are appropriate.
3. **approved_for_gate**: A second reviewer (or the original author after addressing feedback) has confirmed the example is correct and suitable for use as a pass/fail gate in CI.

Only examples with `review_status: "approved_for_gate"` are used in the CI accuracy gate. Examples in `draft` or `reviewed` status are included in development-time evaluation runs but do not block deployment.

## 5. Dual Review Requirement

The following example categories require review by two independent reviewers before reaching `approved_for_gate`:

- **OOD examples**: Because incorrect OOD labeling can cause false negatives in the triage safety net.
- **High-risk / emergency examples**: Because incorrect expected risk flags can mask dangerous routing failures.

Both reviewers must be recorded (e.g., `"reviewed_by": "reviewer-1,reviewer-2"`).

## 6. Production-Derived Examples

Examples sourced from real tenant conversations (`source_type: "production_reviewed"`) must be sanitized before check-in:

- **Hash or redact** all personally identifiable information (names, unit numbers, phone numbers, email addresses).
- Replace real names with generic placeholders (e.g., "the tenant", "unit XXX").
- Do NOT commit raw production text to the repository.
- Record the original conversation ID in a separate, non-committed tracking sheet for audit purposes.
