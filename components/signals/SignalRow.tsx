'use client';

import { useState } from 'react';
import { disposeSignal } from '@/app/signals-actions';
import { KIND_LABEL, type Signal } from '@/modules/signals/client';

const CONF_FLAG: Record<string, string> = { high: 'f-ok', medium: 'f-ev', low: 'f-mute' };

/**
 * A signal is a change that crossed a threshold. The threshold is on the row, because a
 * signal whose rule cannot be named is a notification, and notifications get ignored.
 */
export function SignalRow({ signal, compact = false }: { signal: Signal; compact?: boolean }) {
  const [pending, setPending] = useState<string | null>(null);
  const done = signal.disposition !== 'new';

  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <span className="kind k-chore" style={{ width: 130, marginTop: 2 }}>
        {KIND_LABEL[signal.kind]}
      </span>
      <div className="t">
        <b>{signal.headline}</b>
        <span style={{ display: 'block', lineHeight: 1.5 }}>{signal.detail}</span>
        <span style={{ display: 'block', marginTop: 5 }}>
          <span className={`flag ${CONF_FLAG[signal.confidence]}`}>{signal.confidence}</span>{' '}
          <span className="mono" style={{ fontSize: 10.5 }}>
            {signal.source}
            {signal.sourceRef ? ` · ${signal.sourceRef}` : ''} ·{' '}
            {signal.observedAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
          </span>
        </span>
        {!compact && (
          <span style={{ display: 'block', marginTop: 6, fontSize: 11.5, color: 'var(--muted)' }}>
            <b style={{ color: 'var(--ink)', fontWeight: 500 }}>Why this is a signal:</b>{' '}
            {signal.thresholdLabel} — {signal.thresholdDetail}
          </span>
        )}
      </div>
      <div className="state" style={{ width: 170 }}>
        {done ? (
          <>
            <b>{signal.disposition}</b>
            {signal.claimedByName ?? ''}
            {signal.note ? <div style={{ marginTop: 3 }}>{signal.note}</div> : null}
          </>
        ) : (
          <form
            action={async (fd) => {
              setPending(String(fd.get('disposition')));
              await disposeSignal(fd);
              setPending(null);
            }}
            style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}
          >
            <input type="hidden" name="signalId" value={signal.signalId} />
            <button className="btn" name="disposition" value="claimed" disabled={pending !== null} style={{ fontSize: 11.5, padding: '4px 9px' }}>
              {pending === 'claimed' ? '…' : 'Claim'}
            </button>
            <button className="btn" name="disposition" value="dismissed" disabled={pending !== null} style={{ fontSize: 11.5, padding: '4px 9px' }}>
              Dismiss
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
