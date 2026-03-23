'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

interface WorkOrderSummary {
  work_order_id: string;
  summary_confirmed: string;
  status: string;
  classification: Record<string, string>;
  confidence_by_field: Record<string, number>;
  risk_flags?: Record<string, unknown>;
  needs_human_triage: boolean;
  created_at: string;
}

function WorkOrderListContent() {
  const params = useSearchParams();
  const token = params.get('token');
  const [orders, setOrders] = useState<WorkOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch('/api/work-orders', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => setOrders(data.work_orders ?? []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  if (!token) {
    return <p style={{ padding: '2rem', textAlign: 'center' }}>Token required.</p>;
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1.5rem', fontFamily: 'inherit' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1.5rem',
        }}
      >
        <h1 style={{ fontSize: '1.5rem', margin: 0 }}>Work Orders</h1>
        <a
          href="/dev/demo"
          style={{ color: '#0066cc', fontSize: '0.85rem', textDecoration: 'none' }}
        >
          Back to Demo
        </a>
      </div>

      {error && (
        <div
          style={{
            background: '#fef2f2',
            border: '1px solid #fca5a5',
            borderRadius: 6,
            padding: '0.75rem',
            marginBottom: '1rem',
            color: '#991b1b',
            fontSize: '0.85rem',
          }}
        >
          {error}
        </div>
      )}

      {loading && <p style={{ color: '#888' }}>Loading...</p>}

      {!loading && orders.length === 0 && <p style={{ color: '#888' }}>No work orders yet.</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {orders.map((wo) => {
          const hasRisk = !!(
            wo.risk_flags && (wo.risk_flags as Record<string, unknown>).has_emergency
          );
          const category = wo.classification?.Category ?? '';
          const priority = wo.classification?.Priority ?? '';
          return (
            <a
              key={wo.work_order_id}
              href={`/dev/work-orders/${wo.work_order_id}?token=${encodeURIComponent(token)}`}
              style={{
                display: 'block',
                border: '1px solid #e0e0e0',
                borderRadius: 8,
                padding: '1rem',
                textDecoration: 'none',
                color: 'inherit',
                background: '#fff',
              }}
            >
              <div
                style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}
              >
                <span style={{ fontSize: '0.75rem', color: '#888', fontFamily: 'monospace' }}>
                  {wo.work_order_id.slice(0, 8)}...
                </span>
                <span
                  style={{
                    fontSize: '0.7rem',
                    padding: '0.15rem 0.5rem',
                    borderRadius: 4,
                    background: wo.status === 'created' ? '#dbeafe' : '#f3f4f6',
                    color: wo.status === 'created' ? '#1d4ed8' : '#555',
                  }}
                >
                  {wo.status}
                </span>
              </div>
              <p style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', fontWeight: 500 }}>
                {wo.summary_confirmed}
              </p>
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                {category && (
                  <span
                    style={{
                      fontSize: '0.7rem',
                      background: '#eef2ff',
                      color: '#3b5998',
                      padding: '0.15rem 0.4rem',
                      borderRadius: 4,
                    }}
                  >
                    {category}
                  </span>
                )}
                {priority && (
                  <span
                    style={{
                      fontSize: '0.7rem',
                      background: priority === 'emergency' ? '#fef2f2' : '#f3f4f6',
                      color: priority === 'emergency' ? '#991b1b' : '#555',
                      padding: '0.15rem 0.4rem',
                      borderRadius: 4,
                    }}
                  >
                    {priority}
                  </span>
                )}
                {hasRisk && (
                  <span
                    style={{
                      fontSize: '0.7rem',
                      background: '#fef2f2',
                      color: '#991b1b',
                      padding: '0.15rem 0.4rem',
                      borderRadius: 4,
                    }}
                  >
                    Risk
                  </span>
                )}
                {wo.needs_human_triage && (
                  <span
                    style={{
                      fontSize: '0.7rem',
                      background: '#fef9c3',
                      color: '#854d0e',
                      padding: '0.15rem 0.4rem',
                      borderRadius: 4,
                    }}
                  >
                    Triage needed
                  </span>
                )}
              </div>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: '#888' }}>
                {new Date(wo.created_at).toLocaleString()}
              </p>
            </a>
          );
        })}
      </div>
    </div>
  );
}

export default function WorkOrderListPage() {
  return (
    <Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>}>
      <WorkOrderListContent />
    </Suspense>
  );
}
