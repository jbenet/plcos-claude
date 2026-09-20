import type { Week } from '@/modules/calendar/client';

/**
 * The run to the close. Dead weeks are drawn as dead: grey, dashed bar, and no milestone
 * is scheduled into one. The queue is unchanged — only what the system says about it.
 */
export function SprintStrip({ weeks, wrap = false }: { weeks: Week[]; wrap?: boolean }) {
  return (
    <div className={`weeks${wrap ? ' wrap' : ''}`}>
      {weeks.map((w) => {
        const headline = w.milestone ?? w.periods[0] ?? null;
        return (
          <div className={`wk${w.isCurrent ? ' now' : ''}${w.dead ? ' dead' : ''}`} key={w.startsOn.toISOString()}>
            <div className="d">{w.label}</div>
            <div className="m">{w.isCurrent ? 'This week' : headline?.label ?? '—'}</div>
            <div className="s">
              {w.dead
                ? headline?.detail ?? 'Urgency suppressed.'
                : headline?.detail ?? (w.isCurrent ? 'No milestone scheduled.' : '')}
            </div>
            {w.milestone && !w.dead && <div className="mil">milestone</div>}
            {!w.dead && w.lostDays > 0 && (
              <div className="mil" style={{ color: 'var(--amber)' }}>
                {w.lostDays} of 5 days lost
              </div>
            )}
            <div className={`bar ${w.dead ? 'off' : 'on'}`} />
          </div>
        );
      })}
    </div>
  );
}
