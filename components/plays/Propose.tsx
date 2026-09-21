'use client';

import { useState, useTransition } from 'react';
import { propose } from '@/app/plays/actions';
import { MarkdownField } from '@/components/ui/MarkdownField';

/**
 * Commit to something in your own words.
 *
 * The text is kept exactly as written and whatever a parser can honestly pull out of it —
 * lines, @handles, dates — is stored beside it rather than replacing it. A commitment that
 * has been rewritten by a parser is a commitment nobody can be held to.
 */
export function Propose({
  vehicleId, entityId, path, placeholder,
}: {
  vehicleId: string;
  entityId: string | null;
  path: string;
  placeholder: string;
}) {
  const [body, setBody] = useState('');
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);

  return (
    <div className="cbody">
      <MarkdownField
        value={body}
        onChange={(next) => { setBody(next); setDone(false); }}
        images={[]}
        onImages={() => { /* a commitment is words, not pictures */ }}
        placeholder={placeholder}
        rows={5}
      />
      <div className="acts" style={{ marginTop: 10 }}>
        <button
          className="btn p"
          disabled={pending || !body.trim()}
          onClick={() => start(async () => {
            await propose(vehicleId, entityId, body, path);
            setBody('');
            setDone(true);
          })}
        >
          {pending ? 'Committing…' : 'Commit to this'}
        </button>
        {done && <span className="flag f-ok" style={{ alignSelf: 'center' }}>Written, ticket queued</span>}
      </div>
    </div>
  );
}
