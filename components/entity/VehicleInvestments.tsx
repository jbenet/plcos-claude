import { config } from '@/config/deployment';
import { shortDate } from '@/lib/time';
import { claimLabel, claimsFor, listSourceDocs, notesFor } from '@/lib/authz/read/research';
import { mentions, strategicScope } from '@/modules/strategy';

/**
 * Investments relevant to this vehicle (Juan, 8 Oct 2026: "just flag it in their vehicle-LP page, -- we should
 * list investments relevant to the vehicle"). The LP's public portfolio facts and roles whose words fall in the
 * vehicle's field (config.strategic.domains, the same words as strategic value, issue 0120), and for an SPV the
 * ones naming its company. A holding in another company in an SPV's field is flagged as a possible competitor:
 * a flag for the person writing to them, never a block (Juan: competing holders "can be fine").
 */

const PORTFOLIO = ['public.investment', 'public.fund_gp', 'public.fund_lp', 'public.exit', 'public.spv'];
const OPERATING = ['public.role', 'public.prior_role', 'public.board'];

const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

export async function VehicleInvestments({ entityId, vehicle }: { entityId: string; vehicle: { slug: string; name: string; kind: string } }) {
  const scope = strategicScope(vehicle, config.strategic.domains);
  if (!scope.terms.length && !scope.company) return null;
  const [claims, notes] = await Promise.all([claimsFor(entityId), notesFor(entityId)]);
  const facts = claims.filter((c) => PORTFOLIO.includes(c.field) || OPERATING.includes(c.field));
  const companyTerms = scope.company ? [scope.company] : [];
  const rows = facts.map((c) => {
    const own = companyTerms.length ? mentions(c.value, companyTerms) : null;
    const field = own ? null : mentions(c.value, scope.terms);
    return { c, own, field, portfolio: PORTFOLIO.includes(c.field) };
  }).filter((r) => r.own || r.field);
  // Portfolio ties the research recorded as connections (a portfolio company), when their name is in the field.
  const profile = notes.find((n) => n.kind === 'public_profile');
  const ties = (((profile?.data ?? {}) as { connections?: Array<{ to: string; kind: string; basis: string }> }).connections ?? [])
    .filter((t) => t.kind === 'portfolio' && (mentions(`${t.to} ${t.basis}`, [...companyTerms, ...scope.terms])))
    .filter((t) => !rows.some((r) => r.c.value.toLowerCase().includes(t.to.toLowerCase())));
  const read = facts.filter((c) => PORTFOLIO.includes(c.field)).length;
  if (!facts.length && !ties.length) return null;
  const docs = new Map((await listSourceDocs([...new Set(rows.map((r) => r.c.provenance.source))])).map((d) => [d.docId, d]));
  const field = scope.label ?? 'this field';
  const competitor = vehicle.kind === 'spv' && scope.company;

  return (
    <div className="card pubprof">
      <div className="chead">
        <h2>Relevant investments</h2>
        <span className="lbl">for {vehicle.name} · public sources, unverified</span>
      </div>
      <div className="cbody">
        {rows.length === 0 && ties.length === 0 && (
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
            None of their {read} public portfolio {read === 1 ? 'fact' : 'facts'} or roles {scope.company ? `name ${scope.company} or ` : ''}fall in {field}.
            Not found in what was read is not the same as none.
          </p>
        )}
        {rows.map(({ c, own, portfolio }) => {
          const doc = docs.get(c.provenance.source);
          const note = own ? `names ${scope.company}` : competitor && portfolio ? `in ${field}: a possible competitor to ${scope.company}, worth knowing before the ask` : portfolio ? `has backed ${field}` : `works in ${field}`;
          return (
            <div className="pp-fact" key={c.claimId}>
              <span className="lbl">{claimLabel(c.field).replace(' (public source)', '')}</span>
              <span>
                {c.value}{' '}
                <span className={own || !competitor || !portfolio ? 'muted' : 'needs'}>· {note}</span>{' '}
                {doc ? (
                  <a className="src" href={doc.origin} target="_blank" rel="noreferrer"
                    title={`${doc.title} · as of ${shortDate(c.provenance.asOf)} · ${c.provenance.confidence} confidence · unverified`}>
                    {host(doc.origin)} · {c.provenance.confidence}
                  </a>
                ) : <span className="src">{c.provenance.confidence}</span>}
              </span>
            </div>
          );
        })}
        {ties.map((t, i) => (
          <div className="pp-fact" key={`t${i}`}>
            <span className="lbl">Portfolio tie</span>
            <span>{t.to} <span className="muted">— {t.basis}</span></span>
          </div>
        ))}
      </div>
      <p className="cover">
        <b>What this covers:</b> their public portfolio facts and roles, read for {scope.company ? `${scope.company} and ` : ''}{scope.terms.length ? `the ${field} words (${scope.terms.map((t) => t.replace(/\*$/, '…')).join(', ')})` : 'nothing else'}.
        A company whose name doesn&rsquo;t use those words is missed. {competitor ? 'A competing holding is a flag, not a reason to skip them.' : ''}
      </p>
    </div>
  );
}
