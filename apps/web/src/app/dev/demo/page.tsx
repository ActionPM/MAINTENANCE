'use client';

import { useState } from 'react';
import styles from './demo.module.css';

interface Scenario {
  key: string;
  title: string;
  description: string;
  message: string;
  capabilities: string[];
}

const SCENARIOS: Scenario[] = [
  {
    key: 'standard',
    title: 'Standard Request',
    description:
      'A tenant reports a leaking kitchen faucet. Watch the agent classify it, assign taxonomy labels, and create a work order.',
    message:
      'My kitchen faucet has been dripping constantly for the past two days. Water is pooling under the sink.',
    capabilities: ['Taxonomy classification', 'Work order creation'],
  },
  {
    key: 'multi-issue',
    title: 'Multi-Issue Report',
    description:
      'A tenant describes multiple problems at once. The agent splits them into separate issues, classifies each differently, and asks follow-up questions for uncertain fields.',
    message:
      'Hi, I have a few problems. The kitchen faucet is leaking and there\'s water under the sink. Also, the hallway light near my front door has been flickering on and off for a week. And I think I saw a cockroach in the bathroom last night.',
    capabilities: [
      'Multi-issue splitting',
      'Split review',
      'Diverse classification',
      'Follow-up questions',
      'Grouped work orders',
    ],
  },
  {
    key: 'emergency',
    title: 'Emergency Detection',
    description:
      'A tenant reports a flooding emergency. The agent detects the risk, shows safety instructions, and offers emergency escalation before creating the work order.',
    message:
      "There's water flooding from the pipe under my kitchen sink, it's everywhere on the floor and it won't stop! The water is spreading to the hallway.",
    capabilities: [
      'Emergency detection',
      'Safety mitigations',
      'Escalation confirm/decline',
      'Risk flags on work order',
    ],
  },
];

const ARCH_ITEMS = [
  '14 conversation states',
  'Deterministic state machine',
  'Schema-locked LLM outputs',
  'Append-only event log',
  'Idempotent WO creation',
  'Emergency routing',
];

export default function DemoPage() {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function launch(scenario: Scenario) {
    setLoading(scenario.key);
    setError(null);

    try {
      const res = await fetch('/api/dev/auth/demo-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona_key: 'bob' }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.errors?.[0]?.message ?? `HTTP ${res.status}`);
        setLoading(null);
        return;
      }

      const params = new URLSearchParams({
        token: data.access_token,
        units: 'unit-201,unit-202,unit-203',
        demo_scenario: scenario.key,
        demo_message: scenario.message,
      });

      // Hard navigation — router.push() can fail to re-read useSearchParams on the target page.
      // Use assign() instead of href assignment to avoid React Compiler immutability error.
      window.location.assign(`/?${params.toString()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setLoading(null);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Service Request Intake & Triage Agent</h1>
        <p className={styles.tagline}>
          AI-powered maintenance request processing with authoritative taxonomy classification
        </p>
        <p className={styles.description}>
          Tenants describe maintenance issues in natural language. The agent splits multi-issue
          messages, classifies each against a 9-field taxonomy, asks follow-up questions for
          uncertain fields, detects emergencies, and creates schema-enforced work orders — all
          with deterministic state-machine control.
        </p>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.scenarioGrid}>
        {SCENARIOS.map((s) => (
          <div key={s.key} className={styles.card}>
            <h2 className={styles.cardTitle}>{s.title}</h2>
            <p className={styles.cardDescription}>{s.description}</p>
            <div className={styles.capabilities}>
              {s.capabilities.map((c) => (
                <span key={c} className={styles.capBadge}>
                  {c}
                </span>
              ))}
            </div>
            <button
              className={styles.launchBtn}
              onClick={() => launch(s)}
              disabled={loading !== null}
            >
              {loading === s.key ? 'Loading...' : 'Launch Demo'}
            </button>
          </div>
        ))}
      </div>

      <div className={styles.architecture}>
        <h3 className={styles.archTitle}>Under the Hood</h3>
        <ul className={styles.archList}>
          {ARCH_ITEMS.map((item) => (
            <li key={item} className={styles.archItem}>
              {item}
            </li>
          ))}
        </ul>
        <p className={styles.techStack}>
          Next.js 15 &middot; TypeScript &middot; PostgreSQL &middot; Claude AI
        </p>
      </div>
    </div>
  );
}
