/** Read-only warehouse graph queries. Email addresses exist only inside BigQuery joins. */
const table = (name: string) => '`plrs-data-platform.' + name + '`';
const norm = (field: string) => `REGEXP_REPLACE(LOWER(${field}), r'[^a-z0-9]', '')`;
const members = `
 m AS (SELECT m.dw_member_id, m.labos_member_uid, m.name, LOWER(TRIM(m.email)) email,
   COALESCE(m.main_company_name,i.main_company_name) org, m.main_company_role role, m.is_any_company_founder founder, m.is_pl_infra staff,
   (m.has_investor_profile OR i.dw_member_id IS NOT NULL) investor, m.has_labos_account
 FROM ${table('prod_records.members')} m LEFT JOIN ${table('prod_lists.investors')} i USING(dw_member_id)
 WHERE NULLIF(TRIM(m.name),'') IS NOT NULL AND NOT COALESCE(is_test_account,FALSE)),
 unique_email AS (SELECT email, MIN(dw_member_id) id FROM m WHERE email IS NOT NULL GROUP BY email HAVING COUNT(*)=1),
 unique_name AS (SELECT ${norm('name')} name_key, MIN(dw_member_id) id FROM m GROUP BY 1 HAVING COUNT(*)=1),
 c AS (SELECT dw_company_id, company_labos_team_uid, company_name, members, founders FROM ${table('prod_records.companies')}),
 cm AS (SELECT DISTINCT c.dw_company_id, c.company_name, m.dw_member_id,
   u.email IN UNNEST(REGEXP_EXTRACT_ALL(LOWER(COALESCE(c.founders,'')), r'<([^<>]+)>')) founder
 FROM c, UNNEST(REGEXP_EXTRACT_ALL(LOWER(COALESCE(c.members,'')), r'<([^<>]+)>')) email
 JOIN unique_email u USING(email) JOIN m ON m.dw_member_id=u.id),
 demo AS (SELECT DISTINCT d.demo_day_uid, d.demo_day_member_uid, d.investor_name,
  d.investor_team_name, LOWER(d.investor_email_normalized) email,
  COALESCE(CONCAT('member:',u.id), CONCAT('demo:',TO_HEX(SHA256(COALESCE(NULLIF(d.demo_day_member_uid,''),LOWER(d.investor_email_normalized)))))) person_key
 FROM ${table('prod_lists.demo_day_investors_funnel')} d
 LEFT JOIN unique_email u ON u.email=LOWER(TRIM(d.investor_email_normalized))
 WHERE NULLIF(TRIM(d.investor_name),'') IS NOT NULL AND
 COALESCE(NULLIF(d.demo_day_member_uid,''),NULLIF(d.investor_email_normalized,'')) IS NOT NULL),
 unique_demo_email AS (SELECT email, MIN(person_key) person_key FROM demo GROUP BY email HAVING COUNT(DISTINCT demo.person_key)=1)
`;
export const peopleSql = `WITH ${members}
SELECT CONCAT('member:',dw_member_id) key, dw_member_id member_id, labos_member_uid,
 name, org, REGEXP_EXTRACT(email,r'@([^@]+)$') email_domain, role, founder, staff, investor
 FROM m
UNION ALL
SELECT person_key key, NULL member_id, MIN(demo_day_member_uid) labos_member_uid,
 MIN(investor_name) name, MIN(investor_team_name) org,
 REGEXP_EXTRACT(MIN(email),r'@([^@]+)$') email_domain, 'investor' role, FALSE founder, FALSE staff, TRUE investor
FROM demo WHERE STARTS_WITH(person_key,'demo:') GROUP BY person_key`;
// Pairwise ties aggregate distinct source rows in SQL, so opening/clicking the same message cannot inflate contact.
const pair = (body: string) => `WITH ${members}, raw AS (${body})
SELECT LEAST(a,b) a, GREATEST(a,b) b, evidence, source,
 MIN(on_date) first_seen, MAX(on_date) last_seen,
 ARRAY_AGG(DISTINCT row_id ORDER BY row_id) row_ids, COUNT(DISTINCT row_id) count
FROM raw WHERE a IS NOT NULL AND b IS NOT NULL AND a!=b
GROUP BY 1,2,3,4`;
export const tieQueries: Record<string,string> = {
 company: pair(`SELECT CONCAT('member:',a.dw_member_id) a, CONCAT('member:',b.dw_member_id) b,
 IF(a.founder AND b.founder,'cofounders','shared_company') evidence,
 'prod_records.companies' source, a.dw_company_id row_id, CAST(NULL AS DATE) on_date
 FROM cm a JOIN cm b USING(dw_company_id) WHERE a.dw_member_id < b.dw_member_id`),
 communications: pair(`SELECT CONCAT('member:',s.id) a, CONCAT('member:',r.id) b,
 'direct_contact' evidence, 'prod_records.member_communications' source, communication_id row_id,
 DATE(communication_timestamp) on_date
 FROM ${table('prod_records.member_communications')} x
 JOIN unique_email s ON s.email=LOWER(TRIM(x.sender_email))
 JOIN unique_email r ON r.email=LOWER(TRIM(x.recipient_email))
 WHERE campaign_id IS NULL AND communication_method='affinity' AND communication_type='email'
 AND communication_timestamp<=CURRENT_TIMESTAMP()`),
 meetings: pair(`SELECT CONCAT('member:',a.id) a,CONCAT('member:',b.id) b,
 IF(x.attendee_count=2,'direct_contact','event') evidence,
 'prod_records.meetings+prod_lists.founder_meetings_list' source, CAST(x.meeting_id AS STRING) row_id,
 DATE(x.meeting_start_at) on_date
 FROM ${table('prod_records.meetings')} x
 JOIN ${table('prod_lists.founder_meetings_list')} f USING(meeting_id),
 UNNEST(SPLIT(COALESCE(x.founder_attendee_names,f.founder_attendee_names),' | ')) fn,
 UNNEST(SPLIT(COALESCE(x.internal_team_attendee_names,f.internal_team_attendee_names),' | ')) tn
 JOIN unique_name a ON a.name_key=${norm('fn')}
 JOIN unique_name b ON b.name_key=${norm('tn')}
 WHERE x.meeting_start_at<=CURRENT_TIMESTAMP()`),
 events: pair(`SELECT CONCAT('member:',a.dw_member_id) a,CONCAT('member:',b.dw_member_id) b,
 'event' evidence, 'prod_records.calendar_events_guests+prod_records.calendar_events' source,
 a.dw_calendar_event_id row_id, DATE(e.start_at) on_date
 FROM ${table('prod_records.calendar_events_guests')} a
 JOIN ${table('prod_records.calendar_events_guests')} b USING(dw_calendar_event_id)
 JOIN ${table('prod_records.calendar_events')} e USING(dw_calendar_event_id)
 JOIN m ma ON ma.dw_member_id=a.dw_member_id JOIN m mb ON mb.dw_member_id=b.dw_member_id
 WHERE a.dw_member_id<b.dw_member_id AND e.start_at<=CURRENT_TIMESTAMP()
 AND (a.is_host OR a.is_speaker OR b.is_host OR b.is_speaker OR (a.checked_in_at IS NOT NULL AND b.checked_in_at IS NOT NULL))`),
 portfolio: pair(`SELECT CONCAT('member:',m.dw_member_id) a, CONCAT('member:',cm.dw_member_id) b,
 'portfolio' evidence, 'prod_lists.pl_portfolio_coinvestors+prod_records.companies' source,
 CONCAT(p.investor_key,':',cm.dw_company_id) row_id, CAST(NULL AS DATE) on_date
 FROM ${table('prod_lists.pl_portfolio_coinvestors')} p,
 UNNEST(SPLIT(p.portfolio_companies_invested,' | ')) company
 JOIN cm ON ${norm('cm.company_name')}=${norm('company')} AND cm.founder
 JOIN m ON ${norm('m.org')}=${norm('p.investor_name')}
 WHERE NULLIF(TRIM(m.org),'') IS NOT NULL
 UNION ALL
 SELECT CONCAT('member:',u.id),CONCAT('member:',cm.dw_member_id),'portfolio',
 'prod_lists.pl_portfolio_coinvestors+prod_records.companies',CONCAT(p.investor_key,':',cm.dw_company_id),CAST(NULL AS DATE)
 FROM ${table('prod_lists.pl_portfolio_coinvestors')} p,
 UNNEST(SPLIT(p.portfolio_companies_invested,' | ')) company
 JOIN cm ON ${norm('cm.company_name')}=${norm('company')} AND cm.founder
 JOIN unique_name u ON u.name_key=${norm('p.investor_name')}`),
 demo: pair(`SELECT u.person_key a,CONCAT('member:',cm.dw_member_id) b,'demo_interest' evidence,
 'prod_lists.demo_day_investors_teams_engagement_funnel' source,
 CONCAT(d.demo_day_uid,':',d.team_uid,':',u.person_key) row_id,
 DATE(d.overall_activity_last_ts) on_date
 FROM ${table('prod_lists.demo_day_investors_teams_engagement_funnel')} d
 JOIN unique_demo_email u ON u.email=LOWER(TRIM(d.investor_email))
 JOIN c ON c.company_labos_team_uid=d.team_uid
 JOIN cm USING(dw_company_id)
 WHERE cm.founder AND d.overall_activity_count>0 AND d.overall_activity_last_ts<=CURRENT_TIMESTAMP()
 UNION ALL
 SELECT u.person_key,CONCAT('member:',cm.dw_member_id),'demo_interest',
 'prod_lists.demo_day_investor_team_actions',CONCAT(d.demo_day_uid,':',d.team_name,':',d.action_type,':',u.person_key),DATE(d.action_first_at)
 FROM ${table('prod_lists.demo_day_investor_team_actions')} d
 JOIN unique_demo_email u ON u.email=LOWER(TRIM(d.investor_email))
 JOIN cm ON ${norm('cm.company_name')}=${norm('d.team_name')}
 WHERE cm.founder AND d.action_first_at<=CURRENT_TIMESTAMP()`),
};

/** Funding records have company/round IDs but no investor IDs; they cannot prove personal co-investment. */
export const fundingCoverageSql = `SELECT COUNT(*) events, COUNT(DISTINCT f.dw_company_id) companies,
 COUNTIF(f.round_identifier IS NOT NULL) with_round_identifier, MIN(f.event_date) first_date, MAX(f.event_date) last_date
 FROM ${table('prod_records.funding_valuation_timeline')} f
 JOIN ${table('prod_records.companies')} c USING(dw_company_id)
 WHERE f.event_date<=CURRENT_DATE()`;

export const sourceCoverageQueries: Record<string,string> = {
 communications: `SELECT COUNT(*) non_campaign_records, COUNTIF(sender_email IS NOT NULL) with_sender,
 COUNTIF(recipient_email IS NOT NULL) with_recipient
 FROM ${table('prod_records.member_communications')} WHERE campaign_id IS NULL`,
 meetings: `SELECT COUNT(*) records,COUNTIF(founder_attendee_names IS NOT NULL) with_founder_names,
 COUNTIF(internal_team_attendee_names IS NOT NULL) with_team_names FROM ${table('prod_lists.founder_meetings_list')}`,
};

// Secondary recorded company fields matter for members without a LabOS main company.
// A multi-company string is not treated as one organization; no fuzzy name joins.
const recordedOrg = (alias: string) => `COALESCE(NULLIF(TRIM(${alias}.main_company_name),''),
 NULLIF(TRIM(${alias}.main_company_name_linkedin),''),
 IF(STRPOS(${alias}.company_names,' | ')=0,NULLIF(TRIM(${alias}.company_names),''),NULL))`;
export const personOrganizationsSql = `SELECT dw_member_id, ${recordedOrg('r')} org,
 COALESCE(NULLIF(main_company_role,''),NULLIF(job_title_linkedin,'')) role
 FROM ${table('prod_records.members')} r WHERE ${recordedOrg('r')} IS NOT NULL
 AND NULLIF(TRIM(name),'') IS NOT NULL AND NOT COALESCE(is_test_account,FALSE)`;

tieQueries.recorded_company = pair(`SELECT CONCAT('member:',r.dw_member_id) a,CONCAT('member:',cm.dw_member_id) b,
 'shared_company' evidence,'prod_records.members+prod_records.companies' source,
 cm.dw_company_id row_id,CAST(NULL AS DATE) on_date
 FROM ${table('prod_records.members')} r JOIN m USING(dw_member_id)
 JOIN cm ON ${norm(recordedOrg('r'))}=${norm('cm.company_name')}
 WHERE cm.founder`);
tieQueries.recorded_portfolio = pair(`SELECT CONCAT('member:',r.dw_member_id) a,CONCAT('member:',cm.dw_member_id) b,
 'portfolio' evidence,'prod_records.members+prod_lists.pl_portfolio_coinvestors+prod_records.companies' source,
 CONCAT(p.investor_key,':',cm.dw_company_id) row_id,CAST(NULL AS DATE) on_date
 FROM ${table('prod_lists.pl_portfolio_coinvestors')} p,
 UNNEST(SPLIT(p.portfolio_companies_invested,' | ')) company
 JOIN cm ON ${norm('cm.company_name')}=${norm('company')} AND cm.founder
 JOIN ${table('prod_records.members')} r ON ${norm(recordedOrg('r'))}=${norm('p.investor_name')}
 JOIN m ON m.dw_member_id=r.dw_member_id
 WHERE NULLIF(TRIM(m.org),'') IS NULL`);
