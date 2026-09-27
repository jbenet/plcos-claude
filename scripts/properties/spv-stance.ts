/**
 * SPV stance (Juan, 27 Sep 2026), on invented identities only: a person's setting wins and is
 * reversible; research beats derived; unknown by default; a "doesn't" LP is flagged on an SPV's
 * selection; the two new fact fields validate and map in through the import; and Dakota's text never
 * leaves dakota.account.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { withDb, type Db } from '../../lib/db';
import { pipelineData } from '../../lib/pipeline-data';
import { check as findingProblems, FACT_FIELDS, type Finding } from '../../lib/enrich/schema';
import { importFindings } from '../../lib/enrich/import';
import { EMPTY, matches, spvFlagged } from '../../components/strategy/pipeline-model';
import {
  dakotaCoInvests, deriveSpvStance, readSpvText, resolveSpv, setSpvStance, spvHistory, spvReadings, withdrawSpvStance,
  type SpvEvidence,
} from '../../modules/strategy';
import type { Check } from './harness';

const ev = (o: Partial<SpvEvidence>): SpvEvidence => ({
  kind: 'text', stance: 'does', minDeals: null, label: 'Invented', quote: null, source: 'invented', url: null,
  asOf: '2026-09-01', confidence: 'medium', lastVerifiedBy: null, ...o,
});

export function spvRuleProperties(check: Check) {
  const none = resolveSpv([]);
  check('SPV unknown by default: nothing on file reads unknown, likely open',
    none.stance === 'unknown' && none.basis === 'none' && none.minDeals === null
      && resolveSpv([ev({ kind: 'research', stance: 'unknown', minDeals: 0 })]).basis === 'none',
    'A research "unknown" (nothing found) is not a stance: unsupported is not a refusal.');

  const kinds: SpvEvidence['kind'][] = ['research', 'pipeline', 'dakota', 'text'];
  const stances = ['does', 'does-not'] as const;
  const confs = ['high', 'medium', 'low'] as const;
  let personLost = 0, researchLost = 0, cases = 0;
  for (const k of kinds) for (const st of stances) for (const c of confs) for (const ps of ['does', 'does-not', 'unknown'] as const) {
    cases++;
    const other = ev({ kind: k, stance: st, confidence: c, asOf: '2026-09-26' });
    const r = resolveSpv([other, ev({ kind: 'person', stance: ps, confidence: 'high', asOf: '2020-01-01' })]);
    if (r.stance !== ps || r.basis !== 'person') personLost++;
    if (k !== 'research') {
      const flip = st === 'does' ? 'does-not' : 'does';
      const rr = resolveSpv([other, ev({ kind: 'research', stance: flip, confidence: 'low', asOf: '2019-01-01' })]);
      if (rr.stance !== flip || rr.basis !== 'research' || !rr.conflict) researchLost++;
    }
  }
  check('SPV a person’s setting wins over every other source, whatever its strength or date', personLost === 0,
    `${cases} combinations of source, stance, confidence and a person’s older setting (including an explicit unknown).`);
  check('SPV research beats derived signals, and the conflict is shown', researchLost === 0,
    'A low-confidence, older research fact still stands over our SPVs, Dakota and research text; the losing side is kept as the conflict.');
  const derived = resolveSpv([ev({ kind: 'text', stance: 'does-not', confidence: 'low' }), ev({ kind: 'dakota', stance: 'does', confidence: 'medium' })]);
  const ours = resolveSpv([ev({ kind: 'dakota', stance: 'does-not' }), ev({ kind: 'pipeline', stance: 'does', minDeals: 2, confidence: 'high' })]);
  check('SPV within derived signals the stronger wins: our own SPVs, then Dakota, then text',
    derived.stance === 'does' && derived.conflict?.kind === 'text' && ours.stance === 'does' && ours.minDeals === 2,
    'Dakota’s flag over words in a profile; our records over the vendor.');
  const counts = resolveSpv([ev({ kind: 'research', stance: 'does', minDeals: 3 }), ev({ kind: 'pipeline', stance: 'does', minDeals: 5 }), ev({ kind: 'text', stance: 'does', minDeals: 9, confidence: 'low' })]);
  const personCount = resolveSpv([ev({ kind: 'person', stance: 'does', minDeals: 2 }), ev({ kind: 'pipeline', stance: 'does', minDeals: 5 })]);
  check('SPV a count is a lower bound: the largest agreeing count holds, and a person’s own count wins',
    counts.minDeals === 9 && personCount.minDeals === 2 && resolveSpv([ev({ kind: 'person', stance: 'does-not' }), ev({ kind: 'pipeline', minDeals: 4 })]).minDeals === null,
    'No count under a stance of doesn’t.');

  const t = (x: string) => readSpvText(x);
  check('SPV research text: SPVs, co-investments and syndicates read as does; "does not do SPVs" and fund-only as does-not',
    t('She co-invests through SPVs alongside lead managers.')?.stance === 'does'
      && t('The office has made 4 co-investments since 2021.')?.minDeals === 4
      && t('The foundation does not do SPVs.')?.stance === 'does-not'
      && t('It invests only through commingled funds.')?.stance === 'does-not'
      && t('It never participates in syndicates.')?.stance === 'does-not'
      && t('Backs seed funds and writes angel checks.') === null
      && (t('Co-invested with Invented Ventures in a Series A.')?.stance ?? null) === null,
    'Round participation ("co-invested with") is not an SPV signal; a count is taken when the text gives one.');
  check('SPV Dakota’s co-investment flag: only a yes is a signal',
    ['Yes', 'true', 'TRUE', '1', 'yes - opportunistic'].every(dakotaCoInvests) && !['No', 'false', '', 'Unknown', null].some(dakotaCoInvests),
    'Absence or no is not evidence of doesn’t: a vendor’s blank is unsupported, not a refusal.');

  const base: Finding = { key: randomUUID(), name: 'Invented Fund', researched: { at: '2026-09-27', by: 'fixture', workflow: 'W1', version: '1.49' },
    identity: { match: 'confirmed', basis: 'Invented' }, facts: [] };
  const withFact = (field: string, value: unknown, quote?: string) => ({ ...base, facts: [{ field, value, quote, confidence: 'high',
    source: { url: 'https://example.org/invented', kind: 'primary' } }] });
  const ok = (f: unknown) => findingProblems(f).length === 0;
  check('SPV fact fields: spv_appetite and spv_deals are in FACT_FIELDS under exactly those names',
    FACT_FIELDS.includes('spv_appetite') && FACT_FIELDS.includes('spv_deals'), 'The names the enrichment already writes.');
  check('SPV fact fields validate: stances, whole counts, and a quote for anything that asserts',
    ok(withFact('spv_appetite', 'does', 'We co-invest via SPVs.')) && ok(withFact('spv_appetite', 'does-not', 'Funds only.'))
      && ok(withFact('spv_appetite', 'unknown')) && ok(withFact('spv_deals', 4, 'Four SPVs: A, B, C and D.')) && ok(withFact('spv_deals', '6', 'Six SPVs.'))
      && ok(withFact('spv_deals', 0))
      && !ok(withFact('spv_appetite', 'maybe', 'Unclear.')) && !ok(withFact('spv_appetite', 'does'))
      && !ok(withFact('spv_deals', 'four', 'Four.')) && !ok(withFact('spv_deals', -1, 'x')) && !ok(withFact('spv_deals', 2.5, 'x'))
      && !ok(withFact('spv_deals', 3)),
    'Unknown needs no quote; a count of zero asserts nothing; a stance or a count without its quote is refused.');
}

export async function spvStanceProperties(check: Check, db: Db) {
  spvRuleProperties(check);
  await withDb(db, async () => {
    const actor = (await db.one<{ id: string }>('select id::text from platform.app_user where active order by handle limit 1'))!.id;
    const spv = (await db.one<{ id: string }>("select id::text from platform.vehicle where kind='spv' and phase='active' order by sort_order limit 1"))!.id;
    const spvs = (await db.query<{ id: string }>("select id::text from platform.vehicle where kind='spv' order by sort_order")).map((r) => r.id);
    const tag = randomUUID().slice(0, 6);
    const org = async (name: string) => (await db.one<{ id: string }>(`insert into identity.entity(entity_type,display_name) values('org',$1) returning entity_id::text id`, [`${name} ${tag}`]))!.id;
    const pursue = (e: string, vehicle: string, status = 'sourcing') => db.query(`insert into strategy.pursuit(entity_id,vehicle_id,owner_id,status,status_source,status_set_at)
      values($1,$2,$3,$4::strategy.pursuit_status,'us',now())`, [e, vehicle, actor, status]);
    const read = async (e: string) => (await spvReadings(db, [e])).get(e)!;

    // The import maps the two fact fields in, below a person's setting.
    const researched = await org('Invented Research Office'), fundsOnly = await org('Invented Funds-Only Endowment'), plain = await org('Invented Plain Capital');
    for (const e of [researched, fundsOnly, plain]) await pursue(e, spv);
    const dir = await mkdtemp(join(tmpdir(), 'spv-stance-'));
    try {
      await mkdir(join(dir, 'raw'));
      const finding = (key: string, facts: Finding['facts']): Finding => ({ key, name: `Invented ${key.slice(0, 4)}`,
        researched: { at: '2026-09-27', by: 'fixture', workflow: 'W1', version: '1.49' }, identity: { match: 'confirmed', basis: 'Invented' }, facts });
      const src = (n: string) => ({ url: `https://example.org/invented-spv/${tag}/${n}`, kind: 'primary' as const });
      await writeFile(join(dir, 'raw', `${researched}.json`), JSON.stringify(finding(researched, [
        { field: 'spv_appetite', value: 'does', quote: 'Invented: we co-invest through single-deal SPVs.', confidence: 'medium', source: src('a') },
        { field: 'spv_deals', value: 5 as unknown as string, quote: 'Invented: five SPVs, named A to E.', confidence: 'medium', source: src('b') },
      ])));
      await writeFile(join(dir, 'raw', `${fundsOnly}.json`), JSON.stringify(finding(fundsOnly, [
        { field: 'spv_appetite', value: 'does-not', quote: 'Invented: commits only through commingled funds.', confidence: 'high', source: src('c') },
      ])));
      const imported = await importFindings(actor, dir);
      const r1 = await read(researched), r2 = await read(fundsOnly), r3 = await read(plain);
      check('SPV the import maps spv_appetite and spv_deals onto the stance, with their quotes and provenance',
        imported.rejected === 0 && (imported.spvFacts ?? 0) === 3 && r1.stance === 'does' && r1.minDeals === 5 && r1.basis === 'research'
          && r1.evidence.every((e) => e.kind === 'research' && e.quote && e.url?.startsWith('https://example.org/') && e.asOf === '2026-09-27' && e.confidence === 'medium')
          && r2.stance === 'does-not' && r3.stance === 'unknown' && r3.basis === 'none',
        `${imported.spvFacts ?? 0} SPV facts mapped; a JSON number for spv_deals is read as a count; an LP with nothing is unknown.`);

      // Derived: our own SPVs, Dakota, research text — and research above them.
      const ours = await org('Invented Committed Allocator');
      await pursue(ours, spv); await pursue(ours, spvs[1]!, 'committed'); await pursue(ours, spvs[2]!, 'committed');
      const secret = `INVENTED-DAKOTA-TEXT-${tag}`;
      const dak = await org('Invented Vendor-Flagged Office');
      await pursue(dak, spv);
      await db.query(`insert into dakota.account(id,type,co_investments__c,lastmodifieddate,entity_id,replica_file,last_verified_by)
        values($1,'Family Office',$2,'2026-09-20T00:00:00Z',$3,'invented-fixture',$4)`, [`inv-${tag}-1`, `Yes — ${secret}`, dak, actor]);
      const no = await org('Invented Vendor-No Office');
      await pursue(no, spv);
      await db.query(`insert into dakota.account(id,type,co_investments__c,lastmodifieddate,entity_id,replica_file,last_verified_by)
        values($1,'Family Office',$2,'2026-09-20T00:00:00Z',$3,'invented-fixture',$4)`, [`inv-${tag}-2`, `No — ${secret}`, no, actor]);
      // Research says doesn't; Dakota says yes: research stands.
      await db.query(`insert into dakota.account(id,type,co_investments__c,lastmodifieddate,entity_id,replica_file,last_verified_by)
        values($1,'Endowment','true','2026-09-21T00:00:00Z',$2,'invented-fixture',$3)`, [`inv-${tag}-3`, fundsOnly, actor]);
      const texty = await org('Invented Profile Trust');
      await pursue(texty, spv);
      await db.query(`insert into research.note(entity_id,kind,body,data) values($1,'public_profile',$2,'{}')`, [texty, 'Invented: it has made 3 co-investments alongside its managers.']);
      const report = await deriveSpvStance(db);
      const again = await deriveSpvStance(db);
      const [o, d, n, t, f] = await Promise.all([read(ours), read(dak), read(no), read(texty), read(fundsOnly)]);
      check('SPV derived signals: our SPVs count, Dakota’s yes and research text each give a stance; research stays above them',
        o.stance === 'does' && o.minDeals === 2 && o.basis === 'derived' && o.winner?.kind === 'pipeline'
          && d.stance === 'does' && d.winner?.kind === 'dakota' && n.stance === 'unknown'
          && t.stance === 'does' && t.minDeals === 3 && t.winner?.kind === 'text'
          && f.stance === 'does-not' && f.basis === 'research' && f.conflict?.kind === 'dakota'
          && report.dakota === again.dakota && report.pipeline === again.pipeline && report.text === again.text,
        `Committed on two of our SPVs is ≥2; a Dakota "No" is no signal; the pass is repeatable (${report.pipeline} ours, ${report.dakota} Dakota, ${report.text} text).`);
      const leaked = Number((await db.one<{ n: string }>(`select count(*)::text n from strategy.spv_evidence e where to_jsonb(e)::text like $1`, [`%${secret}%`]))!.n);
      const dakRow = (await db.query<{ label: string; quote: string | null }>(`select label, quote from strategy.spv_evidence where kind='dakota' and entity_id=$1`, [dak]))[0];
      check('SPV Dakota’s text is never copied out of dakota.account',
        leaked === 0 && dakRow?.label === 'Dakota: co-invests' && dakRow.quote === null && !JSON.stringify(d).includes(secret)
          && !JSON.stringify((await pipelineData(spv)).rows).includes(secret),
        'Only a fixed label, its date and its importer leave the table; the stance, the rows and the page data carry none of its words.');

      // A person's setting wins, is audited, and is reversible.
      await setSpvStance(db, researched, actor, { stance: 'does-not', note: 'Invented: told us no SPVs this year.' });
      const set = await read(researched);
      await setSpvStance(db, researched, actor, { stance: 'does', minDeals: 7 });
      const reset = await read(researched);
      const withdrew = await withdrawSpvStance(db, researched, actor);
      const back = await read(researched);
      const history = await spvHistory(db, researched);
      const audits = Number((await db.one<{ n: string }>(`select count(*)::text n from platform.audit_log where subject_id=$1 and action like 'spv.%'`, [researched]))!.n);
      check('SPV a person’s setting wins and is reversible: replaced, then withdrawn, back to the research, every change audited',
        set.stance === 'does-not' && set.basis === 'person' && set.conflict?.kind === 'research'
          && reset.stance === 'does' && reset.minDeals === 7 && withdrew && back.stance === 'does' && back.minDeals === 5 && back.basis === 'research'
          && history.length === 2 && history.every((h) => h.ended) && audits === 3
          && !(await withdrawSpvStance(db, researched, actor)),
        'Two settings kept (one replaced, one withdrawn); three audit rows; a second withdrawal changes nothing.');
      let refused = 0;
      for (const bad of [{ stance: 'maybe' }, { stance: 'does', minDeals: 0.5 }, { stance: 'does', minDeals: -2 }] as const) {
        try { await setSpvStance(db, plain, actor, bad as never); } catch { refused++; }
      }
      check('SPV a setting refuses what the page does not offer', refused === 3 && (await read(plain)).basis === 'none',
        'An unknown stance or a count that is not a whole number from 1 is refused, and nothing is written.');

      // Flagged on an SPV's selection: dimmed, filtered, and warned before a move.
      await setSpvStance(db, plain, actor, { stance: 'does-not' });
      const rows = (await pipelineData(spv)).rows;
      const row = (e: string) => rows.find((r) => r.entityId === e)!;
      const now = Date.now();
      const fundRows = (await pipelineData((await db.one<{ id: string }>("select id::text from platform.vehicle where kind='fund' and phase='active' order by sort_order limit 1"))!.id)).rows;
      check('SPV a doesn’t LP is flagged on an SPV’s selection, and only there',
        spvFlagged(row(plain)) && spvFlagged(row(fundsOnly)) && !spvFlagged(row(researched)) && !spvFlagged(row(ours))
          && row(plain).spv.why?.includes('Set by') === true
          && !matches(row(plain), { ...EMPTY, spv: 'open' }, [], now) && matches(row(researched), { ...EMPTY, spv: 'open' }, [], now)
          && matches(row(fundsOnly), { ...EMPTY, spv: 'not' }, [], now) && matches(row(dak), { ...EMPTY, spv: 'does' }, [], now)
          && fundRows.every((r) => !r.spvVehicle && !spvFlagged(r)),
        'On a fund, a doesn’t LP is a note, not a flag; the filter keeps does-or-unknown, does, unknown or doesn’t.');
      await withdrawSpvStance(db, plain, actor);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
