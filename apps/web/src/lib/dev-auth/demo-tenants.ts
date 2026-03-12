/**
 * Seeded demo tenant catalog for local development and testing.
 *
 * Each entry defines a stable internal identity (tenant_user_id,
 * tenant_account_id, authorized_unit_ids) that maps to the same
 * AuthContext shape used by production auth. Phone/email metadata
 * is included for future identity-provider mapping but is not used
 * for authentication today.
 *
 * This catalog is the source of truth for dev auth token issuance
 * (POST /api/dev/auth/demo-login) and will be replaced by a
 * persistent tenant_users table when production auth is implemented.
 */

export interface DemoTenant {
  readonly persona_key: string;
  readonly tenant_user_id: string;
  readonly tenant_account_id: string;
  readonly authorized_unit_ids: readonly string[];
  readonly default_unit_id: string;
  readonly display_name: string;
  readonly email?: string;
  readonly phone_e164?: string;
}

/**
 * Three demo personas covering common testing scenarios:
 * - alice: single-unit tenant (happy path)
 * - bob: multi-unit tenant (unit selection, cross-unit scope)
 * - carol: different account (cross-tenant ownership tests)
 */
export const DEMO_TENANTS: readonly DemoTenant[] = [
  {
    persona_key: 'alice',
    tenant_user_id: 'tu-demo-alice',
    tenant_account_id: 'ta-demo-acme',
    authorized_unit_ids: ['unit-101'],
    default_unit_id: 'unit-101',
    display_name: 'Alice Johnson',
    email: 'alice@example.com',
    phone_e164: '+15551000001',
  },
  {
    persona_key: 'bob',
    tenant_user_id: 'tu-demo-bob',
    tenant_account_id: 'ta-demo-acme',
    authorized_unit_ids: ['unit-201', 'unit-202', 'unit-203'],
    default_unit_id: 'unit-201',
    display_name: 'Bob Martinez',
    email: 'bob@example.com',
    phone_e164: '+15551000002',
  },
  {
    persona_key: 'carol',
    tenant_user_id: 'tu-demo-carol',
    tenant_account_id: 'ta-demo-birch',
    authorized_unit_ids: ['unit-301'],
    default_unit_id: 'unit-301',
    display_name: 'Carol Nguyen',
    email: 'carol@example.com',
    phone_e164: '+15551000003',
  },
] as const;

const TENANT_MAP = new Map(DEMO_TENANTS.map((t) => [t.persona_key, t]));

/**
 * Look up a demo tenant by persona key. Returns undefined for unknown keys.
 */
export function getDemoTenant(personaKey: string): DemoTenant | undefined {
  return TENANT_MAP.get(personaKey);
}
