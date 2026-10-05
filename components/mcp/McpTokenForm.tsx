'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createMcpTokenAction, type MadeToken } from '@/app/settings/actions';
import { createSyncTokenAction } from '@/app/sync/actions';
import s from './mcp.module.css';

/** Where each cloud sync token is kept on the Mac (docs/deploy/railway.md §6–§7), and what reads it. */
const SYNC_USE: Record<'snapshot' | 'push', { item: string; script: string }> = {
  snapshot: { item: 'snapshot-token', script: 'bash scripts/cloud-pull.sh pull --to postgres://plcos@127.0.0.1:57434/plcos_copy' },
  push: { item: 'push-token', script: 'bash scripts/cloud-push.sh <finished output file>' },
};

/**
 * Make a token, and show it once with what connects it (docs/26-mcp.md): the Claude Code command for an
 * MCP token, or for a cloud sync token the Keychain item the pull or push script reads it from.
 */
export function McpTokenForm({ endpoint, vehicles, draftTools, syncScopes = [] }: {
  endpoint: string; vehicles: Array<{ id: string; name: string }>; draftTools: string[]; syncScopes?: Array<'snapshot' | 'push'>;
}) {
  const router = useRouter();
  const [made, setMade] = useState<(MadeToken & { scope?: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState('read');
  const sync = made?.ok && (made.scope === 'snapshot' || made.scope === 'push') ? SYNC_USE[made.scope] : null;
  const command = !made?.ok ? ''
    : sync ? `security add-generic-password -s plcos-railway -a ${sync.item} -U -w`
      : `claude mcp add --transport http --scope user capital-os ${endpoint} --header "Authorization: Bearer ${made.secret}"`;
  return (
    <>
      <form
        className={s.form}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const data = new FormData(e.currentTarget);
            const chosen = String(data.get('tools') ?? 'read');
            const r = chosen === 'snapshot' || chosen === 'push' ? await createSyncTokenAction(data) : await createMcpTokenAction(data);
            setMade({ ...r, scope: chosen });
            if (r.ok) { (e.target as HTMLFormElement).reset(); setScope('read'); router.refresh(); }
          } finally { setBusy(false); }
        }}
      >
        <label className={s.row}>
          <span>Name</span>
          <input name="label" maxLength={80} placeholder="Claude Code on the Mac" required />
        </label>
        <fieldset className={s.row} onChange={(e) => setScope((e.target as HTMLInputElement).value)}>
          <legend>May</legend>
          <label><input type="radio" name="tools" value="read" defaultChecked /> Read</label>
          <label><input type="radio" name="tools" value="draft" /> Read, and {draftTools.join(' and ')}</label>
          {syncScopes.includes('snapshot') && <label><input type="radio" name="tools" value="snapshot" /> Snapshot: copy the whole database to the Mac (cloud-pull)</label>}
          {syncScopes.includes('push') && <label><input type="radio" name="tools" value="push" /> Push: send finished research up (cloud-push)</label>}
        </fieldset>
        {vehicles.length > 1 && scope !== 'snapshot' && scope !== 'push' && (
          <fieldset className={s.row}>
            <legend>Vehicles</legend>
            {vehicles.map((v) => <label key={v.id}><input type="checkbox" name="vehicle" value={v.id} /> {v.name}</label>)}
            <small className="muted">None ticked: all of yours.</small>
          </fieldset>
        )}
        <div><button className="btn p" type="submit" disabled={busy}>{busy ? 'Making…' : 'Make token'}</button></div>
      </form>
      {made && !made.ok && <p role="status" style={{ color: 'var(--clay)' }}>{made.error}</p>}
      {made?.ok && (
        <div className={s.secret} role="status">
          <p style={{ margin: '0 0 6px' }}><b>{made.label}</b> — copy it now; it is not shown again.</p>
          <code className={s.code}>{made.secret}</code>
          <p style={{ margin: '10px 0 6px' }}>{sync ? 'Keep it in the Mac’s Keychain (in a terminal; it asks for the token, hidden as you paste):' : 'Connect Claude Code (in a terminal):'}</p>
          <code className={s.code}>{command}</code>
          {sync && <p style={{ margin: '10px 0 0' }} className="muted">Then <span className="mono">{sync.script}</span> reads it from there.</p>}
          <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => void navigator.clipboard?.writeText(command)}>Copy the command</button>
        </div>
      )}
    </>
  );
}
