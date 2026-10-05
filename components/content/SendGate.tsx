'use client';

import { useState } from 'react';
import Link from '@/components/ui/AppLink';
import { markSentAction, proposeSend } from '@/app/materials/actions';

export interface Option {
  id: string;
  label: string;
}

/**
 * The send gate. The wrap check runs first: a refusal is recorded, because "wrong-wrap sends = 0"
 * is measured, not assumed. A person who passes it needs no approval (Juan, 5 Oct 2026: SEND
 * tickets are for autonomous agents only): the material is cleared, they send it from their own
 * mailbox and mark it sent here, and the wrap is checked again at that moment (rule 11).
 */
export function SendGate({
  assets, entities, vehicles, instruments,
}: {
  assets: Option[];
  entities: Option[];
  vehicles: Option[];
  instruments: Option[];
}) {
  const [state, setState] = useState<{ refusals?: string[]; ticketId?: string; sendId?: string } | null>(null);
  const [sent, setSent] = useState<{ error?: string; sent?: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  // Controlled, so the form still shows what was checked after the page revalidates. A
  // refusal that appears next to a reset form is a refusal about nothing.
  const [assetId, setAssetId] = useState(assets[0]?.id ?? '');
  const [entityId, setEntityId] = useState(entities[0]?.id ?? '');
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? '');
  const [instrument, setInstrument] = useState(instruments[0]?.id ?? '');

  return (
    <form
      className="cbody"
      action={async (fd) => {
        setPending(true);
        setSent(null);
        setState(await proposeSend(fd));
        setPending(false);
      }}
    >
      <div className="fieldrow">
        <label className="field">
          <span className="lbl">Material</span>
          <select name="assetId" value={assetId} onChange={(ev) => setAssetId(ev.target.value)}>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="lbl">To</span>
          <select name="entityId" value={entityId} onChange={(ev) => setEntityId(ev.target.value)}>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="fieldrow">
        <label className="field">
          <span className="lbl">On behalf of</span>
          <select name="vehicleId" value={vehicleId} onChange={(ev) => setVehicleId(ev.target.value)}>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="lbl">Instrument</span>
          <select name="instrument" value={instrument} onChange={(ev) => setInstrument(ev.target.value)}>
            {instruments.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {state?.refusals && (
        <div className="warn" style={{ marginBottom: 12 }}>
          <div className="lbl" style={{ color: 'var(--clay)' }}>
            Refused by the wrap check — this material may not go to them
          </div>
          {state.refusals.map((r) => (
            <p key={r}>{r}</p>
          ))}
          <p style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            The refusal is on the record. That is what makes &ldquo;wrong-wrap sends = 0&rdquo; a
            measurement rather than an assumption.
          </p>
        </div>
      )}

      {state?.sendId && !state.ticketId && (
        <div className="scope" style={{ marginTop: 0, marginBottom: 12 }} data-cleared>
          <div className="lbl">Wrap check passed · cleared to send</div>
          <p>
            No approval is needed: send it from your own mailbox. Then mark it sent here — the wrap is
            checked again at that moment, so a material that changed since is refused and not counted.
          </p>
          {sent?.sent ? (
            <p className="flag f-ok" style={{ display: 'inline-block' }}>Marked sent</p>
          ) : (
            <button className="btn" type="button" style={{ marginTop: 8 }} onClick={async () => {
              const fd = new FormData();
              fd.set('sendId', state.sendId!);
              setSent(await markSentAction(fd));
            }}>I sent it — mark it sent</button>
          )}
          {sent?.error && <p className="warnline">{sent.error}</p>}
        </div>
      )}

      {state?.ticketId && (
        <div className="scope" style={{ marginTop: 0, marginBottom: 12 }}>
          <div className="lbl">Wrap check passed</div>
          <p>
            A <code>SEND</code> ticket is open. Nothing has been sent — the send is recorded when
            the ticket is approved, and the wrap is checked again at that moment.
          </p>
          <Link className="btn p" href={`/approvals?t=${state.ticketId}`} style={{ display: 'inline-block', padding: 8, marginTop: 8 }}>
            Open the ticket
          </Link>
        </div>
      )}

      <button className="btn p" type="submit" disabled={pending}>
        {pending ? 'Checking the wrap…' : 'Check the wrap'}
      </button>
    </form>
  );
}
