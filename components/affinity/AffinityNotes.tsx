import Link from 'next/link';
import { ago, shortDate } from '@/lib/time';
import type { NoteView } from '@/lib/connectors/affinity/notes';

const CLIP = 360;
const SHOWN = 6;

function One({ note }: { note: NoteView }) {
  const head = (
    <div className="p2">
      {shortDate(note.createdAt)} · {note.kindLabel} · {note.author}
      {note.via.kind === 'organization' ? ` · on ${note.via.name}` : ''}
      {note.authorOnTeam ? '' : ' (not on the team)'}
      {note.updatedAt ? ` · edited ${shortDate(note.updatedAt)}` : ''}
      {note.replies ? ` · ${note.replies} ${note.replies === 1 ? 'reply' : 'replies'} not read` : ''}
      {note.alsoAttached ? ` · also on ${note.alsoAttached} other ${note.alsoAttached === 1 ? 'record' : 'records'}` : ''}
    </div>
  );
  // Health detail stays closed until someone opens it, and is never quoted anywhere derived
  // (Report 4 §6.2). It is the team's own note, so it is not hidden from the team.
  if (note.health) {
    return (
      <div className="anote">
        {head}
        <details>
          <summary>Mentions someone&rsquo;s health — open to read</summary>
          <div className="t">{note.text}</div>
        </details>
      </div>
    );
  }
  // Read by someone (N55): the sentence first, and all of it a click away, like a thread.
  if (note.reading?.summary) {
    return (
      <div className="anote">
        {head}
        <details className="thread">
          <summary>
            <span className="t">{note.reading.summary}</span>
            {note.reading.by === 'claude' && <span className="byline"> · summary by Claude</span>}
            <span className="open">the note</span>
          </summary>
          <div className="t full">{note.text}</div>
        </details>
      </div>
    );
  }
  const long = note.text.length > CLIP;
  return (
    <div className="anote">
      {head}
      {long ? (
        <details>
          <summary className="t">{note.text.slice(0, CLIP).trimEnd()}…</summary>
          <div className="t">{note.text.slice(CLIP)}</div>
        </details>
      ) : (
        <div className="t">{note.text || <span className="muted">No text.</span>}</div>
      )}
    </div>
  );
}

/**
 * The team's notes about one LP, as Affinity has them (N49). Read-only, newest first, with where
 * each came from — the provenance tuple a note can carry: Affinity, when it was written, by whom,
 * and when this copy was read (rule 9).
 */
export function AffinityNotes({ notes }: { notes: NoteView[] }) {
  if (!notes.length) return null;
  const read = notes.reduce((a, x) => (x.fetchedAt > a ? x.fetchedAt : a), new Date(0));
  const onOrg = notes.filter((x) => x.via.kind === 'organization').length;
  return (
    <div className="card">
      <div className="chead">
        <h2>Notes in Affinity</h2>
        <span className="lbl">
          {notes.length}
          {onOrg ? ` · ${onOrg} via their firm` : ''}
        </span>
      </div>
      <div className="cbody">
        {notes.slice(0, SHOWN).map((x) => <One key={x.noteId} note={x} />)}
        {notes.length > SHOWN && (
          <details className="more">
            <summary>{notes.length - SHOWN} older {notes.length - SHOWN === 1 ? 'note' : 'notes'}</summary>
            {notes.slice(SHOWN).map((x) => <One key={x.noteId} note={x} />)}
          </details>
        )}
      </div>
      <p className="cover">
        <b>The team&rsquo;s notes, as written in Affinity</b> — a record of what was said, not
        evidence for the ladder. Copied here by the <Link href="/dev/affinity/notes">notes read</Link>{' '}
        {ago(read)}; Affinity is unchanged.
      </p>
    </div>
  );
}
