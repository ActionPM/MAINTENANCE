'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BuildInfo } from '@/lib/build-info';

interface Persona {
  key: string;
  name: string;
  description: string;
  unitIds: string[];
}

const PERSONAS: Persona[] = [
  {
    key: 'alice',
    name: 'Alice Johnson',
    description: '1 unit (unit-101) — single-unit happy path',
    unitIds: ['unit-101'],
  },
  {
    key: 'bob',
    name: 'Bob Martinez',
    description: '3 units (unit-201, 202, 203) — triggers unit selector',
    unitIds: ['unit-201', 'unit-202', 'unit-203'],
  },
  {
    key: 'carol',
    name: 'Carol Nguyen',
    description: '1 unit (unit-301) — different account (cross-tenant)',
    unitIds: ['unit-301'],
  },
];

export default function DevLoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadBuildInfo() {
      try {
        const res = await fetch('/api/dev/build-info', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as BuildInfo;
        if (!cancelled) {
          setBuildInfo(data);
        }
      } catch {
        // Build info is diagnostic only; ignore failures.
      }
    }

    void loadBuildInfo();
    return () => {
      cancelled = true;
    };
  }, []);

  async function login(persona: Persona) {
    setLoading(persona.key);
    setError(null);

    try {
      const res = await fetch('/api/dev/auth/demo-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona_key: persona.key }),
      });

      const data = await res.json();

      if (!res.ok) {
        const msg = data.errors?.[0]?.message ?? `HTTP ${res.status}`;
        setError(msg);
        setLoading(null);
        return;
      }

      const params = new URLSearchParams({
        token: data.access_token,
        units: persona.unitIds.join(','),
      });

      router.push(`/?${params.toString()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setLoading(null);
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: '4rem auto', padding: '0 1rem', fontFamily: 'inherit' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Dev Login</h1>
      <p style={{ color: '#666', marginBottom: '2rem', fontSize: '0.9rem' }}>
        Pick a demo persona to get a token and open the chat UI.
      </p>

      {buildInfo && (
        <div
          style={{
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: 6,
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
            color: '#1e3a8a',
            fontSize: '0.8rem',
            lineHeight: 1.5,
          }}
        >
          <div>
            <strong>Build marker:</strong> {buildInfo.marker}
          </div>
          <div>
            <strong>Commit:</strong> {buildInfo.commit_sha ?? 'local-or-unknown'}
          </div>
          <div>
            <strong>Branch:</strong> {buildInfo.branch ?? 'local-or-unknown'}
          </div>
          <div>
            <strong>Env:</strong> {buildInfo.vercel_env ?? 'local-or-unknown'}
          </div>
        </div>
      )}

      {error && (
        <div
          style={{
            background: '#fef2f2',
            border: '1px solid #fca5a5',
            borderRadius: 6,
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
            color: '#991b1b',
            fontSize: '0.85rem',
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {PERSONAS.map((p) => (
          <button
            key={p.key}
            onClick={() => login(p)}
            disabled={loading !== null}
            style={{
              padding: '1rem',
              border: '1px solid #d1d5db',
              borderRadius: 8,
              background: loading === p.key ? '#f3f4f6' : '#fff',
              cursor: loading !== null ? 'wait' : 'pointer',
              textAlign: 'left',
              fontSize: '0.9rem',
            }}
          >
            <strong>{p.name}</strong>
            <br />
            <span style={{ color: '#666', fontSize: '0.8rem' }}>{p.description}</span>
            {loading === p.key && (
              <span style={{ float: 'right', color: '#6b7280' }}>Loading...</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
