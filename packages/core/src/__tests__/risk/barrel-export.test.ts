import { describe, it, expect } from 'vitest';
import {
  scanTextForTriggers,
  scanClassificationForTriggers,
  mergeRiskScanResults,
  resolveMitigationTemplate,
  renderMitigationMessages,
  buildRiskDetectedEvent,
  buildEscalationAttemptEvent,
  buildEscalationResultEvent,
  routeEmergency,
} from '../../risk/index.js';

describe('risk barrel export', () => {
  it('exports all risk module functions', () => {
    expect(scanTextForTriggers).toBeDefined();
    expect(scanClassificationForTriggers).toBeDefined();
    expect(mergeRiskScanResults).toBeDefined();
    expect(resolveMitigationTemplate).toBeDefined();
    expect(renderMitigationMessages).toBeDefined();
    expect(buildRiskDetectedEvent).toBeDefined();
    expect(buildEscalationAttemptEvent).toBeDefined();
    expect(buildEscalationResultEvent).toBeDefined();
    expect(routeEmergency).toBeDefined();
  });
});
