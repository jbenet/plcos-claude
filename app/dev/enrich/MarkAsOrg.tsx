'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Marks one record an organisation through POST /api/identity/entity-type, and says what came back. */
export function MarkAsOrg({ entityId }: { entityId: string }) {
  const router = useRouter();
  const [state, setState] = useState<{ busy?: boolean; error?: string; done?: string }>({});
  if (state.done) return <span role="status" className="muted">{state.done}</span>;
  return <>
    <button type="button" className="btn" style={{ padding: '1px 8px', fontSize: 11.5 }} disabled={state.busy} onClick={async () => {
      setState({ busy: true });
      const r = await fetch('/api/identity/entity-type', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operation: 'correct', entityId, type: 'org', requestKey: `app:${entityId}:org`,
          reason: 'Marked an organisation in Developer → Enrichment: the name is an organisation we hold.' }) }).catch(() => null);
      const body = await r?.json().catch(() => null) as { correctionId?: string | null; error?: string } | null;
      if (!r?.ok) { setState({ error: body?.error ?? 'The correction did not go through.' }); return; }
      setState({ done: body?.correctionId ? `Marked an organisation (correction ${body.correctionId.slice(0, 8)})` : 'Already an organisation' });
      router.refresh();
    }}>{state.busy ? 'Marking…' : 'Mark as organisation'}</button>
    {state.error && <span role="alert" style={{ color: 'var(--clay)', marginLeft: 6 }}>{state.error}</span>}
  </>;
}
