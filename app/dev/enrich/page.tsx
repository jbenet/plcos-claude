import { join } from 'node:path';
import { ImportDuplicates } from './ImportDuplicates';
import { DakotaImport } from './DakotaImport';
import { buildCache } from '@/lib/build-cache';
import { PortfolioImport } from './PortfolioImport';
import { portfolioFile } from '@/lib/enrich/portfolio';
import { coalescePage } from '@/lib/page-render';
import { capacityBandLabel } from '@/lib/capacity-bands';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { config } from '@/config/deployment';
import { anthropicKey, cloudWorkflowsOn } from '@/lib/workflows/key';
import { ago, formatDate } from '@/lib/time';
import { RESEARCH_STATUSES, enrichDir, inResearchSet } from '@/lib/enrich/candidates';
import { Prospects } from './Prospects';
import Link from '@/components/ui/AppLink';
import { latestRecordsToFix } from '@/lib/enrich/fixes';
import { listPursuits, openSuggestions, STATUS_LABEL } from '@/lib/authz/read/strategy';
import type { Strategy } from '@/lib/enrich/strategy';
import type { Triage } from '@/lib/enrich/triage';
import { latestRun } from '@/modules/sources';
import { exportResearchSetAction, importFindingsAction, sourceBulkAction, runWorkflowAction, runCloudFactCheckAction, runCloudProfileAction, runCloudStrategyAction, runCloudSourcingAction } from './actions';
import { addedInBulk, BULK_DAY } from '@/lib/enrich/unsourced';
import { readResearchExportStatus } from '@/lib/enrich/export-status';
import { ExportStatus } from './ExportStatus';
import { LpUnits } from './LpUnits';
import { SpvStance } from './SpvStance';
import { recentLpRepoints } from '@/lib/authz/read/strategy';
import { ImportJobs } from '@/components/import-jobs/ImportJobs';

/** The checks the records point to before anyone writes (iteration 3, docs/19). */
const FIRSTS: Array<{ id: NonNullable<Triage['first']>; label: string; means: string }> = [
  { id: 'name an owner', label: 'Name an owner', means: 'a way in exists, and nobody on the team owns the pursuit' },
  { id: 'check sent mail', label: 'Check sent mail', means: 'the stage on file claims contact that no touch on record shows' },
  { id: 'first personal note', label: 'A first personal note', means: 'our last word was a mailing, sent the same day to ten or more' },
  { id: 'reply we owe', label: 'A reply we owe', means: 'they wrote last, with nothing from us since — at any status' },
];

export const dynamic = 'force-dynamic';

const n = (x: number) => x.toLocaleString('en-US');


const enrichmentDbInputs = buildCache(async () => {
  const [pursuits,suggestions,imported,bulk,mergeRun,duplicateRun,lpDecisions] = await Promise.all([
    listPursuits(null),openSuggestions(),latestRun('enrich','import'),addedInBulk(),latestRun('enrich','pursuit-merge'),latestRun('enrich','import-duplicates'),
    recentLpRepoints(),
  ]);
  return {pursuits:pursuits.filter(inResearchSet),suggestions,imported,bulk,mergeRun,duplicateRun,lpDecisions};
});

/**
 * Enrichment (N64, docs/19): the research set, exported for the research workflows, and what
 * came back. The workflows run outside the app and read only public sources; their findings
 * land in files here first, and an import maps them in — so a mapping can change and be run
 * again without anything being searched twice.
 */
async function Enrichment({ searchParams }: { searchParams: Promise<{ exported?: string; imported?: string; claims?: string; refused?: string; sourced?: string }> }) {
  const sp = await searchParams;
  const dir = enrichDir();
  const exportStatus = await readResearchExportStatus(dir);
  const {pursuits,suggestions,imported,bulk,mergeRun,duplicateRun,lpDecisions} = await enrichmentDbInputs();
  // Read live: a pass that changes nothing leaves the cached page inputs' revision where it was.
  const [lpRun, spvRun] = await Promise.all([latestRun('enrich','lp-units'), latestRun('enrich','spv-stance')]);
  const entities = new Set(pursuits.map((p) => p.entityId)).size;
  const {readEnrichmentSummary}=await import('@/lib/enrich/file-worker');
  const {triage,plans,quality,set,cands,raw,pages,strategies}=await readEnrichmentSummary(dir);
  const lanes = (['warm now', 'research first', 'long process', 'cold'] as const).map((lane) => ({ lane, rows: triage.filter((t) => t.lane === lane) }));
  const fixes = await latestRecordsToFix();
  // W8, the portfolio view: every proposal together, this year's close first, then by how much
  // they could do and how ready they are. A person decides each on its LP's page.
  const LEVEL = { high: 3, medium: 2, low: 1, unknown: 0 } as Record<string, number>;
  const BAND = { '>$25M': 5, '$5–25M': 4, '$1–5M': 3, '$250K–1M': 2, '$100K+ (floor)': 1.5, '<$250K': 1, '$50–250K': 1, '$25–50K': 0.5, '<$25K': 0.25 } as Record<string, number>;
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
  const last = (imported?.detail ?? {}) as Partial<import('@/lib/enrich/import').ImportCounts>;
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

      {/* The imports this page starts, while they run or need a look (issue 0114). */}
      <ImportJobs compact />

      <DakotaImport />
      <PortfolioImport file={portfolioFile()} />
      <Prospects directory={join(dir, 'prospects')} />

      <div className="card">
        <div className="chead">
          <h2>The research set</h2>
          <span className="lbl">{RESEARCH_STATUSES.map((s) => STATUS_LABEL[s]).join(', ')} + new prospects · vehicles being raised</span>
        </div>
        <div className="cbody">
          <div className="fact"><span>LPs in it now</span><span>{n(entities)} ({n(pursuits.length)} pursuits)</span></div>
          {(['new', 'sourcing', ...RESEARCH_STATUSES] as const).map((s) => (
            <div className="fact" key={s}><span>{STATUS_LABEL[s]}</span><span>{n(pursuits.filter((p) => p.status === s).length)}</span></div>
          ))}
          <div className="fact"><span>Exported</span><span>{set ? `${n(set.lines)} LPs · ${ago(set.at)}` : 'not yet'}{cands && set && cands.lines !== set.lines ? ' · the two files disagree' : ''}</span></div>
          <div className="fact"><span>Findings back</span><span>{n(raw)} LPs researched{pages.pages ? ` (${n(pages.pages)} owed a pass with search: ${n(pages.pages - pages.partial)} from page reads alone${pages.partial ? `, ${n(pages.partial)} with too few searches to follow the protocol` : ''})` : ''} · {n(strategies)} with a strategy</span></div>
          {sp.exported && <p className="stat ready" style={{ marginTop: 10 }}><i />Exported {sp.exported} LPs to {join(config.data.root, 'enrich')}</p>}
          <ExportStatus status={exportStatus} />
          <form action={runWorkflowAction} style={{ marginTop: 12 }}>
            <label>Batch path <input name="batch" required placeholder={join(dir, 'batches', 'batch.jsonl')} /></label>{' '}
            {['w1', 'w1c', 'w5'].map(protocol => <button key={protocol} className="btn" name="protocol" value={protocol} disabled={!anthropicKey() || !cloudWorkflowsOn()}>Run {protocol.toUpperCase()}</button>)}
            {!anthropicKey() && <span className="muted"> Enter an Anthropic key in <Link href="/settings/connections">Settings → Connections</Link> to run workflows.</span>}
            {anthropicKey() && !cloudWorkflowsOn() && <span className="muted"> Turn on Cloud workflows in <Link href="/settings/connections">Settings → Connections</Link> to run workflows on this server.</span>}
          </form>
          {cloudWorkflowsOn() && anthropicKey() && (
            <form action={runCloudFactCheckAction} style={{ marginTop: 12 }}>
              <label>Batch file <input name="batch" required placeholder="w1c-07a.jsonl" /></label>{' '}
              <label>Review file <input name="review" required pattern="fact-review-[0-9]{2}[a-z]\.jsonl" placeholder="fact-review-07a.jsonl" /></label>{' '}
              <label><input type="checkbox" name="correct" /> and correct the findings</label>{' '}
              <button className="btn" type="submit">Fact check in the cloud</button>
              <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>W1c on this server: reads only the cited pages and grades; corrects only when ticked, from those pages, keeping each original. At most {config.cloudWorkflows.w1c.maxFindings} findings.</span>
            </form>
          )}
          {cloudWorkflowsOn() && anthropicKey() && (
            <form action={runCloudProfileAction} style={{ marginTop: 12 }}>
              <label>Batch file <input name="batch" required placeholder="w1-12a.jsonl" /></label>{' '}
              <button className="btn" type="submit">Profile in the cloud</button>
              <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>W1 on this server: searches and reads public pages, keeps a finding on file before replacing it. At most {config.cloudWorkflows.w1.maxLps} LPs.</span>
            </form>
          )}
          {cloudWorkflowsOn() && anthropicKey() && (
            <form action={runCloudStrategyAction} style={{ marginTop: 12 }}>
              <label>Batch file <input name="batch" required placeholder="w5-04a.txt" /></label>{' '}
              <button className="btn" type="submit">Write strategies in the cloud</button>
              <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>W5 on this server: no web, from our records and the research; the server sets the pins and keeps a strategy on file before replacing it. Nothing is imported or sent. At most {config.cloudWorkflows.w5.maxLps} LPs.</span>
            </form>
          )}
          {cloudWorkflowsOn() && anthropicKey() && (
            <form action={runCloudSourcingAction} style={{ marginTop: 12 }}>
              <label>Vehicle slug <input name="vehicle" required placeholder="neurotech" /></label>{' '}
              <label>How many <input name="count" type="number" min={1} max={config.cloudWorkflows.sourcing.maxProspects} defaultValue={10} style={{ width: 60 }} /></label>{' '}
              <label style={{ display: 'block', marginTop: 6 }}>What to look for <textarea name="brief" required minLength={20} maxLength={config.cloudWorkflows.sourcing.maxBriefChars} rows={2} style={{ width: '100%' }} placeholder="Topic words, kinds of investor, places. Name no LP of ours: the brief guides public searches." /></label>
              <button className="btn" type="submit">Source prospects in the cloud</button>
              <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>Searches public pages for people who fit the vehicle; writes a new file in enrich/prospects for Add prospects. The model sees no record of ours. At most {config.cloudWorkflows.sourcing.maxProspects}.</span>
            </form>
          )}
          <form action={exportResearchSetAction} style={{ marginTop: 12 }}>
            <button className="btn p" type="submit">Export the research set</button>
            <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>
              Writes research-set.jsonl (who they are), candidates.jsonl (where they stand), team.json, triage.jsonl, identity-review.jsonl (ambiguous identities), and lp-unit-review.jsonl (firm or personal, without amounts or contact details) to {join(config.data.root, 'enrich')}.
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
              {last.entityTypes && <details className="more" style={{ marginTop: 10 }}>
                <summary>{last.entityTypes.corrected.length} entity types corrected, {last.entityTypes.ambiguous.length} ambiguous</summary>
                <ul style={{ fontSize: 12 }}>
                  {last.entityTypes.corrected.map(c => <li key={c.correctionId}><Link href={`/orgs/${c.entityId}`}>{c.name}</Link> · organization · <code>{c.correctionId}</code></li>)}
                  {last.entityTypes.ambiguous.map(c => <li key={c.entityId}><Link href={`/orgs/${c.entityId}`}>{c.name}</Link> · {c.reason}</li>)}
                </ul>
                <p className="muted">Local type decisions; source identities retained. Export the research set again before the next enrichment check.</p>
              </details>}
              {(last.skippedRecords?.length ?? 0) > 0 && <div className="fact"><span>Skipped</span><span>{n(last.skippedPaths ?? 0)} paths · {n(last.skippedRecords!.length)} records total — see below</span></div>}
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
          <ImportDuplicates report={duplicateRun?.status === 'ok' && (!imported || duplicateRun.startedAt > imported.startedAt)
            ? duplicateRun.detail as unknown as import('@/lib/enrich/import-dupes').ImportDuplicateReport : last.duplicateIdentities}
            pursuitReport={mergeRun?.status === 'ok' && (!imported || mergeRun.startedAt > imported.startedAt)
              && (duplicateRun?.status !== 'ok' || mergeRun.startedAt > duplicateRun.startedAt)
            ? mergeRun.detail as unknown as import('@/modules/strategy').PursuitMergeReport : duplicateRun?.status === 'ok' && (!imported || duplicateRun.startedAt > imported.startedAt)
              ? (duplicateRun.detail as unknown as import('@/lib/enrich/import-dupes').ImportDuplicateReport).pursuitMerges : last.pursuitMerges} />
          <LpUnits last={lpRun ? `${lpRun.status === 'ok' ? '' : 'stopped · '}${lpRun.note ?? ''}` : null} decisions={lpDecisions}
            fileDecisions={lpRun?.detail?.fileDecisions as import('@/lib/enrich/lp-unit-decisions').LpUnitFileReport | undefined} />
          <SpvStance last={spvRun ? `${spvRun.status === 'ok' ? '' : 'stopped · '}${spvRun.note ?? ''}` : null} />
          {(last.skippedRecords ?? []).length > 0 && (
            <details className="more" style={{ marginTop: 10 }}>
              <summary>{last.skippedRecords!.length} skipped records — correct these files and import again</summary>
              <p className="muted">Indices start at zero. Other valid records were imported.</p>
              <ul style={{ fontSize: 12 }}>{last.skippedRecords!.map((p) => <li key={`${p.file}:${p.index}`}><code>{p.file}</code> · index {p.index} — {p.problems.join('; ')}</li>)}</ul>
            </details>
          )}
          {(last.problems ?? []).length > 0 && (
            <details className="more" style={{ marginTop: 10 }}>
              <summary>{last.problems!.length} refused files</summary>
              <ul style={{ fontSize: 12 }}>{last.problems!.map((p) => <li key={p.key}><code>{p.key}</code> — {p.problems.join('; ')}</li>)}</ul>
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
          <h2>How good it is — the loop&rsquo;s own measurements</h2>
          <span className="lbl">the critic (W5c) · the fact check (W1c)</span>
        </div>
        <div className="cbody">
          {quality.rounds.length === 0 && quality.facts.length === 0 && <p className="muted">No critic round and no fact check has run on these files yet.</p>}
          {quality.rounds.map((r) => (
            <div className="fact" key={r.round}>
              <span>Critic, round {r.round}</span>
              <span>{n(r.graded)} {r.graded === 1 ? 'strategy' : 'strategies'} graded: {(['A', 'B', 'C', 'D'] as const).map((g) => `${r.grades[g]} ${g}`).join(' · ')}
                {Object.keys(r.byCriterion).length > 0 && <span className="muted"> — issues by criterion: {Object.entries(r.byCriterion).sort(([a], [b]) => Number(a) - Number(b)).map(([c, k]) => `${c}: ${k}`).join(', ')}</span>}
              </span>
            </div>
          ))}
          {quality.facts.map((f) => {
            const read = f.facts.supported + f.facts.partly + f.facts['not supported'] + f.facts['someone else'];
            return (
              <div key={f.round}>
                <div className="fact"><span>Fact check, round {f.round}</span><span>{n(read + f.facts.unavailable)} {read + f.facts.unavailable === 1 ? 'fact' : 'facts'} in {n(f.findings)} {f.findings === 1 ? 'finding' : 'findings'}, each re-read at the page it cites: {n(f.facts.supported)} supported, {n(f.facts.partly)} partly, {n(f.facts['not supported'])} not supported, {n(f.facts['someone else'])} about someone else; {n(f.facts.unavailable)} {f.facts.unavailable === 1 ? 'page' : 'pages'} unavailable{read ? ` (${Math.round((100 * f.facts.supported) / read)}% of those read, supported as written)` : ''}</span></div>
                <div className="fact"><span>Identities, round {f.round}</span><span>{n(f.identities.holds)} hold · {n(f.identities.doubt)} in doubt · {n(f.identities.wrong)} wrong</span></div>
              </div>
            );
          })}
        </div>
        <p className="cover">
          <b>What this is:</b> an agent grading against the written protocol (docs/19) — the critic
          grades strategies by its criteria, the fact check re-reads each fact&rsquo;s cited page and
          nothing else. Each round grades its own sample, so the rounds compare the protocol&rsquo;s
          versions, not the same strategies twice. It measures the loop; it is never the team&rsquo;s
          verification of a fact, nor a verdict on an LP.
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
                    <td><Link href={`/targets/${x.pursuitId}`}><b>{x.entityName}</b></Link><div className="muted" style={{ fontSize: 11 }}>capacity {capacityBandLabel(st(x).scores.capacity.band)} · propensity {st(x).scores.propensity.level}</div></td>
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

      {bulk.length > 0 && (
        <div className="card" id="bulk">
          <div className="chead">
            <h2>Added in bulk, nothing else on record</h2>
            <span className="lbl">{n(bulk.reduce((a, d) => a + d.rows.length, 0))} LPs · {bulk.length} {bulk.length === 1 ? 'import' : 'imports'}</span>
          </div>
          <div className="cbody">
            <p className="p2" style={{ marginTop: 0 }}>
              These LPs came into Affinity in a bulk import — a day that added {n(Math.min(...bulk.map((d) => d.added)))} or more
              entries at once — and that import is all we have: no meeting, no email, no note, no word from the team. Nothing
              says who suggested them or who knows them, so their strategies can&rsquo;t choose a route. Say where they came
              from — for the whole import, or row by row — and it is saved as the team&rsquo;s context on each, which the
              strategy step reads first.
            </p>
            {sp.sourced && <p className="p2"><b>Saved for {sp.sourced}.</b> Their strategies are due again.</p>}
          </div>
          {bulk.map((d) => (
            <form key={d.day} action={sourceBulkAction} className="bulkday">
              <input type="hidden" name="day" value={d.day} />
              <div className="cbody">
                <div className="fact">
                  <span>Import of {formatDate(new Date(`${d.day}T12:00:00Z`), { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  <span>{n(d.added)} entries that day · {n(d.inSet)} in the research set · {n(d.rows.length)} with nothing else on record</span>
                </div>
                <label className="bulkall">
                  <span>Where the whole import came from</span>
                  <input name="all" placeholder="e.g. the conference attendee list, a partner's contacts" maxLength={300} />
                </label>
              </div>
              <table className="list sugtable">
                <thead><tr><th style={{ width: 220 }}>LP</th><th>On</th><th>Owner</th><th style={{ width: '36%' }}>Where from, if not the import&rsquo;s</th></tr></thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr key={r.pursuitId}>
                      <td>
                        <Link href={`/targets/${r.pursuitId}`}><b>{r.name}</b></Link>
                        <div className="muted" style={{ fontSize: 11 }}>{r.org ?? '—'}</div>
                        <input type="hidden" name="pursuitId" value={r.pursuitId} />
                        <input type="hidden" name={`ent:${r.pursuitId}`} value={r.entityId} />
                        <input type="hidden" name={`veh:${r.pursuitId}`} value={r.vehicleId} />
                      </td>
                      <td style={{ fontSize: 12 }}>{r.vehicle} · {r.status}</td>
                      <td style={{ fontSize: 12 }}>{r.owner ?? <span className="muted">nobody</span>}</td>
                      <td><input name={`src:${r.pursuitId}`} aria-label={`Where ${r.name} came from`} maxLength={300} className="bulksrc" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="cbody" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <button className="btn p" type="submit">Save where they came from</button>
                <span className="muted" style={{ fontSize: 12 }}>A row left blank takes the import&rsquo;s answer; with no answer at all, nothing is saved.</span>
              </div>
            </form>
          ))}
          <p className="cover">
            <b>Found by rule:</b> an LP in the research set whose first entry on any Affinity list was added on a day with{' '}
            {n(BULK_DAY)} or more additions (<code>BULK_DAY</code>, a GUESS), with no touchpoint, no note in Affinity and no context
            from the team (<code>lib/enrich/unsourced.ts</code>). Nothing here writes to Affinity.
          </p>
        </div>
      )}

      {fixes && (
        <div className="card">
          <div className="chead">
            <h2>Records to fix in Affinity</h2>
            <span className="lbl">{n(fixes.rows.length)} LPs · listed {formatDate(new Date(fixes.at), { day: 'numeric', month: 'short' })}</span>
          </div>
          <div className="cbody">
            <div className="fact"><span>By kind</span><span>{Object.entries(fixes.kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}</span></div>
          </div>
          <table className="list sugtable">
            <thead><tr><th style={{ width: 200 }}>LP</th><th>What the research says</th><th>The proposed step</th></tr></thead>
            <tbody>
              {fixes.rows.map((r) => (
                <tr key={r.key}>
                  <td>
                    {r.pursuitId ? <Link href={`/targets/${r.pursuitId}`}><b>{r.name}</b></Link> : <b>{r.name}</b>}
                    <div className="muted" style={{ fontSize: 11 }}>{r.org ?? '—'} · {r.kind}</div>
                  </td>
                  <td style={{ fontSize: 12 }}>{r.said[0] ?? <span className="muted">—</span>}{r.said.length > 1 && <div className="muted" style={{ fontSize: 11 }}>and {r.said.length - 1} more</div>}</td>
                  <td style={{ fontSize: 12 }}>{r.step ?? <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="cover">
            <b>For a person, in Affinity.</b> What the research found wrong or in doubt in our own records —
            a title the pages contradict, a record merging two people, a misspelled name, a dead domain, a
            firm renamed, a role that ended — and the next steps that start by fixing one. A caution is a
            question, not a verdict: check it against our own mail first. Nothing here writes to Affinity.
            Listed by <code>scripts/enrich-fixes.ts</code>.
          </p>
        </div>
      )}
    </Page>
  );
}

export default coalescePage('/dev/enrich', Enrichment);
