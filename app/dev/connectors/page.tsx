import { coalescePage } from '@/lib/page-render';
import Link from '@/components/ui/AppLink';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { config } from '@/config/deployment';
import { getDb } from '@/lib/db';
import { auth } from '@/lib/auth';
import { issues as issueSink } from '@/lib/issues';
import { agent } from '@/lib/agent';
import { ago } from '@/lib/time';
import { allSignals } from '@/modules/signals';
import { getActivity } from '@/lib/activity';
import type { ActivityData, SourceSummary } from '@/lib/activity/types';
import {
  BURST_RATIO, GROUPS, GROUP_TONE, RANGES, buildView, dayLabel, fmtCount, groupOf, isBurst, parseView, sourceTotals,
  type ActivityView, type BucketSize, type Group, type Part, type RangeKey,
} from '@/lib/activity/view';
import { ActivityCharts } from './ActivityCharts';
import s from './connectors.module.css';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;

const INVARIANTS = [
  {
    rule: 'Everything lands raw first',
    detail:
      'Normalization is a separate, replayable step. When a mapping is wrong — and it will be — ' +
      're-normalize from what landed rather than re-fetching from a rate-limited API.',
  },
  {
    rule: 'Idempotent on (source, source_id, source_updated_at)',
    detail: 'Re-delivery is free. The signals ingest already relies on this and can be run twice.',
  },
  {
    rule: 'onWebhook returns invalidations, never data',
    detail:
      'Even for signed sources. One code path, and the source that cannot be trusted to push ' +
      'correct data becomes the default rather than the exception.',
  },
];

const STATE: Record<SourceSummary['state'], { word: string; flag: string }> = {
  connected: { word: 'Connected', flag: 'f-ok' },
  'read-only': { word: 'Read-only', flag: 'f-ok' },
  files: { word: 'Files', flag: 'f-mute' },
  planned: { word: 'Planned', flag: 'f-mute' },
};
const RANGE_WORD: Record<RangeKey, string> = { '7': '7 d', '30': '30 d', '90': '90 d', all: 'All' };
/** A connected source quiet for longer than this reads as stale, not as fine. A guess, labelled. */
const STALE_DAYS = 3;

function href(v: { group: Group; range: RangeKey; size: BucketSize }, patch: Partial<{ group: Group; range: RangeKey; size: BucketSize | null }>) {
  const next = { ...v, ...patch };
  const q = new URLSearchParams();
  if (next.group !== 'all') q.set('src', next.group);
  if (next.range !== '30') q.set('range', next.range);
  // A bar size is kept only when it differs from the range's own default.
  const size = 'size' in patch ? patch.size : v.size;
  if (size && size !== (next.range === '7' || next.range === '30' ? 'day' : 'week')) q.set('by', size);
  const text = q.toString();
  return `/developer/connectors${text ? `?${text}` : ''}`;
}

function Count({ p }: { p: Part & { unknown: number } }) {
  const all = p.actual + p.estimated;
  if (!all) return <span className="muted">{p.unknown ? 'not counted' : '—'}</span>;
  return (
    <>
      <span title={p.estimated ? `${fmtCount(p.actual)} counted + ${fmtCount(p.estimated)} estimated` : undefined}>
        {p.estimated ? '~' : ''}{fmtCount(all)}
      </span>
      {p.estimated > 0 && <span className={s.snote}>{p.actual ? `${Math.round((p.estimated / all) * 100)}% estimated` : 'estimated'}</span>}
    </>
  );
}

function Origins({ view }: { view: ActivityView }) {
  const rows = view.origins ?? [];
  const shown = rows.slice(0, 10);
  const rest = rows.slice(10);
  const all = rows.reduce((n, r) => n + r.actual + r.estimated, 0);
  const max = Math.max(1, ...shown.map((r) => r.actual + r.estimated));
  const tone = GROUP_TONE.search;
  return (
    <section className={s.origins} aria-labelledby="origins-title">
      <div className={s.ohead}>
        <h3 id="origins-title">Requests by origin host</h3>
        <span className="lbl">{rows.length} hosts · {view.days} days</span>
      </div>
      <p className={s.olede}>
        Searches and page fetches, by the host they went to, so one site hit too often stands out. <b>Peak</b> is its
        busiest single day, marked when it is {BURST_RATIO}× or more its median day; the small bars are its{' '}
        {view.size === 'week' ? 'weeks' : 'days'}, each on its own scale.
      </p>
      {rows.length === 0 ? (
        <p className={s.olede}>No requests by host were recorded in these days.</p>
      ) : (
        <ol className={s.olist}>
          {shown.map((r) => {
            const total = r.actual + r.estimated;
            const peakBucket = Math.max(1, ...r.perBucket);
            const n = r.perBucket.length;
            return (
              <li key={r.origin} className={s.orow}>
                <span className={s.ohost} title={r.origin}>{r.origin}</span>
                <span className={s.otrack} style={{ color: tone }} aria-hidden>
                  <i style={{ width: `${(r.actual / max) * 100}%`, background: tone }} />
                  <i className={s.oest} style={{ width: `${(r.estimated / max) * 100}%`, background: tone }} />
                </span>
                <span className={s.onum}>{r.estimated ? '~' : ''}{fmtCount(total)}</span>
                <span className={s.oshare}>{Math.round((total / Math.max(1, all)) * 100)}%</span>
                <span className={`${s.opeak} ${isBurst(r) ? s.burst : ''}`} title={`Median day ${fmtCount(r.median)} requests`}>
                  peak <b>{fmtCount(r.peak)}</b> · {dayLabel(r.peakDay, false)}
                  {isBurst(r) && <> · {Math.round(r.peak / r.median)}× usual</>}
                </span>
                <svg className={s.ospark} viewBox={`0 0 ${n} 20`} preserveAspectRatio="none" role="img"
                  aria-label={`${r.origin}: busiest ${view.size} ${fmtCount(peakBucket)} requests; active on ${r.activeDays} days`}>
                  {r.perBucket.map((v, i) => (
                    <rect key={i} x={i + 0.15} width={0.7} y={20 - (v / peakBucket) * 20} height={(v / peakBucket) * 20} fill={tone} opacity={0.75} />
                  ))}
                </svg>
              </li>
            );
          })}
        </ol>
      )}
      {rest.length > 0 && (
        <div className={s.orest}>
          {rest.length} more {rest.length === 1 ? 'host' : 'hosts'}: {fmtCount(rest.reduce((n, r) => n + r.actual + r.estimated, 0))} requests together.
        </div>
      )}
    </section>
  );
}

function Sources({ data, view, now }: { data: ActivityData; view: ActivityView; now: Date }) {
  const totals = sourceTotals(data, view.from, view.to);
  const live = data.sources.filter((x) => x.state !== 'planned').length;
  return (
    <div className="card">
      <div className="chead">
        <h2>Sources</h2>
        <span className="lbl">{live} of {data.sources.length} in use · {view.range === 'all' ? 'all days' : `last ${view.days} days`}</span>
      </div>
      <div className={s.sscroll}>
        <table className={`list ${s.stable}`}>
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col" style={{ width: 104 }}>State</th>
              <th scope="col" className={`${s.num} ${s.hideS}`} style={{ width: 110 }}>Requests</th>
              <th scope="col" className={`${s.num} ${s.hideS}`} style={{ width: 110 }}>Records</th>
              <th scope="col" className={s.num} style={{ width: 118 }}>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {data.sources.map((src) => {
              const t = totals.get(src.id);
              const g = groupOf(src.id);
              const last = src.lastAt ? new Date(src.lastAt) : null;
              const stale = src.state !== 'planned' && src.state !== 'files' && last !== null && now.getTime() - last.getTime() > STALE_DAYS * 864e5;
              return (
                <tr key={src.id} className={view.group === g ? s.here : undefined}>
                  <td>
                    <Link href={href(view, { group: g })} scroll={false} className={s.sname}>{src.label}</Link>
                    {src.id === 'affinity' && <Link href="/dev/affinity" className={s.slink}>connection</Link>}
                    <span className={s.snote}>{src.note}</span>
                  </td>
                  <td><span className={`flag ${STATE[src.state].flag}`}>{STATE[src.state].word}</span></td>
                  <td className={`${s.num} ${s.hideS}`}>{t ? <Count p={t.requests} /> : '—'}</td>
                  <td className={`${s.num} ${s.hideS}`}>{t ? <Count p={t.records} /> : '—'}</td>
                  <td className={s.num}>
                    {last ? <span className={stale ? s.stale : undefined} title={last.toISOString()}>{ago(last, now)}{stale ? ' · stale' : ''}</span>
                      : <span className="muted">{src.state === 'planned' ? 'not yet' : 'never'}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

async function Connectors({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const opts = parseView(sp);
  const [db, a, sink, ag, signals, activity] = await Promise.all([
    getDb(), auth(), issueSink(), agent(), allSignals(),
    getActivity().then((d) => ({ ok: true as const, data: d }), (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) })),
  ]);
  const now = new Date();
  const view = activity.ok ? buildView(activity.data, opts) : null;
  const asOf = activity.ok ? new Date(activity.data.asOf) : null;
  const asOfStale = asOf !== null && now.getTime() - asOf.getTime() > 864e5;

  const seams = [
    {
      name: 'Db',
      now: db.kind === 'pglite' ? 'PGlite, file on disk' : 'Postgres via DATABASE_URL',
      later: 'Managed Postgres — the swap is a connection string',
      cheap: `${config.db.url ? 'DATABASE_URL set' : config.db.localDir} · nothing outside lib/db imports a driver`,
    },
    {
      name: 'AuthProvider',
      now: `${a.kind} — user switcher in the rail`,
      later: 'PL LabOS kit at D1',
      cheap: 'Identity is a cookie holding a handle. No password is simulated.',
    },
    {
      name: 'IssueSink',
      now: `${sink.kind} — ${sink.destination}`,
      later: 'GitHubIssueSink at D2',
      cheap: 'The feedback box calls create(). It knows nothing about either implementation.',
    },
    {
      name: 'Connector<T>',
      now: `fixture — ${signals.length} signals ingested through it`,
      later: 'Affinity, Linear, Drive, DocSend at L13',
      cheap: 'The three invariants below are fixed now, so a real source changes the connector and nothing above it.',
    },
    {
      name: 'Agent',
      now: `${ag.kind} — ${ag.available ? 'available' : 'refuses'}`,
      later: 'A live model, once a prompt has passed the protected set',
      cheap: 'Refuses by name rather than returning a plausible-looking answer.',
    },
  ];

  return (
    <Page
      crumbs={[{ label: SECTION.developer }, { label: 'Connectors' }]}
      inspector={
        <>
          <div className="lbl">Reading the charts</div>
          <div className="ihead">What is counted</div>
          <div className="imeta">Per UTC day, per source{asOf ? ` · as of ${dayLabel(asOf.toISOString().slice(0, 10))}` : ''}</div>
          {[
            ['Request', 'One call out: an API page, a query, a search, a fetched page, a model call.'],
            ['Data in · out', 'Bytes received from the source · bytes sent to it.'],
            ['Record', 'An entry pulled, or an item an agent wrote.'],
            ['Estimate', 'Backfilled for days before counting began; drawn lighter and dashed, marked ~ in figures.'],
            ['Unknown', 'Not counted. Never shown as zero.'],
          ].map(([k, v]) => (
            <div className="prov" key={k}>
              <div className="p1">{k}</div>
              <div className="p2" style={{ fontFamily: 'var(--sans)', fontSize: 11.5, lineHeight: 1.5 }}>{v}</div>
            </div>
          ))}
          <div className="note">
            Estimates cover days before a source was measured; each says how it was made, under the charts.
            A file drop makes no requests, so intake shows data and records only.
          </div>

          <div className="lbl" style={{ marginTop: 22 }}>Open questions</div>
          <div className="ihead">Still unanswered</div>
          <div className="imeta">These change the connector design, not just the schedule</div>
          <div className="prov">
            <div className="p1">Affinity plan tier</div>
            <div className="p2" style={{ fontFamily: 'var(--sans)', fontSize: 11.5, lineHeight: 1.5 }}>
              Data Share (Advanced or Enterprise) versus poll-first. Currently{' '}
              <code>{config.affinity.syncMode}</code>, tier {String(config.affinity.tier)}.{' '}
              <Link href="/dev/affinity">Test the connection</Link> to read it from the account.
            </div>
          </div>
          <div className="prov">
            <div className="p1">Warehouse access</div>
            <div className="p2" style={{ fontFamily: 'var(--sans)', fontSize: 11.5, lineHeight: 1.5 }}>
              Own schema with write permission for canon tables? Currently{' '}
              <code>{config.warehouse.canonMode}</code>.
            </div>
          </div>
          <div className="prov">
            <div className="p1">Linear custom fields</div>
            <div className="p2" style={{ fontFamily: 'var(--sans)', fontSize: 11.5, lineHeight: 1.5 }}>
              UNVERIFIED in all three design packages. Check the live GraphQL schema before
              anything depends on it.
            </div>
          </div>
          <div className="note">
            Nothing in the system depends on any of these yet, which is the point of answering
            them before building rather than after.
          </div>
        </>
      }
    >
      <div className="lbl">Developer</div>
      <h1>Connectors</h1>
      <p className="sublede">
        Every source we read — Affinity, the PL data warehouse, Dakota, intake files, the web, SEC and our own
        agents — what state each is in, and how much we ask of it: requests, data in and out, and records pulled, day by day.
      </p>

      {!activity.ok || !view ? (
        <div className="card">
          <div className="chead"><h2>Activity can’t be read here</h2><span className="flag f-mute">Source unavailable</span></div>
          <div className={s.facts}>
            <span>What is known</span><span>{activity.ok ? 'No activity was returned.' : activity.error}</span>
            <span>Who can act</span><span>Claude or ChatGPT, from the folder that records activity.</span>
            <span>Safe next step</span><span>Nothing is shown as zero: the counts are not loaded, not empty. The seams below still hold.</span>
          </div>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="chead">
              <h2>Activity</h2>
              <span className={`lbl ${asOfStale ? s.stale : ''}`}>
                {view.range === 'all' ? `${view.days} days` : `last ${view.days} days`} · {view.size === 'week' ? 'weekly' : 'daily'} · as of {ago(asOf!, now)}
                {asOfStale ? ' · stale' : ''}
              </span>
            </div>
            <div className={s.controls}>
              <nav className={s.pills} aria-label="Which source">
                {GROUPS.map((g) => (
                  <Link key={g.id} href={href(opts, { group: g.id })} scroll={false}
                    className={`${s.pill} ${opts.group === g.id ? s.on : ''}`} aria-current={opts.group === g.id ? 'true' : undefined}>
                    {g.label}
                  </Link>
                ))}
              </nav>
              <div className={s.opts}>
                <nav className={s.seg} aria-label="Time range">
                  {RANGES.map((r) => (
                    <Link key={r} href={href(opts, { range: r, size: null })} scroll={false}
                      className={opts.range === r ? s.on : undefined} aria-current={opts.range === r ? 'true' : undefined}>
                      {RANGE_WORD[r]}
                    </Link>
                  ))}
                </nav>
                <nav className={s.seg} aria-label="One bar per">
                  {(['day', 'week'] as const).map((z) => (
                    <Link key={z} href={href(opts, { size: z })} scroll={false}
                      className={opts.size === z ? s.on : undefined} aria-current={opts.size === z ? 'true' : undefined}>
                      {z === 'day' ? 'Daily' : 'Weekly'}
                    </Link>
                  ))}
                </nav>
              </div>
            </div>
            {view.firstDay && view.firstDay > view.from && (
              <p className="cover" style={{ borderTop: 0, borderBottom: '1px solid var(--hair)' }}>
                Nothing was recorded {opts.group === 'all' ? '' : `for ${GROUPS.find((g) => g.id === opts.group)!.long} `}before{' '}
                <b>{dayLabel(view.firstDay)}</b>; earlier bars are empty because there is no record, not because there was no work.
              </p>
            )}
            <ActivityCharts key={`${opts.group}-${opts.range}-${opts.size}`} view={view} />
            {view.origins && <Origins view={view} />}
          </div>

          <Sources data={activity.data} view={view} now={now} />
        </>
      )}

      <div className="card">
        <div className="chead">
          <h2>The five seams</h2>
          <span className="lbl">local now · live later</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="list">
            <thead>
              <tr>
                <th style={{ width: 130 }}>Seam</th>
                <th style={{ width: 250 }}>Running now</th>
                <th style={{ width: 240 }}>Swaps to</th>
                <th>How the swap stays cheap</th>
              </tr>
            </thead>
            <tbody>
              {seams.map((x) => (
                <tr key={x.name}>
                  <td className="mono"><b>{x.name}</b></td>
                  <td>{x.now}</td>
                  <td className="muted">{x.later}</td>
                  <td className="muted" style={{ fontSize: 11.5 }}>{x.cheap}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="chead">
          <h2>The connector contract</h2>
          <span className="lbl">three invariants, fixed from L1</span>
        </div>
        {INVARIANTS.map((i) => (
          <div className="row" key={i.rule} style={{ alignItems: 'flex-start' }}>
            <div className="t">
              <b>{i.rule}</b>
              <span style={{ display: 'block', lineHeight: 1.55 }}>{i.detail}</span>
            </div>
          </div>
        ))}
        <p className="cover">
          The signals ingest is the only thing that uses this today, and it reads a fixture. That
          is deliberate: proving the product against the contract rather than against a vendor is
          what makes the ninth external database cheap instead of bespoke.
        </p>
      </div>
    </Page>
  );
}

export default coalescePage('/dev/connectors', Connectors);
