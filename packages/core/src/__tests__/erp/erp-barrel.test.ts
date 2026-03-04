import { describe, it, expect } from 'vitest';
import * as erp from '../../erp/index.js';

describe('ERP barrel exports (Phase 12)', () => {
  it('exports event builders', () => {
    expect(typeof erp.buildERPCreateEvent).toBe('function');
    expect(typeof erp.buildERPStatusPollEvent).toBe('function');
    expect(typeof erp.buildERPSyncEvent).toBe('function');
  });
});
