-- Where an exposure's number came from (N47), the provenance tuple for money (rule 9).
--
-- An amount read from Affinity is the team's record of what an LP said, not a signature, so it
-- is always soft here; `claim` keeps what the source said about it ("Documents Signed"), which
-- is how the Soft → Hard page knows it is ready to harden. Hardening still needs the close
-- room's evidence and a MONEY ticket (rule 1).
--
-- Append-only: 001 is applied in the real database and cannot change.

alter table pipeline.exposure
  add column source        text not null default 'us',
  add column source_ref    text,
  add column source_as_of  timestamptz,
  add column claim         text;

create index exposure_source_idx on pipeline.exposure (source, source_ref);
