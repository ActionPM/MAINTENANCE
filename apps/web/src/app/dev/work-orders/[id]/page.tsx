'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useParams } from 'next/navigation';
import { Suspense } from 'react';

interface WorkOrder {
  work_order_id: string;
  issue_group_id: string;
  conversation_id: string;
  unit_id: string;
  status: string;
  raw_text: string;
  summary_confirmed: string;
  classification: Record<string, string>;
  confidence_by_field: Record<string, number>;
  missing_fields: string[];
  risk_flags?: Record<string, unknown>;
  needs_human_triage: boolean;
  pinned_versions: Record<string, string>;
  created_at: string;
}

interface RecordBundle {
  work_order_id: string;
  urgency_basis: {
    has_emergency: boolean;
    highest_severity: string | null;
    trigger_ids: string[];
  };
  status_history: Array<{ status: string; changed_at: string }>;
  communications: Array<{
    notification_id: string;
    channel: string;
    notification_type: string;
    status: string;
    created_at: string;
  }>;
  schedule: {
    priority: string;
    response_hours: number;
    resolution_hours: number;
    response_due_at: string;
    resolution_due_at: string;
  };
  resolution: {
    resolved: boolean;
    final_status: string;
    resolved_at: string | null;
  };
}

const TAXONOMY_FIELDS = [
  'Category',
  'Location',
  'Sub_Location',
  'Maintenance_Category',
  'Maintenance_Object',
  'Maintenance_Problem',
  'Management_Category',
  'Management_Object',
  'Priority',
];

function confColor(conf: number): string {
  if (conf >= 0.8) return '#15803d';
  if (conf >= 0.5) return '#854d0e';
  return '#991b1b';
}

function confBg(conf: number): string {
  if (conf >= 0.8) return '#dcfce7';
  if (conf >= 0.5) return '#fef9c3';
  return '#fef2f2';
}

function WorkOrderDetailContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const id = params.id as string;

  const [wo, setWo] = useState<WorkOrder | null>(null);
  const [bundle, setBundle] = useState<RecordBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !id) return;
    const headers = { Authorization: `Bearer ${token}` };

    Promise.all([
      fetch(`/api/work-orders/${id}`, { headers }).then(async (r) => {
        if (!r.ok) throw new Error(`WO fetch failed: ${r.status}`);
        return r.json();
      }),
      fetch(`/api/work-orders/${id}/record-bundle`, { headers })
        .then(async (r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([woData, bundleData]) => {
        setWo(woData);
        setBundle(bundleData);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token, id]);

  if (!token) return <p style={{ padding: '2rem', textAlign: 'center' }}>Token required.</p>;
  if (loading)
    return <p style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>Loading...</p>;
  if (error)
    return <p style={{ padding: '2rem', textAlign: 'center', color: '#991b1b' }}>{error}</p>;
  if (!wo) return <p style={{ padding: '2rem', textAlign: 'center' }}>Work order not found.</p>;

  const riskFlags = wo.risk_flags as
    | { has_emergency?: boolean; highest_severity?: string; trigger_ids?: string[] }
    | undefined;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1.5rem', fontFamily: 'inherit' }}>
      <div style={{ marginBottom: '1rem' }}>
        <a
          href={`/dev/work-orders?token=${encodeURIComponent(token)}`}
          style={{ color: '#0066cc', fontSize: '0.85rem', textDecoration: 'none' }}
        >
          &larr; Back to Work Orders
        </a>
      </div>

      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1.5rem',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.25rem' }}>Work Order</h1>
          <span style={{ fontSize: '0.75rem', color: '#888', fontFamily: 'monospace' }}>
            {wo.work_order_id}
          </span>
        </div>
        <span
          style={{
            fontSize: '0.8rem',
            padding: '0.25rem 0.6rem',
            borderRadius: 4,
            background: wo.status === 'created' ? '#dbeafe' : '#f3f4f6',
            color: wo.status === 'created' ? '#1d4ed8' : '#555',
            fontWeight: 500,
          }}
        >
          {wo.status}
        </span>
      </div>

      {/* Summary */}
      <section style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: '#333' }}>Issue Summary</h2>
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>{wo.summary_confirmed}</p>
        <p style={{ margin: 0, fontSize: '0.8rem', color: '#666', fontStyle: 'italic' }}>
          &ldquo;{wo.raw_text.slice(0, 300)}
          {wo.raw_text.length > 300 ? '...' : ''}&rdquo;
        </p>
      </section>

      {/* Classification */}
      <section style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: '#333' }}>Classification</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
              <th
                style={{ textAlign: 'left', padding: '0.4rem 0', color: '#888', fontWeight: 500 }}
              >
                Field
              </th>
              <th
                style={{ textAlign: 'left', padding: '0.4rem 0', color: '#888', fontWeight: 500 }}
              >
                Value
              </th>
              <th
                style={{ textAlign: 'right', padding: '0.4rem 0', color: '#888', fontWeight: 500 }}
              >
                Confidence
              </th>
            </tr>
          </thead>
          <tbody>
            {TAXONOMY_FIELDS.map((field) => {
              const value = wo.classification[field] ?? '—';
              const conf = wo.confidence_by_field[field] ?? 0;
              const isNA = value === 'not_applicable';
              return (
                <tr key={field} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '0.4rem 0', color: isNA ? '#ccc' : '#333' }}>{field}</td>
                  <td style={{ padding: '0.4rem 0' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '0.1rem 0.4rem',
                        borderRadius: 4,
                        background: isNA ? '#f9fafb' : '#eef2ff',
                        color: isNA ? '#ccc' : '#3b5998',
                        fontSize: '0.8rem',
                      }}
                    >
                      {value}
                    </span>
                  </td>
                  <td style={{ padding: '0.4rem 0', textAlign: 'right' }}>
                    {!isNA && conf > 0 && (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                        <div
                          style={{
                            width: 60,
                            height: 8,
                            background: '#f3f4f6',
                            borderRadius: 4,
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              width: `${Math.round(conf * 100)}%`,
                              height: '100%',
                              background: confBg(conf),
                              borderRadius: 4,
                            }}
                          />
                        </div>
                        <span
                          style={{
                            fontSize: '0.75rem',
                            color: confColor(conf),
                            fontWeight: 500,
                            minWidth: 35,
                            textAlign: 'right',
                          }}
                        >
                          {Math.round(conf * 100)}%
                        </span>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* Risk Assessment */}
      {riskFlags &&
        (riskFlags.has_emergency ||
          (riskFlags.trigger_ids && riskFlags.trigger_ids.length > 0)) && (
          <section style={{ marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: '#333' }}>
              Risk Assessment
            </h2>
            <div
              style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}
            >
              {riskFlags.has_emergency && (
                <span
                  style={{
                    fontSize: '0.8rem',
                    background: '#fef2f2',
                    color: '#991b1b',
                    padding: '0.2rem 0.5rem',
                    borderRadius: 4,
                    fontWeight: 600,
                  }}
                >
                  Emergency
                </span>
              )}
              {riskFlags.highest_severity && (
                <span
                  style={{
                    fontSize: '0.8rem',
                    padding: '0.2rem 0.5rem',
                    borderRadius: 4,
                    background: riskFlags.highest_severity === 'emergency' ? '#fef2f2' : '#fef9c3',
                    color: riskFlags.highest_severity === 'emergency' ? '#991b1b' : '#854d0e',
                  }}
                >
                  Severity: {riskFlags.highest_severity}
                </span>
              )}
            </div>
            {riskFlags.trigger_ids && riskFlags.trigger_ids.length > 0 && (
              <p style={{ fontSize: '0.8rem', color: '#666', margin: 0 }}>
                Triggers: {riskFlags.trigger_ids.join(', ')}
              </p>
            )}
          </section>
        )}

      {wo.needs_human_triage && (
        <section
          style={{
            marginBottom: '1.5rem',
            background: '#fef9c3',
            padding: '0.75rem 1rem',
            borderRadius: 6,
          }}
        >
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#854d0e', fontWeight: 500 }}>
            This work order requires human review.
          </p>
        </section>
      )}

      {/* Record Bundle — SLA Schedule */}
      {bundle?.schedule && (
        <section style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: '#333' }}>SLA Schedule</h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '0.5rem',
              fontSize: '0.85rem',
            }}
          >
            <div>
              <span style={{ color: '#888' }}>Response:</span> {bundle.schedule.response_hours}h
              (due {new Date(bundle.schedule.response_due_at).toLocaleString()})
            </div>
            <div>
              <span style={{ color: '#888' }}>Resolution:</span> {bundle.schedule.resolution_hours}h
              (due {new Date(bundle.schedule.resolution_due_at).toLocaleString()})
            </div>
          </div>
        </section>
      )}

      {/* Status History */}
      {bundle?.status_history && bundle.status_history.length > 0 && (
        <section style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: '#333' }}>
            Status History
          </h2>
          <div style={{ fontSize: '0.8rem' }}>
            {bundle.status_history.map((entry, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  gap: '0.5rem',
                  padding: '0.25rem 0',
                  borderBottom: '1px solid #f3f4f6',
                }}
              >
                <span style={{ color: '#888', minWidth: 140 }}>
                  {new Date(entry.changed_at).toLocaleString()}
                </span>
                <span style={{ fontWeight: 500 }}>{entry.status}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Communications */}
      {bundle?.communications && bundle.communications.length > 0 && (
        <section style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: '#333' }}>
            Communications
          </h2>
          <div style={{ fontSize: '0.8rem' }}>
            {bundle.communications.map((comm) => (
              <div
                key={comm.notification_id}
                style={{
                  display: 'flex',
                  gap: '0.5rem',
                  padding: '0.25rem 0',
                  borderBottom: '1px solid #f3f4f6',
                }}
              >
                <span style={{ minWidth: 50 }}>{comm.channel}</span>
                <span style={{ flex: 1 }}>{comm.notification_type}</span>
                <span
                  style={{
                    color:
                      comm.status === 'sent' || comm.status === 'delivered' ? '#15803d' : '#888',
                  }}
                >
                  {comm.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Resolution */}
      {bundle?.resolution && (
        <section style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: '#333' }}>Resolution</h2>
          <p style={{ fontSize: '0.85rem', margin: 0 }}>
            {bundle.resolution.resolved
              ? `Resolved (${bundle.resolution.final_status}) at ${new Date(bundle.resolution.resolved_at!).toLocaleString()}`
              : `Not yet resolved — current status: ${bundle.resolution.final_status}`}
          </p>
        </section>
      )}

      {/* Pinned Versions */}
      <section style={{ borderTop: '1px solid #e0e0e0', paddingTop: '1rem', marginTop: '1rem' }}>
        <p style={{ fontSize: '0.7rem', color: '#aaa', margin: 0 }}>
          Taxonomy: {wo.pinned_versions?.taxonomy_version ?? '—'} &middot; Schema:{' '}
          {wo.pinned_versions?.schema_version ?? '—'} &middot; Model:{' '}
          {wo.pinned_versions?.model_id ?? '—'} &middot; Created:{' '}
          {new Date(wo.created_at).toLocaleString()}
        </p>
      </section>
    </div>
  );
}

export default function WorkOrderDetailPage() {
  return (
    <Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>}>
      <WorkOrderDetailContent />
    </Suspense>
  );
}
