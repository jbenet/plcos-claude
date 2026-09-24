'use client';

import { useState } from 'react';
import { addContextAction } from '@/app/targets/actions';

/**
 * Add context, or correct what we know (issue 0016, real): Juan — "a box to add context or make
 * corrections … logged into the research/info for that LP … Sometimes the info should cause the
 * system to re-evaluate / re-think the strategy." Kept as research on the LP, with who wrote it and
 * when; the suggested strategy says when it was written before the newest context, and the next
 * pass of the strategy workflow reads it above everything else it reads.
 */
export function AddContext(props: {
  pursuitId: string; entityId: string; vehicleId: string;
  notes: Array<{ id: string; by: string | null; on: string; body: string }>;
}) {
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<{ error?: string; ok?: boolean } | null>(null);

  return (
    <div className="card addcontext">
      <div className="chead">
        <h2>Add context</h2>
        <span className="lbl">more information, or a correction</span>
      </div>
      <div className="cbody">
        <form
          action={async (fd) => {
            setPending(true);
            const r = await addContextAction(fd);
            setPending(false);
            setState(r);
            if (r.ok) setBody('');
          }}
        >
          <input type="hidden" name="pursuitId" value={props.pursuitId} />
          <input type="hidden" name="entityId" value={props.entityId} />
          <input type="hidden" name="vehicleId" value={props.vehicleId} />
          <textarea
            name="body"
            rows={4}
            value={body}
            onChange={(e) => { setBody(e.target.value); setState(null); }}
            aria-label="Context or a correction"
            placeholder="What we know that isn't here, or what here is wrong: “She moved to the family office in June”; “the $1M was his partner's figure, not his”…"
          />
          {state?.error && <div className="warn" style={{ fontSize: 12.5, marginTop: 6 }}>{state.error}</div>}
          {state?.ok && !pending && <div className="stat ready" style={{ marginTop: 6 }}><i />Added. The strategy below is due a re-think.</div>}
          <button className="btn p" type="submit" disabled={pending || !body.trim()} style={{ marginTop: 8 }}>{pending ? 'Adding…' : 'Add it'}</button>
        </form>
        {props.notes.length > 0 && (
          <div className="ctxlist">
            {props.notes.map((n) => (
              <div className="ctx" key={n.id}>
                <div className="ctxmeta">{n.by ?? 'Someone'} · {n.on}</div>
                <div className="ctxbody">{n.body}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="cover">
        <b>What this keeps:</b> your words, as research on this LP, with your name and the date. It
        moves no status, no rung and no money. The suggested strategy says when it was written before
        the newest context, and the next pass of the strategy workflow reads this first.
      </p>
    </div>
  );
}
