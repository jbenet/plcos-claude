import Link from '@/components/ui/AppLink';
import { getDb } from '@/lib/db';
import { pipelinePeopleNamedLikeOrgs } from '@/lib/enrich/entity-types';
import { MarkAsOrg } from './MarkAsOrg';

/**
 * Pipeline people named like an organisation we hold (issue 0063): a record Affinity typed as a person that is
 * really the firm splits it in two, and the W3 paths through it with it. Each can be marked an organisation here;
 * the correction is local and reversible, and a later Affinity sync keeps it. Read-only until a button is pressed.
 */
export async function TypeCandidates() {
  const db = await getDb();
  const items = await db.transaction(tx => pipelinePeopleNamedLikeOrgs(tx));
  if (!items.length) return <p className="muted" style={{ marginTop: 12 }}>No pipeline person shares a name with an organisation we hold.</p>;
  return <details className="more" style={{ marginTop: 12 }}>
    <summary>{items.length} pipeline {items.length === 1 ? 'person shares' : 'people share'} a name with an organisation</summary>
    <p className="muted">A person with no evidence of being a person is most likely the firm, recorded twice. Marking one an organisation
      changes only its type here; Affinity keeps its record, a later sync keeps the correction, and it can be reversed.</p>
    <ul>{items.map(c => <li key={c.entityId} style={{ marginBottom: 6 }}>
      <Link href={`/orgs/${c.entityId}`}>{c.name}</Link>
      {' · '}{c.pursuits} {c.pursuits === 1 ? 'pipeline' : 'pipelines'}
      {c.match === 'loose' ? ' · the names differ in punctuation or a legal form' : ''}
      {' · '}{c.evidence.length ? <>person evidence: {c.evidence.join(', ')}</> : 'no person evidence found'}
      {c.organizations.map((o, i) => <span key={o}> · <Link href={`/orgs/${o}`}>organisation{c.organizations.length > 1 ? ` ${i + 1}` : ''}</Link></span>)}
      {' '}<MarkAsOrg entityId={c.entityId} />
    </li>)}</ul>
  </details>;
}
