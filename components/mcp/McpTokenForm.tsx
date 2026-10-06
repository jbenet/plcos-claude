'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createMcpTokenAction, type MadeToken } from '@/app/settings/actions';
import s from './mcp.module.css';

/** Where each cloud sync token is kept on the Mac (docs/deploy/railway.md §6–§7), and what reads it. */
const SYNC_USE: Record<string, { item: string; script: string }> = {
  snapshot: { item: 'snapshot-token', script: 'bash scripts/cloud-pull.sh pull --to postgres://plcos@127.0.0.1:57434/plcos_copy' },
  push: { item: 'push-token', script: 'bash scripts/cloud-push.sh <finished output file>' },
  'push-vehicles': { item: 'push-token', script: 'bash scripts/cloud-push.sh <finished output file>; bash scripts/cloud-vehicle.sh <vehicle.json>' },
};

/**
 * Make a token, and show it once with the command that connects it (docs/26-mcp.md): Claude Code for an MCP
 * token, a curl for the outreach desk, or for a cloud sync token the Keychain item its script reads.
 */
export function McpTokenForm({ endpoint, vehicles, draftTools, outreach = false, sync = [], days = 90 }: {
  endpoint: string; vehicles: Array<{ id: string; name: string }>; draftTools: string[];
  /** Offer the mail desk's outreach scope (docs/27): Admin only for now. */
  outreach?: boolean;
  /** The cloud sync scopes this person may hold (lib/sync/scopes.ts): snapshot for an Admin, push for a Team member or an Admin. */
  sync?: Array<'snapshot' | 'push' | 'push-vehicles'>;
  /** The default expiry, in days. */
  days?: number;
}) {
  const router = useRouter();
  const [made, setMade] = useState<MadeToken | null>(null);
  const [busy, setBusy] = useState(false);
  const [preset, setPreset] = useState('read');
  const keep = made?.ok ? SYNC_USE[preset] : undefined;
  const command = keep ? `security add-generic-password -s plcos-railway -a ${keep.item} -U -w`
    : made?.ok && preset.startsWith('outreach') ? `curl -H "Authorization: Bearer ${made.secret}" ${endpoint.replace(/\/api\/mcp$/, '/api/outreach/vehicles')}`
    : made?.ok ? `claude mcp add --transport http --scope user capital-os ${endpoint} --header "Authorization: Bearer ${made.secret}"` : '';
  return (
    <>
      <form
        className={s.form}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const r = await createMcpTokenAction(new FormData(e.currentTarget));
            setMade(r);
            if (r.ok) { (e.target as HTMLFormElement).reset(); router.refresh(); }
          } finally { setBusy(false); }
        }}
      >
        <label className={s.row}>
          <span>Name</span>
          <input name="label" maxLength={80} placeholder="Claude Code on the Mac" required />
        </label>
        <fieldset className={s.row}>
          <legend>May</legend>
          <label><input type="radio" name="tools" value="read" defaultChecked onChange={() => setPreset('read')} /> Read</label>
          <label><input type="radio" name="tools" value="draft" onChange={() => setPreset('draft')} /> Read, and {draftTools.join(' and ')}</label>
          {outreach && (
            <>
              <label><input type="radio" name="tools" value="outreach-read" onChange={() => setPreset('outreach-read')} /> Outreach desk: read the queue</label>
              <label><input type="radio" name="tools" value="outreach-write" onChange={() => setPreset('outreach-write')} /> Outreach desk: read, record updates, ask for approvals, record sends</label>
            </>
          )}
          {sync.includes('snapshot') && <label><input type="radio" name="tools" value="snapshot" onChange={() => setPreset('snapshot')} /> Snapshot: copy the whole database to the Mac (cloud-pull)</label>}
          {sync.includes('push') && <label><input type="radio" name="tools" value="push" onChange={() => setPreset('push')} /> Push: send finished research up (cloud-push)</label>}
          {sync.includes('push-vehicles') && <label><input type="radio" name="tools" value="push-vehicles" onChange={() => setPreset('push-vehicles')} /> Push and add vehicles: research up, and new vehicles as you (cloud-push, cloud-vehicle)</label>}
        </fieldset>
        <label className={s.row}>
          <span>Expires</span>
          <select name="days" defaultValue={String(days)}>
            <option value="7">in a week</option>
            <option value="30">in a month</option>
            <option value="90">in three months</option>
            <option value="365">in a year</option>
          </select>
        </label>
        {vehicles.length > 1 && !SYNC_USE[preset] && (
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
          <p style={{ margin: '10px 0 6px' }}>{keep ? 'Keep it in the Mac’s Keychain (in a terminal; it asks for the token, hidden as you paste):'
            : preset.startsWith('outreach') ? 'Try it (in a terminal):' : 'Connect Claude Code (in a terminal):'}</p>
          <code className={s.code}>{command}</code>
          {keep && <p style={{ margin: '10px 0 0' }} className="muted">Then <span className="mono">{keep.script}</span> reads it from there.</p>}
          <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => void navigator.clipboard?.writeText(command)}>Copy the command</button>
        </div>
      )}
    </>
  );
}
