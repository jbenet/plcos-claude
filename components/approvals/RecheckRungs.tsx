import Link from '@/components/ui/AppLink';
import { shortDate } from '@/lib/time';
import { RUNG_LABEL } from '@/modules/strategy';
import type { RecheckRow } from '@/lib/reconcile';

const NOW_LABEL: Record<RecheckRow['now'], string> = {
  general: 'General — not about a raise',
  unclear: 'About a raise, vehicle unclear',
  'another vehicle': 'About another vehicle',
  'not found': 'The record is no longer on file',
};

const WHO: Record<string, string> = { rule: 'the rules', claude: 'Claude', person: 'a person' };

/**
 * Rungs to check again (N81): approved on records the re-map now reads as not about their vehicle.
 * A rung is recorded once and stays; this card changes nothing. It lists them, one LP a row, for a
 * person to decide whether the ladder should say less — the answer is theirs, not the system's.
 */
export function RecheckRungs({ rows }: { rows: RecheckRow[] }) {
  if (!rows.length) return null;
  const byLp = new Map<string, RecheckRow[]>();
  for (const r of rows) byLp.set(r.pursuitId, [...(byLp.get(r.pursuitId) ?? []), r]);
  return (
    <div className="card" style={{ marginTop: 18 }} id="recheck">
      <div className="chead">
        <h2>Rungs to check again</h2>
        <span className="lbl">{rows.length} rungs · {byLp.size} LPs</span>
      </div>
      <div className="cbody">
        <p className="p2" style={{ marginTop: 0 }}>
          These rungs were approved on a meeting or a reply that the rules then read as about the raise.
          Since the re-map (N81) each record says which vehicle it is about, and these don&rsquo;t say
          it is theirs. A rung is recorded once and stays: nothing here changes one. Look at the LP&rsquo;s
          timeline — the row carries its tag — and tag the record there if the tag is wrong.
        </p>
      </div>
      <table className="list sugtable">
        <thead><tr><th style={{ width: 220 }}>LP</th><th>Rungs</th><th>The record now</th><th style={{ width: 150 }}>Approved</th></tr></thead>
        <tbody>
          {[...byLp.values()].map((rs) => {
            const r = rs[0]!;
            return (
              <tr key={r.pursuitId}>
                <td>
                  <Link href={`/targets/${r.pursuitId}`}><b>{r.name}</b></Link>
                  <div className="muted" style={{ fontSize: 11 }}>{r.vehicle}</div>
                </td>
                <td style={{ fontSize: 12 }}>{rs.map((x) => `${RUNG_LABEL[x.rung]}${x.kind === 'not_applicable' ? ' (not applicable)' : ''}`).join(', ')}</td>
                <td style={{ fontSize: 12 }}>
                  {[...new Set(rs.map((x) => NOW_LABEL[x.now]))].join('; ')}
                  {r.basis && <div className="muted" style={{ fontSize: 11 }}>{r.by ? `${WHO[r.by] ?? r.by}: ` : ''}{r.basis}</div>}
                </td>
                <td style={{ fontSize: 12 }}>{shortDate(r.recordedAt)}{r.recordedBy ? ` · ${r.recordedBy}` : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="cover">
        <b>Found by rule:</b> a rung whose record is an Affinity interaction that isn&rsquo;t tagged with the
        pursuit&rsquo;s vehicle (<code>rungsToRecheck</code>, lib/reconcile.ts). Withdrawing a rung needs a
        decision the ladder doesn&rsquo;t yet have a path for; until then, this list is where they are.
      </p>
    </div>
  );
}
