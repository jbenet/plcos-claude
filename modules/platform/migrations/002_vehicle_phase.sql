-- A vehicle can be history (N45). The SPVs that did not go through are still worth seeing —
-- who was approached, how far each got, the people they touched — but nothing about them is a
-- current raise: no headline counts them, and no send or wire is possible on them.
--
-- An exemption can be "unknown" for a historical vehicle nobody will offer again. It is not a
-- default: the compliance gate reads unknown as 506(c), the strictest, so it fails closed.
--
-- Append-only: 001 is applied in the real database and cannot change.

alter table platform.vehicle add column phase text not null default 'active'
  check (phase in ('active', 'historical'));
