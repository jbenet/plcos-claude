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
          {pending ? 'Proposing…' : 'Propose the ask'}
        </button>
      </div>
      <dl className="pwhere">
        <dt>Why this owner</dt>
        <dd>{suggestion}</dd>
        <dt>Where it goes</dt>
        <dd>
          This writes the ask, runs the four guards, and opens an <b>INTRO_ASK</b> ticket in
          Approvals with its scope stated. <b>Nobody is contacted</b> until that ticket is
          approved, and the owner is who the approval authorises to make it.
        </dd>
      </dl>
    </form>
  );
}
