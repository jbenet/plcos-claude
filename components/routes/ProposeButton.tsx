'use client';

import { useState } from 'react';
import { proposeFromRoute } from '@/app/routes/actions';

/**
 * Proposing is not sending. The label says so, because the gap between "asked the system"
 * and "asked the person" is exactly where a consent ladder gets skipped.
 */
export function ProposeButton({
  targetId, connectorId, vehicles, owners, suggestedOwnerId, suggestion,
}: {
  targetId: string;
  connectorId: string | null;
  vehicles: Array<{ slug: string; name: string }>;
  owners: Array<{ id: string; name: string }>;
  suggestedOwnerId: string;
  /** Why this person is suggested. Shown, because a suggestion with no reason is a default. */
  suggestion: string;
}) {
  const [pending, setPending] = useState(false);

  return (
    <form
      className="proposebox"
      action={async (fd) => {
        setPending(true);
        await proposeFromRoute(fd);
        setPending(false);
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <input type="hidden" name="targetId" value={targetId} />
      <input type="hidden" name="connectorId" value={connectorId ?? ''} />
      <div className="prow">
        <label>
          <span className="lbl">Vehicle</span>
          <select name="vehicleSlug" defaultValue={vehicles[0]?.slug}>
            {vehicles.map((v) => <option key={v.slug} value={v.slug}>{v.name}</option>)}
          </select>
        </label>
        <label>
          <span className="lbl">Who carries it</span>
          <select name="ownerId" defaultValue={suggestedOwnerId}>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}{o.id === suggestedOwnerId ? ' · suggested' : ''}
              </option>
            ))}
          </select>
        </label>
        <button className="btn p" type="submit" disabled={pending}>
          {pending ? 'Recording…' : 'Record the ask'}
        </button>
      </div>
      <dl className="pwhere">
        <dt>Why this owner</dt>
        <dd>{suggestion}</dd>
        <dt>Where it goes</dt>
        <dd>
          This writes the ask with its owner and runs the four guards: a restriction on the
          target blocks it, in red, and a collision with another vehicle opens a case to
          coordinate. <b>No approval is needed</b> — a person makes the ask by sending the email
          (Juan, 5 Oct 2026); only an autonomous agent needs an <b>INTRO_ASK</b> ticket.
          <b> Nobody is contacted</b> by this button.
        </dd>
      </dl>
    </form>
  );
}
