import { coalescePage } from '@/lib/page-render';
import Link from '@/components/ui/AppLink';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { ago } from '@/lib/time';
import { KINDS, KIND_LABEL, loadTimeline, type Event, type Kind } from '@/lib/dev/timeline';
import { Outcome } from '../workflows/parts';
import s from './logs.module.css';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const LIMIT = 200;

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const dayLabel = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const hm = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** Consecutive events that say the same thing within a few minutes read as one line, with a count. */
function fold(events: Event[]): Array<{ e: Event; n: number }> {
  const out: Array<{ e: Event; n: number; last: Date }> = [];
  for (const e of events) {
    const prev = out.at(-1);
    if (prev && !prev.e.run && !e.run && prev.e.kind === e.kind && prev.e.what === e.what && prev.e.code === e.code
        && prev.e.actor === e.actor && prev.last.getTime() - e.at.getTime() < 5 * 60e3) {
      prev.n += 1;
      prev.last = e.at;
    } else out.push({ e, n: 1, last: e.at });
  }
  return out;
}

function Row({ e, n }: { e: Event; n: number }) {
  return (
    <li className={s.ev}>
      <span className={s.time}>{hm(e.at)}</span>
      <span className={`${s.kind} ${s[e.kind]}`}>{KIND_LABEL[e.kind]}</span>
      <div className={s.main}>
        <div className={s.what}>
          {e.href ? <Link href={e.href}>{e.what}</Link> : e.what}
          {n > 1 && <span className={s.times}>×{n}</span>}
          {e.run && <> <Outcome outcome={e.run.outcome} /></>}
        </div>
        {(e.about || e.issues.length > 0 || e.code) && (
          <div className={s.about}>
            {e.about && <span>{e.about}</span>}
            {e.issues.map((num) => (
              <Link key={num} href={`/developer/issues/${num}`} className={s.issue}>#{num}</Link>
            ))}
            {e.code && <span className={s.code}>{e.code}</span>}
          </div>
        )}
        {e.detail.length > 0 && e.kind !== 'import' && n === 1 && (
          <details className={s.detail}>
            <summary>detail</summary>
            <dl>
              {e.detail.map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
          </details>
        )}
      </div>
      <span className={s.actor}>{e.actor}</span>
    </li>
  );
}

async function Logs({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const kind = KINDS.includes(one(sp.kind) as Kind) ? (one(sp.kind) as Kind) : null;
  const beforeRaw = one(sp.before);
  const before = beforeRaw && Number.isFinite(Date.parse(beforeRaw)) ? new Date(beforeRaw) : null;
  const t = await loadTimeline({ limit: LIMIT, before, kind });
  const href = (k: Kind | null, b: Date | null = null) => {
    const q = new URLSearchParams();
    if (k) q.set('kind', k);
    if (b) q.set('before', b.toISOString());
    const text = q.toString();
    return `/dev/logs${text ? `?${text}` : ''}`;
  };
  const days: Array<{ key: string; label: string; events: Event[] }> = [];
  for (const e of t.events) {
    const k = dayKey(e.at);
    const last = days.at(-1);
    if (last?.key === k) last.events.push(e);
    else days.push({ key: k, label: dayLabel(e.at), events: [e] });
  }
  const total = KINDS.reduce((n, k) => n + t.counts[k], 0);
  const actions = [...t.events.filter((e) => e.code && !e.code.match(/^[0-9a-f]{7}$/))
    .reduce((m, e) => m.set(e.code!, (m.get(e.code!) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);

  return (
    <Page
      crumbs={[{ label: SECTION.developer }, { label: 'Logs' }]}
      inspector={
        <>
          <div className="lbl">Append-only · newest first</div>
          <div className="ihead">What happened, in order</div>
          <div className="imeta">
            {t.events.length} shown{before ? ` from before ${before.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}
            {t.events.length ? `, back to ${ago(t.events.at(-1)!.at)}` : ''}
          </div>
          {KINDS.map((k) => (
            <div className="kv" key={k}>
              <span><span className={`${s.dot} ${s[k]}`} aria-hidden />{KIND_LABEL[k]}</span>
              <span>{t.counts[k]}</span>
            </div>
          ))}
          <div className="lbl" style={{ marginTop: 18 }}>Read from</div>
          {t.sources.map((x) => (
            <div key={x.key} className={s.src}>
              <b>{x.label}</b> <span className={`flag ${x.ok ? 'f-ok' : 'f-mute'}`}>{x.ok ? 'read' : 'unavailable'}</span>
              <div>{x.note}</div>
            </div>
          ))}
          {actions.length > 0 && (
            <>
              <div className="lbl" style={{ marginTop: 18 }}>Actions shown</div>
              {actions.slice(0, 10).map(([a, n]) => (
                <div className="kv" key={a}>
                  <span className="mono" style={{ fontSize: 11 }}>{a}</span>
                  <span>{n}</span>
                </div>
              ))}
            </>
          )}
          <div className="note">
            The audit row is written in the same transaction as the change it describes; runs come from the workflow
            ledger and commits from this repository’s own history, read on the server. Nothing here is editable and
            nothing is deleted.
          </div>
        </>
      }
    >
      <div className="lbl">Developer</div>
      <h1>Logs</h1>
      <p className="sublede">
        Everything that happened, in one line: commits and merges on master and the issues they closed, workflow runs
        and imports, every approval, status change and feedback — with who did it.
      </p>

      <nav className={s.filters} aria-label="Kinds of event">
        <Link href={href(null)} className={`${s.chip} ${!kind ? s.on : ''}`} aria-current={!kind ? 'page' : undefined}>All <b>{total}</b></Link>
        {KINDS.map((k) => (
          <Link key={k} href={href(k)} className={`${s.chip} ${kind === k ? s.on : ''}`} aria-current={kind === k ? 'page' : undefined}>
            <span className={`${s.dot} ${s[k]}`} aria-hidden />{KIND_LABEL[k]} <b>{t.counts[k]}</b>
          </Link>
        ))}
      </nav>

      {t.events.length === 0 ? (
        <div className="card">
          <div className="cbody">
            <p className="muted">
              {before ? 'Nothing older than this in the sources that could be read.' : 'Nothing of this kind in the sources that could be read.'}{' '}
              {t.sources.some((x) => !x.ok) && `Unavailable: ${t.sources.filter((x) => !x.ok).map((x) => x.label.toLowerCase()).join(', ')} — so this is not proof that nothing happened.`}
              {' '}<Link href={href(null)}>Show everything</Link>.
            </p>
          </div>
        </div>
      ) : (
        days.map((d) => (
          <section className={`card ${s.day}`} key={d.key}>
            <div className="chead">
              <h2>{d.label}</h2>
              <span className="lbl">
                {KINDS.map((k) => [k, d.events.filter((e) => e.kind === k).length] as const).filter(([, n]) => n)
                  .map(([k, n]) => `${n} ${KIND_LABEL[k].toLowerCase()}`).join(' · ')}
              </span>
            </div>
            <ol className={s.list}>
              {fold(d.events).map(({ e, n }) => <Row key={e.id} e={e} n={n} />)}
            </ol>
          </section>
        ))
      )}

      {t.more && (
        <p className={s.older}>
          <Link href={href(kind, t.more)} className={s.chip}>Older →</Link>
          <span className="muted">From before {hm(t.more)}, {t.more.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.</span>
        </p>
      )}
    </Page>
  );
}

export default coalescePage('/dev/logs', Logs);
