import type { SpvRowMark } from '@/modules/strategy/client';
import s from './spv.module.css';

/**
 * The SPV stance's compact mark (Juan, 27 Sep 2026): "does ≥4", "does", "doesn't" or "unknown".
 * The words carry the meaning; colour only repeats it. Whose word it is and why are in the title and,
 * in full, in every detail pane and on the LP page — nothing here is hover-only information.
 */
export function SpvMark({ mark, tag = false, showBasis = true }: { mark: SpvRowMark; tag?: boolean; showBasis?: boolean }) {
  const tone = mark.stance === 'does' ? s.does : mark.stance === 'does-not' ? s.not : s.unknown;
  const words = mark.stance === 'does' ? <>does{mark.minDeals ? <> <b>≥{mark.minDeals}</b></> : null}</>
    : mark.stance === 'does-not' ? <b>doesn’t</b> : <b>unknown</b>;
  const title = mark.stance === 'unknown' && !mark.why ? 'SPVs: unknown, likely open. Nothing on file either way.'
    : `SPVs: ${mark.stance === 'does' ? `does${mark.minDeals ? `, at least ${mark.minDeals} known` : ''}` : mark.stance === 'does-not' ? 'doesn’t' : 'unknown'}. ${mark.why ?? ''}${mark.conflict ? ' Evidence on file disagrees.' : ''}`;
  if (tag) return (
    <span className={`${s.tag} ${tone}`} title={title}>
      <span>SPVs</span>{words}{showBasis && mark.basis === 'person' && <span className={s.sub}>set</span>}
      {showBasis && mark.conflict && <span className={`${s.sub} ${s.conflict}`}>conflict</span>}
    </span>
  );
  // In a table cell: the stance, and under it whose word it is, as the score column shows its kind.
  return (
    <span className={s.cell} title={title}>
      <span className={`${s.mark} ${tone}`}>{words}</span>
      {showBasis && <span className={s.kind}>{BASIS[mark.basis]}{mark.conflict && <span className={s.conflict}> · conflict</span>}</span>}
    </span>
  );
}
const BASIS: Record<SpvRowMark['basis'], string> = { person: 'set here', research: 'research', derived: 'derived', none: 'likely open' };

/** The reason a "doesn't do SPVs" row is dimmed: short, and in full in the detail beside it. */
export function SpvReason({ mark }: { mark: SpvRowMark }) {
  return <span className={s.reason}>Doesn’t do SPVs{mark.short ? ` · ${mark.short}` : ''}</span>;
}

export const spvStyles = s;
