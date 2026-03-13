import type { RiskProtocols } from './types/risk.js';
import protocolsData from '../risk_protocols.json';

/**
 * Load risk_protocols.json as a typed RiskProtocols object.
 * Validates that every trigger references an existing mitigation template.
 */
export function loadRiskProtocols(): RiskProtocols {
  const protocols = protocolsData as unknown as RiskProtocols;

  const templateIds = new Set(protocols.mitigation_templates.map((t) => t.template_id));
  for (const trigger of protocols.triggers) {
    if (!templateIds.has(trigger.mitigation_template_id)) {
      throw new Error(
        `Trigger ${trigger.trigger_id} references missing mitigation template: ${trigger.mitigation_template_id}`,
      );
    }
  }

  return protocols;
}
