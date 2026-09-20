'use client';

import { useState } from 'react';
import { proposeFromRoute } from '@/app/routes/actions';

/**
 * Proposing is not sending. The label says so, because the gap between "asked the system"
 * and "asked the person" is exactly where a consent ladder gets skipped.
 */
export function ProposeButton({
  targetId, connectorId, vehicles,
}: {
  targetId: string;
  connectorId: string | null;
  vehicles: Array<{ slug: string; name: string }>;
}) {
  const [pending, setPending] = useState(false);

  return (
    <form
      action={async (fd) => {
        setPending(true);
        await proposeFromRoute(fd);
        setPending(false);
      }}
      style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}
      onClick={(e) => e.stopPropagation()}
    >
      <input type="hidden" name="targetId" value={targetId} />
      <input type="hidden" name="connectorId" value={connectorId ?? ''} />
      <select name="vehicleSlug" defaultValue={vehicles[0]?.slug} style={{ width: 150, fontSize: 12, padding: '5px 8px' }}>
        {vehicles.map((v) => (
          <option key={v.slug} value={v.slug}>
            {v.name}
          </option>
        ))}
      </select>
      <button className="btn" type="submit" disabled={pending}>
        {pending ? 'Proposing…' : 'Propose the ask'}
      </button>
    </form>
  );
}
