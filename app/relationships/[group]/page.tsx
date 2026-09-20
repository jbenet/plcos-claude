import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/shell/Page';
import { usdM } from '@/lib/money';
import { relationshipRoles, ROLE_LABEL, type RelationshipRole } from '@/modules/identity';
import { RUNG_LABEL, type LadderRung } from '@/modules/strategy';

export const dynamic = 'force-dynamic';

const GROUPS: Record<string, { title: string; lede: string; keep: (roles: RelationshipRole[]) => boolean; note: string }> = {
  lps: {
    title: 'LPs',
    lede: 'Everyone with money on file, across every vehicle. Derived from the exposure table rather than a field somebody maintains.',
    keep: (roles) => roles.includes('lp'),
    note: 'Being an LP here means a hard commitment exists. Someone on the soft track is a prospect until the MONEY ticket is approved.',
  },
  'co-funders': {
    title: 'Co-funders',
    lede: 'Co-investors and grant funders — the people who show up beside us rather than behind us.',
    keep: (roles) => roles.includes('co_funder') || roles.includes('funder'),
    note: 'Derived from coinvestor edges and the grants rail. A co-investment recorded only in a CSV nobody can vouch for still shows, and the edge tier says so.',
  },
  all: {
    title: 'All relationships',
    lede: 'The whole universe, with what each person is to us worked out from what has actually happened.',
    keep: () => true,
    note: 'Nobody types a role in. An LP is an LP because money is on file; a connector is a connector because asks have gone through them.',
  },
};

const ROLE_FLAG: Record<RelationshipRole, string> = {
  lp: 'f-ok', co_funder: 'f-ev', connector: 'f-mute',
  funder: 'f-ev', prospect: 'f-mute', team: 'f-mute',
};

export default async function Relationships({ params }: { params: Promise<{ group: string }> }) {
  const { group } = await params;
  const spec = GROUPS[group];
  if (!spec) notFound();

  const all = await relationshipRoles();
  const rows = all.filter((r) => !r.roles.includes('team') && spec.keep(r.roles));
  const tally = (role: RelationshipRole) => all.filter((r) => r.roles.includes(role)).length;

  return (
    <Page
      crumbs={[{ label: 'Relationships' }, { label: spec.title }]}
      inspector={
        <>
          <div className="lbl">Roles, derived</div>
          <div className="ihead">What someone is to us</div>
          <div className="imeta">Worked out from the record, never declared</div>
          {(['lp', 'co_funder', 'connector', 'funder', 'prospect'] as RelationshipRole[]).map((role) => (
            <div className="kv" key={role}>
              <span>{ROLE_LABEL[role]}</span>
              <span>{tally(role)}</span>
            </div>
          ))}
          <div className="scope">
            <div className="lbl">Why derived</div>
            <p>
              A role field is a second copy of the truth, and the second copy is the one that goes
              stale. These are computed from exposure, asks, edges and the grants rail, so they
              cannot disagree with what happened.
            </p>
          </div>
          <div className="note">{spec.note}</div>
        </>
      }
    >
      <div className="lbl">Relationships</div>
      <h1>{spec.title}</h1>
      <p className="sublede">{spec.lede}</p>

      <div className="card">
        <div className="chead">
          <h2>{rows.length} {rows.length === 1 ? 'relationship' : 'relationships'}</h2>
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
          <table className="list">
            <thead>
              <tr>
                <th>Who</th>
                <th style={{ width: 210 }}>Is to us</th>
                <th style={{ width: 110 }} className="right">Hard</th>
                <th style={{ width: 110 }} className="right">Soft</th>
                <th style={{ width: 190 }}>Where</th>
                <th style={{ width: 160 }}>Ladder</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.entityId} className="clickable">
                  <td>
                    <Link href={`/research/${r.entityId}`}>
                      <b>{r.name}</b>
                    </Link>
                    <div className="muted" style={{ fontSize: 11.5 }}>{r.entityType}</div>
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
                    {r.vehicles.length ? r.vehicles.join(', ') : '—'}
                  </td>
                  <td className="muted" style={{ fontSize: 11.5 }}>
                    {r.rung ? RUNG_LABEL[r.rung as LadderRung] : '—'}
                    {r.connectorAsks > 0 && (
                      <div style={{ fontSize: 11 }}>{r.connectorAsks} asks carried</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="cover">
          <b>What this covers:</b> entities recorded in this system. Someone nobody has written
          down is not in it, which is a gap in the record rather than an absence of a relationship.
        </p>
      </div>
    </Page>
  );
}
