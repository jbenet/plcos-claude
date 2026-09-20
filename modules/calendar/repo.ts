import { getDb } from '@/lib/db';
import type { Period, PeriodKind, UrgencyState, Week } from './types';

type Row = {
  period_id: string; kind: PeriodKind; label: string; detail: string | null;
  starts_on: Date | string; ends_on: Date | string; vehicle_name: string | null;
  suppress_urgency: boolean;
};

const toPeriod = (r: Row): Period => ({
  periodId: r.period_id, kind: r.kind, label: r.label, detail: r.detail,
  startsOn: new Date(r.starts_on), endsOn: new Date(r.ends_on),
  vehicleName: r.vehicle_name, suppressUrgency: r.suppress_urgency,
});

export async function listPeriods(): Promise<Period[]> {
  const db = await getDb();
  const rows = await db.query<Row>(
    `select p.period_id, p.kind, p.label, p.detail, p.starts_on, p.ends_on,
            v.name as vehicle_name, p.suppress_urgency
       from calendar.period p
       left join platform.vehicle v on v.id = p.vehicle_id
      order by p.starts_on, p.kind`,
  );
  return rows.map(toPeriod);
}

const DAY = 86_400_000;

/** Monday of the week containing `d`. */
function weekStart(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const shift = (out.getUTCDay() + 6) % 7;
  out.setUTCDate(out.getUTCDate() - shift);
  return out;
}

const overlaps = (p: Period, from: Date, to: Date) =>
  p.startsOn.getTime() <= to.getTime() && p.endsOn.getTime() >= from.getTime();

/**
 * The strip: `count` weeks from this one, each labelled with whatever overlaps it.
 *
 * A week counts as dead when a suppressing period covers three or more of its five
 * working days. Thanksgiving starts on a Wednesday and the week is over — pretending
 * Monday and Tuesday make it a working week is how a plan quietly loses three days.
 */
export async function sprintStrip(count = 8, now = new Date()): Promise<Week[]> {
  const periods = await listPeriods();
  const first = weekStart(now);
  const currentStart = first.getTime();

  return Array.from({ length: count }, (_, i) => {
    const startsOn = new Date(currentStart + i * 7 * DAY);
    const endsOn = new Date(startsOn.getTime() + 6 * DAY);
    const hits = periods.filter((p) => overlaps(p, startsOn, endsOn));
    const workingDays = Array.from({ length: 5 }, (_, d) => new Date(startsOn.getTime() + d * DAY));
    const lost = workingDays.filter((day) =>
      hits.some((p) => p.suppressUrgency && p.startsOn <= day && p.endsOn >= day),
    ).length;
    const dead = lost >= 3;
    return {
      startsOn,
      label: startsOn.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
      isCurrent: i === 0,
      periods: hits.sort((a, b) => Number(b.kind === 'milestone') - Number(a.kind === 'milestone')),
      dead,
      lostDays: lost,
      milestone: hits.find((p) => p.kind === 'milestone') ?? null,
    };
  });
}

/**
 * Whether the HUD may use urgency language today. This is the whole point of the module:
 * the queue does not change, the tone does.
 */
export async function urgency(now = new Date()): Promise<UrgencyState> {
  const periods = await listPeriods();
  const hit = periods.find(
    (p) => p.suppressUrgency && p.startsOn <= now && p.endsOn >= now,
  );
  if (!hit) return { suppressed: false, reason: null, until: null };
  return {
    suppressed: true,
    reason: hit.detail ?? hit.label,
    until: hit.endsOn,
  };
}
