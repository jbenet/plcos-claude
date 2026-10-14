'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addCandidateAction, dismissCandidateAction, researchCandidateAction, undoCandidateAddAction, type CandidateActionResult } from '@/app/targets/calendar-candidate-actions';
import { actionFailure, withDeadline } from '@/lib/client/action-failure';
import { newRequestKey } from '@/lib/request-key';
import s from './possible-lps.module.css';

/**
 * The three clicks on a possible LP (lib/calendar-candidates.ts). Each waits for the server's receipt before it says
 * anything happened (the frontend contract: consequential commands are never optimistic), and each carries a request
 * key, so a double click records once.
 */

type Busy = null | 'add' | 'dismiss' | 'research' | 'undo';

/**
 * A receipt that refreshes the list removes the row that asked for it, and with it the row's own message; such a
 * receipt is said once at the top of the section instead (Notice), so an add, a set-aside or an undo is never silent.
 */
const NOTICE = 'possible-lps:notice';

export function Notice() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => setText((e as CustomEvent<string>).detail);
    window.addEventListener(NOTICE, on);
    return () => window.removeEventListener(NOTICE, on);
  }, []);
  return text ? <div role="status" className={`${s.notice} ${s.ok}`}>{text}</div> : null;
}

function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState<Busy>(null);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (what: Exclude<Busy, null>, call: () => Promise<CandidateActionResult>, refresh = true) => {
    setBusy(what);
    setSaid(null);
    try {
      const r = await withDeadline(call());
      if (r.ok && refresh) {
        window.dispatchEvent(new CustomEvent(NOTICE, { detail: r.message }));
        router.refresh();
      } else setSaid(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    } catch (e) {
      setSaid({ ok: false, text: actionFailure(e, 'The server did not answer. Nothing is known to have changed; reload the page to see.') });
    } finally {
      setBusy(null);
    }
  };
  return { busy, said, run };
}

export function CandidateActions({ candidateKey, domain, held, vehicles, fixedVehicle }: {
  candidateKey: string;
  /** Set when the group is known only by its domain: the firm's name is asked for before adding. */
  domain: string | null;
  held: boolean;
  /** The vehicles a pursuit may be opened in; one when the page is on a vehicle. */
  vehicles: Array<{ id: string; name: string }>;
  fixedVehicle: boolean;
}) {
  const { busy, said, run } = useRun();
  const [keys] = useState(() => ({ add: newRequestKey(), research: newRequestKey() }));
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? '');
  const [firmName, setFirmName] = useState('');
  const [confirming, setConfirming] = useState(false);
  const needsName = !held && !!domain;
  const canAdd = !!vehicleId && (!needsName || firmName.trim().length >= 2);

  return (
    <div className={s.actions}>
      <div className={s.actRow}>
        {needsName && (
          <label className={s.field}>
            <span className={s.fieldLbl}>Firm at {domain}</span>
            <input className={s.input} value={firmName} onChange={(e) => setFirmName(e.target.value)} placeholder="The firm’s name" maxLength={200} />
          </label>
        )}
        {!fixedVehicle && vehicles.length > 1 && (
          <label className={s.field}>
            <span className={s.fieldLbl}>Vehicle</span>
            <select className={s.input} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className={s.actRow}>
        <button type="button" className="btn p" disabled={!!busy || !canAdd || !vehicles.length}
          title={!vehicles.length ? 'No vehicle being raised takes LP prospects.' : needsName && !canAdd ? 'Type the firm’s name first.' : `Open a pursuit in New${fixedVehicle ? ` for ${vehicles[0]?.name}` : ''}, with these meetings as its touchpoints. Undo is offered below.`}
          onClick={() => void run('add', () => addCandidateAction({ key: candidateKey, vehicleId, requestKey: keys.add, ...(needsName ? { firmName } : {}) }))}>
          {busy === 'add' ? 'Adding…' : 'Add as LP prospect'}
        </button>
        <button type="button" className="btn" disabled={!!busy || !held}
          title={held ? 'Ask for the usual profile research on the firm, by its public name only. Nothing runs until someone starts it.' : 'We hold no name for this domain to research; add the firm first.'}
          onClick={() => void run('research', () => researchCandidateAction({ key: candidateKey, requestKey: keys.research }), false)}>
          {busy === 'research' ? 'Asking…' : 'Research'}
        </button>
        {!confirming ? (
          <button type="button" className="btn" disabled={!!busy} onClick={() => setConfirming(true)}
            title="Set this aside for good: no later calendar read lists it again.">Not an LP</button>
        ) : (
          <span className={s.confirm}>
            Set aside for good?
            <button type="button" className="btn" disabled={!!busy} onClick={() => void run('dismiss', () => dismissCandidateAction({ key: candidateKey }))}>
              {busy === 'dismiss' ? 'Setting aside…' : 'Yes, not an LP'}
            </button>
            <button type="button" className="btn" disabled={!!busy} onClick={() => setConfirming(false)}>Cancel</button>
          </span>
        )}
      </div>
      {said && <div role="status" className={said.ok ? s.ok : s.err}>{said.text}</div>}
    </div>
  );
}

export function UndoAdd({ pursuitId }: { pursuitId: string }) {
  const { busy, said, run } = useRun();
  return (
    <span className={s.undo}>
      <button type="button" className="btn" disabled={!!busy} title="Remove the pursuit and the meetings it brought, and list it here again. Refused once anything else is recorded on it."
        onClick={() => void run('undo', () => undoCandidateAddAction({ pursuitId }))}>{busy === 'undo' ? 'Undoing…' : 'Undo'}</button>
      {said && <span role="status" className={said.ok ? s.ok : s.err}>{said.text}</span>}
    </span>
  );
}
