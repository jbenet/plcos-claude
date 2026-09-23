-- The close track (N52, docs/17 §3): how far a commitment's money has got, as dated events.
--
-- Most of it already existed: an exposure's track (soft or hard), the close room's pack with
-- its returned and countersigned dates, the SPV room's wires. What this adds is what those could
-- not hold: a signature with its date, and a second one when documents are re-signed, with the
-- reason; a closing; and wires as amounts, several to a commitment, because a fund is called
-- in parts.
--
-- The state is derived from these events, never stored: soft → signed → hard → closed, with
-- wires beside it. Hard is still exposure.track, set only by pipeline.harden under a MONEY
-- ticket (rule 1); that command now writes its countersigned event here, in the same
-- transaction, so the two cannot disagree.
--
-- An event read from Affinity is a claim — "Documents Signed" is a signature nobody dated here —
-- and says so in `source`.
--
-- Append-only: 001 and 002 are applied in the real database and cannot change.

create type pipeline.commitment_step as enum (
  'soft',           -- they named an amount (again, if it changed)
  'signed',         -- they signed the subscription documents
  'resigned',       -- they signed again: the entity changed, the documents were amended
  'countersigned',  -- we accepted: the money is hard (written by pipeline.harden only)
  'closed',         -- admitted at a closing: the first close, the SPV's close
  'wired',          -- cash arrived: an amount on a date
  'withdrawn'       -- they pulled out, with the reason
);

create table pipeline.commitment_event (
  event_id      uuid primary key default gen_random_uuid(),
  exposure_id   uuid not null references pipeline.exposure(exposure_id),
  step          pipeline.commitment_step not null,
  -- Null when the source does not say: an undated claim is kept as undated.
  occurred_on   date,
  amount        numeric(16,2) check (amount is null or amount >= 0),
  -- Which document, and which version of it.
  document      text,
  -- Why they re-signed, or withdrew.
  reason        text,
  -- The evidence: a document reference, a wire confirmation.
  reference     text,
  source        text not null default 'us',
  source_ref    text,
  recorded_by   uuid references platform.app_user(id),
  recorded_at   timestamptz not null default now(),
  constraint wired_has_amount check (step <> 'wired' or source <> 'us' or amount is not null)
);

create index commitment_event_exposure_idx on pipeline.commitment_event (exposure_id, recorded_at);
create unique index commitment_event_source_idx on pipeline.commitment_event (source, source_ref) where source_ref is not null;
