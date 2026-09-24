'use client';

import { useUrlParam } from '@/lib/url-state';
import { EvidenceRef, type EvidenceDoc } from '@/components/ui/EvidenceRef';
import { GRADE_SCORE, type Certainty, type Grade } from '@/modules/fit/client';
import { CertaintyMark, Reading, Weight } from './marks';

export interface DimRow {
  code: string;
  label: string;
  question: string;
  grade: Grade;
  certainty: Certainty;
  finding: string;
  source: string | null;
  asOf: string;
  weightUs: number;
  weightThem: number;
}

type Order = 'us' | 'them' | 'miss';

const ORDERS: Array<{ id: Order; label: string; hint: string }> = [
  { id: 'us', label: 'What matters to us', hint: 'Heaviest first by how much it moves our decision to spend time here.' },
  { id: 'them', label: 'What matters to them', hint: 'Heaviest first by how much it moves their decision to write the cheque.' },
  { id: 'miss', label: 'Biggest misses', hint: 'Readings against us on heavy dimensions first — the shortest list of things to fix.' },
];

/**
 * Firm–vehicle fit, dimension by dimension.
 *
 * Two orderings because there are two questions. "Is this worth our week" is sorted by
 * weight to us; "why would they say yes" is sorted by weight to them, and the two
 * disagree often enough that collapsing them into one number would hide the disagreement.
 */
export function FitDimensions({ rows, docs }: { rows: DimRow[]; docs: Record<string, EvidenceDoc> }) {
  // The order is a view, so it's in the address (issue 0009).
  const [order, setOrder] = useUrlParam<Order>('order', 'us', ['us', 'them', 'miss']);

  const sorted = [...rows].sort((a, b) => {
    if (order === 'them') return b.weightThem - a.weightThem || a.label.localeCompare(b.label);
    if (order === 'miss') {
      const pain = (x: DimRow) => (1 - GRADE_SCORE[x.grade]) * x.weightUs;
      return pain(b) - pain(a) || b.weightUs - a.weightUs;
    }
    return b.weightUs - a.weightUs || a.label.localeCompare(b.label);
  });

  const active = ORDERS.find((o) => o.id === order)!;

  return (
    <>
      <div className="sorter" role="group" aria-label="Sort the dimensions">
        {ORDERS.map((o) => (
          <button
            key={o.id}
            className={o.id === order ? 'on' : ''}
            onClick={() => setOrder(o.id)}
            aria-pressed={o.id === order}
            title={o.hint}
          >
            {o.label}
          </button>
        ))}
        <span className="muted">{active.hint}</span>
      </div>

      <table className="list dims">
        <thead>
          <tr>
            <th style={{ width: 172 }}>Dimension</th>
            <th style={{ width: 124 }}>How it reads for us</th>
            <th style={{ width: 64 }}>Basis</th>
            <th>What we found</th>
            <th style={{ width: 78 }} className="right">Matters to us</th>
            <th style={{ width: 78 }} className="right">Matters to them</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.code}>
              <td>
                <b>{r.label}</b>
                <div className="muted qn">{r.question}</div>
              </td>
              <td><Reading grade={r.grade} /></td>
              <td><CertaintyMark certainty={r.certainty} /></td>
              <td>
                {r.finding}
                {r.source && docs[r.source] && <EvidenceRef doc={docs[r.source]} />}
                <span className="mono asof">{r.asOf}</span>
              </td>
              <td className="right"><Weight n={r.weightUs} /></td>
              <td className="right"><Weight n={r.weightThem} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
