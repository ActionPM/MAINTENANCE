'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ChatShell } from '@/components/chat-shell';

function ChatPageContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const units = searchParams.get('units');

  if (!token) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p>Token required. Append <code>?token=YOUR_JWT&units=unit1,unit2</code> to the URL.</p>
      </div>
    );
  }

  const unitIds = units ? units.split(',').filter(Boolean) : [];

  return <ChatShell token={token} unitIds={unitIds} />;
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>}>
      <ChatPageContent />
    </Suspense>
  );
}
