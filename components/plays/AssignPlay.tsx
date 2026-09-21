'use client';

import { useState, useTransition } from 'react';
import { assign } from '@/app/plays/actions';

/**
 * Suggesting an owner and assigning one are different acts.
 *
 * The board suggests; a person assigns, in a second deliberate step, and that step is what
 * opens a ticket. A board that assigned as it ranked would fill somebody's week with
 * whatever the arithmetic liked this morning.
 */
export function AssignPlay({
  playId, suggestedId, suggested, assignedTo, users, path,
}: {
  playId: string;
  suggestedId: string | null;
  suggested: string | null;
  assignedTo: string | null;
  users: Array<{ id: string; name: string; role: string }>;
  path: string;
}) {
  const [who, setWho] = useState(suggestedId ?? users[0]?.id ?? '');
  const [pending, start] = useTransition();

  if (assignedTo) {
    return (
      <div className="assigned">
        <span className="flag f-ok">Assigned</span>
        <div className="muted">{assignedTo}</div>
        <div className="muted tiny">Linear ticket queued</div>
      </div>
    );
  }

  return (
    <div className="assignbox">
      <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Assign to">
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}{u.id === suggestedId ? ' · suggested' : ''}
          </option>
        ))}
      </select>
      <button
        className="btn"
        disabled={pending || !who}
        onClick={() => start(async () => { await assign(playId, who, path); })}
      >
        {pending ? 'Assigning…' : 'Assign'}
      </button>
      {suggested && <div className="muted tiny">suggested: {suggested}</div>}
    </div>
  );
}
