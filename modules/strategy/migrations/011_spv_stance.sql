-- SPV stance (Juan, 27 Sep 2026): whether an LP unit does SPVs, and how many we know of, so an
-- approach for an SPV starts from what they have done. Unknown by default, read as "likely open".
--
-- Three sources, in this order, and never blended into one row:
--   1. a person's setting on the LP page: audited, reversible, and it always wins;
--   2. research facts (the W1 fact fields spv_appetite and spv_deals), written by the import;
--   3. derived signals: our own SPV commitments, Dakota's co-investment flag, and research text that
--      names SPVs or co-investments. Rewritten by the derive job; the strongest wins, conflicts shown.
-- The resolution is code (modules/strategy/spv-rules.ts); these tables hold the inputs with rule 9's
-- provenance on each.

-- A person's setting. A new setting replaces the standing one; a withdrawal returns the LP to the
-- evidence. Both keep the earlier row, so every change can be read back and undone.
create table strategy.spv_setting (
  setting_id    uuid primary key default gen_random_uuid(),
  entity_id     uuid not null references identity.entity(entity_id),
  stance        text not null check (stance in ('unknown', 'does', 'does-not')),
  min_deals     int check (min_deals is null or (min_deals between 1 and 10000)),
  note          text check (note is null or length(note) <= 600),
  set_by        uuid not null references platform.app_user(id),
  set_at        timestamptz not null default now(),
  -- Deferred: the standing row is marked replaced before its successor is written, so at most one stands.
  replaced_by   uuid references strategy.spv_setting(setting_id) deferrable initially deferred,
  withdrawn_at  timestamptz,
  withdrawn_by  uuid references platform.app_user(id),
  check (stance = 'does' or min_deals is null)
);
create index spv_setting_entity_idx on strategy.spv_setting (entity_id, set_at desc);
-- At most one standing setting per entity.
create unique index spv_setting_standing on strategy.spv_setting (entity_id) where replaced_by is null and withdrawn_at is null;

-- Evidence from research and derived signals, one row per signal. Research rows come from the
-- import (a claim each, removed with it); derived rows from the derive job, replaced on each pass.
-- `quote` is our research's own words from a public page: a Dakota row never carries one, and its
-- label is fixed ("Dakota: co-invests"), so no vendor text is copied out of dakota.account.
create table strategy.spv_evidence (
  evidence_id       uuid primary key default gen_random_uuid(),
  entity_id         uuid not null references identity.entity(entity_id),
  kind              text not null check (kind in ('research', 'pipeline', 'dakota', 'text')),
  stance            text not null check (stance in ('unknown', 'does', 'does-not')),
  min_deals         int check (min_deals is null or min_deals >= 0),
  label             text not null,
  quote             text check (quote is null or length(quote) <= 400),
  -- the provenance tuple (rule 9): what it rests on, when, how sure, and who checked it
  source            text not null,
  url               text,
  as_of             date not null,
  confidence        research.confidence not null,
  last_verified_by  uuid references platform.app_user(id),
  claim_id          uuid references research.claim(claim_id) on delete cascade,
  derived_at        timestamptz not null default now(),
  check (kind <> 'dakota' or quote is null),
  check ((kind = 'research') = (claim_id is not null))
);
create index spv_evidence_entity_idx on strategy.spv_evidence (entity_id, kind);
create unique index spv_evidence_claim on strategy.spv_evidence (claim_id) where claim_id is not null;

-- Page inputs read the stance (lib/build-cache.ts): a change is a new read revision.
create trigger network_reads_changed after insert or update or delete or truncate on strategy.spv_setting
  for each statement execute function network.invalidate_reads();
create trigger network_reads_changed after insert or update or delete or truncate on strategy.spv_evidence
  for each statement execute function network.invalidate_reads();

