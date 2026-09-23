-- The pipeline status (N50, docs/17): six values for where our effort is with an LP.
--
-- It replaces N46's twelve stages, which put what happened — a first meeting, a second —
-- into the status. What happened now lives in the dated touchpoints and the close track; the
-- status is our plan, set by a person, able to move in any direction. The ladder is still the
-- evidence, and a status never writes to it (rule 2).
--
-- 002's stage and outcome columns stay, unread: this file cannot drop what an applied
-- migration made without the next reader wondering where it went. The backfill below reads
-- them once, so nothing that was further along reads as new.
--
-- Append-only: 001 and 002 are applied in the real database and cannot change.

create type strategy.pursuit_status as enum (
  'new',          -- on the list; nobody has researched them or reached out
  'sourcing',     -- picked to research, enrich, or find a way in
  'selected',     -- we have decided to approach; outreach is next, or under way unanswered
  'discussing',   -- they have engaged: a reply, a call being set, any number of meetings
  'committed',    -- they said yes with an amount; the close track says how far it has got
  'passed'        -- off for now, with who and why; it can reopen
);

alter table strategy.pursuit
  add column status         strategy.pursuit_status not null default 'new',
  -- Why it passed (one of strategy's REASONS), or a line about the status.
  add column status_reason  text,
  -- Who ended it: they declined, we stopped, or it went quiet. Only on passed.
  add column passed_by      text check (passed_by is null or passed_by in ('them', 'us', 'quiet')),
  -- 'us' once a person sets it here, and translation never overwrites that; 'affinity' while
  -- it is still what Affinity's word was read as.
  add column status_source  text not null default 'us',
  add column status_set_at  timestamptz,
  add column status_set_by  uuid references platform.app_user(id),
  -- What the source's word reads as in these statuses, kept even after a person sets the status
  -- here — so when Affinity moves on, the page can say so instead of quietly disagreeing.
  add column status_said    strategy.pursuit_status,
  -- What the source's word says happened, undated ("met_twice", "signed"): claims kept beside
  -- the log and the ladder, never written into either.
  add column implied        text[] not null default '{}',
  -- "Not now" is a date, not a status: "back in touch after the offsite".
  add column next_step      text,
  add column next_step_on   date;

-- Pursuits read from Affinity keep what Affinity's word was read as, until a person sets one.
update strategy.pursuit set status_source = 'affinity' where source = 'affinity';

-- From N46's stage and outcome, where there is one.
update strategy.pursuit set
  status = (case
    when outcome in ('passed', 'lost') then 'passed'
    when stage in ('soft_commit', 'signed', 'funded') then 'committed'
    when stage in ('responded', 'scheduling', 'first_meeting', 'follow_up', 'diligence', 'docs_out') then 'discussing'
    when stage = 'contacted' then 'selected'
    when stage in ('research', 'targeted') then 'sourcing'
    else 'new' end)::strategy.pursuit_status,
  passed_by = case outcome when 'passed' then 'them' when 'lost' then 'quiet' end,
  status_reason = case when outcome in ('passed', 'lost') then outcome_reason end,
  next_step = case when outcome = 'paused' then 'On hold' end
where stage is not null or outcome <> 'open';

-- The rest — pursuits recorded here before stages existed — from their evidence: the ladder is
-- what they had, so the status says no more than it does.
-- A closed pursuit passed, unless what closed was the vehicle: on history, the LP is where the
-- evidence left them.
update strategy.pursuit p set status = (case
    when p.closed_at is not null and r.phase <> 'historical' then 'passed'
    when r.top in ('indication_given', 'commitment_accepted', 'cash_received') then 'committed'
    when r.top in ('target_opted_in', 'meeting_held') then 'discussing'
    when r.top = 'connector_willing' then 'selected'
    else 'sourcing' end)::strategy.pursuit_status
  from (
    select pp.pursuit_id, v.phase,
           (select l.rung::text from strategy.ladder_event l
             where l.pursuit_id = pp.pursuit_id order by l.rung desc limit 1) as top
      from strategy.pursuit pp join platform.vehicle v on v.id = pp.vehicle_id
  ) r
 where r.pursuit_id = p.pursuit_id and p.stage is null and p.outcome = 'open';

update strategy.pursuit set status_said = status where status_source = 'affinity';

create index pursuit_status_idx on strategy.pursuit (vehicle_id, status);
