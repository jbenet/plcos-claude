'use client';

import { useState } from 'react';
import { setLinkAction } from '@/app/materials/actions';

/**
 * One material's link (Juan, 8 Oct 2026): a DocSend or file link a person pastes, offered next to the
 * material by the outreach API so the mail desk can include it. Capital OS stores it and never opens it.
 */
export function AssetLinkForm({ assetId, link }: { assetId: string; link: string | null }) {
  const [value, setValue] = useState(link ?? '');
  const [state, setState] = useState<{ error?: string; saved?: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <form
      style={{ display: 'flex', gap: 6, alignItems: 'center' }}
      action={async (fd) => {
        setPending(true);
        const r = await setLinkAction(fd);
        setState(r.error ? { error: r.error } : { saved: true });
        if (!r.error) setValue(r.link ?? '');
        setPending(false);
      }}
    >
      <input type="hidden" name="assetId" value={assetId} />
      <input
        name="link"
        type="url"
        inputMode="url"
        placeholder="https://docsend.com/view/…"
        aria-label="Link"
        value={value}
        onChange={(ev) => { setValue(ev.target.value); setState(null); }}
        style={{ flex: 1, minWidth: 0 }}
      />
      <button className="btn" type="submit" disabled={pending || value === (link ?? '')}>
        {pending ? 'Saving…' : value ? 'Save' : 'Clear'}
      </button>
      {state?.saved && <span className="flag f-ok">Saved</span>}
      {state?.error && <span className="warnline">{state.error}</span>}
    </form>
  );
}
