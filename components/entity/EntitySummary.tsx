import Link from '@/components/ui/AppLink';
import { usdM } from '@/lib/money';
import { shortDate } from '@/lib/time';
import { getEntity } from '@/modules/identity';
import { AFFIL_LABEL, ROLE_LABEL, orgsFor, peopleAt, relationshipRoles, type RelationshipRole } from '@/modules/identity';
import { listExposures } from '@/modules/pipeline';
import { listEdges, TIER_MEANING } from '@/modules/network';
import { restrictionsFor } from '@/modules/coordination';
import { assessmentsForEntity, BLOCKER_LABEL } from '@/modules/fit';
import { claimsFor, listSourceDocs } from '@/modules/research';
import { listPursuits, RUNG_LABEL, STATUS_LABEL } from '@/modules/strategy';

const TYPE_LABEL: Record<string, string> = {
  person: 'Person', org: 'Organisation', family: 'Family office',
  foundation: 'Foundation', vehicle: 'Vehicle',
};

const ROLE_FLAG: Record<RelationshipRole, string> = {
  lp: 'f-ok', co_funder: 'f-ev', connector: 'f-mute',
  funder: 'f-ev', prospect: 'f-mute', team: 'f-mute',
};

/**
 * The right-pane summary for one entity.
 *
 * It answers "who is this and where do we stand" without leaving the list, and it is the
 * same component on every screen so the answer cannot differ between them. Money is shown
 * per vehicle and never added up — there is no line in here that sums across vehicles or
 * blends soft into hard.
 */
export async function EntitySummary({ entityId }: { entityId: string }) {
  const entity = await getEntity(entityId);
  if (!entity) {
    return (
      <>
        <div className="lbl">Not found</div>
        <div className="ihead">No such record</div>
        <p className="muted">
          That identifier is not in this system. A name somebody mentioned is not an entity
          until somebody writes it down.
        </p>
      </>
    );
  }

  const [roles, exposures, edges, restrictions, fit, claims, docs, pursuits] = await Promise.all([
    relationshipRoles(),
    listExposures(null),
    listEdges(),
    restrictionsFor(entityId),
    assessmentsForEntity(entityId),
    claimsFor(entityId),
    listSourceDocs(),
    listPursuits(null),
  ]);
  const [sits, staff] = await Promise.all([
    entity.entityType === 'person' ? orgsFor(entityId) : Promise.resolve([]),
    entity.entityType === 'person' ? Promise.resolve([]) : peopleAt(entityId),
  ]);

  const row = roles.find((r) => r.entityId === entityId) ?? null;
  const mine = exposures.filter((x) => x.entityId === entityId);
  const ties = edges
    .filter((e) => e.fromEntity === entityId || e.toEntity === entityId)
    .slice(0, 6);
  const theirs = pursuits.filter((p) => p.entityId === entityId);
  const sources = [...new Set(claims.map((c) => c.provenance.source))]
    .map((id) => docs.find((d) => d.docId === id))
    .filter((d): d is NonNullable<typeof d> => Boolean(d));

  return (
    <>
      <div className="lbl">Summary</div>
      <div className="ihead">{entity.displayName}</div>
      <div className="imeta">
        {TYPE_LABEL[entity.entityType] ?? entity.entityType}
        {row && row.roles.length > 0 && ' · '}
        {row?.roles.map((r) => (
          <span key={r} className={`flag ${ROLE_FLAG[r]}`} style={{ marginRight: 4 }}>
            {ROLE_LABEL[r]}
          </span>
        ))}
      </div>

      <div className="acts" style={{ margin: '12px 0 4px' }}>
        <Link className="btn p" href={`/orgs/${entityId}`}>Open their page</Link>
        {fit.length > 0 && (
          <Link className="btn" href={`/${fit[0]!.vehicleSlug}/fit/${entityId}`}>Fit</Link>
        )}
      </div>

      {restrictions.length > 0 && (
        <div className="warn" style={{ marginTop: 14 }}>
          <div className="lbl" style={{ color: 'var(--clay)' }}>Restriction on file</div>
          {restrictions.map((r) => (
            <p key={r.restrictionId}>{r.instruction}</p>
          ))}
          <p style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            It attaches to them, not to one route. Every candidate path is checked against it.
          </p>
        </div>
      )}

      {sits.length > 0 && (
        <>
          <div className="lbl" style={{ marginTop: 16 }}>Acts for</div>
          {sits.map((a) => (
            <Link className="prov" href={`/orgs/${a.orgId}`} key={a.affiliationId}>
              <div className="p1">{a.orgName}{a.current ? '' : ' (former)'}</div>
              <div className="p2">{AFFIL_LABEL[a.kind]} · {a.role}</div>
            </Link>
          ))}
          {sits.length > 1 && (
            <div className="note">
              More than one, which is normal. An ask lands on a person; the mandate and the
              restriction land on an institution.
            </div>
          )}
        </>
      )}

      {staff.filter((a) => a.current).length > 0 && (
        <>
          <div className="lbl" style={{ marginTop: 16 }}>Who acts for them</div>
          {staff.filter((a) => a.current).map((a) => (
            <Link className="prov" href={`/orgs/${a.personId}`} key={a.affiliationId}>
              <div className="p1">{a.personName}</div>
              <div className="p2">{AFFIL_LABEL[a.kind]} · {a.role}</div>
            </Link>
          ))}
        </>
      )}

      {mine.length > 0 && (
        <>
          <div className="lbl" style={{ marginTop: 16 }}>Money on file, per vehicle</div>
          {mine.map((x) => (
            <div className="kv" key={x.exposureId}>
              <span>{x.vehicleName}</span>
              <span className="mono" style={{ color: x.track === 'hard' ? 'var(--green)' : undefined }}>
                {usdM(x.amount)} {x.track}
              </span>
            </div>
          ))}
          <div className="note">
            Listed, never added. There is no line in this system that sums these.
          </div>
        </>
      )}

      {theirs.length > 0 && (
        <>
          <div className="lbl" style={{ marginTop: 16 }}>Where the conversation is</div>
          {theirs.map((p) => (
            <div className="kv" key={p.pursuitId}>
              <span>{p.vehicleName}</span>
              <span>{STATUS_LABEL[p.status]}{p.rung ? <span className="muted"> · {RUNG_LABEL[p.rung]} on the ladder</span> : null}</span>
            </div>
          ))}
        </>
      )}

      {fit.length > 0 && (
        <>
          <div className="lbl" style={{ marginTop: 16 }}>What is in the way</div>
          {fit.map((f) => (
            <Link className="prov" href={`/${f.vehicleSlug}/fit/${entityId}`} key={f.assessmentId}>
              <div className="p1">{f.vehicleName}</div>
              <div className="p2">
                {BLOCKER_LABEL[f.diagnosis.blocker]} · fit {f.weightedFit.toFixed(2)} ·{' '}
                {Math.round(f.evidenceCover * 100)}% known
              </div>
            </Link>
          ))}
        </>
      )}

      {ties.length > 0 && (
        <>
          <div className="lbl" style={{ marginTop: 16 }}>Ties on file</div>
          {ties.map((e) => (
            <div className="kv" key={e.edgeId}>
              <span>
                {e.fromEntity === entityId ? e.toName : e.fromName}
                <span className={`tier t${e.tier}`} style={{ marginLeft: 6 }}>{e.tier}</span>
              </span>
              <span className="muted" style={{ fontSize: 11 }}>{e.kind.replace(/_/g, ' ')}</span>
            </div>
          ))}
          <div className="note">
            Tiers C and D are discovery clues. {TIER_MEANING.C.routable}
          </div>
        </>
      )}

      {sources.length > 0 && (
        <>
          <div className="lbl" style={{ marginTop: 16 }}>What we know rests on</div>
          {sources.map((d) => (
            <Link className="prov" href={`/research/sources#${d.docId}`} key={d.docId}>
              <div className="p1">{d.docId} · {d.title}</div>
              <div className="p2">
                {d.origin} · {shortDate(d.asOf)} · {d.strength} evidence
              </div>
            </Link>
          ))}
        </>
      )}

      <div className="scope">
        <div className="lbl">Asking about this record</div>
        <p>
          The agent runtime can draft against this entity once a prompt has passed the
          protected set. It has not, so <Link href="/agents">Agents</Link> shows the envelope,
          the eval cases and the refusal rather than a chat box that would answer from nothing.
        </p>
      </div>
    </>
  );
}
