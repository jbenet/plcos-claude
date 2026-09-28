import type { StrategicMark as Mark } from '@/modules/strategy/client';
import s from './spv.module.css';

/**
 * Strategic value's compact mark (issue 0120): high, some, none or unknown, and under it whose word it
 * is — a person's grade ("assessed") or the records ("derived"). The words carry the meaning; colour
 * only repeats it. The reasons are in the title here and, in full, in the detail beside the list.
 */
export function StrategicMark({ mark }: { mark: Mark }) {
  const tone = mark.level === 'high' ? s.does : mark.level === 'some' ? s.some : s.unknown;
  return (
    <span className={s.cell} title={strategicTitle(mark)}>
      <span className={`${s.mark} ${tone}`}><b>{mark.level}</b></span>
      <span className={s.kind}>{BASIS[mark.basis]}</span>
    </span>
  );
}

export function strategicTitle(mark: Mark): string {
  if (mark.level === 'unknown') return 'Strategic value: unknown. Nothing on file ties them to this vehicle’s field or company, and nobody has judged it.';
  return `Strategic value: ${mark.level} (${BASIS[mark.basis]}). ${mark.reasons.join(' · ')}`;
}

export const STRATEGIC_BASIS: Record<Mark['basis'], string> = { assessed: 'assessed', derived: 'derived', none: 'no evidence' };
const BASIS = STRATEGIC_BASIS;
