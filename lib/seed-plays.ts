import type { Db } from './db';

/**
 * The action space.
 *
 * Every play below cites a finding that is actually in this database — a fit diagnosis, a
 * gate that failed, a claim the registry could not substantiate, an edge nobody reviewed.
 * That is the point of the `because` column: an action with no finding behind it is a task
 * somebody thought of in the shower, and a board full of those is a to-do list wearing a
 * strategy's clothes.
 *
 * The numbers are judgement. `likelihood` is 1–5 and `effort_days` is person-days, both
 * written by a person and both meant to be argued with on the page.
 */

interface PlaySeed {
  vehicle: string;
  entity?: string;
  horizon: 'now' | 'compounding';
  lever: string;
  title: string;
  detail: string;
  because: string;
  likelihood: number;
  effort: number;
  reach?: number;
  payoff: string;
  certainty?: string;
  owner?: string;
  gate?: string;
}

interface NeedSeed {
  vehicle: string;
  entity: string;
  kind: string;
  statement: string;
  evidence: string;
  met?: boolean | null;
  source?: string;
  as_of: string;
}

const PLAYS: PlaySeed[] = [
  // ---------------------------------------------------------------- Neurotech · now
  {
    vehicle: 'neurotech', horizon: 'now', lever: 'validate',
    title: 'Get the operating-company marks independently verified',
    detail:
      'Engage a third party to verify the audited marks on the three prior operating-company '
      + 'vehicles, and publish the letter to the answer library so it can be cited rather than '
      + 're-explained.',
    because:
      'Northwood named it as the blocker in the room, and it is the stated reason their fit '
      + 'reading is conviction rather than awareness. Cedar asked for the same thing before '
      + 'signing, and two further endowment-shaped prospects will ask it next.',
    likelihood: 4, effort: 5, reach: 4,
    payoff:
      'Answers one objection permanently for every prospect who asks it, instead of once per '
      + 'conversation. The only play on this board that unblocks more than one name.',
    certainty: 'known', owner: 'mara',
  },
  {
    vehicle: 'neurotech', horizon: 'now', lever: 'process',
    title: 'Offer Whitcomb the CPA-letter accreditation route',
    detail:
      'Write the one-page note explaining why the SPV was different, and offer the '
      + 'accountant-letter route, which does not require them to send us any financial document.',
    because:
      'Whitcomb has indicated $5.0M soft and fails the accreditation gate on a self-certification. '
      + 'The compliance registry and the fit gate independently agree that they cannot subscribe.',
    likelihood: 4, effort: 1, reach: 1,
    payoff: '$5.0M of soft becomes hardenable, from a firm that already wired an SPV in nineteen days.',
    certainty: 'known', owner: 'ines', gate: 'MONEY',
  },
  {
    vehicle: 'neurotech', horizon: 'now', lever: 'route',
    title: 'Ask Vantage for a reference call and an introduction',
    detail:
      'Vantage are an LP in both vehicles. Ask their CIO for a reference call, and separately '
      + 'whether Priya Raman — who was their investment director until August — would take a '
      + 'warm note about the Northwood emerging-manager programme.',
    because:
      'The affiliation table surfaced that Raman came from Vantage, and Vantage has never been '
      + 'asked for anything. Report 6 is blunt that under-asking existing LPs is the most common '
      + 'mistake a manager makes.',
    likelihood: 4, effort: 0.5, reach: 2,
    payoff:
      'A tier-A route to the highest-scoring unconverted prospect, and a reference that every '
      + 'subsequent endowment conversation can lean on.',
    certainty: 'known', owner: 'juan', gate: 'INTRO_ASK',
  },
  {
    vehicle: 'neurotech', horizon: 'now', lever: 'enrich',
    title: 'Answer the four unanswered hard gates',
    detail:
      'Four assessments carry a gate nobody has answered: Northwood’s mandate slot, Roos’s '
      + 'trust-deed permission, Vantage’s new-vehicle conflict, and Sable Point’s. Each is '
      + 'one call or one document.',
    because:
      'An unanswered gate is not a pass, so these four sit in the board as "cannot be qualified '
      + 'yet" and consume attention without ever converting. The evidence coverage across the '
      + 'whole pool is dragged down by them.',
    likelihood: 5, effort: 2, reach: 4,
    payoff:
      'Four prospects move from unqualifiable to either workable or honestly dead. Either answer '
      + 'is worth more than the current one.',
    certainty: 'known', owner: 'mara',
  },
  {
    vehicle: 'neurotech', horizon: 'now', lever: 'segment',
    title: 'Source family offices with a publicly stated neuro interest',
    detail:
      'Build a list of single family offices whose principal has said something public about '
      + 'neuroscience, longevity or frontier biology — conference talks, interviews, foundation '
      + 'giving. Record only what they said about their own interests.',
    because:
      'Tessaro scores 80 and arrived at the thesis independently of us; they are the highest-fit '
      + 'unconverted name on the board and they came from exactly this shape of search. One '
      + 'instance is a lead, not a pattern, which is why this is a sourcing play rather than a '
      + 'conclusion.',
    likelihood: 3, effort: 4, reach: 6,
    payoff:
      'Widens the top of the funnel with names that start at conviction rather than at awareness — '
      + 'the expensive gap to close.',
    certainty: 'inferred', owner: 'mara',
  },
  {
    vehicle: 'neurotech', horizon: 'now', lever: 'materials',
    title: 'Write the valuation-policy note for pre-revenue assets',
    detail:
      'A two-page note on how pre-revenue positions are marked, who signs the mark, and what '
      + 'happens when a round does not price. Approve it into the answer library.',
    because:
      'Northwood raised it as a DDQ question they must defend to nine families, and the coverage '
      + 'query lists it among the questions with no approved answer behind them.',
    likelihood: 4, effort: 1.5, reach: 5,
    payoff:
      'A DDQ answer that will be asked by every institutional prospect, answered once and cited '
      + 'thereafter.',
    certainty: 'known', owner: 'ines',
  },
  {
    vehicle: 'neurotech', horizon: 'now', lever: 'convince',
    title: 'Refresh the §4944(c) position with counsel',
    detail:
      'Get a current written position on programme-related investments into a venture fund, and '
      + 'a PRI structure note that a foundation’s counsel can read.',
    because:
      'Roos cannot be qualified until it is answered; the only note on file is from March 2024 and '
      + 'expired. No amount of relationship work substitutes for a legal opinion.',
    likelihood: 3, effort: 2, reach: 2,
    payoff:
      'Unblocks the best thesis fit in the universe, and opens the foundation segment generally.',
    certainty: 'known', owner: 'mara',
  },
  {
    vehicle: 'neurotech', horizon: 'now', lever: 'ask',
    title: 'Adjudicate the Roos collision and diarise the loser',
    detail:
      'Two vehicles have an open ask on the same actor inside the conflict window, through the '
      + 'only tier-A connector either has. Pick one, and write the dated follow-up for the other.',
    because:
      'Open since 18 September. Duettmann is at two of three asks this quarter, so the window is '
      + 'closing on its own whether or not anybody decides.',
    likelihood: 5, effort: 0.25, reach: 2,
    payoff:
      'One ask proceeds this week instead of neither. The dated follow-up is what stops the loser '
      + 'being lost silently.',
    certainty: 'known', owner: 'juan', gate: 'INTRO_ASK',
  },
  {
    vehicle: 'neurotech', horizon: 'now', lever: 'convene',
    title: 'Invite four prospects to the November convening',
    detail:
      'Offer seats at the next research convening to Tessaro, Sable Point, Brenner and Okonjo. '
      + 'A seat, not a pitch — no subscription document goes near it.',
    because:
      'Okonjo is speaking at a neurotech conference in November, which is a contact that costs no '
      + 'connector goodwill; Tessaro holds the thesis and has never heard of us. Both are reachable '
      + 'at low pressure and neither is reachable by another ask.',
    likelihood: 3, effort: 2, reach: 4,
    payoff:
      'Relationship without spending an ask, and the one format that has historically converted a '
      + 'cold prospect here.',
    certainty: 'inferred', owner: 'sam',
  },

  // ---------------------------------------------------------------- Neurotech · compounding
  {
    vehicle: 'neurotech', horizon: 'compounding', lever: 'reach',
    title: 'Publish the thesis as a standing, citable document',
    detail:
      'A permanent public version of the neuro thesis with its evidence, updated quarterly, that '
      + 'somebody can find without knowing us and send to a colleague without asking permission.',
    because:
      'Tessaro found their way to this thesis independently and named two of our podcast guests '
      + 'as people they follow — without ever hearing of us. That is reach working, by accident, '
      + 'on somebody else’s content.',
    likelihood: 3, effort: 8, reach: 12,
    payoff:
      'The only lever that works while nobody is doing anything. It converts nothing this quarter '
      + 'and it is why the next raise starts with warm names instead of cold ones.',
    certainty: 'inferred', owner: 'juan',
  },
  {
    vehicle: 'neurotech', horizon: 'compounding', lever: 'validate',
    title: 'Build a standing reference bench',
    detail:
      'Three founders, two scientific advisers and two LPs who have agreed in advance to take a '
      + 'reference call, with a note on what each is credible about.',
    because:
      'Connector credibility is target- and topic-specific and does not transfer between domains. '
      + 'Assembling the bench after an LP asks means a two-week gap at the worst moment.',
    likelihood: 4, effort: 3, reach: 10,
    payoff:
      'Every future conviction gap has a person to point at within a day. Compounds because each '
      + 'call makes the next reference more willing.',
    certainty: 'inferred', owner: 'juan',
  },
  {
    vehicle: 'neurotech', horizon: 'compounding', lever: 'enrich',
    title: 'Replace the 2021 CSV with sourced records',
    detail:
      'Every figure that traces back to the 2021 import gets re-sourced or marked as unusable, '
      + 'starting with the firms that carry a live assessment.',
    because:
      'Northwood’s AUM, cheque band and co-investor list all come from a file nobody can vouch '
      + 'for, and the fit score is discounted for it. Several other rows share the source.',
    likelihood: 5, effort: 4, reach: 8,
    payoff:
      'Raises the evidence coverage of the whole board, which is the reading that decides whether '
      + 'any of the rankings can be trusted.',
    certainty: 'known', owner: 'mara',
  },
  {
    vehicle: 'neurotech', horizon: 'compounding', lever: 'process',
    title: 'Make accreditation verification part of the invite, not the close',
    detail:
      'Offer the third-party verification route at first serious contact rather than at '
      + 'subscription, with a standing arrangement so it takes days instead of weeks.',
    because:
      'Whitcomb is blocked at the last step on something that could have been settled at the first. '
      + 'Two further prospects have no accreditation record at all.',
    likelihood: 4, effort: 2.5, reach: 9,
    payoff:
      'Removes a class of late-stage surprise permanently. The kind of work that never shows up in '
      + 'a weekly number and shortens every close after it.',
    certainty: 'inferred', owner: 'ines',
  },

  // ---------------------------------------------------------------- Rails · now
  {
    vehicle: 'rails', horizon: 'now', lever: 'process',
    title: 'Disclose the Cedar fee break to Vantage',
    detail:
      'Their most-favoured-nation clause is triggered by the break documented in the Cedar side '
      + 'letter. Tell them, in writing, before they find it.',
    because:
      'The compliance registry flagged the interaction the day after Cedar signed, and it has been '
      + 'open since. Finding out from a quarterly report is a relationship problem, not a '
      + 'paperwork one.',
    likelihood: 5, effort: 0.5, reach: 1,
    payoff:
      'Keeps the largest cheque on either register from discovering a term change on their own.',
    certainty: 'known', owner: 'juan', gate: 'SEND',
  },
  {
    vehicle: 'rails', horizon: 'now', lever: 'enrich',
    title: 'Establish whether Vantage’s new vehicle competes with ours',
    detail:
      'They filed a Form D for a $400M vehicle in August. Find out whether it draws on the same '
      + 'capital and the same mandate.',
    because:
      'It is the one unanswered gate on the only assessment this vehicle has, and it decides '
      + 'whether the relationship is deepening or dividing.',
    likelihood: 4, effort: 1, reach: 1,
    payoff: 'Turns the only open question on this vehicle’s board into a fact.',
    certainty: 'known', owner: 'juan',
  },
  {
    vehicle: 'rails', horizon: 'compounding', lever: 'source',
    title: 'Build a crypto-native allocator list that is not the neuro list',
    detail:
      'The two vehicles share an LP universe and should not. Source allocators whose mandate is '
      + 'specifically digital-asset infrastructure.',
    because:
      'Four concurrent raises chase an overlapping universe, which is where the conflict cases '
      + 'come from. One open collision already exists on a single connector.',
    likelihood: 3, effort: 6, reach: 10,
    payoff:
      'Fewer cross-vehicle collisions, and a connector pool that is not being spent twice on the '
      + 'same people.',
    certainty: 'inferred', owner: 'sam',
  },

  // ---------------------------------------------------------------- per-target plays
  {
    vehicle: 'neurotech', entity: 'Northwood Capital', horizon: 'now', lever: 'convince',
    title: 'Send the verification letter the moment it exists',
    detail:
      'Raman named independent verification as the thing standing between a DDQ pack and a real '
      + 'conversation. Send it with a one-paragraph note and nothing else attached.',
    because: 'They stated the objection in the room. It is the whole content of their fit diagnosis.',
    likelihood: 4, effort: 0.25, reach: 1,
    payoff: 'Converts a conviction gap into a normal diligence process.',
    certainty: 'known', owner: 'mara', gate: 'SEND',
  },
  {
    vehicle: 'neurotech', entity: 'Northwood Capital', horizon: 'now', lever: 'route',
    title: 'Reach Raman through Vantage rather than cold',
    detail:
      'Raman was an investment director at Vantage until 31 August. Vantage is an LP in both of '
      + 'our vehicles. Ask their CIO for a note.',
    because:
      'The affiliation record surfaced the former seat, and the tie is tier-A by employment rather '
      + 'than by inference. No ask has ever been made of Vantage.',
    likelihood: 4, effort: 0.5, reach: 1,
    payoff: 'A warm route to the decision-maker that does not spend any existing connector.',
    certainty: 'known', owner: 'juan', gate: 'INTRO_ASK',
  },
  {
    vehicle: 'neurotech', entity: 'Northwood Capital', horizon: 'now', lever: 'enrich',
    title: 'Ask whether a 2026 emerging-manager slot is open',
    detail: 'One question, to Raman, before any more diligence effort is spent.',
    because:
      'She raised the programme, we did not. The mandate gate is unanswered and everything else on '
      + 'this target is downstream of it.',
    likelihood: 5, effort: 0.1, reach: 1,
    payoff: 'Either the whole target becomes real, or three days of diligence are saved.',
    certainty: 'known', owner: 'mara',
  },
  {
    vehicle: 'neurotech', entity: 'Tessaro Family Office', horizon: 'now', lever: 'route',
    title: 'Ask Duettmann for an introduction',
    detail:
      'The principal publicly named Duettmann as somebody she follows. Ask Duettmann for a note, '
      + 'not a pitch.',
    because:
      'They hold the thesis independently and have never heard of us — an awareness gap with a '
      + 'tier-A route sitting unused.',
    likelihood: 4, effort: 0.25, reach: 1,
    payoff:
      'Turns the highest-fit unconverted name into a conversation, starting from a shared premise.',
    certainty: 'inferred', owner: 'juan', gate: 'INTRO_ASK',
  },
  {
    vehicle: 'neurotech', entity: 'Tessaro Family Office', horizon: 'now', lever: 'reach',
    title: 'Prime with the podcast episode before the introduction',
    detail:
      'Send the episode featuring the adviser she named, through the connector, a week before any '
      + 'introduction lands.',
    because:
      'She found this field through podcasts and said so publicly. We converted an LP once by '
      + 'exactly this route — one instance, and it is the only evidence there is.',
    likelihood: 3, effort: 0.25, reach: 1,
    payoff:
      'The first real conversation starts from a shared premise rather than from an explanation.',
    certainty: 'guess', owner: 'mara',
  },
  {
    vehicle: 'neurotech', entity: 'Tessaro Family Office', horizon: 'now', lever: 'convene',
    title: 'Offer a seat at the November convening',
    detail: 'A seat at the research convening. No document, no ask, no follow-up sequence.',
    because:
      'Principal-decided, two to six weeks, and holds the thesis. The constraint is that they do '
      + 'not know us — which a room solves faster than a deck.',
    likelihood: 3, effort: 0.5, reach: 1,
    payoff: 'Relationship at zero connector cost, with a principal who can decide alone.',
    certainty: 'inferred', owner: 'sam',
  },
  {
    vehicle: 'neurotech', entity: 'Sable Point Capital', horizon: 'now', lever: 'route',
    title: 'Find one credible route into a seeder',
    detail:
      'Ask every LP and adviser on the register whether they know anybody at Sable Point. This is '
      + 'a census question, not an ask.',
    because:
      'No tie on file and no prior relationship — the only assessment on this board blocked purely '
      + 'on access, and the mandate is explicitly first-time managers.',
    likelihood: 2, effort: 1, reach: 1,
    payoff:
      'A seeder on the register is the strongest validation signal available to a Fund I, and even '
      + 'a pass with real feedback beats twenty polite family-office meetings.',
    certainty: 'known', owner: 'juan',
  },
  {
    vehicle: 'neurotech', entity: 'Sable Point Capital', horizon: 'now', lever: 'materials',
    title: 'Package the sourcing edge as an inspectable document',
    detail:
      'What the convening programme and the content operation actually produce, as deal flow an '
      + 'allocator can check rather than a claim they have to take.',
    because:
      'It is the second question a seeder asks, and nothing we have is written for that reader.',
    likelihood: 3, effort: 2, reach: 3,
    payoff: 'Answers the question every institutional allocator asks after the track record.',
    certainty: 'inferred', owner: 'mara',
  },
  {
    vehicle: 'neurotech', entity: 'Okonjo Family Office', horizon: 'now', lever: 'convene',
    title: 'See Okonjo at the November conference',
    detail: 'He is speaking. Be there, and do not ask for anything.',
    because:
      'Three weeks of silence after a warm introduction, and the connector is at two of three asks '
      + 'this quarter. A second ask now spends goodwill for nothing.',
    likelihood: 3, effort: 0.5, reach: 1,
    payoff: 'Contact that costs no connector goodwill, with a target whose diagnosis is timing.',
    certainty: 'known', owner: 'juan',
  },
  {
    vehicle: 'neurotech', entity: 'Roos Foundation', horizon: 'now', lever: 'materials',
    title: 'Lead with a PRI structure note, not the primer',
    detail:
      'A note on how a programme-related investment into this vehicle would be structured, written '
      + 'for a foundation’s counsel.',
    because:
      'Forty-seven grants over seven years include no LP positions and two PRIs. The LP path is the '
      + 'wrong opening and the primer is written for the wrong reader.',
    likelihood: 3, effort: 1.5, reach: 2,
    payoff: 'Opens the only instrument this funder has ever used.',
    certainty: 'known', owner: 'mara',
  },
];

const NEEDS: NeedSeed[] = [
  {
    vehicle: 'neurotech', entity: 'Northwood Capital', kind: 'validation',
    statement: 'Somebody other than us confirming the operating-company marks.',
    evidence: 'Raman said it in the room on 8 September and would not discuss the science until it is settled.',
    met: false, as_of: '2026-09-08',
  },
  {
    vehicle: 'neurotech', entity: 'Northwood Capital', kind: 'permission',
    statement: 'A 2026 emerging-manager slot that is not already spoken for.',
    evidence: 'She raised the programme unprompted; nobody has asked whether a slot exists.',
    met: null, as_of: '2026-09-08',
  },
  {
    vehicle: 'neurotech', entity: 'Northwood Capital', kind: 'mechanics',
    statement: 'A valuation policy for pre-revenue assets they can defend to nine families.',
    evidence: 'Asked in the DDQ request. We have a policy and it has never been written up for an external reader.',
    met: false, as_of: '2026-09-08',
  },
  {
    vehicle: 'neurotech', entity: 'Tessaro Family Office', kind: 'know_us',
    statement: 'To know who we are at all.',
    evidence: 'Public interview names two of our podcast guests as people she follows, and never mentions us.',
    met: false, source: 'S12', as_of: '2026-09-02',
  },
  {
    vehicle: 'neurotech', entity: 'Tessaro Family Office', kind: 'know_domain',
    statement: 'Nothing — she already holds the thesis.',
    evidence: 'Has spoken publicly about wanting more exposure to frontier neuroscience and about why the timelines deter most investors.',
    met: true, as_of: '2026-09-02',
  },
  {
    vehicle: 'neurotech', entity: 'Tessaro Family Office', kind: 'believe_access',
    statement: 'Evidence that we get into the rounds that matter.',
    evidence: 'Not yet raised, because no conversation has happened. Inferred from what a direct investor of this shape asks.',
    met: null, as_of: '2026-09-20',
  },
  {
    vehicle: 'neurotech', entity: 'Sable Point Capital', kind: 'believe_access',
    statement: 'An inspectable sourcing edge, not a claimed one.',
    evidence: 'Standard for a seeder underwriting a first-time manager. Nothing we hold is written for that reader.',
    met: false, as_of: '2026-09-20',
  },
  {
    vehicle: 'neurotech', entity: 'Sable Point Capital', kind: 'validation',
    statement: 'A manager who has already assembled a real LP base.',
    evidence: '$56.0M hard from four institutions. True, and currently said to nobody there.',
    met: true, as_of: '2026-09-20',
  },
  {
    vehicle: 'neurotech', entity: 'Roos Foundation', kind: 'permission',
    statement: 'A trust deed that permits a fund LP position, or a PRI that avoids the question.',
    evidence: 'Forty-seven grants over seven years include no LP positions. Nobody has read the deed.',
    met: null, source: 'S02', as_of: '2026-09-14',
  },
  {
    vehicle: 'neurotech', entity: 'Roos Foundation', kind: 'mechanics',
    statement: 'A current §4944(c) position their counsel can rely on.',
    evidence: 'Our only note is from March 2024 and expired.',
    met: false, source: 'S10', as_of: '2024-03-11',
  },
  {
    vehicle: 'neurotech', entity: 'Okonjo Family Office', kind: 'timing',
    statement: 'Their own window, which is not now.',
    evidence: 'Three weeks of silence after a warm introduction that he agreed to receive.',
    met: false, as_of: '2026-09-11',
  },
  {
    vehicle: 'neurotech', entity: 'Whitcomb Capital', kind: 'mechanics',
    statement: 'A way to prove accreditation without handing a manager financial documents.',
    evidence: 'Only a self-certification is on file, and 506(c) does not accept one.',
    met: false, as_of: '2026-08-14',
  },
  {
    vehicle: 'rails', entity: 'Vantage Partners', kind: 'mechanics',
    statement: 'To be told about a term change before they find it.',
    evidence: 'Their MFN is triggered by the Cedar fee break, signed 18 September, and nobody has told them.',
    met: false, as_of: '2026-09-18',
  },
];

export async function seedPlays(db: Db): Promise<{ plays: number; needs: number }> {
  const existing = await db.one<{ n: string }>('select count(*)::text as n from plays.play');
  if (existing && Number(existing.n) > 0) return { plays: 0, needs: 0 };

  const users = await db.query<{ id: string; handle: string }>('select id, handle from platform.app_user');
  const vehicles = await db.query<{ id: string; slug: string }>('select id, slug from platform.vehicle');
  const entities = await db.query<{ entity_id: string; display_name: string }>(
    'select entity_id, display_name from identity.entity',
  );
  const u = (h?: string) => (h ? users.find((x) => x.handle === h)?.id ?? null : null);
  const v = (s: string) => vehicles.find((x) => x.slug === s)!.id;
  const e = (n?: string) => (n ? entities.find((x) => x.display_name === n)?.entity_id ?? null : null);

  await db.transaction(async (tx) => {
    let sort = 0;
    for (const p of PLAYS) {
      await tx.query(
        `insert into plays.play
           (vehicle_id, entity_id, horizon, lever, title, detail, because, likelihood,
            effort_days, reach, payoff, certainty, suggested_owner, gate, sort)
         values ($1,$2,$3::plays.horizon,$4::plays.lever,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [v(p.vehicle), e(p.entity), p.horizon, p.lever, p.title, p.detail, p.because,
         p.likelihood, p.effort, p.reach ?? 1, p.payoff, p.certainty ?? 'inferred',
         u(p.owner), p.gate ?? null, sort++],
      );
    }
    let nsort = 0;
    for (const n of NEEDS) {
      const entityId = e(n.entity);
      if (!entityId) continue;
      await tx.query(
        `insert into plays.need
           (vehicle_id, entity_id, kind, statement, evidence, met, source, as_of, sort)
         values ($1,$2,$3::plays.need_kind,$4,$5,$6,$7,$8::date,$9)`,
        [v(n.vehicle), entityId, n.kind, n.statement, n.evidence,
         n.met ?? null, n.source ?? null, n.as_of, nsort++],
      );
    }
  });

  return { plays: PLAYS.length, needs: NEEDS.length };
}
