'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

export interface TargetRow {
  entityId: string;
  name: string;
  isPerson: boolean;
  /** Fit score 0–100 against the selected vehicle, when one exists. */
  score: number | null;
  /** Set when the score belongs to an organisation this person acts for, not to them. */
  borrowedFrom: string | null;
  /** The organisations a person acts for, or the people who act for an organisation. */
  related: string[];
  blocker: string | null;
}

type Sort = 'score' | 'name';

/**
 * Who to route to.
 *
 * The list used to be names and a type. It is the column you scan before deciding where a
 * week goes, so it carries **the fit score** — there is no point finding a beautiful route
 * to somebody nobody has qualified. Search covers the name and the records around it, so
 * typing "Kaplan" finds the trust and the person who signs for it.
 *
 * Filtering happens in the browser: this list is small, and a round trip per keystroke
 * would make it feel slower than it is.
 */
export function TargetPicker({
  targets, current, total,
}: {
  targets: TargetRow[];
  current: string | undefined;
  total: number;
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('score');
  const [min, setMin] = useState(0);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const keep = targets.filter((t) => {
      if (min > 0 && (t.score ?? -1) < min) return false;
      if (!needle) return true;
      return t.name.toLowerCase().includes(needle)
        || t.related.some((r) => r.toLowerCase().includes(needle));
    });
    return [...keep].sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name));
  }, [targets, q, sort, min]);

  return (
    <>
      <div className="qhead">
        <div className="lbl">Route to whom</div>
        <input
          className="qsearch"
          type="search"
          value={q}
          placeholder="Name, or an org they act for"
          aria-label="Search targets"
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="qctl">
          <button className={sort === 'score' ? 'on' : ''} onClick={() => setSort('score')} aria-pressed={sort === 'score'}>
            Score
          </button>
          <button className={sort === 'name' ? 'on' : ''} onClick={() => setSort('name')} aria-pressed={sort === 'name'}>
            Name
          </button>
          <span className="sp" />
          {[0, 60, 75].map((m) => (
            <button key={m} className={min === m ? 'on' : ''} onClick={() => setMin(m)} aria-pressed={min === m}>
              {m === 0 ? 'Any' : `${m}+`}
            </button>
          ))}
        </div>
        <p className="qcount">
        {rows.length} of {total}
        {rows.some((t) => t.borrowedFrom) && <> · * from their org</>}
      </p>
      </div>

      {rows.map((t) => (
        <Link
          key={t.entityId}
          href={`/routes?target=${t.entityId}`}
          className={`tix${t.entityId === current ? ' on' : ''}`}
        >
          <span className="tixline">
            <span className="tkind" aria-hidden title={t.isPerson ? 'Person' : 'Organisation'}>
              {t.isPerson ? '◔' : '▣'}
            </span>
            <b>{t.name}</b>
            <span
              className={`tscore${t.score === null ? ' none' : ''}${t.borrowedFrom ? ' borrowed' : ''}`}
              title={t.borrowedFrom ? `Read from ${t.borrowedFrom}, whom they act for` : undefined}
            >
              {t.score === null ? '—' : t.score}{t.borrowedFrom ? '*' : ''}
            </span>
          </span>
          {t.related.length > 0 && <p className="trel">{t.related.join(' · ')}</p>}
          {t.blocker && <p className="tblock">{t.blocker}</p>}
        </Link>
      ))}

      {rows.length === 0 && (
        <p className="qempty">
          Nothing matches. The search covers names and the records around them — an
          organisation a person acts for, or the people who act for an organisation.
        </p>
      )}
    </>
  );
}
