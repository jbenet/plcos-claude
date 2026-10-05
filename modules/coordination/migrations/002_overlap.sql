-- Fund before SPV became advisory (Juan, 4 Oct 2026: "we have to pitch SPVs as we go"; docs/27 §4).
-- Pitching an SPV to an LP with an open fund discussion is no longer held; it is coordinated, and the
-- coordination is a record (rule 5): which LP, which SPV and which fund, what was chosen — mention both
-- in one note, send the SPV separately, or wait — and a dated follow-up, always. For "wait" the SPV is
-- the side that defers, and the date is its second bite; otherwise it is when to look at both again.
--
-- Pursuit ids are not foreign keys: strategy migrates after coordination.
--
-- Append-only: 001 is applied in the real database and cannot change.

create table coordination.overlap (
  overlap_id        uuid primary key default gen_random_uuid(),
  entity_id         uuid not null references identity.entity(entity_id),
  vehicle_id        uuid not null references platform.vehicle(id),
  pursuit_id        uuid not null,
  other_vehicle_id  uuid not null references platform.vehicle(id),
  other_pursuit_id  uuid,
  choice            text not null check (choice in ('mention_both', 'send_separately', 'wait')),
  follow_up_on      date not null,
  ticket_id         uuid references governance.approval_ticket(id),
  recorded_by       uuid not null references platform.app_user(id),
  recorded_at       timestamptz not null default now(),
  note              text
);

create index overlap_entity_idx on coordination.overlap (entity_id, recorded_at desc);
