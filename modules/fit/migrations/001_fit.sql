-- fit: where we stand with one firm, on one vehicle.
--
-- The shape comes from the reports rather than from intuition. Report 1 §2.5 and Report 4
-- §4.2 both land on the same structure: binary hard gates that exclude with a stated
-- reason, then a weighted set of graded dimensions — never one blended "priority" field,
-- which is exactly why priority fields go stale and get ignored (Report 4 §4.1).
--
-- Two things are carried everywhere: the certainty of each finding (we knew it, we
-- inferred it, or we guessed) and the date it was last refreshed. Report 4 §4.3: "A ranked
-- list nobody trusts is a ranked list nobody uses, and the fastest way to lose trust is an
-- unexplained number."

create schema if not exists fit;

-- Report 4 §2.1. The class determines the decision architecture and therefore the timeline,
-- which for a dated close matters more than fit does.
create type fit.firm_class as enum (
  'sfo',          -- single family office: principal-controlled, fast, usually no ADV
  'mfo',          -- multi-family office: registered, committee, slower
  'ria',
  'foundation',
  'endowment',
  'fof',          -- fund-of-funds and specialist emerging-manager seeders
  'institution',  -- pension, insurance, sovereign
  'corporate',
  'individual'
);

-- Report 4 §4.2: encode decision architecture as an ordinal with estimated weeks.
create type fit.decision_arch as enum ('principal', 'cio', 'small_ic', 'full_ic_consultant');

-- Certainty is a first-class field. "Whether we guess or know" changes what a finding
-- licenses, and a grade without it is a number pretending to be evidence.
create type fit.certainty as enum ('known', 'inferred', 'guess');

create type fit.grade as enum ('strong', 'good', 'neutral', 'weak', 'blocker');

-- Per firm, independent of any vehicle: who they are and how they decide.
create table fit.firm_profile (
  entity_id          uuid primary key references identity.entity(entity_id),
  firm_class         fit.firm_class not null,
  -- Report 4 §1.1: absence from IAPD is itself diagnostic — it usually means an exempt
  -- single family office, which is the faster-moving prospect.
  iapd_registered    boolean,
  est_aum            numeric(16,2),
  aum_basis          text,
  aum_certainty      fit.certainty not null default 'guess',
  decision_arch      fit.decision_arch not null,
  weeks_min          int not null,
  weeks_max          int not null,
  who_signs          text,
  who_can_kill       text,
  check_band_min     numeric(16,2),
  check_band_max     numeric(16,2),
  -- Report 4 §8: relationship provenance is a compliance field, not a nicety. Under
  -- 506(b) it is the record you would need if anyone ever asked.
  prior_relationship boolean not null default false,
  provenance_note    text,
  provenance_since   date,
  updated_at         timestamptz not null default now()
);

-- Per firm × vehicle.
create table fit.assessment (
  assessment_id  uuid primary key default gen_random_uuid(),
  entity_id      uuid not null references identity.entity(entity_id),
  vehicle_id     uuid not null references platform.vehicle(id),
  owner_id       uuid references platform.app_user(id),
  headline       text not null,
  updated_at     timestamptz not null default now(),
  unique (entity_id, vehicle_id)
);

-- Binary. Report 1 §2.5: "fail any and the prospect is out". An unknown gate is not a
-- pass — it is a thing to go and find out.
create table fit.gate (
  gate_id        uuid primary key default gen_random_uuid(),
  assessment_id  uuid not null references fit.assessment(assessment_id),
  code           text not null,
  label          text not null,
  passed         boolean,
  detail         text not null,
  certainty      fit.certainty not null,
  source         text references research.source_doc(doc_id),
  as_of          date not null,
  unique (assessment_id, code)
);

-- The graded dimensions. weight_us and weight_them are separate because they answer
-- different questions: how much this moves our decision, and how much it moves theirs.
create table fit.dimension (
  dimension_id   uuid primary key default gen_random_uuid(),
  assessment_id  uuid not null references fit.assessment(assessment_id),
  code           text not null,
  label          text not null,
  question       text not null,
  grade          fit.grade not null,
  certainty      fit.certainty not null,
  finding        text not null,
  source         text references research.source_doc(doc_id),
  as_of          date not null,
  weight_us      int not null check (weight_us between 1 and 5),
  weight_them    int not null check (weight_them between 1 and 5),
  unique (assessment_id, code)
);

-- What they value, how we match it, and whether they already know that.
create table fit.value_item (
  value_id       uuid primary key default gen_random_uuid(),
  assessment_id  uuid not null references fit.assessment(assessment_id),
  they_value     text not null,
  our_match      text not null,
  match_grade    fit.grade not null,
  -- The distinction that decides what to do next: a gap in their knowledge is a
  -- different problem from a gap in our substance.
  clear_to_them  boolean not null,
  next_action    text not null,
  certainty      fit.certainty not null,
  source         text references research.source_doc(doc_id),
  as_of          date not null
);

-- Report 5 §3: what reaches a segment differs sharply, so awareness and agreement are
-- tracked apart. A prospect who has never heard of us is a marketing problem; one who
-- knows us well and disagrees is a thesis problem. They look identical in a pipeline.
create type fit.familiarity as enum ('unaware', 'heard_of', 'familiar', 'deep');
create type fit.sentiment as enum ('negative', 'skeptical', 'neutral', 'positive', 'champion', 'unknown');

create table fit.perception (
  perception_id  uuid primary key default gen_random_uuid(),
  assessment_id  uuid not null references fit.assessment(assessment_id),
  subject        text not null,
  subject_kind   text not null,
  familiarity    fit.familiarity not null,
  sentiment      fit.sentiment not null,
  evidence       text not null,
  certainty      fit.certainty not null,
  source         text references research.source_doc(doc_id),
  as_of          date not null
);

-- Public engagement. Weak evidence on its own, and useful precisely because it is cheap:
-- it separates "never heard of us" from "watching quietly".
create table fit.engagement (
  engagement_id  uuid primary key default gen_random_uuid(),
  assessment_id  uuid not null references fit.assessment(assessment_id),
  channel        text not null,
  behaviour      text not null,
  detail         text not null,
  observed_on    date not null,
  certainty      fit.certainty not null
);

-- Opinion-setting links. Report 6 §2.2: the causal finding is an inverted U — moderately
-- weak ties move more than either strangers or your closest contacts — so the band is
-- stored and the planner prefers the middle of it.
create type fit.link_kind as enum (
  'they_lp_in_us', 'we_lp_in_them', 'co_lp', 'co_investor', 'portfolio_overlap',
  'former_colleague', 'board', 'personal', 'advisor', 'grantee'
);

create table fit.link (
  link_id        uuid primary key default gen_random_uuid(),
  assessment_id  uuid not null references fit.assessment(assessment_id),
  via_entity     uuid references identity.entity(entity_id),
  kind           fit.link_kind not null,
  statement      text not null,
  tie_band       text not null,
  -- How much this person's opinion actually moves this target. A credible voice on the
  -- wrong topic moves nothing (Report 6 §3.1).
  opinion_weight fit.grade not null,
  certainty      fit.certainty not null,
  source         text references research.source_doc(doc_id),
  as_of          date not null
);

create index assessment_vehicle_idx on fit.assessment (vehicle_id);
create index dimension_assessment_idx on fit.dimension (assessment_id);
