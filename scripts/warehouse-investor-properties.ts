/** Invented identities only. Regression coverage for investor extraction and PL policy. */
import { config } from '../config/deployment';
import { addWarehouseFirmTies, addWarehouseNetworkTies, addWarehouseMembershipTies, classifyWarehouseTie, warehouseCoverage,
  type WarehousePerson, type WarehouseMatch, type WarehouseTie } from '../lib/enrich/warehouse-graph';

type Check = (name: string, ok: boolean, detail: string) => void;
export function warehouseInvestorProperties(check: Check) {
  const person = (key: string, extra: Partial<WarehousePerson> = {}): WarehousePerson => ({key,name:key,org:null,
    emailDomain:null,roles:[],warehouseIds:{},source:'invented fixture',as_of:'2026-09-26',confidence:'fixture',last_verified_by:'fixture',...extra});
  const people = [person('team',{teamKey:'invented-team'}),person('founder',{oneHop:true,roles:['founder']}),
    person('member',{oneHop:true,roles:['founder']}),person('crm',{roles:['investor']}),
    person('coinvestor:firm',{name:'Invented Ventures LLC',nodeType:'organization'}),person('lp')];
  const policy=addWarehouseNetworkTies(people,'2026-09-26');
  check('WINV founder access connects through explicit policy; investor roles alone do not',
    policy.some(t=>[t.from,t.to].includes('member')&&[t.from,t.to].includes('team'))
    && !policy.some(t=>[t.from,t.to].includes('crm')) && policy.every(t=>t.tier==='B'&&t.lastSeen===null&&!!t.basis),
    'A founder remains a first hop. An investor role alone carries no source-row evidence.');
  const directory=[person('directory'),person('labos'),person('listed'),person('unlisted',{roles:['investor']}),person('team',{teamKey:'invented-team'})];
  const founderPolicy=addWarehouseNetworkTies(directory,'2026-09-26');
  const membership=addWarehouseMembershipTies(directory,[
    {personKey:'directory',source:'prod_records.members',rowId:'directory-row'},
    {personKey:'labos',source:'prod_lists.labos_members',rowId:'labos-row'},
    {personKey:'listed',source:'prod_lists.investors',rowId:'investor-row'},
    {personKey:'listed',source:'prod_lists.investors',rowId:'investor-row'}]);
  check('WINV2 each directory/list source independently establishes a tier B PL organization tie',
    membership.length===3&&membership.every(t=>t.tier==='B'&&t.kind==='acquaintance'
      && [t.from,t.to].includes('organization:protocol-labs')&&t.firstSeen===null&&t.lastSeen===null)
    && membership.some(t=>t.source==='prod_records.members'&&t.basis==='registered in the PL network directory'&&t.rowIds[0]==='directory-row')
    && membership.some(t=>t.source==='prod_lists.labos_members'&&t.rowIds[0]==='labos-row')
    && membership.some(t=>t.source==='prod_lists.investors'&&t.basis==="on PL's investor list"&&t.rowIds[0]==='investor-row'),
    'Membership needs neither account approval nor observed contact; repeated rows are idempotent.');
  const directoryMatches:WarehouseMatch[]=['directory','labos','listed'].map(k=>({lpKey:k,personKey:k,score:1,status:'confident',basis:['fixture']}));
  check('WINV2 directory membership reaches PL without inventing a named team contact',
    membership.every(t=>![t.from,t.to].includes('team')&&![t.from,t.to].includes('unlisted'))
    && !founderPolicy.some(t=>['directory','labos','listed'].some(k=>[t.from,t.to].includes(k)))
    && directory.filter(p=>['directory','labos','listed'].includes(p.key)).every(p=>!p.oneHop)
    && warehouseCoverage(directory,[...founderPolicy,...membership],directoryMatches).withinTwoHops===3,
    'Membership-only people stay distinct from founder/team first hops; no pair to a named employee is inferred.');
  const matches:WarehouseMatch[]=[{lpKey:'candidate',personKey:'lp',score:1,status:'confident',basis:['fixture']}];
  const source:WarehouseTie={key:'firm-deal',from:'coinvestor:firm',to:'founder',tier:'C',kind:'joint_investment',
    source:'invented portfolio',rowIds:['deal-one'],count:1,firstSeen:null,lastSeen:null};
  const lps=[{key:'candidate',name:'Invented Investor',org:'Invented Ventures',domains:[]}];
  const firm=addWarehouseFirmTies(lps,matches,people,[source]);
  check('WINV exact firm attribution reaches founders at tier C and never impersonates a named investor',
    firm.length===1&&firm[0]?.tier==='C'&&firm[0]?.basis==='firm_attribution'&&firm[0]?.kind==='joint_investment'
    && addWarehouseFirmTies(lps,[{...matches[0]!,status:'ambiguous'}],people,[source]).length===0
    && addWarehouseFirmTies([{...lps[0]!,org:'Different Ventures'}],matches,people,[source]).length===0,
    'Only confident LP identities and exact normalized affiliations receive the firm evidence.');
  const coverage=warehouseCoverage(people,[...policy,...firm],matches);
  check('WINV investor → founder → team coverage is measured from actual edges',
    coverage.matched===1&&coverage.anyTie===1&&coverage.tieToOneHopOrPL===1&&coverage.withinTwoHops===1
    && warehouseCoverage(people,firm,matches).withinTwoHops===0,
    'Removing the policy edge removes the two-hop path; flags alone do not count as an edge.');
  check('WINV views cannot become contact and repeated clicks cannot become named investment',
    classifyWarehouseTie('demo_interest',999).kind==='proximity'&&classifyWarehouseTie('demo_interest',999).tier==='D'
    && classifyWarehouseTie('demo_action',1).kind==='acquaintance'&&classifyWarehouseTie('demo_action',1).tier==='C'
    && classifyWarehouseTie('demo_action',config.routeWarmth.repeatedContacts).kind==='repeated_contact'
    && classifyWarehouseTie('named_coinvestment',config.routeWarmth.frequentDeals).kind==='frequent_coinvestment'
    && classifyWarehouseTie('named_coinvestment',1).tier==='B'
    && classifyWarehouseTie('portfolio',config.routeWarmth.frequentDeals).tier==='C',
    'Distinct event/company IDs drive repetition; the evidence tier does not rise with volume.');
  let refused=false;try { classifyWarehouseTie('unknown' as 'event',1); } catch { refused=true; }
  check('WINV unknown evidence fails closed',refused,'An unknown warehouse label cannot silently produce an untyped tie.');
}

/** Real BigQuery dialect, entirely invented inline tables. Optional integration check; no warehouse data. */
export async function warehouseSqlFixtures() {
  const { peopleSql, tieQueries } = await import('../lib/enrich/warehouse-sql');
  const literal = (v: string|number|boolean|null, type: string) => v===null?`CAST(NULL AS ${type})`
    : typeof v==='string'?`CAST('${v.replaceAll("'","''")}' AS ${type})`:String(v);
  const table = (columns: Record<string,string>, rows: Record<string,string|number|boolean|null>[]) =>
    '('+(rows.length?rows:[{}]).map(row=>'SELECT '+Object.entries(columns).map(([k,t])=>`${literal(row[k]??null,t)} AS ${k}`).join(', ')
    +(rows.length?'':' FROM UNNEST([1]) WHERE FALSE')).join(' UNION ALL ')+')';
  const text = (names: string) => Object.fromEntries(names.split(' ').map(k=>[k,'STRING']));
  const fixture:Record<string,string>={
    'prod_records.members':table({...text('dw_member_id labos_member_uid name email main_company_name main_company_name_linkedin company_names main_company_role member_approval_state'),
      is_any_company_founder:'BOOL',is_pl_infra:'BOOL',has_investor_profile:'BOOL',is_test_account:'BOOL',pln_start_date:'TIMESTAMP'},[
      {dw_member_id:'investor',labos_member_uid:'investor-uid',name:'Iris Invented',email:'iris@example.org',main_company_name:'Invented Ventures'},
      {dw_member_id:'founder',name:'Fern Fiction',email:'fern@example.org',main_company_name:'Fiction Labs'},
      {dw_member_id:'pending',name:'Pat Pending',member_approval_state:'PENDING'},
      {dw_member_id:'approved',name:'Alex Approved',member_approval_state:'APPROVED'}]),
    'prod_lists.investors':table(text('dw_member_id main_company_name'),[{dw_member_id:'investor',main_company_name:'Invented Ventures'}]),
    'prod_lists.labos_members':table(text('dw_member_id'),[{dw_member_id:'approved'}]),
    'prod_records.companies':table({...text('dw_company_id company_labos_team_uid company_name members founders'),is_pl_network_company:'BOOL'},[
      {dw_company_id:'company',company_labos_team_uid:'company-uid',company_name:'Fiction Labs',founders:'Fern Fiction <fern@example.org> | Faye Missing <faye@example.org>',is_pl_network_company:true}]),
    'prod_lists.demo_day_investors_funnel':table(text('demo_day_member_uid investor_name investor_team_name investor_email_normalized'),[
      {demo_day_member_uid:'investor-uid',investor_name:'Iris Invented',investor_team_name:'Invented Ventures',investor_email_normalized:'changed@example.org'}]),
    'prod_lists.demo_day_investor_team_actions':table({...text('demo_day_uid demo_day_member_uid investor_name investor_company investor_email team_name action_type'),action_first_at:'TIMESTAMP'},[
      {demo_day_uid:'day',demo_day_member_uid:'investor-uid',investor_name:'Iris Invented',investor_company:'Invented Ventures',team_name:'Fiction Labs',action_type:'invest',action_first_at:'2026-01-01'},
      {demo_day_uid:'day',demo_day_member_uid:'investor-uid',investor_name:'Iris Invented',investor_company:'Invented Ventures',team_name:'Fiction Labs',action_type:'connect',action_first_at:'2026-01-01'}]),
    'prod_lists.demo_day_investors_teams_engagement_funnel':table({...text('demo_day_uid team_uid investor_name investor_email investor_team_name'),
      overall_activity_last_ts:'TIMESTAMP',overall_activity_count:'INT64',team_intro_confirm_clicked_count:'INT64',team_connect_clicked_count:'INT64',team_invest_clicked_count:'INT64',team_like_clicked_count:'INT64'},[
      {demo_day_uid:'day',team_uid:'company-uid',investor_name:'Iris Invented',investor_email:'changed@example.org',investor_team_name:'Invented Ventures',overall_activity_last_ts:'2026-01-01',overall_activity_count:999}]),
    'prod_lists.pl_portfolio_coinvestors':table(text('investor_key investor_name portfolio_companies_invested'),[
      {investor_key:'named',investor_name:'Iris Invented',portfolio_companies_invested:'Fiction Labs'},
      {investor_key:'firm',investor_name:'Invented Ventures',portfolio_companies_invested:'Fiction Labs'}]),
    'prod_records.meetings':table({...text('founder_attendee_names internal_team_attendee_names'),meeting_id:'INT64',attendee_count:'INT64',meeting_start_at:'TIMESTAMP'},[
      {meeting_id:1,attendee_count:2,meeting_start_at:'2026-01-01',founder_attendee_names:'Fern Fiction | Iris Invented'}]),
    'prod_lists.founder_meetings_list':table({...text('founder_attendee_names internal_team_attendee_names'),meeting_id:'INT64',attendee_count:'INT64',meeting_start_at:'TIMESTAMP'},[]),
  };
  const replace = (sql:string) => sql.replace(/`plrs-data-platform\.([^`]+)`/g,(_,key:string)=>{
    if(!fixture[key]) throw new Error('Missing invented source fixture'); return fixture[key];
  });
  return Object.fromEntries(Object.entries({people:peopleSql,demo:tieQueries.demo!,portfolio:tieQueries.portfolio!,meetings:tieQueries.meetings!}).map(([k,q])=>[k,replace(q)]));
}

export function verifyWarehouseSqlFixtures(results: Record<string,Record<string,unknown>[]>, check: Check) {
  const people=results.people??[],demo=results.demo??[],portfolio=results.portfolio??[],meetings=results.meetings??[];
  check('WINV SQL retains founders absent from members and resolves changed email through a stable ID',
    people.some(p=>String(p.key).startsWith('company-person:')&&p.name==='Faye Missing')
    && people.filter(p=>p.key==='member:investor').length===1&&!people.some(p=>String(p.key).startsWith('demo:')),
    'Invented inline source tables; both named founders survive.');
  check('WINV SQL distinguishes pending accounts from approved account access',
    people.find(p=>p.key==='member:pending')?.network==='false'&&people.find(p=>p.key==='member:approved')?.network==='true',
    'Account approval remains a separate source field; all directory rows receive PL membership ties independently.');
  check('WINV SQL deduplicates actions within a demo/company and preserves view-only evidence',
    demo.filter(t=>t.evidence==='demo_action').length===2&&demo.filter(t=>t.evidence==='demo_interest').length===2
    && demo.every(t=>Number(t.count)===1), 'Two founders, one event: two clicks still count once for each pair.');
  check('WINV SQL distinguishes named from firm-attributed portfolio evidence',
    portfolio.filter(t=>t.evidence==='named_coinvestment').length===2&&portfolio.filter(t=>t.evidence==='portfolio').length===2,
    'The named investor and their firm remain separate evidence.');
  check('WINV SQL can use either named attendee field without a row in both meeting sources',
    meetings.length===1&&meetings[0]?.evidence==='direct_contact'&&Number(meetings[0]?.count)===1,
    'Two named people in one field still yield their observed pair.');
}
