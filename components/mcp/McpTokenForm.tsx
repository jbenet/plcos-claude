'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createMcpTokenAction, type MadeToken } from '@/app/settings/actions';
import s from './mcp.module.css';

/** The cloud sync presets (docs/deploy/railway.md §6–§7): no vehicle choice. */
const SYNC_PRESETS = new Set(['snapshot', 'push', 'admin']);

/**
 * Make a token, and show it once with a button that copies it (docs/26-mcp.md). Only the token: no terminal
 * command to paste (issue 0126). The endpoint it goes with is printed at the foot of the card.
 */
export function McpTokenForm({ vehicles, draftTools, outreach = false, sync = [], days = 90 }: {
  vehicles: Array<{ id: string; name: string }>; draftTools: string[];
  /** Offer the mail desk's outreach scope (docs/27): Admin only for now. */
  outreach?: boolean;
  /** The cloud sync scopes this person may hold (lib/sync/scopes.ts): snapshot for an Admin, push for a Team member or an Admin. */
  sync?: Array<'snapshot' | 'push' | 'admin'>;
  /** The default expiry, in days. */
  days?: number;
}) {
  const router = useRouter();
  const [made, setMade] = useState<MadeToken | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [preset, setPreset] = useState('read');
  const syncToken = SYNC_PRESETS.has(preset);
  return (
    <>
      <form
        className={s.form}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const r = await createMcpTokenAction(new FormData(e.currentTarget));
            setMade(r); setCopied(false);
            if (r.ok) { (e.target as HTMLFormElement).reset(); setPreset('read'); router.refresh(); }
          } finally { setBusy(false); }
        }}
      >
        <label className={s.row}>
          <span>Name</span>
          <input name="label" maxLength={80} placeholder="Claude Code on the Mac" required />
        </label>
        <fieldset className={s.set}>
          <legend>May</legend>
          <div className={s.choices}>
            <label><input type="radio" name="tools" value="read" defaultChecked onChange={() => setPreset('read')} /> Read</label>
            <label><input type="radio" name="tools" value="draft" onChange={() => setPreset('draft')} /> Read, and {draftTools.join(' and ')}</label>
            {outreach && (
              <>
                <label><input type="radio" name="tools" value="outreach-read" onChange={() => setPreset('outreach-read')} /> Outreach desk: read the queue</label>
                <label><input type="radio" name="tools" value="outreach-write" onChange={() => setPreset('outreach-write')} /> Outreach desk: read, record updates, ask for approvals, record sends</label>
              </>
            )}
            {sync.includes('snapshot') && <label><input type="radio" name="tools" value="snapshot" onChange={() => setPreset('snapshot')} /> Snapshot: copy the database to the Mac</label>}
            {sync.includes('push') && <label><input type="radio" name="tools" value="push" onChange={() => setPreset('push')} /> Push: send finished research up</label>}
            {sync.includes('admin') && <label><input type="radio" name="tools" value="admin" onChange={() => setPreset('admin')} /> Admin: pull, push, add vehicles and other Admin tasks</label>}
          </div>
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
        {vehicles.length > 1 && !syncToken && (
          <fieldset className={s.set}>
            <legend>Vehicles</legend>
            <div className={s.inline}>
              {vehicles.map((v) => <label key={v.id}><input type="checkbox" name="vehicle" value={v.id} /> {v.name}</label>)}
              <small className="muted">None ticked: all of yours.</small>
            </div>
          </fieldset>
        )}
        <div><button className="btn p" type="submit" disabled={busy}>{busy ? 'Making…' : 'Make token'}</button></div>
      </form>
      {made && !made.ok && <p role="status" style={{ color: 'var(--clay)' }}>{made.error}</p>}
      {made?.ok && (
        <div className={s.secret} role="status">
          <p style={{ margin: '0 0 6px' }}><b>{made.label}</b> — copy it now; it is not shown again.</p>
          <code className={s.code}>{made.secret}</code>
          <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => { void navigator.clipboard?.writeText(made.secret).then(() => setCopied(true)); }}>{copied ? 'Copied' : 'Copy the token'}</button>
        </div>
      )}
    </>
  );
}
