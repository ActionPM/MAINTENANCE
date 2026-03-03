import type { RiskProtocols, RiskScanResult, MatchedTrigger, RiskSeverity } from '@wo-agent/schemas';

const SEVERITY_RANK: Record<RiskSeverity, number> = {
  emergency: 3,
  high: 2,
  medium: 1,
};

/**
 * Deterministic risk scan against trigger grammar (spec §17).
 * Pure function — no side effects.
 * Checks keyword_any and regex_any against lowercased text.
 */
export function scanTextForTriggers(
  text: string,
  protocols: RiskProtocols,
): RiskScanResult {
  const lowerText = text.toLowerCase();
  const matched: MatchedTrigger[] = [];

  for (const trigger of protocols.triggers) {
    const matchedKeywords = trigger.grammar.keyword_any.filter(
      kw => lowerText.includes(kw.toLowerCase()),
    );

    const matchedRegex: string[] = [];
    for (const pattern of trigger.grammar.regex_any) {
      try {
        const re = new RegExp(pattern, 'i');
        if (re.test(text)) {
          matchedRegex.push(pattern);
        }
      } catch {
        // Invalid regex in config — skip
      }
    }

    if (matchedKeywords.length > 0 || matchedRegex.length > 0) {
      matched.push({
        trigger,
        matched_keywords: matchedKeywords,
        matched_regex: matchedRegex,
        matched_taxonomy_paths: [],
      });
    }
  }

  return buildScanResult(matched);
}

/**
 * Scan classification output for taxonomy_path_any triggers (spec §17).
 * Builds taxonomy paths from classification field values and matches
 * against trigger grammar.
 */
export function scanClassificationForTriggers(
  classification: Record<string, string>,
  protocols: RiskProtocols,
): RiskScanResult {
  const paths = buildTaxonomyPaths(classification);
  const matched: MatchedTrigger[] = [];

  for (const trigger of protocols.triggers) {
    if (trigger.grammar.taxonomy_path_any.length === 0) continue;

    const matchedPaths = trigger.grammar.taxonomy_path_any.filter(
      tp => paths.has(tp),
    );

    if (matchedPaths.length > 0) {
      matched.push({
        trigger,
        matched_keywords: [],
        matched_regex: [],
        matched_taxonomy_paths: matchedPaths,
      });
    }
  }

  return buildScanResult(matched);
}

/**
 * Merge two scan results (text scan + classification scan).
 * Deduplicates by trigger_id, merging match details.
 */
export function mergeRiskScanResults(
  a: RiskScanResult,
  b: RiskScanResult,
): RiskScanResult {
  const byId = new Map<string, MatchedTrigger>();

  for (const m of [...a.triggers_matched, ...b.triggers_matched]) {
    const existing = byId.get(m.trigger.trigger_id);
    if (existing) {
      byId.set(m.trigger.trigger_id, {
        trigger: m.trigger,
        matched_keywords: [...new Set([...existing.matched_keywords, ...m.matched_keywords])],
        matched_regex: [...new Set([...existing.matched_regex, ...m.matched_regex])],
        matched_taxonomy_paths: [...new Set([...existing.matched_taxonomy_paths, ...m.matched_taxonomy_paths])],
      });
    } else {
      byId.set(m.trigger.trigger_id, m);
    }
  }

  return buildScanResult([...byId.values()]);
}

function buildScanResult(matched: MatchedTrigger[]): RiskScanResult {
  let highestRank = 0;
  let highestSeverity: RiskSeverity | null = null;
  let hasEmergency = false;

  for (const m of matched) {
    const rank = SEVERITY_RANK[m.trigger.severity];
    if (rank > highestRank) {
      highestRank = rank;
      highestSeverity = m.trigger.severity;
    }
    if (m.trigger.severity === 'emergency') {
      hasEmergency = true;
    }
  }

  return {
    triggers_matched: matched,
    has_emergency: hasEmergency,
    highest_severity: highestSeverity,
  };
}

function buildTaxonomyPaths(classification: Record<string, string>): Set<string> {
  const paths = new Set<string>();
  const category = classification.maintenance_category;
  const subcategory = classification.maintenance_subcategory;
  const object = classification.maintenance_object;

  if (category) {
    paths.add(`maintenance.${category}`);
    if (subcategory) {
      paths.add(`maintenance.${category}.${subcategory}`);
      if (object) {
        paths.add(`maintenance.${category}.${subcategory}.${object}`);
      }
    }
  }

  return paths;
}
