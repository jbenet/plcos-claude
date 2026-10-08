'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { addUpdateAction } from '@/app/targets/actions';
import { READS, READ_LABEL, type Read } from '@/modules/meetings/client';
import {
  PASSED_BY_CHOICES, PASSED_BY_LABEL, REASONS, STATUSES, STATUS_LABEL, readUpdate,
  type PassedBy, type PursuitStatus, type TouchChannel, type UpdateSuggestion,
} from '@/modules/strategy/client';
import { Glyph } from '@/components/ui/Glyph';
import { newRequestKey } from '@/lib/request-key';
import { formatDate } from '@/lib/time';

type Of<K extends UpdateSuggestion['kind']> = Extract<UpdateSuggestion, { kind: K }>;

const CHANNEL_WORD: Record<TouchChannel, string> = { meeting: 'meeting', call: 'call', email: 'email', message: 'message' };
const newKey = newRequestKey;
const a = (w: string) => `${/^[aeiou]/.test(w) ? 'an' : 'a'} ${w}`;
const day = (iso: string) => formatDate(new Date(`${iso}T12:00:00Z`), { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * The first row of an LP's timeline (N61, issue 0004): write what happened or what changed, and
 * say what it changes. Juan: "allow user to enter a note and indicate a status, which should
 * generate an event on the timeline that changes the status" — and read the words to decide what
 * to do with them. The words are read as they are typed (modules/strategy/reader.ts, word rules
 * for now), and each suggestion fills a field and shows the words it rests on. A field the person
 * sets by hand stops following the words. Nothing happens until Save, which waits for the server.
 */
export function UpdateBox({ pursuitId, status, today, glyph }: { pursuitId: string; status: PursuitStatus; today: string; glyph?: ReactNode }) {
  const [body, setBody] = useState('');
  const [key, setKey] = useState(newKey);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ error?: string; ok?: boolean; proposed?: boolean; recorded?: boolean } | null>(null);
  // What the person set by hand; undefined means "follow the words".
  const [pick, setPick] = useState<{
    status?: string; passedBy?: string; reason?: string;
    touch?: boolean; channel?: TouchChannel; on?: string; read?: string;
    next?: boolean; step?: string; nextOn?: string;
    indicated?: boolean; low?: string; high?: string;
  }>({});
  const set = (k: keyof typeof pick, v: unknown) => { setPick((p) => ({ ...p, [k]: v })); setResult(null); };

  const suggestions = useMemo(() => readUpdate(body, { status, today }), [body, status, today]);
  const sug = {
    status: suggestions.find((s): s is Of<'status'> => s.kind === 'status'),
    touch: suggestions.find((s): s is Of<'touch'> => s.kind === 'touch'),
    read: suggestions.find((s): s is Of<'read'> => s.kind === 'read'),
    next: suggestions.find((s): s is Of<'next'> => s.kind === 'next'),
    amount: suggestions.find((s): s is Of<'amount'> => s.kind === 'amount'),
  };

  const to = (pick.status ?? sug.status?.to ?? '') as PursuitStatus | '';
  const passed = to === 'passed';
  const passedBy = (pick.passedBy ?? (sug.status?.to === 'passed' ? sug.status.passedBy : '') ?? '') as PassedBy | '';
  const reason = pick.reason ?? (sug.status?.to === 'passed' ? sug.status.reason : undefined) ?? 'other';
  const touch = pick.touch ?? Boolean(sug.touch);
  const channel = pick.channel ?? sug.touch?.channel ?? 'meeting';
  const on = pick.on ?? sug.touch?.on ?? today;
  const ahead = on > today;
  const read = ahead ? '' : pick.read ?? sug.read?.read ?? '';
  const direction = channel === 'meeting' || channel === 'call' ? 'both' : sug.touch?.channel === channel ? sug.touch.direction : 'ours';
  const next = pick.next ?? Boolean(sug.next);
  const step = pick.step ?? sug.next?.step ?? '';
  const nextOn = pick.nextOn ?? sug.next?.on ?? '';
  const changes = Boolean(to && to !== status);
  // An indicated amount (docs/27 §1): offered from the words, saved only when ticked; never soft money.
  const indicated = pick.indicated ?? false;
  const low = pick.low ?? (sug.amount?.low != null ? String(sug.amount.low) : '');
  const high = pick.high ?? (sug.amount?.high != null && sug.amount.high !== sug.amount.low ? String(sug.amount.high) : '');
  const money = (v: string) => (Number(v) >= 1e6 ? `$${+(Number(v) / 1e6).toFixed(2)}M` : Number(v) >= 1e3 ? `$${+(Number(v) / 1e3).toFixed(1)}K` : `$${v}`);

  const will = [
    'add this update to the timeline',
    changes ? `set the status to ${STATUS_LABEL[to as PursuitStatus]}${passed && passedBy ? ` (${PASSED_BY_LABEL[passedBy].toLowerCase()}, ${reason.replace(/_/g, ' ')})` : ''}, from ${STATUS_LABEL[status]}` : null,
    touch ? (ahead ? `put ${a(CHANNEL_WORD[channel])} on record for ${day(on)}` : `log ${a(CHANNEL_WORD[channel])} on ${day(on)}${read ? `, their read ${READ_LABEL[read as Read].toLowerCase()}` : ''}`) : null,
    next && step ? `make the next step “${step}”${nextOn ? `, by ${day(nextOn)}` : ''}` : null,
    indicated && low ? `record ${money(low)}${high && high !== low ? `–${money(high)}` : ''} as indicated, beside soft and hard and in neither` : null,
  ].filter(Boolean) as string[];

  const basis = (s: { basis: string } | undefined, shown: boolean) => (s && shown ? <span className="basis">from &ldquo;{s.basis}&rdquo;</span> : null);

  return (
    <form
      className="tl-row updbox"
      action={async (fd) => {
        setPending(true);
        const r = await addUpdateAction(fd);
        setPending(false);
        setResult(r);
        if (r.ok) { setBody(''); setPick({}); setKey(newKey()); }
      }}
    >
      {glyph ?? <Glyph name="update" title="An update from the team" />}
      <div className="anote">
        <input type="hidden" name="pursuitId" value={pursuitId} />
        <input type="hidden" name="key" value={key} />
        <label className="sr-only" htmlFor={`upd-${pursuitId}`}>Add an update</label>
        <textarea
          id={`upd-${pursuitId}`} name="body" rows={body ? 3 : 1} value={body}
          placeholder="Add an update: what happened, what changed, what's next"
          onChange={(e) => { setBody(e.target.value); setResult(null); }}
        />
        {body.trim() && (
          <div className="upd-changes">
            <div className="lbl">What it changes · read by word rules, not a model — each suggestion shows its words</div>
            <div className="fieldrow">
              <label className="field">
                <span className="lbl">Status</span>
                <select name="status" value={to} onChange={(e) => set('status', e.target.value)}>
                  <option value="">Keep: {STATUS_LABEL[status]}</option>
                  {STATUSES.filter((s) => s.id !== status).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
              {passed && (
                <>
                  <label className="field">
                    <span className="lbl">Who ended it</span>
                    <select name="passedBy" value={passedBy} required onChange={(e) => set('passedBy', e.target.value)}>
                      <option value="" disabled>Choose</option>
                      {PASSED_BY_CHOICES.map((k) => <option key={k} value={k}>{PASSED_BY_LABEL[k]}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <span className="lbl">Why</span>
                    <select name="reason" value={reason} onChange={(e) => set('reason', e.target.value)}>
                      {REASONS.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                    </select>
                  </label>
                </>
              )}
              {basis(sug.status, pick.status === undefined)}
            </div>

            <div className="sug">
              <label className="check">
                <input type="checkbox" name="touch" checked={touch} onChange={(e) => set('touch', e.target.checked)} />
                <span>Log</span>
              </label>
              <select name="touchChannel" aria-label="What kind of touchpoint" value={channel} disabled={!touch} onChange={(e) => set('channel', e.target.value)}>
                {(['meeting', 'call', 'email', 'message'] as TouchChannel[]).map((c) => <option key={c} value={c}>{a(CHANNEL_WORD[c])}</option>)}
              </select>
              <span>on</span>
              <input type="date" name="touchOn" aria-label="When" value={on} disabled={!touch} onChange={(e) => set('on', e.target.value)} />
              {!ahead && (
                <select name="touchRead" aria-label="Their read" value={read} disabled={!touch} onChange={(e) => set('read', e.target.value)}>
                  <option value="">their read: not recorded</option>
                  {READS.map((r) => <option key={r} value={r}>their read: {READ_LABEL[r].toLowerCase()}</option>)}
                </select>
              )}
              <input type="hidden" name="touchDirection" value={direction} />
              {touch && sug.touch && !sug.touch.dated && pick.on === undefined && <span className="basis warnish">no date in the words: today?</span>}
              {basis(sug.touch, touch && pick.touch === undefined)}
              {basis(sug.read, touch && Boolean(read) && pick.read === undefined)}
            </div>

            <div className="sug">
              <label className="check">
                <input type="checkbox" name="next" checked={next} onChange={(e) => set('next', e.target.checked)} />
                <span>Next step</span>
              </label>
              <input name="nextStep" aria-label="Next step" value={step} disabled={!next} placeholder="Send the deck, say" onChange={(e) => set('step', e.target.value)} />
              <span>by</span>
              <input type="date" name="nextStepOn" aria-label="Next step by" value={nextOn} disabled={!next} onChange={(e) => set('nextOn', e.target.value)} />
              {basis(sug.next, next && pick.step === undefined)}
            </div>

            {sug.amount && (
              <div className="sug">
                <label className="check">
                  <input type="checkbox" name="indicated" checked={indicated} onChange={(e) => set('indicated', e.target.checked)} />
                  <span>Indicated</span>
                </label>
                <span>$</span>
                <input type="number" name="indicatedLow" aria-label="Indicated amount, or the low end" min={0} step="any" value={low} disabled={!indicated} onChange={(e) => set('low', e.target.value)} style={{ width: 120 }} />
                <span>to $</span>
                <input type="number" name="indicatedHigh" aria-label="The high end, if a range" min={0} step="any" value={high} placeholder="same" disabled={!indicated} onChange={(e) => set('high', e.target.value)} style={{ width: 120 }} />
                {basis(sug.amount, pick.low === undefined)}
              </div>
            )}
            {sug.amount && (
              <p className="basis warnish" style={{ margin: '6px 0 0' }}>
                It mentions {sug.amount.said}. Ticked, that is kept as an indicated amount: shown beside soft and hard and added to neither. A soft commitment is recorded on the close track (rule 1).
              </p>
            )}
            {touch && !ahead && (channel === 'meeting' || channel === 'call') && (
              <p className="muted" style={{ fontSize: 11.5, margin: '6px 0 0' }}>
                {a(CHANNEL_WORD[channel]).replace(/^a/, 'A')} logged is a record: if the ladder is behind it, Reconciliation records the conversation rung it supports, and proposes anything above that for approval.
              </p>
            )}
            <p className="willdo"><b>Saving will</b> {will.join('; ')}.</p>
          </div>
        )}
        {result?.error && <div className="warn" style={{ fontSize: 12.5, marginTop: 8 }}>{result.error}</div>}
        {result?.ok && (
          <div className="stat ready" style={{ marginTop: 8 }}>
            <i />Saved{result.recorded ? ' — the ladder now shows the rung it supports' : ''}{result.proposed ? ' — a rung above it is waiting on Approvals' : ''}
          </div>
        )}
        {body.trim() && (
          <div style={{ marginTop: 8 }}>
            <button className="btn p" type="submit" disabled={pending || (passed && !passedBy)}>{pending ? 'Saving…' : 'Save update'}</button>
            <button className="btn" type="button" style={{ marginLeft: 8 }} onClick={() => { setBody(''); setPick({}); setResult(null); }}>Clear</button>
          </div>
        )}
      </div>
    </form>
  );
}
