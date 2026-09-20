import { getDb } from '@/lib/db';
import type {
  Action, External, ExternalSource, Horizon, Item, ItemStatus, Metric, Standup,
} from './types';

const d = (v: Date | string) => new Date(v);
const iso = (v: Date) => v.toISOString().slice(0, 10);

export async function listDays(): Promise<Array<{ day: Date; capturedAt: Date | null; headline: string | null }>> {
  const db = await getDb();
  const rows = await db.query<{ day: Date | string; captured_at: Date | string | null; headline: string | null }>(
    'select day, captured_at, headline from standup.day order by day desc',
  );
  return rows.map((r) => ({
    day: d(r.day), capturedAt: r.captured_at ? d(r.captured_at) : null, headline: r.headline,
  }));
}

type ItemRow = {
  item_id: string; horizon: Horizon; title: string; detail: string | null;
  owner_name: string | null; vehicle_name: string | null; status: ItemStatus;
  carried_from: Date | string | null; sort: number;
};

const toItem = (r: ItemRow): Item => ({
  itemId: r.item_id, horizon: r.horizon, title: r.title, detail: r.detail,
  ownerName: r.owner_name, vehicleName: r.vehicle_name, status: r.status,
  carriedFrom: r.carried_from ? d(r.carried_from) : null, sort: r.sort,
});

const ITEM_SELECT = `
  select i.item_id, i.horizon::text as horizon, i.title, i.detail, u.name as owner_name,
         v.name as vehicle_name, i.status::text as status, i.carried_from, i.sort
    from standup.item i
    left join platform.app_user u on u.id = i.owner_id
    left join platform.vehicle v on v.id = i.vehicle_id`;

async function itemsFor(day: string): Promise<Item[]> {
  const db = await getDb();
  return (await db.query<ItemRow>(`${ITEM_SELECT} where i.day = $1::date order by i.horizon, i.sort`, [day]))
    .map(toItem);
}

/**
 * One day's standup.
 *
 * A day with a pin renders the pin. A day without one renders live numbers and says so.
 * The two are never mixed: half a page of September numbers and half of today's is the
 * failure this whole table exists to prevent.
 */
export async function standupFor(day: string): Promise<Standup | null> {
  const db = await getDb();
  const row = await db.one<{
    day: Date | string; captured_at: Date | string | null; captured_by_name: string | null;
    metrics: Metric[] | string | null; headline: string | null;
  }>(
    `select s.day, s.captured_at, u.name as captured_by_name, s.metrics, s.headline
       from standup.day s left join platform.app_user u on u.id = s.captured_by
      where s.day = $1::date`,
    [day],
  );
  if (!row) return null;

  const [items, actions, externals, neighbours] = await Promise.all([
    itemsFor(day),
    db.query<{
      action_id: string; rank: number; title: string; why: string; owner_name: string | null;
      vehicle_name: string | null; blocker: string | null; blocked_on: string | null;
      due_on: Date | string | null; gate: string | null;
    }>(
      `select a.action_id, a.rank, a.title, a.why, u.name as owner_name, v.name as vehicle_name,
              a.blocker, a.blocked_on, a.due_on, a.gate
         from standup.action a
         left join platform.app_user u on u.id = a.owner_id
         left join platform.vehicle v on v.id = a.vehicle_id
        where a.day = $1::date order by a.rank`,
      [day],
    ),
    db.query<{
      external_id: string; source: ExternalSource; ref: string; title: string; state: string;
      who: string | null; detail: string | null; occurred_at: Date | string; url: string | null;
    }>(
      `select external_id, source::text as source, ref, title, state, who, detail, occurred_at, url
         from standup.external where day = $1::date order by occurred_at desc`,
      [day],
    ),
    db.query<{ day: Date | string }>('select day from standup.day order by day'),
  ]);

  const all = neighbours.map((r) => iso(d(r.day)));
  const here = all.indexOf(day);
  const prevIso = here > 0 ? all[here - 1]! : null;

  const pinned = row.metrics
    ? (typeof row.metrics === 'string' ? (JSON.parse(row.metrics) as Metric[]) : row.metrics)
    : null;

  const toExternal = (r: (typeof externals)[number]): External => ({
    externalId: r.external_id, source: r.source, ref: r.ref, title: r.title, state: r.state,
    who: r.who, detail: r.detail, occurredAt: d(r.occurred_at), url: r.url,
  });

  return {
    day: d(row.day),
    capturedAt: row.captured_at ? d(row.captured_at) : null,
    capturedByName: row.captured_by_name,
    headline: row.headline,
    live: pinned === null,
    metrics: pinned ?? [],
    today: items.filter((i) => i.horizon === 'today'),
    week: items.filter((i) => i.horizon === 'week'),
    actions: actions.map((r) => ({
      actionId: r.action_id, rank: r.rank, title: r.title, why: r.why,
      ownerName: r.owner_name, vehicleName: r.vehicle_name,
      blocker: r.blocker, blockedOn: r.blocked_on,
      dueOn: r.due_on ? d(r.due_on) : null, gate: r.gate,
    })),
    linear: externals.filter((r) => r.source === 'linear').map(toExternal),
    outreach: externals.filter((r) => r.source === 'affinity').map(toExternal),
    previous: prevIso ? { day: d(prevIso), items: await itemsFor(prevIso) } : null,
    prevDay: prevIso ? d(prevIso) : null,
    nextDay: here >= 0 && here < all.length - 1 ? d(all[here + 1]!) : null,
  };
}

export async function latestDay(): Promise<string | null> {
  const db = await getDb();
  const row = await db.one<{ day: Date | string }>('select day from standup.day order by day desc limit 1');
  return row ? iso(d(row.day)) : null;
}

export async function pinDay(day: string, userId: string, metrics: Metric[]): Promise<void> {
  const db = await getDb();
  await db.query(
    `update standup.day
        set captured_at = now(), captured_by = $2, metrics = $3::jsonb
      where day = $1::date and captured_at is null`,
    [day, userId, JSON.stringify(metrics)],
  );
}
