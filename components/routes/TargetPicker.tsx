'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from '@/components/ui/AppLink';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Glyph } from '@/components/ui/Glyph';

export interface TargetRow {
  entityId: string;
  name: string;
  isPerson: boolean;
  /** Fit score 0–100 against the selected vehicle, when one exists. */
  score: number | null;
  /** The score is from the proposed strategy's readings, not a fit assessment (issue 0022). */
  provisional: boolean;
  /** Set when the score belongs to an organisation this person acts for, not to them. */
  borrowedFrom: string | null;
  /** The organisations a person acts for, or the people who act for an organisation. */
  related: string[];
  blocker: string | null;
  /**
   * Already in touch (issue 0027, real): the latest meeting held with them or message from them, in
   * words — "Met 12 Mar 2026". Someone the team deals with directly needs no introduction.
   */
  touch: string | null;
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
 * The server searches (issue 0023, real): on the real data the list is thousands long, and
 * sending all of it made this page 1.7 MB. The page carries only the rows it draws — the top
 * of the search, by the chosen order — and the search, the order and the minimum score live in
 * the address, so a link opens the same view.
 *
 * People the team is already in touch with are left out unless asked for (issue 0027, real): they
 * need no introduction. The count says how many are left out, and when they are shown each carries
 * a check and the words for it.
 */
export function TargetPicker({ targets, current, matched, total, q, sort, min, touchShown, hiddenInTouch, firstShown }: {
  targets: TargetRow[];
  current: string | undefined;
  /** How many match the search and the minimum; `targets` is the first of them. */
  matched: number;
  total: number;
  q: string;
  sort: Sort;
  min: number;
  /** In-touch people are listed too. */
  touchShown: boolean;
  /** How many match but are left out for being in touch. */
  hiddenInTouch: number;
  /** How many of the matches are drawn: `targets` may also carry the one selected, pinned on top. */
  firstShown: number;
}) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [text, setText] = useState(q);
  const [pending, start] = useTransition();

  const go = (patch: Record<string, string | null>) => {
    const u = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === '') u.delete(k); else u.set(k, v); }
    u.delete('r');
    start(() => router.replace(`${path}?${u.toString()}`, { scroll: false }));
  };
  // Typing waits a moment before it asks the server: one request per pause, not per keystroke.
  useEffect(() => {
    if (text === q) return;
    const t = window.setTimeout(() => go({ q: text.trim() || null }), 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  const href = (id: string) => {
    const u = new URLSearchParams(params.toString());
    u.set('target', id);
    u.delete('r');
    return `/routes?${u.toString()}`;
  };

  return (
    <>
      <div className="qhead">
        <div className="lbl">Route to whom</div>
        <input
          className="qsearch"
          type="search"
          value={text}
          placeholder="Name, or an org they act for"
          aria-label="Search targets"
          onChange={(e) => setText(e.target.value)}
        />
        <div className="qctl">
          <button className={sort === 'score' ? 'on' : ''} onClick={() => go({ sort: null })} aria-pressed={sort === 'score'}>
            Score
          </button>
          <button className={sort === 'name' ? 'on' : ''} onClick={() => go({ sort: 'name' })} aria-pressed={sort === 'name'}>
            Name
          </button>
          <span className="sp" />
          {[0, 60, 75].map((m) => (
            <button key={m} className={min === m ? 'on' : ''} onClick={() => go({ min: m ? String(m) : null })} aria-pressed={min === m}>
              {m === 0 ? 'Any' : `${m}+`}
            </button>
          ))}
          <span className="sp" />
          <button
            className={touchShown ? 'on' : ''}
            onClick={() => go({ touch: touchShown ? null : '1' })}
            aria-pressed={touchShown}
            title="People the team has met, or heard from, already: they need no introduction, so they are left out unless this is on."
          >
            ✓ In touch
          </button>
        </div>
        <p className="qcount">
          {pending ? 'Searching…' : <>{matched === total ? `${total}` : `${matched} of ${total}`}{matched > firstShown ? ` · the first ${firstShown} shown` : ''}</>}
          {hiddenInTouch > 0 && <> · {hiddenInTouch} in touch, left out</>}
          {targets.some((t) => t.borrowedFrom) && <> · * from their org</>}
          {targets.some((t) => t.provisional) && <> · ~ provisional, from the proposed strategy</>}
        </p>
      </div>

      {targets.map((t) => (
        <Link
          key={t.entityId}
          href={href(t.entityId)}
          className={`tix${t.entityId === current ? ' on' : ''}`}
        >
          <span className="tixline">
            <span className="tkind" aria-hidden title={t.isPerson ? 'Person' : 'Organisation'}>
              {t.isPerson ? '◔' : '▣'}
            </span>
            <b>{t.name}{t.touch && <Glyph name="check" title={`In touch: ${t.touch}`} tone="good" />}</b>
            <span
              className={`tscore${t.score === null ? ' none' : ''}${t.borrowedFrom ? ' borrowed' : ''}${t.provisional ? ' prov' : ''}`}
              title={[
                t.provisional ? 'Provisional: from the proposed strategy’s readings — capacity, affinity, propensity, time to decide — weighted as the scoring settings say. Not a fit assessment.' : null,
                t.borrowedFrom ? `Read from ${t.borrowedFrom}, whom they act for` : null,
              ].filter(Boolean).join(' ') || undefined}
            >
              {t.score === null ? '—' : `${t.provisional ? '~' : ''}${t.score}`}{t.borrowedFrom ? '*' : ''}
            </span>
          </span>
          {t.related.length > 0 && <p className="trel">{t.related.join(' · ')}</p>}
          {t.touch && <p className="ttouch">In touch · {t.touch}</p>}
          {t.blocker && <p className="tblock">{t.blocker}</p>}
        </Link>
      ))}

      {matched > firstShown && (
        <p className="qempty">{matched - firstShown} more — search, or raise the minimum score, to narrow the list.</p>
      )}
      {targets.length === 0 && (
        <p className="qempty">
          Nothing matches. The search covers names and the records around them — an
          organisation a person acts for, or the people who act for an organisation.
        </p>
      )}
    </>
  );
}
