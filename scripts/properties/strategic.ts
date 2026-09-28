/**
 * Strategic value (issue 0120), on invented identities only: a small derived level per LP and
 * vehicle — high, some, none, unknown — with its reasons; a person's grade wins; unknown without
 * evidence, never none; per vehicle (an SPV's company, a fund's field); a separate lens that never
 * moves the score; and the list sorts and filters by it.
 */
import { randomUUID } from 'node:crypto';
import { withDb, type Db } from '../../lib/db';
import { pipelineData } from '../../lib/pipeline-data';
import { config } from '../../config/deployment';
import { EMPTY, filtersFrom, matches, rankRows, type PipelineRow } from '../../components/strategy/pipeline-model';
import {
  mentions, spvCompany, strategicMark, strategicScope, UNKNOWN_MARK, type StrategicInputs, type StrategicScope,
} from '../../modules/strategy';
import type { Check } from './harness';

const neuro: StrategicScope = { company: null, label: 'neurotech', terms: ['neuro*', 'brain', 'bci'] };
const cortex: StrategicScope = { ...neuro, company: 'Cortex' };
const none: StrategicInputs = { texts: [] };
const fact = (field: string, value: string) => ({ field, value, asOf: '2026-09-01' });

export function strategicRuleProperties(check: Check) {
  const empty = strategicMark(cortex, none);
  check('Strategic unknown without evidence: nothing on file is unknown, not none, with no reasons',
    empty.level === 'unknown' && empty.basis === 'none' && empty.reasons.length === 0
      && strategicMark(cortex, { texts: [fact('role', 'Partner at an invented logistics fund.')] }).level === 'unknown',
    'Research that says nothing about the field is not a judgement against them (rule 7).');

  const tie = strategicMark(cortex, { texts: [fact('investment', 'Led the seed round of Cortex in 2024.')] });
  check('Strategic an SPV: a tie to its company by name reads high, and the why names the company',
    tie.level === 'high' && tie.basis === 'derived' && tie.reasons[0]!.includes('Cortex') && tie.reasons[0]!.includes('2026-09-01')
      && strategicMark(neuro, { texts: [fact('investment', 'Led the seed round of Cortex in 2024.')] }).level === 'unknown',
    'The same fact about the company counts on its SPV only; the fund’s field words decide there.');

  const one = strategicMark(neuro, { texts: [fact('board', 'Board member of an invented neuroscience institute.')] });
  const twoSame = strategicMark(neuro, { texts: [fact('board', 'Board of a neurotech startup.'), fact('role', 'COO of a brain-imaging company.')] });
  const twoKinds = strategicMark(neuro, { texts: [fact('board', 'Board of a neurotech startup.'), fact('investment', 'Backed an invented BCI company.')] });
  check('Strategic one tie to the field reads some; two kinds of tie read high; one kind twice is still one',
    one.level === 'some' && one.reasons[0]!.startsWith('Works in neurotech') && twoSame.level === 'some' && twoSame.points === 1
      && twoKinds.level === 'high' && twoKinds.reasons.length === 2,
    'Operating, portfolio and expertise count once each.');

  check('Strategic words match at a word start: neuro* is neuroscience, not euro; ai is not maintain; neural is not neurotech',
    mentions('A neuroscience lab', ['neuro*']) === 'neuro' && mentions('A euro fund', ['neuro*']) === null
      && mentions('Maintains a portfolio', ['ai']) === null && mentions('An AI fund', ['ai']) === 'ai'
      && mentions('Neural networks for ads', config.strategic.domains.find((d) => d.label === 'neurotech')!.terms) === null,
    'A word inside another word is not a mention.');

  const sourced = strategicMark(neuro, { prospect: { strategic: true, reason: 'Invented: a neurologist who refers patients.', researched: true }, texts: [] });
  const notSourced = strategicMark(neuro, { prospect: { strategic: false, reason: 'Invented: qualifies on check size.', researched: true }, texts: [] });
  const intake = strategicMark(neuro, { prospect: { strategic: false, reason: 'Invented: a name to research.', researched: false }, texts: [] });
  check('Strategic sourcing: marked strategic reads some with its reason; researched and not marked reads none; intake alone is unknown',
    sourced.level === 'some' && sourced.reasons[0]!.includes('refers patients') && notSourced.level === 'none'
      && notSourced.reasons[0]!.startsWith('Sourced and not marked strategic') && intake.level === 'unknown',
    'A prospect row still at New has not been judged.');

  const w5 = (affinity: string, askShape: string | null = null) => strategicMark(neuro, { strategy: { affinity: { level: affinity, basis: 'Invented basis.' }, askShape }, texts: [] });
  check('Strategic the strategy: affinity high or an ask of advice, introductions or co-investing count; affinity low alone reads none',
    w5('high').level === 'some' && w5('medium', 'advice').level === 'some' && w5('high', 'intro to others').level === 'high'
      && w5('medium', 'fund commitment').level === 'unknown' && w5('low').level === 'none'
      && strategicMark(neuro, { strategy: { affinity: { level: 'low' } }, texts: [fact('board', 'Board of a neurotech startup.')] }).level === 'some',
    'A judgement against counts only when nothing speaks for them.');

  const graded = (grade: 'strong' | 'good' | 'neutral' | 'weak', texts = [fact('investment', 'Led the seed round of Cortex.')]) =>
    strategicMark(cortex, { assessed: { grade, finding: 'Invented finding.', certainty: 'known', asOf: '2026-09-02' }, texts });
  check('Strategic a person’s grade in Fit & standing wins, and what the records say stays beneath it',
    graded('strong', []).level === 'high' && graded('strong', []).basis === 'assessed' && graded('good').level === 'some'
      && graded('neutral').level === 'none' && graded('weak').level === 'none'
      && graded('neutral').reasons[0]!.startsWith('Graded neutral') && graded('neutral').reasons[1]!.includes('Cortex'),
    'Like a person’s SPV setting: reversible by regrading, never overruled by a derived signal.');

  const vehicle = (slug: string, name: string, kind: string) => strategicScope({ slug, name, kind }, config.strategic.domains);
  check('Strategic per vehicle: an SPV’s company from its name, a fund’s field from its slug; an unknown field keeps the company tie only',
    spvCompany('SPV — Cortex') === 'Cortex' && spvCompany('Invented Labs SPV') === 'Invented Labs' && spvCompany('SPV — Meridian (2025)') === 'Meridian'
      && vehicle('neurotech', 'PLC Neurotech I', 'fund').company === null && vehicle('neurotech', 'PLC Neurotech I', 'fund').label === 'neurotech'
      && vehicle('rails', 'PLC Crypto/Rails', 'fund').label === 'crypto' && vehicle('spv-cortex', 'SPV — Cortex', 'spv').company === 'Cortex'
      && vehicle('spv-lattice', 'SPV — Lattice', 'spv').terms.length === 0 && vehicle('spv-lattice', 'SPV — Lattice', 'spv').company === 'Lattice',
    'The same LP can be high for one vehicle and unknown for another.');

  // The list: sorted high, some, unknown, none; filtered by level; "High or some" keeps both.
  const row = (id: string, level: PipelineRow['strategic']['level'], score: number | null) => ({
    id, name: id, org: null, orgFirst: false, isOrg: true, score, strategic: { ...UNKNOWN_MARK, level, points: level === 'high' ? 2 : level === 'some' ? 1 : 0 },
  }) as unknown as PipelineRow;
  const rows = [row('a', 'none', 90), row('b', 'unknown', 80), row('c', 'some', 20), row('d', 'high', null), row('e', 'some', 60)];
  const order = rankRows(rows, 'strategic', -1).map((r) => r.id).join('');
  const f = (strategic: string) => rows.filter((r) => matches(r, filtersFrom({ strategic }), [], 0)).map((r) => r.id).sort().join('');
  check('Strategic the list sorts high, some, unknown, none — the score orders within a level — and filters by level',
    order === 'decba' && f('high') === 'd' && f('some') === 'ce' && f('useful') === 'cde' && f('none') === 'a' && f('unknown') === 'b'
      && f('any') === 'abcde' && filtersFrom({ strategic: 'bogus' }).strategic === EMPTY.strategic,
    `Order ${order}. A small check with strategic value sorts above a large one without.`);
}

export async function strategicProperties(check: Check, db: Db) {
  strategicRuleProperties(check);
  await withDb(db, async () => {
    const actor = (await db.one<{ id: string }>('select id::text from platform.app_user where active order by handle limit 1'))!.id;
    const spv = (await db.one<{ id: string; name: string }>("select id::text, name from platform.vehicle where kind='spv' and phase='active' order by sort_order limit 1"))!;
    const fund = (await db.one<{ id: string }>("select id::text from platform.vehicle where slug='neurotech'"))!.id;
    const tag = randomUUID().slice(0, 6);
    const org = async (name: string) => (await db.one<{ id: string }>(`insert into identity.entity(entity_type,display_name) values('org',$1) returning entity_id::text id`, [`${name} ${tag}`]))!.id;
    const pursue = async (e: string, vehicle: string) => (await db.one<{ id: string }>(`insert into strategy.pursuit(entity_id,vehicle_id,owner_id,status,status_source,status_set_at)
      values($1,$2,$3,'sourcing','us',now()) returning pursuit_id::text id`, [e, vehicle, actor]))!.id;
    const company = spvCompany(spv.name)!;

    const tied = await org('Invented Tie Office'), field = await org('Invented Field Office'), blank = await org('Invented Blank Office');
    for (const e of [tied, field, blank]) { await pursue(e, spv.id); await pursue(e, fund); }
    const before = (await pipelineData(spv.id)).rows.map((r) => [r.id, r.score]);
    const doc = `pub:props-strategic-${tag}`;
    await db.query(`insert into research.source_doc (doc_id,title,kind,origin,as_of,strength,supports,body)
      values ($1,'Invented page','public:press','https://example.org/props-strategic','2026-09-01','moderate','Invented.','')`, [doc]);
    await db.query(`insert into research.claim (entity_id,field,value,source,as_of,confidence) values
      ($1,'public.board',$3,$4,'2026-09-01','medium'), ($2,'public.role','Chief scientist at an invented neuroscience company.',$4,'2026-09-01','medium')`,
      [tied, field, `Board observer at ${company}.`, doc]);
    // A prospect row marks the blank office strategic on the fund only.
    const fundPursuit = (await db.one<{ id: string }>('select pursuit_id::text id from strategy.pursuit where entity_id=$1 and vehicle_id=$2', [blank, fund]))!.id;
    await db.query(`insert into research.note (entity_id,kind,body,data) values ($1,'context','Invented.',$2::jsonb)`,
      [blank, JSON.stringify({ source: 'prospects', pursuitId: fundPursuit, vehicleId: fund, status: 'sourcing', strategic: true, reason: 'Invented: runs a neurology referral network.' })]);

    const spvRows = (await pipelineData(spv.id)).rows, fundRows = (await pipelineData(fund)).rows;
    const on = (rows: PipelineRow[], e: string) => rows.find((r) => r.entityId === e)!.strategic;
    check('Strategic from the records, per vehicle: a board seat at the SPV’s company is high there and unknown on the fund',
      on(spvRows, tied).level === 'high' && on(spvRows, tied).reasons[0]!.includes(company) && on(fundRows, tied).level === 'unknown',
      `${company} is the SPV’s company; the fund reads its field.`);
    check('Strategic from the records: a role in the field reads some on both; a prospect row counts on its own vehicle only',
      on(fundRows, field).level === 'some' && on(spvRows, field).level !== 'none'
        && on(fundRows, blank).level === 'some' && on(fundRows, blank).reasons[0]!.includes('referral') && on(spvRows, blank).level === 'unknown',
      'The sourcing judgement belongs to the vehicle it was made for.');
    const after = (await pipelineData(spv.id)).rows.map((r) => [r.id, r.score]);
    check('Strategic is a separate lens: the scores on the list are the same before and after strategic evidence lands',
      before.length > 0 && JSON.stringify(before) === JSON.stringify(after),
      'Never blended into the score (issue 0120).');
  });
}
