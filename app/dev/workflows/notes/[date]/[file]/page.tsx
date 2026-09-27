import { notFound } from 'next/navigation';
import { coalescePage } from '@/lib/page-render';
import Link from '@/components/ui/AppLink';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { parseMarkdown } from '@/lib/markdown';
import { Blocks } from '@/components/dev/ChangelogBlocks';
import { listNotes, loadLedger, noteSummary, readNote } from '@/lib/workflows/view';
import { Outcome, fmtDay } from '../../../parts';
import s from '../../../workflows.module.css';

export const dynamic = 'force-dynamic';

/**
 * One iteration note (issue 0100), read from enrich/log/<date>/<file>.md inside the notes root the
 * ledger resolved for this server. Only a validated date and file name open; nothing else is served.
 */
async function Note({ params }: { params: Promise<{ date: string; file: string }> }) {
  const { date, file } = await params;
  const ledger = await loadLedger();
  const text = await readNote(ledger.notesRoot, date, decodeURIComponent(file));
  if (text === null) notFound();
  const name = decodeURIComponent(file);
  const { title, runId } = noteSummary(text);
  const blocks = parseMarkdown(text, { document: true });
  const body = blocks.filter((b, i) => !(i === blocks.findIndex((x) => x.kind === 'heading') && b.kind === 'heading' && b.level === 1));
  const runIds = [...new Set([...text.matchAll(/\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi)].map((m) => m[1]!))];
  const runs = runIds.map((id) => ledger.runs.find((r) => r.runId === id)).filter((r) => r !== undefined);
  const day = (await listNotes(ledger.notesRoot)).dates.find((d) => d.date === date)?.notes ?? [];
  const at = day.findIndex((n) => n.file === name);
  const prev = day[at - 1];
  const next = day[at + 1];

  return (
    <Page
      crumbs={[{ label: SECTION.developer }, { label: 'Workflows' }, { label: title ?? name }]}
      inspector={
        <>
          <div className="lbl">Iteration note</div>
          <div className="ihead">{fmtDay(new Date(`${date}T12:00:00`))}</div>
          <div className="imeta">{at >= 0 ? `${at + 1} of ${day.length} that day` : name}</div>
          {runs.length > 0 ? (
            <>
              <div className="lbl" style={{ marginTop: 6 }}>Runs it names</div>
              <ul className={s.checks}>
                {runs.map((r) => (
                  <li key={r.runId} style={{ flexDirection: 'column', gap: 4 }}>
                    <Link href={`/dev/workflows?run=${r.runId}`}>{r.workflow} · {r.operation}</Link>
                    <Outcome outcome={r.outcome} />
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="muted" style={{ fontSize: 12.5 }}>
              {runId ? 'The run it names is not in the ledger.' : 'This note names no run.'}
            </p>
          )}
          <div className="note">
            From <code>enrich/log/{date}/{name}</code>, as the iteration wrote it. <Link href="/dev/workflows#iterations">Every iteration</Link>
          </div>
        </>
      }
    >
      <div className="lbl"><Link href="/dev/workflows#iterations">Workflows · iterations</Link> · {date}</div>
      <h1>{title ?? name}</h1>
      <article className="card" style={{ marginTop: 12 }}>
        <div className="cbody" style={{ maxWidth: '92ch' }}>
          <Blocks blocks={body} />
        </div>
      </article>
      <nav className={s.two} aria-label="Earlier and later notes">
        <div>{prev && <Link href={`/dev/workflows/notes/${date}/${prev.file}`} className={s.chip}>← {prev.title}</Link>}</div>
        <div style={{ textAlign: 'right' }}>{next && <Link href={`/dev/workflows/notes/${date}/${next.file}`} className={s.chip}>{next.title} →</Link>}</div>
      </nav>
    </Page>
  );
}

export default coalescePage('/dev/workflows/notes/[date]/[file]', Note);
