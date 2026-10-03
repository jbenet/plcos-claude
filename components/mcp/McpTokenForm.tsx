'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createMcpTokenAction, type MadeToken } from '@/app/settings/actions';
import s from './mcp.module.css';

/** Make a token, and show it once with the command that connects Claude Code to it (docs/26-mcp.md). */
export function McpTokenForm({ endpoint, vehicles, draftTools }: { endpoint: string; vehicles: Array<{ id: string; name: string }>; draftTools: string[] }) {
  const router = useRouter();
  const [made, setMade] = useState<MadeToken | null>(null);
  const [busy, setBusy] = useState(false);
  const command = made?.ok ? `claude mcp add --transport http --scope user capital-os ${endpoint} --header "Authorization: Bearer ${made.secret}"` : '';
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
          <label><input type="radio" name="tools" value="read" defaultChecked /> Read</label>
          <label><input type="radio" name="tools" value="draft" /> Read, and {draftTools.join(' and ')}</label>
        </fieldset>
        {vehicles.length > 1 && (
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
          <p style={{ margin: '10px 0 6px' }}>Connect Claude Code (in a terminal):</p>
          <code className={s.code}>{command}</code>
          <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => void navigator.clipboard?.writeText(command)}>Copy the command</button>
        </div>
      )}
    </>
  );
}
