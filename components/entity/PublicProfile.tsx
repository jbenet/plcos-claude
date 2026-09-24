import { shortDate } from '@/lib/time';
import { claimLabel, claimsFor, getSourceDoc, notesFor, type Claim } from '@/modules/research';

/**
 * What public sources say about an LP (N64, docs/19): the enrichment research, mapped in by the
 * import. Every line rests on a page someone can open, with how sure the reading is, and nobody
 * on the team has verified any of it until someone does (rule 9). The paths are candidates: a C
 * or D path is a clue for a person to check before it routes anything (rule 6). And it says what
 * was searched, and what wasn't found — an empty section is not "nothing exists" (rule 7).
 */

interface Profile {
  identity?: { match: string; basis: string; links?: Array<{ kind: string; url: string }> };
  profile?: {
    summary: string; investorType: string; howTheyInvest?: string; interests?: string[];
    capacity?: { band: string; basis: string }; signals?: Array<{ what: string; on?: string | null; source?: string | null }>; cautions?: string[];
  } | null;
  researched?: { at: string; by: string; method?: 'search' | 'pages' };
  coverage?: { searched?: string[]; notFound?: string[]; note?: string } | null;
}
interface PathView { other: { type: string; name: string }; kind: string; tier: 'A' | 'B' | 'C' | 'D'; basis: string; source?: string | null }

const TYPE_LABEL: Record<string, string> = {
  angel: 'Angel investor', fo_principal: 'Family office principal', fo_staff: 'Family office staff', fund_gp: 'Runs a fund',
  fund_lp_program: 'Backs other funds', foundation: 'Foundation', corporate: 'Corporate', operator: 'Operator or founder',
  institutional: 'Institutional allocator', advisor: 'Adviser', unknown: 'Not clear',
};
const MATCH_LABEL: Record<string, string> = {
  confirmed: 'Identity confirmed', probable: 'Identity probable', ambiguous: 'Identity not resolved', not_found: 'Not found in public sources',
};
const TIER_MEANS: Record<string, string> = {
  A: 'our own record of an interaction', B: 'a documented association', C: 'a shared affiliation, no evidence they spoke', D: 'proximity only',
};

const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

export async function PublicProfile({ entityId }: { entityId: string }) {
  const [notes, claims] = await Promise.all([notesFor(entityId), claimsFor(entityId)]);
  const note = notes.find((n) => n.kind === 'public_profile');
  const pathsNote = notes.find((n) => n.kind === 'connection_candidates');
  const facts = claims.filter((c) => c.field.startsWith('public.'));
  if (!note && !pathsNote) return null;
  const docs = new Map((await Promise.all([...new Set(facts.map((c) => c.provenance.source))].map(getSourceDoc))).filter(Boolean).map((x) => [x!.docId, x!]));
  const d = (note?.data ?? {}) as Profile;
  const p = d.profile ?? null;
  const paths = ((pathsNote?.data ?? {}) as { paths?: PathView[] }).paths ?? [];
  const byField = new Map<string, Claim[]>();
  for (const c of facts) byField.set(c.field, [...(byField.get(c.field) ?? []), c]);
  const unresolved = d.identity && (d.identity.match === 'ambiguous' || d.identity.match === 'not_found');

  return (
    <div className="card pubprof">
      <div className="chead">
        <h2>From public sources</h2>
        <span className="lbl">{d.researched ? `read ${shortDate(new Date(d.researched.at))}` : 'our records'} · not verified by the team</span>
      </div>
      <div className="cbody">
        {d.identity && (
          <p className={`pp-id ${unresolved ? 'warnish' : ''}`}>
            <b>{MATCH_LABEL[d.identity.match] ?? d.identity.match}.</b> {d.identity.basis}
            {(d.identity.links ?? []).length > 0 && (
              <span className="pp-links"> {d.identity.links!.slice(0, 4).map((l) => <a key={l.url} href={l.url} target="_blank" rel="noreferrer">{l.kind}</a>)}</span>
            )}
          </p>
        )}
        {p && !unresolved && (
          <>
            <p className="pp-sum">{p.summary}</p>
            <div className="fact"><span>How they invest</span><span>{TYPE_LABEL[p.investorType] ?? p.investorType}{p.howTheyInvest ? ` — ${p.howTheyInvest}` : ''}</span></div>
            {(p.interests ?? []).length > 0 && (
              <div className="fact"><span>What they care about</span><span>{p.interests!.join(' · ')}</span></div>
            )}
            {p.capacity && (
              <div className="fact"><span>Capacity</span><span>{p.capacity.band === 'unknown' ? 'Not known' : `${p.capacity.band}, an estimate`}<span className="muted"> — {p.capacity.basis}</span></span></div>
            )}
            {(p.signals ?? []).map((s, i) => (
              <div className="fact" key={`s${i}`}><span>Signal</span><span>{s.what}{s.on ? ` (${s.on})` : ''}</span></div>
            ))}
            {(p.cautions ?? []).map((c, i) => <p className="warnline pp-caution" key={`c${i}`}>{c}</p>)}
          </>
        )}

        {byField.size > 0 && (
          <details className="more" style={{ marginTop: 10 }}>
            <summary>{facts.length} {facts.length === 1 ? 'fact' : 'facts'}, each with its source</summary>
            {[...byField.entries()].map(([field, cs]) => cs.map((c) => (
              <div className="pp-fact" key={c.claimId}>
                <span className="lbl">{claimLabel(field).replace(' (public source)', '')}</span>
                <span>
                  {c.value}{' '}
                  {docs.get(c.provenance.source) ? (
                    <a className="src" href={docs.get(c.provenance.source)!.origin} target="_blank" rel="noreferrer"
                      title={`${docs.get(c.provenance.source)!.title} · as of ${shortDate(c.provenance.asOf)} · ${c.provenance.confidence} confidence · ${docs.get(c.provenance.source)!.strength} source · unverified`}>
                      {host(docs.get(c.provenance.source)!.origin)} · {c.provenance.confidence}
                    </a>
                  ) : <span className="src">{c.provenance.confidence}</span>}
                </span>
              </div>
            )))}
          </details>
        )}

        {paths.length > 0 && (
          <div className="pp-paths">
            <div className="lbl" style={{ marginTop: 12 }}>Near us · {paths.length} {paths.length === 1 ? 'path' : 'paths'}</div>
            {paths.slice(0, 8).map((x, i) => (
              <div className="pp-path" key={i}>
                <span className={`tier t${x.tier}`} title={TIER_MEANS[x.tier]}>{x.tier}</span>
                <span><b>{x.other.name}</b> <span className="muted">— {x.basis}</span>{(x.tier === 'C' || x.tier === 'D') && <span className="needs"> · needs a person to check</span>}</span>
              </div>
            ))}
            {paths.length > 8 && <p className="muted" style={{ fontSize: 12 }}>{paths.length - 8} more.</p>}
          </div>
        )}
      </div>
      <p className="cover">
        <b>What this covers:</b> {d.researched ? `public pages read on ${shortDate(new Date(d.researched.at))} by ${d.researched.by}` : 'our own records only'}
        {d.coverage?.searched?.length ? `, searching ${d.coverage.searched.join(', ')}` : ''}.
        {d.researched?.method === 'pages' && <> From page reads only, with no web search: a search pass is still owed, and &ldquo;not found&rdquo; here means not named in the pages read.</>}
        {d.coverage?.notFound?.length ? <> Not found: {d.coverage.notFound.join('; ')} — not found in what was searched, which is not the same as not there.</> : null}
        {' '}Nothing here was sent or posted anywhere; nobody on the team has verified it yet.
      </p>
    </div>
  );
}
