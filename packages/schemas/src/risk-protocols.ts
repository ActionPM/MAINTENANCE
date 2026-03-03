import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RiskProtocols } from './types/risk.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load risk_protocols.json as a typed RiskProtocols object.
 * Validates that every trigger references an existing mitigation template.
 */
export function loadRiskProtocols(): RiskProtocols {
  const filePath = resolve(__dirname, '..', 'risk_protocols.json');
  const raw = readFileSync(filePath, 'utf-8');
  const protocols = JSON.parse(raw) as RiskProtocols;

  const templateIds = new Set(protocols.mitigation_templates.map(t => t.template_id));
  for (const trigger of protocols.triggers) {
    if (!templateIds.has(trigger.mitigation_template_id)) {
      throw new Error(
        `Trigger ${trigger.trigger_id} references missing mitigation template: ${trigger.mitigation_template_id}`,
      );
    }
  }

  return protocols;
}
