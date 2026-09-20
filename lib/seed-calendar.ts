import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from './db';

interface PeriodFixture {
  kind: string; label: string; detail: string; starts_on: string; ends_on: string;
  vehicle: string | null; suppress_urgency: boolean;
}

/**
 * L7 seed: the run to the December close, including the two stretches where nobody is
 * going to answer. Both dates are real constraints on this raise, not decoration.
 */
export async function seedCalendar(db: Db): Promise<{ periods: number }> {
  const existing = await db.one<{ n: string }>('select count(*)::text as n from calendar.period');
  if (existing && Number(existing.n) > 0) return { periods: 0 };

  const periods: PeriodFixture[] = JSON.parse(
    await readFile(join(process.cwd(), 'fixtures', 'calendar.json'), 'utf8'),
  ) as PeriodFixture[];
  const vehicles = await db.query<{ id: string; slug: string }>('select id, slug from platform.vehicle');

  await db.transaction(async (tx) => {
    for (const p of periods) {
      await tx.query(
        `insert into calendar.period (kind, label, detail, starts_on, ends_on, vehicle_id, suppress_urgency)
         values ($1::calendar.period_kind,$2,$3,$4::date,$5::date,$6,$7)`,
        [p.kind, p.label, p.detail, p.starts_on, p.ends_on,
         p.vehicle ? vehicles.find((v) => v.slug === p.vehicle)?.id ?? null : null,
         p.suppress_urgency],
      );
    }
  });

  return { periods: periods.length };
}
