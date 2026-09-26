/** Read-only warehouse graph queries. Email addresses exist only inside BigQuery joins. */
const table = (name: string) => '`plrs-data-platform.' + name + '`';
const norm = (field: string) => `REGEXP_REPLACE(LOWER(${field}), r'[^a-z0-9]', '')`;
// Prefer recorded company fields without conflating a multi-company list with one firm.
const recordedOrg = (alias: string) => `COALESCE(NULLIF(TRIM(${alias}.main_company_name),''),
 NULLIF(TRIM(${alias}.main_company_name_linkedin),''),
 IF(STRPOS(${alias}.company_names,' | ')=0,NULLIF(TRIM(${alias}.company_names),''),NULL))`;
const members = `
 m AS (SELECT m.dw_member_id, m.labos_member_uid, m.name, LOWER(TRIM(m.email)) email,
   COALESCE(${recordedOrg('m')},i.main_company_name) org, m.main_company_role role, m.is_any_company_founder founder, m.is_pl_infra staff,
   (m.has_investor_profile OR i.dw_member_id IS NOT NULL) investor,
   (l.dw_member_id IS NOT NULL OR m.member_approval_state IN ('APPROVED','VERIFIED') OR m.pln_start_date IS NOT NULL) network
 FROM ${table('prod_records.members')} m LEFT JOIN ${table('prod_lists.investors')} i USING(dw_member_id)
 LEFT JOIN ${table('prod_lists.labos_members')} l USING(dw_member_id)
 WHERE NULLIF(TRIM(m.name),'') IS NOT NULL AND NOT COALESCE(is_test_account,FALSE)),
 unique_email AS (SELECT email, MIN(dw_member_id) id FROM m WHERE NULLIF(email,'') IS NOT NULL GROUP BY email HAVING COUNT(*)=1),
 unique_uid AS (SELECT labos_member_uid uid, MIN(dw_member_id) id FROM m WHERE NULLIF(labos_member_uid,'') IS NOT NULL GROUP BY 1 HAVING COUNT(*)=1),
 unique_name AS (SELECT ${norm('name')} name_key, MIN(dw_member_id) id FROM m GROUP BY 1 HAVING COUNT(*)=1),
 unique_name_org AS (SELECT ${norm('name')} name_key, ${norm('org')} org_key, MIN(dw_member_id) id FROM m
 WHERE NULLIF(TRIM(org),'') IS NOT NULL GROUP BY 1,2 HAVING COUNT(*)=1),
 c AS (SELECT dw_company_id, company_labos_team_uid, company_name, members, founders,
 is_pl_network_company network FROM ${table('prod_records.companies')}),
 company_tokens AS (
 SELECT c.*, token, FALSE founder FROM c, UNNEST(SPLIT(COALESCE(members,''),' | ')) token
 UNION ALL SELECT c.*, token, TRUE founder FROM c, UNNEST(SPLIT(COALESCE(founders,''),' | ')) token),
 company_names AS (SELECT *, TRIM(REGEXP_REPLACE(token,r'<[^<>]*>','')) person_name,
 LOWER(TRIM(REGEXP_EXTRACT(token,r'<([^<>]+)>'))) person_email FROM company_tokens),
 cm AS (SELECT c.dw_company_id,c.company_name,
 COALESCE(CONCAT('member:',u.id),CONCAT('member:',n.id),
 CONCAT('company-person:',TO_HEX(SHA256(CONCAT(c.dw_company_id,':',${norm('c.person_name')}))))) person_key,
 MIN(c.person_name) name, MIN(REGEXP_EXTRACT(c.person_email,r'@([^@]+)$')) email_domain,
 LOGICAL_OR(c.founder) founder, LOGICAL_OR(c.network) network
 FROM company_names c LEFT JOIN unique_email u ON u.email=c.person_email
 LEFT JOIN unique_name n ON n.name_key=${norm('c.person_name')}
 WHERE NULLIF(c.person_name,'') IS NOT NULL
 GROUP BY 1,2,3),
 demo_raw AS (
 SELECT demo_day_member_uid uid, investor_name name, investor_team_name org, LOWER(TRIM(investor_email_normalized)) email
 FROM ${table('prod_lists.demo_day_investors_funnel')}
 UNION ALL SELECT demo_day_member_uid,investor_name,investor_company,LOWER(TRIM(investor_email)) FROM ${table('prod_lists.demo_day_investor_team_actions')}
 UNION ALL SELECT NULL,investor_name,investor_team_name,LOWER(TRIM(investor_email)) FROM ${table('prod_lists.demo_day_investors_teams_engagement_funnel')}),
 demo AS (SELECT DISTINCT d.*,
 COALESCE(CONCAT('member:',u.id),CONCAT('member:',v.id),CONCAT('member:',n.id),
 CONCAT('demo:',TO_HEX(SHA256(COALESCE(NULLIF(d.email,''),NULLIF(d.uid,''),CONCAT(d.name,':',d.org)))))) person_key
 FROM demo_raw d LEFT JOIN unique_email u USING(email)
 LEFT JOIN unique_uid v ON v.uid=d.uid
 LEFT JOIN unique_name_org n ON n.name_key=${norm('d.name')} AND n.org_key=${norm('d.org')}
 WHERE NULLIF(TRIM(d.name),'') IS NOT NULL
 AND (u.id IS NULL OR v.id IS NULL OR u.id=v.id)),
 unique_demo_email AS (SELECT email, MIN(person_key) person_key FROM demo WHERE NULLIF(email,'') IS NOT NULL
 GROUP BY email HAVING COUNT(DISTINCT demo.person_key)=1),
 unique_demo_uid AS (SELECT uid, MIN(person_key) person_key FROM demo WHERE NULLIF(uid,'') IS NOT NULL
 GROUP BY uid HAVING COUNT(DISTINCT demo.person_key)=1)
`;
export const peopleSql = `WITH ${members}
SELECT CONCAT('member:',dw_member_id) key, dw_member_id member_id, labos_member_uid,
 name, org, REGEXP_EXTRACT(email,r'@([^@]+)$') email_domain, role,
 (founder OR EXISTS(SELECT 1 FROM cm WHERE cm.person_key=CONCAT('member:',m.dw_member_id) AND cm.founder)) founder, staff, investor,
 (network OR EXISTS(SELECT 1 FROM cm WHERE cm.person_key=CONCAT('member:',m.dw_member_id) AND cm.network)) network,
 'prod_records.members+prod_lists.investors+prod_lists.labos_members' source
 FROM m
UNION ALL
SELECT person_key, NULL, MIN(uid), MIN(name), MIN(org), REGEXP_EXTRACT(MIN(email),r'@([^@]+)$'),
 'investor', FALSE, FALSE, TRUE, FALSE,
 'prod_lists.demo_day_investors_funnel+prod_lists.demo_day_investor_team_actions+prod_lists.demo_day_investors_teams_engagement_funnel'
FROM demo WHERE STARTS_WITH(person_key,'demo:') GROUP BY person_key
UNION ALL
SELECT person_key,NULL,NULL,MIN(name),MIN(company_name),MIN(email_domain),'company member',LOGICAL_OR(founder),FALSE,FALSE,LOGICAL_OR(network),
 'prod_records.companies' FROM cm WHERE STARTS_WITH(person_key,'company-person:') GROUP BY person_key`;
// Pairwise ties aggregate distinct source rows in SQL, so opening/clicking the same message cannot inflate contact.
const pair = (body: string) => `WITH ${members}, raw AS (${body})
SELECT LEAST(a,b) a, GREATEST(a,b) b, evidence, source,
 MIN(on_date) first_seen, MAX(on_date) last_seen,
 ARRAY_AGG(DISTINCT row_id ORDER BY row_id) row_ids, COUNT(DISTINCT row_id) count
FROM raw WHERE a IS NOT NULL AND b IS NOT NULL AND a!=b
GROUP BY 1,2,3,4`;
export const tieQueries: Record<string,string> = {
 company: pair(`SELECT a.person_key a, b.person_key b,
 IF(a.founder AND b.founder,'cofounders','shared_company') evidence,
 'prod_records.companies' source, a.dw_company_id row_id, CAST(NULL AS DATE) on_date
 FROM cm a JOIN cm b USING(dw_company_id) WHERE a.person_key < b.person_key`),
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
 FROM (SELECT meeting_id,meeting_start_at,attendee_count,founder_attendee_names,internal_team_attendee_names FROM ${table('prod_records.meetings')}
 UNION DISTINCT SELECT meeting_id,meeting_start_at,attendee_count,founder_attendee_names,internal_team_attendee_names FROM ${table('prod_lists.founder_meetings_list')}) x,
 UNNEST(SPLIT(CONCAT(COALESCE(x.founder_attendee_names,''),' | ',COALESCE(x.internal_team_attendee_names,'')),' | ')) an,
 UNNEST(SPLIT(CONCAT(COALESCE(x.founder_attendee_names,''),' | ',COALESCE(x.internal_team_attendee_names,'')),' | ')) bn
 JOIN unique_name a ON a.name_key=${norm('an')}
 JOIN unique_name b ON b.name_key=${norm('bn')}
 WHERE a.id<b.id AND x.meeting_start_at<=CURRENT_TIMESTAMP()`),
 events: pair(`SELECT CONCAT('member:',a.dw_member_id) a,CONCAT('member:',b.dw_member_id) b,
 'event' evidence, 'prod_records.calendar_events_guests+prod_records.calendar_events' source,
 a.dw_calendar_event_id row_id, DATE(e.start_at) on_date
 FROM ${table('prod_records.calendar_events_guests')} a
 JOIN ${table('prod_records.calendar_events_guests')} b USING(dw_calendar_event_id)
 JOIN ${table('prod_records.calendar_events')} e USING(dw_calendar_event_id)
 JOIN m ma ON ma.dw_member_id=a.dw_member_id JOIN m mb ON mb.dw_member_id=b.dw_member_id
 WHERE a.dw_member_id<b.dw_member_id AND e.start_at<=CURRENT_TIMESTAMP()
 AND (a.is_host OR a.is_speaker OR b.is_host OR b.is_speaker OR (a.checked_in_at IS NOT NULL AND b.checked_in_at IS NOT NULL))`),
 portfolio: pair(`SELECT CONCAT('member:',m.dw_member_id) a, cm.person_key b,
 'portfolio' evidence, 'prod_lists.pl_portfolio_coinvestors+prod_records.companies' source,
 CONCAT(p.investor_key,':',cm.dw_company_id) row_id, CAST(NULL AS DATE) on_date
 FROM ${table('prod_lists.pl_portfolio_coinvestors')} p,
 UNNEST(SPLIT(p.portfolio_companies_invested,' | ')) company
 JOIN cm ON ${norm('cm.company_name')}=${norm('company')} AND cm.founder
 JOIN m ON ${norm('m.org')}=${norm('p.investor_name')}
 WHERE NULLIF(TRIM(m.org),'') IS NOT NULL
 UNION ALL
 SELECT CONCAT('member:',u.id),cm.person_key,'named_coinvestment',
 'prod_lists.pl_portfolio_coinvestors+prod_records.companies',CONCAT(p.investor_key,':',cm.dw_company_id),CAST(NULL AS DATE)
 FROM ${table('prod_lists.pl_portfolio_coinvestors')} p,
 UNNEST(SPLIT(p.portfolio_companies_invested,' | ')) company
 JOIN cm ON ${norm('cm.company_name')}=${norm('company')} AND cm.founder
 JOIN unique_name u ON u.name_key=${norm('p.investor_name')}`),
 demo: pair(`SELECT u.person_key a,cm.person_key b,
 IF(COALESCE(d.team_intro_confirm_clicked_count,0)+COALESCE(d.team_connect_clicked_count,0)+COALESCE(d.team_invest_clicked_count,0)+COALESCE(d.team_like_clicked_count,0)>0,
 'demo_action','demo_interest') evidence,
 'prod_lists.demo_day_investors_teams_engagement_funnel' source,
 CONCAT(d.demo_day_uid,':',d.team_uid,':',u.person_key) row_id,
 DATE(d.overall_activity_last_ts) on_date
 FROM ${table('prod_lists.demo_day_investors_teams_engagement_funnel')} d
 JOIN unique_demo_email u ON u.email=LOWER(TRIM(d.investor_email))
 JOIN c ON c.company_labos_team_uid=d.team_uid
 JOIN cm USING(dw_company_id)
 WHERE d.overall_activity_count>0 AND d.overall_activity_last_ts<=CURRENT_TIMESTAMP()
 UNION ALL
 SELECT COALESCE(u.person_key,v.person_key),cm.person_key,'demo_action',
 'prod_lists.demo_day_investor_team_actions',CONCAT(d.demo_day_uid,':',cm.dw_company_id,':',COALESCE(u.person_key,v.person_key)),DATE(d.action_first_at)
 FROM ${table('prod_lists.demo_day_investor_team_actions')} d
 LEFT JOIN unique_demo_email u ON u.email=LOWER(TRIM(d.investor_email))
 LEFT JOIN unique_demo_uid v ON v.uid=d.demo_day_member_uid
 JOIN cm ON ${norm('cm.company_name')}=${norm('d.team_name')}
 WHERE d.action_type IN ('connect','invest','invest + connect') AND d.action_first_at<=CURRENT_TIMESTAMP()`),

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

export const personOrganizationsSql = `SELECT dw_member_id, ${recordedOrg('r')} org,
 COALESCE(NULLIF(main_company_role,''),NULLIF(job_title_linkedin,'')) role
 FROM ${table('prod_records.members')} r WHERE ${recordedOrg('r')} IS NOT NULL
 AND NULLIF(TRIM(name),'') IS NOT NULL AND NOT COALESCE(is_test_account,FALSE)`;

tieQueries.recorded_company = pair(`SELECT CONCAT('member:',r.dw_member_id) a,cm.person_key b,
 'shared_company' evidence,'prod_records.members+prod_records.companies' source,
 cm.dw_company_id row_id,CAST(NULL AS DATE) on_date
 FROM ${table('prod_records.members')} r JOIN m USING(dw_member_id)
 JOIN cm ON ${norm(recordedOrg('r'))}=${norm('cm.company_name')}
 WHERE cm.founder`);
/** Keep the firm as a node, then attach locally matched LP affiliations without claiming a personal decision. */
export const coinvestorOrganizationsSql = `SELECT CONCAT('coinvestor:',investor_key) key, investor_name name
 FROM ${table('prod_lists.pl_portfolio_coinvestors')} WHERE NULLIF(TRIM(investor_name),'') IS NOT NULL`;
tieQueries.portfolio_organizations = pair(`SELECT CONCAT('coinvestor:',p.investor_key) a,cm.person_key b,
 'portfolio' evidence,'prod_lists.pl_portfolio_coinvestors+prod_records.companies' source,
 cm.dw_company_id row_id,CAST(NULL AS DATE) on_date
 FROM ${table('prod_lists.pl_portfolio_coinvestors')} p,
 UNNEST(SPLIT(p.portfolio_companies_invested,' | ')) company
 JOIN cm ON ${norm('cm.company_name')}=${norm('company')} AND cm.founder`);
