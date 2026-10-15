-- Two things the mail desk asked for (JuanMail feedback 0173 and 0174; Juan said yes, 15 Oct 2026). docs/27 §5c.
--
-- send_to: the one address mail to an LP goes To (an investments@ inbox, say), its main contact cc'd. At most one
-- per entity: a new one replaces the old. The address is also an email claim on the entity, as any confirmed
-- address is; claim_id names it. Readers resolve merges through identity.alias_ids.
create table identity.send_to (
  entity_id uuid primary key references identity.entity(entity_id),
  email     text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  claim_id  uuid,
  set_by    uuid not null references platform.app_user(id),
  set_at    timestamptz not null default now(),
  source    text not null
);

-- relation: what a non-LP organisation is to us. An LP is anyone with a pursuit and needs no row; a company in
-- network.portfolio reads as a portfolio company without one. A row set here wins over both.
create table identity.entity_relation (
  entity_id uuid primary key references identity.entity(entity_id),
  relation  text not null check (relation in ('portfolio-company', 'prospect-company', 'service-provider', 'other')),
  set_by    uuid not null references platform.app_user(id),
  set_at    timestamptz not null default now(),
  source    text not null
);
