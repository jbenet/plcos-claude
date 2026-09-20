import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/shell/Page';
import { EvidenceRef, type EvidenceDoc } from '@/components/ui/EvidenceRef';
import { ConfidenceWord, ProvenanceLine } from '@/components/ui/Provenance';
import { Coverage } from '@/components/ui/Coverage';
import { getEntity } from '@/modules/identity';
import { claimsFor, listSourceDocs, notesFor, corpusCoverage } from '@/modules/research';
import { assessmentsForEntity, listAssessments, BLOCKER_LABEL } from '@/modules/fit';
import { listSyncSources } from '@/modules/platform';
import { listExposures } from '@/modules/pipeline';
import { listPursuits, RUNG_LABEL, RUNGS, rungIndex } from '@/modules/strategy';
import { listEdges, TIER_MEANING } from '@/modules/network';
import { restrictionsFor, listAsks } from '@/modules/coordination';
import { ROLE_LABEL, relationshipRoles, listAffiliations, orgsFor, peopleAt, type RelationshipRole } from '@/modules/identity';
import { OrgsFor, PeopleAt } from '@/components/entity/People';
import { EntityLink } from '@/components/entity/EntityLink';
import { usdM } from '@/lib/money';
import { shortDate } from '@/lib/time';

export const dynamic = 'force-dynamic';

const TYPE_LABEL: Record<string, string> = {
  person: 'Person', org: 'Organisation', family: 'Family office',
  foundation: 'Foundation', vehicle: 'Vehicle',
};

const ROLE_FLAG: Record<RelationshipRole, string> = {
  lp: 'f-ok', co_funder: 'f-ev', connector: 'f-mute',
  funder: 'f-ev', prospect: 'f-mute', team: 'f-mute',
};

const BLOCKER_FLAG: Record<string, string> = {
  gated: 'f-block', conviction: 'f-ev', access: 'f-ev', evidence: 'f-ev',
  fit: 'f-ev', timing: 'f-mute', awareness: 'f-mute', none: 'f-ok',
};

export default async function OrgPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entity = await getEntity(id);
  if (!entity) notFound();

  const [claims, docs, notes, coverage, sources, fit, exposures, pursuits, edges,
         restrictions, roles, asks] = await Promise.all([
    claimsFor(entity.entityId),
    listSourceDocs(),
    notesFor(entity.entityId),
    corpusCoverage(),
    listSyncSources(),
    assessmentsForEntity(entity.entityId),
    listExposures(null),
    listPursuits(null),
    listEdges(),
    restrictionsFor(entity.entityId),
    relationshipRoles(),
    listAsks(null),
  ]);
  const [allFit, people, sits, everyAffiliation] = await Promise.all([
    listAssessments(null),
    peopleAt(entity.entityId),
    orgsFor(entity.entityId),
    listAffiliations(),
  ]);
  const isPerson = entity.entityType === 'person';

  const mine = exposures.filter((x) => x.entityId === entity.entityId);
  const theirs = pursuits.filter((p) => p.entityId === entity.entityId);
  const ties = edges.filter((e) => e.fromEntity === entity.entityId || e.toEntity === entity.entityId);
  const role = roles.find((r) => r.entityId === entity.entityId) ?? null;
  /**
   * A person and the institution they sign for are separate records. When only one of them
   * is assessed, say so — otherwise the page reads as "nobody has looked at this", which is
   * a different and wronger thing.
   */
  const tied = new Set(ties.map((e) => (e.fromEntity === entity.entityId ? e.toEntity : e.fromEntity)));
  const nearby = allFit.filter((f) => tied.has(f.entityId));
  const askedOf = asks.filter((a) => a.entityId === entity.entityId);
  const carried = asks.filter((a) => a.connectorId === entity.entityId);

  /** One row per vehicle this entity touches. Assembled, never added together. */
  const vehicleIds = [...new Set([
    ...mine.map((x) => x.vehicleId),
    ...theirs.map((p) => p.vehicleId),
    ...fit.map((f) => f.vehicleId),
  ])];
  const standing = vehicleIds.map((vid) => ({
    vehicleId: vid,
    vehicleName:
      mine.find((x) => x.vehicleId === vid)?.vehicleName
      ?? theirs.find((p) => p.vehicleId === vid)?.vehicleName
      ?? fit.find((f) => f.vehicleId === vid)!.vehicleName,
    exposures: mine.filter((x) => x.vehicleId === vid),
    pursuit: theirs.find((p) => p.vehicleId === vid) ?? null,
    assessment: fit.find((f) => f.vehicleId === vid) ?? null,
  }));

  const docMap = new Map<string, EvidenceDoc>(
    docs.map((d) => [
      d.docId,
      { docId: d.docId, title: d.title, origin: d.origin, asOf: shortDate(d.asOf), strength: d.strength, supports: d.supports },
    ]),
  );

  const questions = notes.filter((n) => n.kind === 'open_question');
  const summary = notes.find((n) => n.kind === 'summary');
  const colour = notes.filter((n) => n.kind === 'note');
  const weakest = claims
    .map((c) => docMap.get(c.provenance.source)?.strength)
    .filter((s): s is 'strong' | 'moderate' | 'weak' => Boolean(s));
  const restriction = claims.find((c) => c.field === 'Approach restriction');

  return (
    <Page
      crumbs={[
        { label: 'Orgs & people', href: '/orgs/g/all' },
        { label: entity.displayName },
      ]}
      inspector={
        <>
          <div className="lbl">Evidence standing</div>
          <div className="ihead">{entity.displayName}</div>
          <div className="imeta">
            {TYPE_LABEL[entity.entityType]} · {claims.length} supported field
            {claims.length === 1 ? '' : 's'}
          </div>

          <div className="kv">
            <span>Strong support</span>
            <span>{weakest.filter((s) => s === 'strong').length}</span>
          </div>
          <div className="kv">
            <span>Moderate</span>
            <span>{weakest.filter((s) => s === 'moderate').length}</span>
          </div>
          <div className="kv">
            <span>Weak — leads only</span>
            <span>{weakest.filter((s) => s === 'weak').length}</span>
          </div>
          <div className="kv">
            <span>Verified by a person</span>
            <span>{claims.filter((c) => c.provenance.lastVerifiedBy).length}</span>
          </div>

          {restriction && (
            <div className="warn" style={{ marginTop: 16 }}>
              <div className="lbl" style={{ color: 'var(--clay)' }}>
                Restriction on file
              </div>
              <p>{restriction.value}.</p>
              <p style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                The restriction attaches to the target, not to one edge. When route planning lands
                at L4, every candidate path is checked against it — substituting a different
                connector toward the same approach is the failure this prevents.
              </p>
            </div>
          )}

          {fit.length > 0 && (
            <>
              <div className="lbl" style={{ marginTop: 16 }}>Funder–vehicle fit</div>
              {fit.map((f) => (
                <Link className="prov" href={`/fit/${entity.entityId}`} key={f.assessmentId}>
                  <div className="p1">{f.vehicleName}</div>
                  <div className="p2">
                    {BLOCKER_LABEL[f.diagnosis.blocker]} · fit {f.weightedFit.toFixed(2)} ·{' '}
                    {Math.round(f.evidenceCover * 100)}% known
                  </div>
                </Link>
              ))}
              <div className="note">
                Assessed per vehicle, never blended. This dossier is what those readings were built
                from.
              </div>
            </>
          )}

          <div className="scope">
            <div className="lbl">Cache versus snapshot</div>
            <p>
              A cache exists for latency and has no persistence guarantee. A snapshot exists to
              explain a historical output and is explicitly not today&rsquo;s truth. This dossier
              reads neither — it reads claims.
            </p>
          </div>

          <div className="note">
            Nothing here is a score. Confidence is shown as a word, and the word says who stood
            behind it rather than how sure a model was.
          </div>
        </>
      }
    >
      <div className="lbl">
        {TYPE_LABEL[entity.entityType]}
        {role?.roles.map((r) => (
          <span key={r} className={`flag ${ROLE_FLAG[r]}`} style={{ marginLeft: 6 }}>
            {ROLE_LABEL[r]}
          </span>
        ))}
      </div>
      <h1 style={{ marginTop: 8 }}>{entity.displayName}</h1>
      <p className="sublede">{summary?.body ?? TYPE_LABEL[entity.entityType]}</p>

      {restrictions.length > 0 && (
        <div className="card" style={{ boxShadow: 'inset 3px 0 0 var(--clay)' }}>
          <div className="chead">
            <h2>Do not approach</h2>
            <span className="lbl">attaches to them, not to one route</span>
          </div>
          <div className="cbody">
            {restrictions.map((r) => (
              <div className="fact" key={r.restrictionId} style={{ display: 'block' }}>
                <div style={{ fontSize: 13, lineHeight: 1.5 }}>{r.instruction}</div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                  {r.scope}
                  {r.connectorName ? ` · ${r.connectorName}` : ''} ·{' '}
                  {r.recordedByName ?? 'unattributed'} · {shortDate(r.recordedAt)}
                </div>
              </div>
            ))}
          </div>
          <p className="cover">
            The route planner checks every candidate path against this. Substituting a different
            connector toward the same approach is the failure this exists to prevent.
          </p>
        </div>
      )}

      {isPerson ? (
        <>
          <OrgsFor affiliations={sits} personName={entity.displayName} />
      <div className="card">
        <div className="chead">
          <h2>Where we stand, per vehicle</h2>
          <span className="lbl">{standing.length} vehicle{standing.length === 1 ? '' : 's'} · never summed</span>
        </div>
        {standing.length === 0 ? (
          <div className="cbody">
            <div className="empty">
              <span className="stat unavailable"><i />No vehicle</span>
              <h3>Nothing connects {entity.displayName} to a vehicle yet.</h3>
              <p>
                No exposure, no pursuit, no fit assessment. They are in the record because someone
                wrote them down, and nothing has been decided about them.
              </p>
            </div>
          </div>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th style={{ width: 190 }}>Vehicle</th>
                <th style={{ width: 150 }}>Money on file</th>
                <th style={{ width: 190 }}>Consent ladder</th>
                <th>What is in the way</th>
              </tr>
            </thead>
            <tbody>
              {standing.map((s) => (
                <tr key={s.vehicleId}>
                  <td><b>{s.vehicleName}</b></td>
                  <td className="mono">
                    {s.exposures.length === 0 ? <span className="muted">—</span> : s.exposures.map((x) => (
                      <div key={x.exposureId} style={{ color: x.track === 'hard' ? 'var(--green)' : 'var(--muted)' }}>
                        {usdM(x.amount)} {x.track}
                      </div>
                    ))}
                  </td>
                  <td>
                    {s.pursuit
                      ? <>
                          {s.pursuit.rung ? RUNG_LABEL[s.pursuit.rung] : 'No rung evidenced'}
                          <div className="muted" style={{ fontSize: 11 }}>
                            {s.pursuit.rung
                              ? `${rungIndex(s.pursuit.rung) + 1} of ${RUNGS.length}`
                              : 'the first rung needs an evidence record'}
                          </div>
                        </>
                      : <span className="muted">No pursuit open</span>}
                  </td>
                  <td>
                    {s.assessment ? (
                      <>
                        <Link href={`/${s.assessment.vehicleSlug}/fit/${entity.entityId}`}>
                          <span className={`flag ${BLOCKER_FLAG[s.assessment.diagnosis.blocker]}`}>
                            {BLOCKER_LABEL[s.assessment.diagnosis.blocker]}
                          </span>
                        </Link>
                        <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                          {s.assessment.diagnosis.nextMove}
                        </div>
                      </>
                    ) : (
                      <span className="muted">Not assessed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {fit.length === 0 && nearby.length > 0 && (
          <p className="cover">
            <b>Assessed next door.</b> Nobody has assessed {entity.displayName} directly, but{' '}
            {nearby.map((f, i) => (
              <span key={f.assessmentId}>
                {i > 0 && ', '}
                <Link href={`/${f.vehicleSlug}/fit/${f.entityId}`}>{f.entityName}</Link> is,
                against {f.vehicleName}
              </span>
            ))}
            . A person and the institution they sign for are separate records on purpose — the
            money, the mandate and the restriction do not always attach to the same one.
          </p>
        )}
        <p className="cover">
          <b>One row per vehicle, and no total row.</b> Soft and hard are separate columns within a
          row and separate rows across vehicles. There is no figure anywhere in this system that
          adds them.
        </p>
      </div>

        </>
      ) : (
        <>
      <div className="card">
        <div className="chead">
          <h2>Where we stand, per vehicle</h2>
          <span className="lbl">{standing.length} vehicle{standing.length === 1 ? '' : 's'} · never summed</span>
        </div>
        {standing.length === 0 ? (
          <div className="cbody">
            <div className="empty">
              <span className="stat unavailable"><i />No vehicle</span>
              <h3>Nothing connects {entity.displayName} to a vehicle yet.</h3>
              <p>
                No exposure, no pursuit, no fit assessment. They are in the record because someone
                wrote them down, and nothing has been decided about them.
              </p>
            </div>
          </div>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th style={{ width: 190 }}>Vehicle</th>
                <th style={{ width: 150 }}>Money on file</th>
                <th style={{ width: 190 }}>Consent ladder</th>
                <th>What is in the way</th>
              </tr>
            </thead>
            <tbody>
              {standing.map((s) => (
                <tr key={s.vehicleId}>
                  <td><b>{s.vehicleName}</b></td>
                  <td className="mono">
                    {s.exposures.length === 0 ? <span className="muted">—</span> : s.exposures.map((x) => (
                      <div key={x.exposureId} style={{ color: x.track === 'hard' ? 'var(--green)' : 'var(--muted)' }}>
                        {usdM(x.amount)} {x.track}
                      </div>
                    ))}
                  </td>
                  <td>
                    {s.pursuit
                      ? <>
                          {s.pursuit.rung ? RUNG_LABEL[s.pursuit.rung] : 'No rung evidenced'}
                          <div className="muted" style={{ fontSize: 11 }}>
                            {s.pursuit.rung
                              ? `${rungIndex(s.pursuit.rung) + 1} of ${RUNGS.length}`
                              : 'the first rung needs an evidence record'}
                          </div>
                        </>
                      : <span className="muted">No pursuit open</span>}
                  </td>
                  <td>
                    {s.assessment ? (
                      <>
                        <Link href={`/${s.assessment.vehicleSlug}/fit/${entity.entityId}`}>
                          <span className={`flag ${BLOCKER_FLAG[s.assessment.diagnosis.blocker]}`}>
                            {BLOCKER_LABEL[s.assessment.diagnosis.blocker]}
                          </span>
                        </Link>
                        <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                          {s.assessment.diagnosis.nextMove}
                        </div>
                      </>
                    ) : (
                      <span className="muted">Not assessed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {fit.length === 0 && nearby.length > 0 && (
          <p className="cover">
            <b>Assessed next door.</b> Nobody has assessed {entity.displayName} directly, but{' '}
            {nearby.map((f, i) => (
              <span key={f.assessmentId}>
                {i > 0 && ', '}
                <Link href={`/${f.vehicleSlug}/fit/${f.entityId}`}>{f.entityName}</Link> is,
                against {f.vehicleName}
              </span>
            ))}
            . A person and the institution they sign for are separate records on purpose — the
            money, the mandate and the restriction do not always attach to the same one.
          </p>
        )}
        <p className="cover">
          <b>One row per vehicle, and no total row.</b> Soft and hard are separate columns within a
          row and separate rows across vehicles. There is no figure anywhere in this system that
          adds them.
        </p>
      </div>

          <PeopleAt people={people} orgName={entity.displayName} elsewhere={everyAffiliation} />
        </>
      )}

      {(ties.length > 0 || askedOf.length > 0 || carried.length > 0) && (
        <div className="card">
          <div className="chead">
            <h2>How we reach them, and what has been spent</h2>
            <span className="lbl">
              {ties.length} tie{ties.length === 1 ? '' : 's'} · {askedOf.length} ask
              {askedOf.length === 1 ? '' : 's'} made to them · {carried.length} carried by them
            </span>
          </div>
          {ties.length > 0 && (
            <table className="list">
              <thead>
                <tr>
                  <th style={{ width: 230 }}>With</th>
                  <th style={{ width: 150 }}>Kind</th>
                  <th style={{ width: 80 }}>Tier</th>
                  <th>What the tier is allowed to mean</th>
                </tr>
              </thead>
              <tbody>
                {ties.map((e) => {
                  const other = e.fromEntity === entity.entityId
                    ? { id: e.toEntity, name: e.toName }
                    : { id: e.fromEntity, name: e.fromName };
                  return (
                    <tr key={e.edgeId}>
                      <td><EntityLink id={other.id} name={other.name} /></td>
                      <td className="muted">{e.kind.replace(/_/g, ' ')}</td>
                      <td><span className={`tier t${e.tier}`}>{e.tier}</span></td>
                      <td className="muted">
                        {TIER_MEANING[e.tier].means} {TIER_MEANING[e.tier].routable}
                        {e.reviewedByName && (
                          <span className="mono" style={{ fontSize: 9.5, marginLeft: 6 }}>
                            reviewed by {e.reviewedByName}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="cover">
            <b>Tiers C and D are discovery clues, not relationships.</b> Co-attendance and a public
            social connection say two people were in the same place, which is not evidence they
            have ever spoken — so a human looks before either can carry a route.
          </p>
        </div>
      )}

      <div className="grid2">
        <div>
          <div className="card dossier">
            <div className="chead">
              <h2>What we can support</h2>
              <span className="lbl">source · as of · confidence · verified by</span>
            </div>
            {claims.length === 0 ? (
              <div className="cbody">
                <div className="empty">
                  <span className="stat unavailable">
                    <i />
                    Nothing supported
                  </span>
                  <h3>No claim about this entity carries a full provenance tuple.</h3>
                  <p>
                    That is different from knowing nothing. It means nothing on file can be stated
                    as a fact yet, so this dossier refuses to state one.
                  </p>
                </div>
              </div>
            ) : (
              claims.map((c) => {
                const doc = docMap.get(c.provenance.source);
                return (
                  <div className="row" key={c.claimId} style={{ alignItems: 'flex-start' }}>
                    <div className="t">
                      <b>
                        {c.value}
                        {doc && <EvidenceRef doc={doc} />}
                      </b>
                      <span>
                        {c.field} · <ProvenanceLine
                          prov={{
                            source: c.provenance.source,
                            asOf: shortDate(c.provenance.asOf),
                            confidence: c.provenance.confidence,
                            lastVerifiedBy: c.provenance.lastVerifiedBy,
                          }}
                        />
                      </span>
                    </div>
                    <div className="state" style={{ width: 150 }}>
                      {doc && (
                        <span className={`strength st-${doc.strength}`} style={{ marginBottom: 5, display: 'inline-block' }}>
                          {doc.strength}
                        </span>
                      )}
                      <ConfidenceWord
                        confidence={c.provenance.confidence}
                        verified={Boolean(c.provenance.lastVerifiedBy)}
                      />
                    </div>
                  </div>
                );
              })
            )}
            <Coverage
              corpus={`${coverage.documents} seed source documents`}
              from={coverage.from ? shortDate(coverage.from) : null}
              to={coverage.to ? shortDate(coverage.to) : null}
              notInspected={sources
                .filter((s) => s.status === 'not_connected')
                .map((s) => ({ source: s.label, why: s.detail ?? 'not connected' }))}
            />
          </div>

          {colour.length > 0 && (
            <div className="card">
              <div className="chead">
                <h2>Notes</h2>
                <span className="lbl">research.note · not yet worth a migration</span>
              </div>
              {colour.map((n) => (
                <div className="row" key={n.noteId} style={{ alignItems: 'flex-start' }}>
                  <div className="t">
                    <b style={{ fontWeight: 400, lineHeight: 1.5 }}>{n.body}</b>
                    <span>
                      {n.author ?? 'unattributed'} · {shortDate(n.createdAt)}
                      {n.tags.length > 0 ? ` · ${n.tags.join(', ')}` : ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="card">
            <div className="chead">
              <h2>Open questions</h2>
              <span className="lbl">{questions.length}</span>
            </div>
            {questions.length === 0 ? (
              <div className="cbody">
                <p className="muted">None recorded.</p>
              </div>
            ) : (
              <div className="cbody">
                {questions.map((q) => {
                  const status = String(q.data['status'] ?? 'unknown');
                  return (
                    <div className="fact" key={q.noteId} style={{ display: 'block' }}>
                      <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{q.body}</div>
                      <div style={{ marginTop: 6 }}>
                        <span className={`flag ${status === 'stale' ? 'f-ev' : 'f-mute'}`}>{status}</span>
                        <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>
                          {q.author ?? 'unattributed'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="cover">
              Open questions live in <code>research.note</code> with{' '}
              <code>kind = &apos;open_question&apos;</code>. They get their own columns when
              someone needs to filter on them, a mistake recurs, a tool needs a precise input, or
              performance demands it — and not before.
            </div>
          </div>
        </div>
      </div>
    </Page>
  );
}
