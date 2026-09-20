import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/shell/Page';
import { EntityLink } from '@/components/entity/EntityLink';
import { EntitySummary } from '@/components/entity/EntitySummary';
import { usdM } from '@/lib/money';
import {
  AFFIL_LABEL, listAffiliations, relationshipRoles, ROLE_LABEL, type RelationshipRole,
} from '@/modules/identity';
import { RUNG_LABEL, type LadderRung } from '@/modules/strategy';
import { listAssessments, BLOCKER_SHORT, type Blocker } from '@/modules/fit';

export const dynamic = 'force-dynamic';

interface Row { roles: RelationshipRole[]; entityType: string }

const GROUPS: Record<string, {
  title: string; lede: string; keep: (r: Row) => boolean; note: string;
}> = {
  people: {
    title: 'People',
    lede: 'Everyone who is a person rather than an institution — principals, the people who decide, our counterparts, and the connectors who carry asks.',
    keep: (r) => r.entityType === 'person',
    note: 'An ask lands on a person. The mandate, the cheque band and the do-not-approach instruction land on an institution. The two are separate records here for exactly that reason.',
  },
  firms: {
    title: 'Firms & institutions',
    lede: 'Funds, family offices, foundations and endowments — the records that hold a mandate, a cheque band and a restriction.',
    keep: (r) => r.entityType !== 'person',
    note: 'A firm is assessed; a person is approached. The funder–vehicle fit reading sits on the institution, which is why a principal can show "not assessed" while their foundation is.',
  },
  lps: {
    title: 'LPs',
    lede: 'Everyone with money on file, across every vehicle. Derived from the exposure table rather than a field somebody maintains.',
    keep: (r) => r.roles.includes('lp'),
    note: 'Being an LP here means a hard commitment exists. Someone on the soft track is a prospect until the MONEY ticket is approved.',
  },
  'co-funders': {
    title: 'Co-funders',
    lede: 'Co-investors and grant funders — the people who show up beside us rather than behind us.',
    keep: (r) => r.roles.includes('co_funder') || r.roles.includes('funder'),
    note: 'Derived from coinvestor edges and the grants rail. A co-investment recorded only in a CSV nobody can vouch for still shows, and the edge tier says so.',
  },
  connectors: {
    title: 'Connectors',
    lede: 'The people who have actually carried an ask. Goodwill is finite and spent per person, not per vehicle.',
    keep: (r) => r.roles.includes('connector'),
    note: 'A connector is a connector because asks have gone through them. Willingness to ask is the first rung of the consent ladder and nothing more.',
  },
  all: {
    title: 'Everyone',
    lede: 'The whole universe, with what each person is to us worked out from what has actually happened.',
    keep: () => true,
    note: 'Nobody types a role in. An LP is an LP because money is on file; a connector is a connector because asks have gone through them.',
  },
};

const ORDER = ['all', 'people', 'firms', 'lps', 'co-funders', 'connectors'];

const ROLE_FLAG: Record<RelationshipRole, string> = {
  lp: 'f-ok', co_funder: 'f-ev', connector: 'f-mute',
  funder: 'f-ev', prospect: 'f-mute', team: 'f-mute',
};

const BLOCKER_FLAG: Record<Blocker, string> = {
  gated: 'f-block', conviction: 'f-ev', access: 'f-ev', evidence: 'f-ev',
  fit: 'f-ev', timing: 'f-mute', awareness: 'f-mute', none: 'f-ok',
};

export default async function Orgs({
  params, searchParams,
}: {
  params: Promise<{ group: string }>;
  searchParams: Promise<{ e?: string }>;
}) {
  const { group } = await params;
  const { e } = await searchParams;
  const spec = GROUPS[group];
  if (!spec) notFound();

  const [all, fit, affiliations] = await Promise.all([
    relationshipRoles(), listAssessments(null), listAffiliations(),
  ]);
  const rows = all.filter((r) => !r.roles.includes('team') && spec.keep(r));
  const tally = (role: RelationshipRole) => all.filter((r) => r.roles.includes(role)).length;
  const peopleCount = all.filter((r) => !r.roles.includes('team') && r.entityType === 'person').length;
  const firmCount = all.filter((r) => !r.roles.includes('team') && r.entityType !== 'person').length;

  return (
    <Page
      crumbs={[{ label: 'Orgs & people' }, { label: spec.title }]}
      inspector={
        e ? (
          <EntitySummary entityId={e} />
        ) : (
          <>
            <div className="lbl">Roles, derived</div>
            <div className="ihead">What someone is to us</div>
            <div className="imeta">Worked out from the record, never declared</div>
            <div className="kv"><span>People</span><span>{peopleCount}</span></div>
            <div className="kv"><span>Firms &amp; institutions</span><span>{firmCount}</span></div>
            {(['lp', 'co_funder', 'connector', 'funder', 'prospect'] as RelationshipRole[]).map((role) => (
              <div className="kv" key={role}>
                <span>{ROLE_LABEL[role]}</span>
                <span>{tally(role)}</span>
              </div>
            ))}
            <div className="scope">
              <div className="lbl">Click a name</div>
              <p>
                The name opens a summary here — money per vehicle, where the conversation is, what
                is in the way, and the ties on file. The arrow beside it opens their page. Two
                affordances, because &ldquo;remind me who this is&rdquo; and &ldquo;take me to
                their record&rdquo; are different intentions.
              </p>
            </div>
            <div className="note">{spec.note}</div>
          </>
        )
      }
    >
      <div className="lbl">Orgs &amp; people</div>
      <h1>{spec.title}</h1>
      <p className="sublede">{spec.lede}</p>

      <div className="sorter" style={{ paddingBottom: 14 }}>
        {ORDER.map((g) => (
          <Link key={g} className={g === group ? 'on' : ''} href={`/orgs/g/${g}`}>
            {GROUPS[g]!.title}
          </Link>
        ))}
      </div>

      <div className="card">
        <div className="chead">
          <h2>{rows.length} {rows.length === 1 ? 'record' : 'records'}</h2>
          <span className="lbl">hard money shown per actor, never summed across vehicles</span>
        </div>
        {rows.length === 0 ? (
          <div className="cbody">
            <div className="empty">
              <span className="stat unavailable">
                <i />
                Nobody yet
              </span>
              <h3>Nobody in the universe qualifies for this group.</h3>
              <p>
                That is a statement about what has been recorded, not about who exists. Roles are
                derived, so this list fills as things actually happen.
              </p>
            </div>
          </div>
        ) : (
          <table className="list orgs">
            <thead>
              <tr>
                <th style={{ width: 218 }}>Who</th>
                <th style={{ width: 158 }}>Is to us</th>
                <th style={{ width: 88 }} className="right">Hard</th>
                <th style={{ width: 88 }} className="right">Soft</th>
                <th style={{ width: 142 }}>Ladder</th>
                <th>What is in the way</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const theirs = fit.filter((f) => f.entityId === r.entityId);
                return (
                  <tr key={r.entityId} className={e === r.entityId ? 'sel' : undefined}>
                    <td>
                      <EntityLink id={r.entityId} name={r.name} />
                      <div className="muted" style={{ fontSize: 11.5 }}>
                        {r.entityType}
                        {r.vehicles.length > 0 ? ` · ${r.vehicles.join(', ')}` : ''}
                      </div>
                      {(() => {
                        const acts = affiliations.filter(
                          (a) => a.personId === r.entityId && a.current,
                        );
                        const staff = affiliations.filter(
                          (a) => a.orgId === r.entityId && a.current,
                        );
                        if (acts.length > 0) {
                          return (
                            <div className="affline">
                              {acts.map((a, i) => (
                                <span key={a.affiliationId}>
                                  {i > 0 && ' · '}
                                  {AFFIL_LABEL[a.kind].toLowerCase()} at{' '}
                                  <Link href={`/orgs/${a.orgId}`}>{a.orgName}</Link>
                                </span>
                              ))}
                            </div>
                          );
                        }
                        if (staff.length > 0) {
                          return (
                            <div className="affline">
                              {staff.length} {staff.length === 1 ? 'person' : 'people'} on file
                            </div>
                          );
                        }
                        return <div className="affline dim">nobody on file</div>;
                      })()}
                    </td>
                    <td>
                      {r.roles.map((role) => (
                        <span key={role} className={`flag ${ROLE_FLAG[role]}`} style={{ marginRight: 4 }}>
                          {ROLE_LABEL[role]}
                        </span>
                      ))}
                    </td>
                    <td className="right mono" style={{ color: r.hard > 0 ? 'var(--green)' : undefined }}>
                      {r.hard > 0 ? usdM(r.hard) : '—'}
                    </td>
                    <td className="right mono muted">{r.soft > 0 ? usdM(r.soft) : '—'}</td>
                    <td className="muted" style={{ fontSize: 11.5 }}>
                      {r.rung ? RUNG_LABEL[r.rung as LadderRung] : '—'}
                      {r.connectorAsks > 0 && (
                        <div style={{ fontSize: 11 }}>{r.connectorAsks} asks carried</div>
                      )}
                    </td>
                    <td>
                      {theirs.length === 0 ? (
                        <span className="muted" style={{ fontSize: 11.5 }}>Not assessed</span>
                      ) : (
                        theirs.map((f) => (
                          <div key={f.assessmentId} style={{ marginBottom: 3 }}>
                            <Link href={`/${f.vehicleSlug}/fit/${r.entityId}`}>
                              <span className={`flag ${BLOCKER_FLAG[f.diagnosis.blocker]}`}>
                                {BLOCKER_SHORT[f.diagnosis.blocker]}
                              </span>
                            </Link>
                            {theirs.length > 1 && (
                              <div className="muted" style={{ fontSize: 10.5 }}>{f.vehicleName}</div>
                            )}
                          </div>
                        ))
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="cover">
          <b>What this covers:</b> entities recorded in this system. Someone nobody has written
          down is not in it, which is a gap in the record rather than an absence of a relationship.
          <b> Not assessed</b> means nobody has done the work, not that the firm is unsuitable.
        </p>
      </div>
    </Page>
  );
}
