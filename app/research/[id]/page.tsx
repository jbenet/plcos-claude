import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/shell/Page';
import { EvidenceRef, type EvidenceDoc } from '@/components/ui/EvidenceRef';
import { ConfidenceWord, ProvenanceLine } from '@/components/ui/Provenance';
import { Coverage } from '@/components/ui/Coverage';
import { getEntity } from '@/modules/identity';
import { claimsFor, listSourceDocs, notesFor, corpusCoverage } from '@/modules/research';
import { assessmentsForEntity, BLOCKER_LABEL } from '@/modules/fit';
import { listSyncSources } from '@/modules/platform';
import { shortDate } from '@/lib/time';

export const dynamic = 'force-dynamic';

const TYPE_LABEL: Record<string, string> = {
  person: 'Person', org: 'Organisation', family: 'Family office',
  foundation: 'Foundation', vehicle: 'Vehicle',
};

export default async function Dossier({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entity = await getEntity(id);
  if (!entity) notFound();

  const [claims, docs, notes, coverage, sources, fit] = await Promise.all([
    claimsFor(entity.entityId),
    listSourceDocs(),
    notesFor(entity.entityId),
    corpusCoverage(),
    listSyncSources(),
    assessmentsForEntity(entity.entityId),
  ]);

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
        { label: 'Research & enrichment', href: '/research' },
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
        <Link href="/research">← Research &amp; enrichment</Link>
      </div>
      <h1 style={{ marginTop: 8 }}>{entity.displayName}</h1>
      <p className="sublede">{summary?.body ?? TYPE_LABEL[entity.entityType]}</p>

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
