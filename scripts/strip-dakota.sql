-- SQL body of strip-dakota.ts; run through that entrypoint (one transaction,
-- journal undo and audit-trigger restoration). Schema stays for app/migration compatibility.
create temporary table strip_counts(operation text primary key, count bigint) on commit drop;
create or replace function pg_temp.strip_run(label text, statement text) returns void language plpgsql as $$
declare n bigint;
begin
  execute statement; get diagnostics n = row_count;
  insert into strip_counts values(label,n) on conflict(operation) do update set count=strip_counts.count+excluded.count;
end $$;
create or replace function pg_temp.is_dakota(s text) returns boolean language sql immutable as $$
  select coalesce(s ~* '^(external:|rule:)?dakota($|[:/ _.\-])',false)
$$;
-- Only provenance keys, never a name or arbitrary prose containing the word Dakota.
create or replace function pg_temp.clean_evidence(j jsonb) returns jsonb language plpgsql stable as $$
declare result jsonb; k text; v jsonb; cleaned jsonb;
begin
  if jsonb_typeof(j)='object' then
    if pg_temp.is_dakota(j->>'source') or pg_temp.is_dakota(j->>'origin')
      or pg_temp.is_dakota(j->>'file') or coalesce(j->>'file','') ~* '(^|/)dakota/'
      or exists(select 1 from strip_docs where doc_id in (j->>'source',j->>'doc_id'))
      or exists(select 1 from strip_claims where claim_id::text=j->>'claim_id') then return null; end if;
    if jsonb_typeof(j->'source') in ('object','array')
      and j->'source' is distinct from pg_temp.clean_evidence(j->'source') and
      coalesce(pg_temp.clean_evidence(j->'source'),'[]'::jsonb)='[]'::jsonb then return null; end if;
    result := '{}';
    for k,v in select * from jsonb_each(j) loop
      -- Per-field provenance (e.g. company_domain_source) owns that field only.
      if right(k,7)='_source' and (pg_temp.is_dakota(v #>> '{}')
        or exists(select 1 from strip_docs where doc_id=v #>> '{}')) then continue; end if;
      if j ? (k||'_source') and (pg_temp.clean_evidence(j->(k||'_source')) is null
        or pg_temp.is_dakota(j->>(k||'_source'))
        or exists(select 1 from strip_docs where doc_id=j->>(k||'_source'))) then continue; end if;
      cleaned := pg_temp.clean_evidence(v);
      if cleaned is not null then result := result || jsonb_build_object(k,cleaned); end if;
    end loop;
    return result;
  elsif jsonb_typeof(j)='array' then
    result := '[]';
    for v in select * from jsonb_array_elements(j) loop
      cleaned := pg_temp.clean_evidence(v);
      if cleaned is not null then result := result || jsonb_build_array(cleaned); end if;
    end loop;
    return result;
  end if;
  return j;
end $$;

-- Retain the keys before removing source-owned rows, including opaque document ids.
create temporary table strip_docs on commit drop as
  select doc_id from research.source_doc where pg_temp.is_dakota(origin) or pg_temp.is_dakota(doc_id);
create temporary table strip_claims on commit drop as
  select claim_id from research.claim where source in (select doc_id from strip_docs) or pg_temp.is_dakota(source);

create unique index on strip_docs(doc_id);
create unique index on strip_claims(claim_id);

-- Free-form mixed prose cannot be partitioned by citation. Refuse it; remove
-- outputs supported only by Dakota and their provenance links.
create temporary table strip_answers on commit drop as select distinct answer_id from library.answer_source
 where doc_id in (select doc_id from strip_docs) or claim_id in (select claim_id from strip_claims);
create temporary table strip_assets on commit drop as select distinct asset_id from content.claim_ref
 where claim_id in (select claim_id from strip_claims);
do $$ begin
 if exists(select 1 from library.answer_source where answer_id in (select answer_id from strip_answers)
   and (doc_id is not null and doc_id not in (select doc_id from strip_docs)
     or claim_id is not null and claim_id not in (select claim_id from strip_claims)))
 or exists(select 1 from content.claim_ref where asset_id in (select asset_id from strip_assets)
   and claim_id not in (select claim_id from strip_claims)) then
   raise exception 'Cutover requires review of mixed derived prose';
 end if;
end $$;
select pg_temp.strip_run('answer_sources','delete from library.answer_source where answer_id in (select answer_id from strip_answers)');
select pg_temp.strip_run('answers','delete from library.answer where answer_id in (select answer_id from strip_answers)');
select pg_temp.strip_run('asset_claims','delete from content.claim_ref where asset_id in (select asset_id from strip_assets)');
select pg_temp.strip_run('asset_flags','delete from content.refresh_flag where asset_id in (select asset_id from strip_assets)');
select pg_temp.strip_run('assets','delete from content.asset where asset_id in (select asset_id from strip_assets)');
select pg_temp.strip_run('claim_links', 'update research.claim set superseded_by=null where superseded_by in (select claim_id from strip_claims)');
select pg_temp.strip_run('refresh_flags', 'delete from content.refresh_flag where claim_id in (select claim_id from strip_claims)');
select pg_temp.strip_run('spv_claims', 'delete from strategy.spv_evidence where claim_id in (select claim_id from strip_claims)');

-- Identity redirects are themselves derived evidence. Names and all source-owned
-- records from other systems remain at their original ids.
select pg_temp.strip_run('redirects', $s$update identity.entity e set merged_into=null
 where exists(select 1 from identity.match_assertion m where m.merged_entity=e.entity_id
 and m.canonical_entity=e.merged_into and m.undone_at is null
 and (pg_temp.is_dakota(m.left_source) or pg_temp.is_dakota(m.right_source) or pg_temp.clean_evidence(m.signals) is null))
 and not exists(select 1 from identity.match_assertion m where m.merged_entity=e.entity_id
 and m.canonical_entity=e.merged_into and m.undone_at is null and not pg_temp.is_dakota(m.left_source)
 and not pg_temp.is_dakota(m.right_source) and pg_temp.clean_evidence(m.signals) is not null)$s$);

-- Empty all seven vendor tables without CASCADE (unknown dependencies stop cutover).
-- The revision table is emptied last: source-table triggers may update it but never insert.
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='dakota'
    order by case tablename when 'employment' then 0 when 'account' then 1 when 'contact' then 2 else 3 end loop
    perform pg_temp.strip_run('dakota.'||t.tablename,format('delete from dakota.%I',t.tablename));
  end loop;
end $$;

-- Remove evidence elements independently; keep an edge with independent evidence.
select pg_temp.strip_run('edges_removed', $s$delete from network.edge where evidence <> '[]'::jsonb
 and coalesce(pg_temp.clean_evidence(evidence),'[]')='[]'::jsonb$s$);
select pg_temp.strip_run('edges_cleaned', $s$update network.edge set evidence=pg_temp.clean_evidence(evidence)
 where evidence is distinct from pg_temp.clean_evidence(evidence)$s$);
-- Aggregate identity confidence and journal details cannot be reassigned to the
-- remaining evidence automatically. Mixed records stop rather than lose facts.
do $$ begin
 if exists(select 1 from identity.possible_match where signals is distinct from pg_temp.clean_evidence(signals)
   and coalesce(pg_temp.clean_evidence(signals),'[]') not in ('[]'::jsonb,'{}'::jsonb))
 or exists(select 1 from identity.match_assertion where not pg_temp.is_dakota(left_source)
   and not pg_temp.is_dakota(right_source) and signals is distinct from pg_temp.clean_evidence(signals)
   and coalesce(pg_temp.clean_evidence(signals),'[]') not in ('[]'::jsonb,'{}'::jsonb))
 or exists(select 1 from platform.audit_log where not pg_temp.is_dakota(action)
   and detail is distinct from pg_temp.clean_evidence(detail)
   and coalesce(pg_temp.clean_evidence(detail),'[]') not in ('[]'::jsonb,'{}'::jsonb)) then
   raise exception 'Mixed inference or journal provenance requires review';
 end if;
end $$;
select pg_temp.strip_run('possible_matches', $s$delete from identity.possible_match
 where signals is distinct from pg_temp.clean_evidence(signals)$s$);
select pg_temp.strip_run('assertions', $s$delete from identity.match_assertion where
 pg_temp.is_dakota(left_source) or pg_temp.is_dakota(right_source) or signals is distinct from pg_temp.clean_evidence(signals)$s$);

-- Source-tagged nested facts are removed individually, retaining independent facts.
-- A whole note with Dakota provenance has no independent body.
select pg_temp.strip_run('notes_removed', $s$delete from research.note where pg_temp.clean_evidence(data) is null$s$);
select pg_temp.strip_run('note_facts', $s$update research.note set data=pg_temp.clean_evidence(data)
 where data is distinct from pg_temp.clean_evidence(data)$s$);

-- These fields have their own basis, so don't delete the independent firm profile.
select pg_temp.strip_run('aum_fields', $s$update fit.firm_profile set est_aum=null,aum_basis=null
 where pg_temp.is_dakota(aum_basis)$s$);
select pg_temp.strip_run('relationship_fields', $s$update fit.firm_profile set prior_relationship=false,provenance_note=null,provenance_since=null
 where pg_temp.is_dakota(provenance_note)$s$);

-- The question/objection is independent of the answer's evidence.
select pg_temp.strip_run('objection_answers', $s$update meetings.objection set answer=null,answer_source=null,
 answered_by=null,answered_at=null,status='open' where pg_temp.is_dakota(answer_source)
 or answer_source in (select doc_id from strip_docs)$s$);
select pg_temp.strip_run('diligence_answers', $s$update meetings.diligence_question set answer=null,answer_source=null,
 answered_at=null,status='open' where pg_temp.is_dakota(answer_source)
 or answer_source in (select doc_id from strip_docs)$s$);

-- Preserve a pursuit adopted by a person; its original source-owned ranking is no
-- longer evidence for the person's status. Untouched Dakota suggestions are deleted.
select pg_temp.strip_run('adopted_pursuits', $s$update strategy.pursuit set source='us',source_ref=null,source_as_of=null,
 stage_said=null,owner_said=null where pg_temp.is_dakota(source) and status_source='us'$s$);

-- Every scalar source column in every user table, including source-doc FKs. The
-- catalog walk means new source-bearing tables cannot silently escape this policy.
-- FK violations stop and roll back; there is deliberately no DELETE CASCADE.
do $$ declare t record; begin
  for t in select c.table_schema,c.table_name,c.column_name from information_schema.columns c
    join information_schema.tables b using(table_schema,table_name)
    where b.table_type='BASE TABLE' and c.table_schema not in ('information_schema','dakota')
      and c.table_schema !~ '^pg_' and c.data_type in ('text','character varying','USER-DEFINED')
      and c.column_name in ('source','answer_source','evidence_kind')
    order by case when c.table_schema='research' and c.table_name='claim' then 1 else 0 end loop
    perform pg_temp.strip_run(t.table_schema||'.'||t.table_name,format(
      'delete from %I.%I where pg_temp.is_dakota(%I::text) or %I::text in (select doc_id from strip_docs)',
      t.table_schema,t.table_name,t.column_name,t.column_name));
  end loop;
end $$;
select pg_temp.strip_run('source_docs','delete from research.source_doc where doc_id in (select doc_id from strip_docs)');
select pg_temp.strip_run('audit', $s$delete from platform.audit_log where pg_temp.is_dakota(action)
 or detail is distinct from pg_temp.clean_evidence(detail) or pg_temp.is_dakota(detail->>'reason')$s$);
select pg_temp.strip_run('jobs', $s$delete from platform.import_job where kind='dakota'$s$);
-- Cached route payloads embed contact titles and evidence. They are recomputable.
select pg_temp.strip_run('route_cache','delete from network.route_cache');
select pg_temp.strip_run('route_warmup', $s$update network.route_warmup set status='idle',total=0,completed=0,error=null$s$);

-- Portfolio investments are independently sourced JSON facts.
select pg_temp.strip_run('portfolio_rows', $s$delete from network.portfolio where pg_temp.clean_evidence(source) is null or pg_temp.is_dakota(source #>> '{}')$s$);
select pg_temp.strip_run('portfolio_facts', $s$update network.portfolio set investments=pg_temp.clean_evidence(investments)
 where investments is distinct from pg_temp.clean_evidence(investments)$s$);

-- A final catalog audit refuses unhandled JSON provenance (journals, corrections,
-- suggestions, etc.). Never silently keep a newly introduced provenance container.
do $$ declare t record; found boolean; begin
 for t in select c.table_schema,c.table_name,c.column_name from information_schema.columns c
 join information_schema.tables b using(table_schema,table_name)
 where b.table_type='BASE TABLE' and c.table_schema not in ('information_schema','dakota')
 and c.table_schema !~ '^pg_' and c.data_type='jsonb' loop
   execute format('select exists(select 1 from %I.%I where %I is distinct from pg_temp.clean_evidence(%I))',
     t.table_schema,t.table_name,t.column_name,t.column_name) into found;
   if found then raise exception 'Unhandled JSON provenance at cutover'; end if;
 end loop;
end $$;
-- Scalar provenance outside the generic source column needs explicit treatment,
-- not a silent best effort (e.g. a new status-source or reference representation).
do $$ declare t record; found boolean; begin
 for t in select c.table_schema,c.table_name,c.column_name from information_schema.columns c
 join information_schema.tables b using(table_schema,table_name)
 where b.table_type='BASE TABLE' and c.table_schema not in ('information_schema','dakota')
 and c.table_schema !~ '^pg_' and c.data_type in ('text','character varying','USER-DEFINED')
 and c.column_name in ('source','origin','left_source','right_source','status_source','answer_source',
   'source_ref','evidence_ref','evidence_kind','provenance_note','aum_basis') loop
   execute format('select exists(select 1 from %I.%I where pg_temp.is_dakota(%I::text))',
     t.table_schema,t.table_name,t.column_name) into found;
   if found then raise exception 'Unhandled scalar provenance at cutover'; end if;
 end loop;
end $$;
