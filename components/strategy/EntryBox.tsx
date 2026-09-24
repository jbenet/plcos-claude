'use client';

import { useState } from 'react';
import { Glyph } from '@/components/ui/Glyph';
import type { PursuitStatus } from '@/modules/strategy/client';
import { TouchpointForm } from './TouchpointForm';
import { UpdateBox } from './UpdateBox';

/**
 * The timeline's first row (issue 0015, real): an update, or a touchpoint, from the same place.
 * Juan: "make the log touchpoint part be as easy/in the same place as adding the update, but
 * leverage a bit of the structure if we want it." Two icons choose; the chosen one is darker. An
 * update is words the system reads for what they change; a touchpoint is a dated record — a
 * meeting, a call, an email — with who reached out and their read.
 */
export function EntryBox(props: { pursuitId: string; entityId: string; vehicleId: string; vehicleName: string; status: PursuitStatus; today: string }) {
  const [mode, setMode] = useState<'update' | 'touch'>('update');
  const choose = (
    <div className="entrymode" role="radiogroup" aria-label="What to add">
      <button type="button" role="radio" aria-checked={mode === 'update'} className={mode === 'update' ? 'on' : ''}
        onClick={() => setMode('update')} title="An update: what happened, what changed, what's next">
        <Glyph name="update" title="An update" />
      </button>
      <button type="button" role="radio" aria-checked={mode === 'touch'} className={mode === 'touch' ? 'on' : ''}
        onClick={() => setMode('touch')} title="Log a touchpoint: a meeting, a call or an email, with its date">
        <Glyph name="calendar" title="Log a touchpoint" />
      </button>
    </div>
  );
  if (mode === 'update') return <UpdateBox pursuitId={props.pursuitId} status={props.status} today={props.today} glyph={choose} />;
  return (
    <div className="tl-row updbox entrytouch">
      {choose}
      <div className="anote">
        <TouchpointForm pursuitId={props.pursuitId} entityId={props.entityId} vehicleId={props.vehicleId} vehicleName={props.vehicleName} textFirst />
      </div>
    </div>
  );
}
