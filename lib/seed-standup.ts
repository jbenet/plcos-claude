import type { Db } from './db';

/**
 * Three days of standup.
 *
 * The 18th and 19th are pinned — their numbers are frozen at the moment they were
 * captured, and they are deliberately *different* from today's, so that opening an old
 * day proves the pin works rather than asserting it.
 *
 * Today is left unpinned, because that is the honest state of a day nobody has run yet.
 */

interface ItemSeed {
  horizon: 'today' | 'week';
  title: string;
  detail?: string;
  owner?: string;
  vehicle?: string;
  status?: 'open' | 'done' | 'carried' | 'dropped';
  carried?: string;
}

interface ActionSeed {
  title: string;
  why: string;
  owner?: string;
  vehicle?: string;
  blocker?: string;
  blockedOn?: string;
  due?: string;
  gate?: string;
}

interface ExternalSeed {
  source: 'linear' | 'affinity';
  ref: string;
  title: string;
  state: string;
  who?: string;
  detail?: string;
  at: string;
  url?: string;
}

interface DaySeed {
  day: string;
  headline: string;
  capturedAt?: string;
  capturedBy?: string;
  metrics?: Array<[string, string, number, 'usd' | 'count' | 'ratio', string | null, string]>;
  items: ItemSeed[];
  actions: ActionSeed[];
  externals: ExternalSeed[];
}

const DAYS: DaySeed[] = [
  {
    day: '2026-09-18',
    headline: 'Cedar countersigned. The first close has a first name on it.',
    capturedAt: '2026-09-18T08:12:00Z',
    capturedBy: 'juan',
    metrics: [
      ['hard:neurotech', 'Hard', 52_000_000, 'usd', 'neurotech', 'Signed and countersigned. $52.0M has wired.'],
      ['soft:neurotech', 'Soft', 26_500_000, 'usd', 'neurotech', 'A separate track. Never added to hard.'],
      ['gap:neurotech', 'Gap to target', 38_000_000, 'usd', 'neurotech', 'Hard-only basis.'],
      ['hard:rails', 'Hard', 27_000_000, 'usd', 'rails', 'Signed and countersigned. $27.0M has wired.'],
      ['tickets', 'Approvals waiting', 3, 'count', null, 'Open tickets across every vehicle.'],
      ['conflicts', 'Open conflicts', 1, 'count', null, 'Cross-vehicle collisions awaiting adjudication.'],
      ['asks', 'Asks on file', 3, 'count', null, 'Every ask recorded, at any stage.'],
      ['pursuits', 'Pursuits open', 4, 'count', null, 'Open target workspaces.'],
    ],
    items: [
      { horizon: 'week', title: 'Get Cedar from accepted to countersigned', owner: 'juan', vehicle: 'neurotech', status: 'done', detail: 'Signed on the 18th. $4.0M, fee break documented in the side letter.' },
      { horizon: 'week', title: 'Independent verification of the operating-company marks', owner: 'mara', vehicle: 'neurotech', status: 'open', detail: 'Northwood named it as the blocker in the room. Two other endowments will ask the same question.' },
      { horizon: 'week', title: 'Close the Lattice SPV allocation', owner: 'sam', vehicle: 'lattice', status: 'open' },
      { horizon: 'today', title: 'Countersign Cedar and file the side letter', owner: 'juan', vehicle: 'neurotech', status: 'done' },
      { horizon: 'today', title: 'Draft the Roos PRI structure note', owner: 'mara', vehicle: 'neurotech', status: 'carried', detail: 'The primer is the wrong opening for a foundation that has made two PRIs and no LP commitments.' },
    ],
    actions: [
      { title: 'Tell Vantage about the Cedar fee break', why: 'Their MFN is triggered by it. Finding out from a quarterly report is a relationship problem, not a paperwork one.', owner: 'juan', vehicle: 'rails', due: '2026-09-22', gate: 'SEND' },
      { title: 'Book the §4944(c) refresh with counsel', why: 'The only note we have is from March 2024 and expired. It is the Roos blocker and it is answerable.', owner: 'mara', vehicle: 'neurotech', due: '2026-09-25' },
      { title: 'Adjudicate the Roos collision', why: 'Duettmann is the only tier-A route and two vehicles want her. Whoever loses needs a dated follow-up, not a silent stop.', owner: 'juan', blocker: 'Waiting on a decision', blockedOn: 'Juan — nobody else can adjudicate a cross-vehicle collision', gate: 'INTRO_ASK' },
    ],
    externals: [
      { source: 'linear', ref: 'CAP-118', title: 'Side letter template: MFN clause language', state: 'In Progress', who: 'Ines Duarte', at: '2026-09-18T07:40:00Z' },
      { source: 'linear', ref: 'CAP-121', title: 'DDQ pack — valuation policy section', state: 'Todo', who: 'Mara Vance', at: '2026-09-17T16:05:00Z' },
      { source: 'affinity', ref: 'cedar', title: 'Cedar Trust — countersigned', state: 'Commitment accepted', who: 'Ivo Lindqvist', detail: 'Signature returned. $4.0M at the documented break.', at: '2026-09-18T07:02:00Z' },
      { source: 'affinity', ref: 'northwood', title: 'Northwood Capital — DDQ pack requested', state: 'Meeting held', who: 'Priya Raman', detail: 'Asked for the pack within a week of meeting. Fast for a multi-family office.', at: '2026-09-16T11:20:00Z' },
    ],
  },

  {
    day: '2026-09-19',
    headline: 'Hard moved. The fee break moved something else, and nobody has told Vantage.',
    capturedAt: '2026-09-19T08:05:00Z',
    capturedBy: 'mara',
    metrics: [
      ['hard:neurotech', 'Hard', 56_000_000, 'usd', 'neurotech', 'Signed and countersigned. $56.0M has wired.'],
      ['soft:neurotech', 'Soft', 22_500_000, 'usd', 'neurotech', 'A separate track. Never added to hard.'],
      ['gap:neurotech', 'Gap to target', 34_000_000, 'usd', 'neurotech', 'Hard-only basis.'],
      ['hard:rails', 'Hard', 27_000_000, 'usd', 'rails', 'Signed and countersigned. $27.0M has wired.'],
      ['tickets', 'Approvals waiting', 4, 'count', null, 'Open tickets across every vehicle.'],
      ['conflicts', 'Open conflicts', 1, 'count', null, 'Cross-vehicle collisions awaiting adjudication.'],
      ['asks', 'Asks on file', 4, 'count', null, 'Every ask recorded, at any stage.'],
      ['pursuits', 'Pursuits open', 4, 'count', null, 'Open target workspaces.'],
    ],
    items: [
      { horizon: 'week', title: 'Independent verification of the operating-company marks', owner: 'mara', vehicle: 'neurotech', status: 'open', carried: '2026-09-18' },
      { horizon: 'week', title: 'Close the Lattice SPV allocation', owner: 'sam', vehicle: 'lattice', status: 'open', carried: '2026-09-18' },
      { horizon: 'week', title: 'MFN disclosure to Vantage', owner: 'juan', vehicle: 'rails', status: 'open', detail: 'Raised by the compliance registry the day after Cedar signed.' },
      { horizon: 'today', title: 'Draft the Roos PRI structure note', owner: 'mara', vehicle: 'neurotech', status: 'carried', carried: '2026-09-18' },
      { horizon: 'today', title: 'Chase the third-party verification letter for Northwood', owner: 'mara', vehicle: 'neurotech', status: 'open' },
      { horizon: 'today', title: 'Public claim review — "backed by a $60M first close"', owner: 'ines', status: 'done', detail: 'Flagged. Hard is $56.0M. The claim was used in an email on the 19th and does not substantiate.' },
    ],
    actions: [
      { title: 'Withdraw the "$60M first close" claim', why: 'Hard is $56.0M. It went out in an email yesterday and the registry cannot substantiate it.', owner: 'ines', due: '2026-09-19', gate: 'SEND' },
      { title: 'Tell Vantage about the Cedar fee break', why: 'Their MFN is triggered. Every day this waits is a day they could find it themselves.', owner: 'juan', vehicle: 'rails', due: '2026-09-22', gate: 'SEND' },
      { title: 'Adjudicate the Roos collision', why: 'Second day open. Duettmann is at two of three asks this quarter and the window is closing.', owner: 'juan', blocker: 'Waiting on a decision', blockedOn: 'Juan', gate: 'INTRO_ASK' },
      { title: 'Ask Raman whether a 2026 emerging-manager slot exists', why: 'She raised it, not us. Diligence effort before that answer is effort that may have nowhere to land.', owner: 'mara', vehicle: 'neurotech', due: '2026-09-24' },
    ],
    externals: [
      { source: 'linear', ref: 'CAP-118', title: 'Side letter template: MFN clause language', state: 'In Review', who: 'Ines Duarte', at: '2026-09-19T07:15:00Z' },
      { source: 'linear', ref: 'CAP-124', title: 'Compliance: substantiate public claims before use', state: 'Todo', who: 'Ines Duarte', detail: 'Filed after the $60M claim was caught.', at: '2026-09-19T06:58:00Z' },
      { source: 'linear', ref: 'CAP-121', title: 'DDQ pack — valuation policy section', state: 'In Progress', who: 'Mara Vance', at: '2026-09-18T15:40:00Z' },
      { source: 'affinity', ref: 'okonjo', title: 'Okonjo Family Office — no reply', state: 'Connector willing', who: 'Michael Okonjo', detail: 'Three weeks since Duettmann forwarded the opt-in request. Silence is information.', at: '2026-09-19T06:30:00Z' },
      { source: 'affinity', ref: 'whitcomb', title: 'Whitcomb Capital — $5.0M soft', state: 'Indication given', who: 'Gordon Whitcomb', detail: 'Wants in. Cannot subscribe on a self-certification.', at: '2026-09-18T14:10:00Z' },
    ],
  },

  {
    day: '2026-09-20',
    headline: 'Four approvals waiting and one of them has been waiting two days.',
    items: [
      { horizon: 'week', title: 'Independent verification of the operating-company marks', owner: 'mara', vehicle: 'neurotech', status: 'open', carried: '2026-09-18', detail: 'Third day. Northwood named it, and two other endowments will ask the same question.' },
      { horizon: 'week', title: 'MFN disclosure to Vantage', owner: 'juan', vehicle: 'rails', status: 'open', carried: '2026-09-19' },
      { horizon: 'week', title: 'Close the Lattice SPV allocation', owner: 'sam', vehicle: 'lattice', status: 'open', carried: '2026-09-18' },
      { horizon: 'week', title: 'Whitcomb: CPA-letter route for accreditation', owner: 'ines', vehicle: 'neurotech', status: 'open', detail: 'They want to come in and cannot. The route that does not require sending us anything is the one to offer.' },
      { horizon: 'today', title: 'Adjudicate the Roos collision', owner: 'juan', vehicle: 'neurotech', status: 'open', carried: '2026-09-18', detail: 'Third day open.' },
      { horizon: 'today', title: 'Draft the Roos PRI structure note', owner: 'mara', vehicle: 'neurotech', status: 'carried', carried: '2026-09-18' },
      { horizon: 'today', title: 'Approve or refuse the Neurotech primer to Okonjo', owner: 'juan', vehicle: 'neurotech', status: 'open' },
    ],
    actions: [
      { title: 'Adjudicate the Roos collision', why: 'Open since the 18th. Duettmann is at two of three asks this quarter, and the loser is owed a dated follow-up rather than a silent stop.', owner: 'juan', vehicle: 'neurotech', blocker: 'Nobody else can adjudicate a cross-vehicle collision', blockedOn: 'Juan', gate: 'INTRO_ASK', due: '2026-09-21' },
      { title: 'Tell Vantage about the Cedar fee break', why: 'Third day. Their MFN is triggered and they still do not know.', owner: 'juan', vehicle: 'rails', due: '2026-09-22', gate: 'SEND' },
      { title: 'Offer Whitcomb the CPA-letter route', why: 'They have indicated $5.0M soft and cannot subscribe on a self-certification. This is the only path that does not ask them to send us financial documents.', owner: 'ines', vehicle: 'neurotech', due: '2026-09-23' },
      { title: 'Arrange the third-party verification of the marks', why: 'The stated Northwood blocker, and the one thing on this list that unblocks more than one prospect.', owner: 'mara', vehicle: 'neurotech', due: '2026-09-26' },
      { title: 'Get the §4944(c) position refreshed', why: 'Two years stale. Roos cannot be qualified until it is answered, and no amount of relationship work substitutes.', owner: 'mara', vehicle: 'neurotech', blocker: 'Waiting on outside counsel', blockedOn: 'Counsel — call booked, no date returned', due: '2026-09-25' },
      { title: 'Ask Vantage for a reference call', why: 'They are an LP in both vehicles, Raman came from there, and nobody has ever asked. Under-asking existing LPs is the most common mistake in the reports.', owner: 'juan', vehicle: 'neurotech', gate: 'INTRO_ASK' },
    ],
    externals: [
      { source: 'linear', ref: 'CAP-124', title: 'Compliance: substantiate public claims before use', state: 'In Progress', who: 'Ines Duarte', at: '2026-09-20T07:20:00Z' },
      { source: 'linear', ref: 'CAP-118', title: 'Side letter template: MFN clause language', state: 'Done', who: 'Ines Duarte', at: '2026-09-20T06:45:00Z' },
      { source: 'linear', ref: 'CAP-121', title: 'DDQ pack — valuation policy section', state: 'In Progress', who: 'Mara Vance', at: '2026-09-19T17:30:00Z' },
      { source: 'linear', ref: 'CAP-130', title: 'Fit page: say which reading moved the score', state: 'Triage', who: 'unassigned', detail: 'Mirrors issue 0007 filed through the feedback box.', at: '2026-09-20T09:05:00Z' },
      { source: 'affinity', ref: 'raman', title: 'Priya Raman — joined Northwood from Vantage', state: 'Meeting held', who: 'Priya Raman', detail: 'Affiliation recorded. Vantage is an LP in both vehicles and has never been asked for a reference.', at: '2026-09-20T08:40:00Z' },
      { source: 'affinity', ref: 'tessaro', title: 'Tessaro Family Office — public interview', state: 'Prospect', who: 'Marisa Tessaro', detail: 'Named two of our podcast guests as people she follows. She holds the thesis and has never heard of us.', at: '2026-09-19T19:15:00Z' },
      { source: 'affinity', ref: 'okonjo', title: 'Okonjo Family Office — speaking in November', state: 'Connector willing', who: 'Michael Okonjo', detail: 'A contact that costs no connector goodwill.', at: '2026-09-19T12:00:00Z' },
    ],
  },
];

export async function seedStandup(db: Db): Promise<{ standupDays: number }> {
  const existing = await db.one<{ n: string }>('select count(*)::text as n from standup.day');
  if (existing && Number(existing.n) > 0) return { standupDays: 0 };

  const users = await db.query<{ id: string; handle: string }>('select id, handle from platform.app_user');
  const vehicles = await db.query<{ id: string; slug: string; name: string }>(
    'select id, slug, name from platform.vehicle',
  );
  const u = (h?: string) => (h ? users.find((x) => x.handle === h)?.id ?? null : null);
  const v = (s?: string) => (s ? vehicles.find((x) => x.slug === s)?.id ?? null : null);
  const vName = (s: string | null) => (s ? vehicles.find((x) => x.slug === s)?.name ?? null : null);

  await db.transaction(async (tx) => {
    for (const day of DAYS) {
      const metrics = day.metrics
        ? day.metrics.map(([key, label, value, unit, slug, detail]) => ({
            key, label, value, unit, vehicleSlug: slug, vehicleName: vName(slug), detail,
          }))
        : null;

      await tx.query(
        `insert into standup.day (day, captured_at, captured_by, metrics, headline)
         values ($1::date, $2::timestamptz, $3, $4::jsonb, $5)`,
        [day.day, day.capturedAt ?? null, u(day.capturedBy), metrics ? JSON.stringify(metrics) : null, day.headline],
      );

      let sort = 0;
      for (const i of day.items) {
        await tx.query(
          `insert into standup.item
             (day, horizon, title, detail, owner_id, vehicle_id, status, carried_from, sort)
           values ($1::date,$2::standup.horizon,$3,$4,$5,$6,$7::standup.item_status,$8::date,$9)`,
          [day.day, i.horizon, i.title, i.detail ?? null, u(i.owner), v(i.vehicle),
           i.status ?? 'open', i.carried ?? null, sort++],
        );
      }

      let rank = 1;
      for (const a of day.actions) {
        await tx.query(
          `insert into standup.action
             (day, rank, title, why, owner_id, vehicle_id, blocker, blocked_on, due_on, gate)
           values ($1::date,$2,$3,$4,$5,$6,$7,$8,$9::date,$10)`,
          [day.day, rank++, a.title, a.why, u(a.owner), v(a.vehicle),
           a.blocker ?? null, a.blockedOn ?? null, a.due ?? null, a.gate ?? null],
        );
      }

      for (const e of day.externals) {
        await tx.query(
          `insert into standup.external
             (day, source, ref, title, state, who, detail, occurred_at, url)
           values ($1::date,$2::standup.external_source,$3,$4,$5,$6,$7,$8::timestamptz,$9)`,
          [day.day, e.source, e.ref, e.title, e.state, e.who ?? null, e.detail ?? null, e.at, e.url ?? null],
        );
      }
    }
  });

  return { standupDays: DAYS.length };
}
