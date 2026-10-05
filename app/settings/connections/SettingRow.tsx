'use client';

import { useActionState, useState } from 'react';
import { checkSettingAction, clearSettingAction, saveSettingAction, type SettingResult } from './actions';
import s from './connections.module.css';

/** What the page may know about a setting: never a stored secret, only its last four characters. */
export interface RowView {
  key: string; label: string; secret: boolean; env: string | null; help: string; placeholder: string;
  source: 'env' | 'app' | 'unset'; shown: string; unreadable: boolean; updatedAt: string | null;
  checkable: boolean; removeWarning: string | null;
  /** The Mac's user switcher: shown, never changed from here. */
  readOnly: boolean;
}

function Source({ v }: { v: RowView }) {
  if (v.source === 'env') return <span className="flag f-mute" title={`Remove ${v.env} from the server’s environment to manage it here`}>set in the environment</span>;
  if (v.unreadable) return <span className="flag f-block" title="It does not decrypt with this server’s PLCOS_SECRET">stored, unreadable</span>;
  if (v.source === 'app') return <span className="flag f-ok">set here</span>;
  return <span className="flag f-ev">not set</span>;
}

export function SettingRow({ v }: { v: RowView }) {
  const [saved, save, saving] = useActionState<SettingResult, FormData>(saveSettingAction, null);
  const [checked, check, checking] = useActionState<SettingResult, FormData>(checkSettingAction, null);
  const [editing, setEditing] = useState(v.source === 'unset');
  const result = checked ?? saved;
  return (
    <div className={s.row} data-source={v.source}>
      <div className={s.top}>
        <div>
          <b>{v.label}</b> <Source v={v} />
          {v.env && <span className={s.env}>{v.env}</span>}
        </div>
        {v.shown && <code className={s.value}>{v.shown}</code>}
      </div>
      <p className={s.help}>{v.help}{v.unreadable ? ' The stored value was encrypted with another PLCOS_SECRET: enter it again.' : ''}</p>

      {v.source !== 'env' && !v.readOnly && (editing ? (
        <form action={save} className={s.form}>
          <input type="hidden" name="key" value={v.key} />
          <input type={v.secret ? 'password' : 'text'} name="value" autoComplete="off" spellCheck={false} required aria-label={v.label}
            placeholder={v.source === 'app' ? (v.secret ? 'The new value, to replace it' : v.shown) : v.placeholder} />
          <button className="btn p" disabled={saving}>{saving ? 'Saving…' : v.source === 'app' ? 'Replace' : 'Save'}</button>
          {v.checkable && <button className="btn" formAction={check} formNoValidate disabled={checking}>{checking ? 'Checking…' : 'Check'}</button>}
          {v.source === 'app' && <button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button>}
        </form>
      ) : (
        <div className={s.form}>
          <button type="button" className="btn" onClick={() => setEditing(true)}>Replace</button>
          {v.checkable && <form action={check}><input type="hidden" name="key" value={v.key} /><button className="btn" disabled={checking}>{checking ? 'Checking…' : 'Check'}</button></form>}
          <form action={clearSettingAction} onSubmit={(e) => { if (!confirm(v.removeWarning ?? `Remove the ${v.label}?`)) e.preventDefault(); }}>
            <input type="hidden" name="key" value={v.key} />
            <button className="btn">Remove</button>
          </form>
        </div>
      ))}
      {(v.source === 'env' || v.readOnly) && v.checkable && (
        <form action={check} className={s.form}><input type="hidden" name="key" value={v.key} /><button className="btn" disabled={checking}>{checking ? 'Checking…' : 'Check the key'}</button></form>
      )}
      {result && <p className={result.ok ? s.ok : s.bad} role="status">{result.ok ? result.message : result.error}</p>}
    </div>
  );
}
