import Link from 'next/link';
import { RUNG_LABEL, STATUSES, STATUS_BACKED_BY, rungIndex, type Pursuit, type PursuitStatus } from '@/modules/strategy';

/**
 * Where the pursuits stand, by status (N62, issue 0008): "Statuses in overview should be the new
 * statuses we aligned on." Each status with its count, a bar for its share, and — for the three
 * whose claim the ladder can back — how many have that evidence confirmed. The status is our plan;
 * the second number is what the records show, so the gap between them stays visible (rule 2).
 * Which rung backs which status is STATUS_BACKED_BY, the rule the LP page and the
 * visualizations use too; these are its words.
 */
const BACKED_WORDS: Partial<Record<PursuitStatus, string>> = {
  connecting: 'with a connector’s yes, or direct contact, on the ladder',
  discussing: 'with a meeting on the ladder',
  committed: 'countersigned',
};

export function StatusCounts({ pursuits, vehicleName }: {
  pursuits: Pick<Pursuit, 'status' | 'rung'>[];
  vehicleName: string | null;
}) {
  const passed = pursuits.filter((p) => p.status === 'passed').length;
  const rows = STATUSES.map((s) => {
    const here = pursuits.filter((p) => p.status === s.id);
    const rung = STATUS_BACKED_BY[s.id];
    const words = BACKED_WORDS[s.id];
    return {
      ...s, n: here.length,
      backed: rung && words ? { n: here.filter((p) => rungIndex(p.rung) >= rungIndex(rung)).length, words, rung } : null,
    };
  });
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="card">
      <div className="chead">
        <h2>Where the pursuits stand</h2>
        <span className="lbl">{pursuits.length - passed} open · {passed} passed</span>
      </div>
      <div className="cbody">
        {rows.map((r) => (
          <Link className={`scount${r.id === 'passed' ? ' off' : ''}`} key={r.id} href={`/targets?status=${r.id}`} title={r.means}>
            <span className="nm">{r.label}</span>
            <span className="bar"><i style={{ width: `${(r.n / max) * 100}%` }} /></span>
            <span className="n mono">{r.n.toLocaleString('en-US')}</span>
            {r.backed && r.n > 0 && (
              <span className="ev" title={`${RUNG_LABEL[r.backed.rung]} or later, confirmed through a STAGE ticket`}>
                {r.backed.n.toLocaleString('en-US')} {r.backed.words}
              </span>
            )}
          </Link>
        ))}
      </div>
      <p className="cover">
        The status is our plan, set by a person or read from Affinity; the numbers beside it are
        what the ladder has confirmed. {vehicleName ? `Only ${vehicleName}.` : 'Every vehicle, each LP once per vehicle.'}{' '}
        <Link href="/targets">Open the pipeline</Link>.
      </p>
    </div>
  );
}
