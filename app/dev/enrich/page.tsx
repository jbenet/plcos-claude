import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { config } from '@/config/deployment';
import { ago } from '@/lib/time';
import { RESEARCH_STATUSES, enrichDir } from '@/lib/enrich/candidates';
import Link from 'next/link';
import { listPursuits, openSuggestions, STATUS_LABEL } from '@/modules/strategy';
import type { Strategy } from '@/lib/enrich/strategy';
import type { Triage } from '@/lib/enrich/triage';
import type { ConnectorPlan } from '@/lib/enrich/connectors';
import { latestRun } from '@/modules/sources';
import { exportResearchSetAction, importFindingsAction } from './actions';

/** The checks the records point to before anyone writes (iteration 3, docs/19). */
const FIRSTS: Array<{ id: NonNullable<Triage['first']>; label: string; means: string }> = [
  { id: 'name an owner', label: 'Name an owner', means: 'a way in exists, and nobody on the team owns the pursuit' },
  { id: 'check sent mail', label: 'Check sent mail', means: 'the stage on file claims contact that no touch on record shows' },
  { id: 'first personal note', label: 'A first personal note', means: 'our last word was a mailing, sent the same day to ten or more' },
];

export const dynamic = 'force-dynamic';

const n = (x: number) => x.toLocaleString('en-US');

async function fileInfo(path: string): Promise<{ at: Date; lines: number } | null> {
  try {
    const s = await stat(path);
    const { readFile } = await import('node:fs/promises');
    const lines = (await readFile(path, 'utf8')).split('\n').filter(Boolean).length;
    return { at: s.mtime, lines };
  } catch { return null; }
}

async function count(dir: string): Promise<number> {
  try { return (await readdir(dir)).filter((f) => f.endsWith('.json')).length; } catch { return 0; }
}

/** Findings made from page reads alone (v1.6): still owed a pass with search. */
async function pagesOnly(dir: string): Promise<number> {
  const { readFile } = await import('node:fs/promises');
  let n = 0;
  for (const f of (await readdir(dir).catch(() => [])).filter((x) => x.endsWith('.json'))) {
    try { if ((JSON.parse(await readFile(join(dir, f), 'utf8')) as { researched?: { method?: string } }).researched?.method === 'pages') n++; } catch { /* the checker reports it */ }
  }
  return n;
}

/**
 * Enrichment (N64, docs/19): the research set, exported for the research workflows, and what
 * came back. The workflows run outside the app and read only public sources; their findings
 * land in files here first, and an import maps them in — so a mapping can change and be run
 * again without anything being searched twice.
 */
export default async function Enrichment({ searchParams }: { searchParams: Promise<{ exported?: string; imported?: string; claims?: string; refused?: string }> }) {
  const sp = await searchParams;
  const dir = enrichDir();
  const pursuits = (await listPursuits(null)).filter((p) => !p.historical && RESEARCH_STATUSES.includes(p.status));
  const entities = new Set(pursuits.map((p) => p.entityId)).size;
  const { readFile } = await import('node:fs/promises');
  const triage = (await readFile(join(dir, 'triage.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Triage);
  const lanes = (['warm now', 'research first', 'long process', 'cold'] as const).map((lane) => ({ lane, rows: triage.filter((t) => t.lane === lane) }));
  const plans = JSON.parse(await readFile(join(dir, 'connectors.json'), 'utf8').catch(() => '[]')) as ConnectorPlan[];
  const [set, cands, raw, pages, strategies, imported, suggestions] = await Promise.all([
    fileInfo(join(dir, 'research-set.jsonl')),
    fileInfo(join(dir, 'candidates.jsonl')),
    count(join(dir, 'raw')),
    pagesOnly(join(dir, 'raw')),
    count(join(dir, 'strategy')),
    latestRun('enrich', 'import'),
    openSuggestions(),
  ]);
  // W8, the portfolio view: every proposal together, this year's close first, then by how much
  // they could do and how ready they are. A person decides each on its LP's page.
  const LEVEL = { high: 3, medium: 2, low: 1, unknown: 0 } as Record<string, number>;
  const BAND = { '>$25M': 5, '$5–25M': 4, '$1–5M': 3, '$250K–1M': 2, '<$250K': 1 } as Record<string, number>;
  const open = suggestions.filter((x) => x.status === 'proposed');
  const st = (x: (typeof open)[number]) => x.data as unknown as Strategy;
  const ranked = [...open].sort((a, b) =>
    (st(a).list === 'this year' ? 0 : st(a).list === '2027' ? 1 : 2) - (st(b).list === 'this year' ? 0 : st(b).list === '2027' ? 1 : 2)
    || (LEVEL[st(b).scores.propensity.level] ?? 0) - (LEVEL[st(a).scores.propensity.level] ?? 0)
    || (BAND[st(b).scores.capacity.band] ?? 0) - (BAND[st(a).scores.capacity.band] ?? 0));
  const tally = (k: (s: Strategy) => string) => open.reduce<Record<string, number>>((m, x) => ({ ...m, [k(st(x))]: (m[k(st(x))] ?? 0) + 1 }), {});
  const who = tally((s) => s.next.who.split(/[ (,—]/)[0] ?? '?');
  const lists = tally((s) => s.list);
  const routes = tally((s) => s.route?.tier ?? 'none');
  const last = (imported?.detail ?? {}) as { mapped?: number; claims?: number; docs?: number; withPaths?: number; paths?: number; rejected?: number; problems?: Array<{ key: string; problems: string[] }> };
  return (
    <Page
      crumbs={[{ label: SECTION.developer }, { label: 'Enrichment' }]}
      inspector={
        <>
          <div className="lbl">Read only</div>
          <div className="ihead">Public sources, and nothing written anywhere</div>
          <div className="note">
            The research reads public pages: no sign-ins, no paid services, and nothing posted.
            A search may carry a name, an organization and a title. It never carries a status, an
            amount, a note, or the fact that someone is in this pipeline.
          </div>
        </>
      }
    >
      <div className="lbl">Developer</div>
      <h1>Enrichment</h1>
      <p className="sublede">
        Who the research workflows read about, what came back, and the import that maps it in.
      </p>

      <div className="card">
        <div className="chead">
          <h2>The research set</h2>
          <span className="lbl">{RESEARCH_STATUSES.map((s) => STATUS_LABEL[s]).join(', ')} · vehicles being raised</span>
        </div>
        <div className="cbody">
          <div className="fact"><span>LPs in it now</span><span>{n(entities)} ({n(pursuits.length)} pursuits)</span></div>
          {RESEARCH_STATUSES.map((s) => (
            <div className="fact" key={s}><span>{STATUS_LABEL[s]}</span><span>{n(pursuits.filter((p) => p.status === s).length)}</span></div>
          ))}
          <div className="fact"><span>Exported</span><span>{set ? `${n(set.lines)} LPs · ${ago(set.at)}` : 'not yet'}{cands && set && cands.lines !== set.lines ? ' · the two files disagree' : ''}</span></div>
          <div className="fact"><span>Findings back</span><span>{n(raw)} LPs researched{pages ? ` (${n(pages)} from page reads only, owed a pass with search)` : ''} · {n(strategies)} with a strategy</span></div>
          {sp.exported && <p className="stat ready" style={{ marginTop: 10 }}><i />Exported {sp.exported} LPs to {join(config.data.root, 'enrich')}</p>}
          <form action={exportResearchSetAction} style={{ marginTop: 12 }}>
            <button className="btn p" type="submit">Export the research set</button>
            <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>
              Writes research-set.jsonl (who they are) and candidates.jsonl (with where they stand) to {join(config.data.root, 'enrich')}.
            </span>
          </form>
        </div>
      </div>

      <div className="card">
        <div className="chead">
          <h2>The import</h2>
          <span className="lbl">files → claims with provenance, profiles, connection candidates</span>
        </div>
        <div className="cbody">
          <div className="fact"><span>Last import</span><span>{imported ? `${ago(imported.startedAt)} · ${imported.note ?? imported.status}` : 'never'}</span></div>
          {imported && (
            <>
              <div className="fact"><span>Mapped</span><span>{n(last.mapped ?? 0)} LPs · {n(last.claims ?? 0)} claims from {n(last.docs ?? 0)} public pages</span></div>
              <div className="fact"><span>Connection candidates</span><span>{n(last.paths ?? 0)} paths for {n(last.withPaths ?? 0)} LPs</span></div>
              {(last.rejected ?? 0) > 0 && <div className="fact"><span>Refused</span><span>{n(last.rejected ?? 0)} files that fail the schema — see below</span></div>}
            </>
          )}
          {sp.imported && <p className="stat ready" style={{ marginTop: 10 }}><i />Imported {sp.imported} findings, {sp.claims} claims{Number(sp.refused) ? `; ${sp.refused} refused` : ''}</p>}
          <form action={importFindingsAction} style={{ marginTop: 12 }}>
            <button className="btn p" type="submit">Import the findings</button>
            <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>
              Replaces what an earlier import wrote; a claim somebody verified is kept.
            </span>
          </form>
          {(last.problems ?? []).length > 0 && (
            <details className="more" style={{ marginTop: 10 }}>
              <summary>{last.problems!.length} refused files</summary>
              <ul style={{ fontSize: 12 }}>{last.problems!.map((p) => <li key={p.key}><code>{p.key.slice(0, 8)}</code> — {p.problems.join('; ')}</li>)}</ul>
            </details>
          )}
        </div>
        <p className="cover">
          <b>What this maps:</b> each fact to a claim, with its source page, the page&rsquo;s date
          (or the day it was read), a confidence, and nobody as its verifier until a person is
          (rule 9). Each connection path keeps its tier: a C or D path is a clue for a person to
          check, not a route (rule 6).
        </p>
      </div>

      <div className="card">
        <div className="chead">
          <h2>Triage — who we&rsquo;ve written to and not heard from</h2>
          <span className="lbl">W9 · from our records, no web · {n(triage.length)} at Selected or Connecting</span>
        </div>
        {triage.length === 0 ? (
          <div className="cbody"><p className="muted">Not run yet: <code>scripts/enrich-triage.ts</code> writes it from the files.</p></div>
        ) : (
          <div className="cbody">
            {lanes.map((l) => (
              <div className="fact" key={l.lane}>
                <span>{l.lane}</span>
                <span>
                  {n(l.rows.length)}
                  <span className="muted"> — {l.lane === 'warm now' ? 'a way in exists today: a colleague who met us, an insider, a close contact, a deck they opened'
                    : l.lane === 'research first' ? 'senior, at a firm that invests, nothing public read yet: where research should go next'
                    : l.lane === 'long process' ? 'decides by committee over quarters: the 2027 list unless a path says otherwise'
                    : 'no way in on record: find a connector before writing again'}</span>
                </span>
              </div>
            ))}
            <div className="lbl" style={{ marginTop: 14 }}>Before any outreach</div>
            {FIRSTS.map((f) => (
              <div className="fact" key={f.id}>
                <span>{f.label}</span>
                <span>
                  {n(triage.filter((t) => t.first === f.id).length)}
                  <span className="muted"> — {f.means}</span>
                </span>
              </div>
            ))}
            <details className="more" style={{ marginTop: 10 }}>
              <summary>The warm ones, and why</summary>
              {lanes[0]!.rows.map((t) => (
                <div className="pp-fact" key={t.key} style={{ gridTemplateColumns: '200px minmax(0,1fr)' }}>
                  <span><b>{t.name}</b>{t.first && <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>first: {t.first}</span>}</span>
                  <span style={{ fontSize: 12.5 }}>{t.reasons.join(' · ')}</span>
                </div>
              ))}
            </details>
          </div>
        )}
        <p className="cover">
          <b>What this reads:</b> the pipeline, our notes, and the paths W3 found — nothing public, and
          nothing sent. A lane is a starting point with its reasons; a person can overrule it. A first
          step is a check for someone on the team, before anyone writes.
        </p>
      </div>

      <div className="card">
        <div className="chead">
          <h2>The connector plan — who could introduce whom</h2>
          <span className="lbl">W11 · no web · {config.guard.asksPerConnectorPerQuarter} asks a connector a quarter, a guess</span>
        </div>
        {plans.length === 0 ? (
          <div className="cbody"><p className="muted">Nobody yet: <code>scripts/enrich-connectors.ts</code> writes it once W3 has found an LP who has committed next to a prospect.</p></div>
        ) : (
          <div className="cbody">
            {plans.map((pl) => (
              <div className="pp-fact" key={pl.connector.key} style={{ gridTemplateColumns: '220px minmax(0,1fr)' }}>
                <span>
                  <b>{pl.connector.name}</b>
                  <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>
                    {pl.connector.status}{pl.connector.money ? ` · ${pl.connector.money}` : ''} · ask {pl.when}
                  </span>
                </span>
                <span style={{ fontSize: 12.5 }}>
                  {pl.prospects.filter((x) => pl.asks.includes(x.key)).map((x, i) => (
                    <span key={x.key}>{i > 0 && ' · '}{x.name} <span className="muted">(tier {x.tier}{x.tier === 'C' || x.tier === 'D' ? ', to confirm' : ''}: {/^(Both|They)\b/.test(x.basis) ? x.basis[0]!.toLowerCase() + x.basis.slice(1) : x.basis})</span></span>
                  ))}
                  {pl.prospects.length > pl.asks.length && <span className="muted"> · {pl.prospects.length - pl.asks.length} more next quarter</span>}
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="cover">
          <b>What this reads:</b> the paths, the triage and the strategies. A prospect under a
          do-not-approach instruction is left out (rule 8); a C or D tie is a question for the
          connector before it is an introduction (rule 6); a plan names the prospect, never where
          they stand with us. An introduction still goes through an approved ticket.
        </p>
      </div>

      <div className="card">
        <div className="chead">
          <h2>The suggestions, together</h2>
          <span className="lbl">{n(open.length)} ready for review · {n(suggestions.filter((x) => x.status === 'accepted').length)} accepted · {n(suggestions.filter((x) => x.status === 'dismissed').length)} dismissed</span>
        </div>
        {open.length === 0 ? (
          <div className="cbody"><p className="muted">No strategy is waiting: none imported yet, or every one decided.</p></div>
        ) : (
          <>
            <div className="cbody">
              <div className="fact"><span>By list</span><span>{Object.entries(lists).map(([k, v]) => `${k}: ${v}`).join(' · ')}</span></div>
              <div className="fact"><span>Best way in</span><span>{Object.entries(routes).sort().map(([k, v]) => `${k === 'none' ? 'no path' : `tier ${k}`}: ${v}`).join(' · ')}</span></div>
              <div className="fact"><span>Next step falls to</span><span>{Object.entries(who).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}</span></div>
            </div>
            <table className="list sugtable">
              <thead><tr><th>LP</th><th>Next</th><th style={{ width: 90 }}>Way in</th><th style={{ width: 150 }}>Ask</th><th style={{ width: 90 }}>List</th></tr></thead>
              <tbody>
                {ranked.slice(0, 60).map((x) => (
                  <tr key={x.suggestionId}>
                    <td><Link href={`/targets/${x.pursuitId}`}><b>{x.entityName}</b></Link><div className="muted" style={{ fontSize: 11 }}>capacity {st(x).scores.capacity.band} · propensity {st(x).scores.propensity.level}</div></td>
                    <td style={{ fontSize: 12.5 }}>{st(x).next.what}<div className="muted" style={{ fontSize: 11 }}>{st(x).next.who}{st(x).next.when ? ` · ${st(x).next.when}` : ''}</div></td>
                    <td>{st(x).route ? <span className={`tier t${st(x).route!.tier}`}>{st(x).route!.tier}</span> : <span className="muted">none</span>}</td>
                    <td style={{ fontSize: 12 }}>{st(x).ask.shape}{st(x).ask.range ? <div className="muted" style={{ fontSize: 11 }}>{st(x).ask.range}</div> : null}</td>
                    <td style={{ fontSize: 12 }}>{st(x).list}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ranked.length > 60 && <p className="cover">{ranked.length - 60} more; each is on its LP&rsquo;s page.</p>}
          </>
        )}
        <p className="cover">
          <b>Proposals for a person.</b> Each rests on public sources and our records, and each is
          decided on its LP&rsquo;s page: accepting sets the next step, and nothing else moves.
        </p>
      </div>
    </Page>
  );
}
