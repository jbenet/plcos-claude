-- Dakota stays in the database. Needed fields only; no raw payloads.
create schema dakota;
create table dakota.account (
  id text primary key,
  type text,
  parentid text,
  website text,
  linkedin__c text,
  lid__linkedin_company_id__c text,
  sec_cik__c text,
  crd__c text,
  description text,
  firm_commentary__c text,
  aum__c text,
  discretionary_assets__c text,
  average_ticket_size__c text,
  check_size_from__c text,
  check_size_to__c text,
  private_equity_average_ticket_size__c text,
  venture_capital__c text,
  private_equity__c text,
  private_equity_fof__c text,
  fof__c text,
  co_investments__c text,
  secondaries__c text,
  cryptocurrency__c text,
  emerging_manager_program__c text,
  investment_interest__c text,
  investment_focus_single__c text,
  industry_focus__c text,
  sector__c text,
  preferred_investment_vehicle__c text,
  asset_classes__c text,
  geography__c text,
  billingcity text,
  billingstate text,
  billingcountry text,
  metro_area_name__c text,
  year_founded__c text,
  of_employees__c text,
  ownership_type__c text,
  operational_status__c text,
  lastmodifieddate timestamptz not null,
  entity_id uuid not null references identity.entity,
  replica_file text not null,
  source text not null default 'dakota' check(source='dakota'),
  confidence text not null default 'medium',
  last_verified_by uuid not null references platform.app_user(id)
);
create table dakota.contact (
  id text primary key,
  accountid text,
  account_name__c text,
  account_type__c text,
  firstname text,
  lastname text,
  title text,
  contact_type__c text,
  asset_class_coverage__c text,
  biography__c text,
  linkedin_url__c text,
  email text,
  mailingcity text,
  mailingstate text,
  mailingcountry text,
  metro_area_name__c text,
  marketplace_verified_contact__c text,
  lastmodifieddate timestamptz not null,
  entity_id uuid not null references identity.entity,
  replica_file text not null,
  source text not null default 'dakota' check(source='dakota'),
  confidence text not null default 'medium',
  last_verified_by uuid not null references platform.app_user(id)
);
alter table dakota.account add column likely_contact_id text references dakota.contact(id);
create index contact_account_idx on dakota.contact(accountid);
create table dakota.replica (
  module text not null check(module in ('account','contact')),
  file text not null,
  hash text not null,
  primary key(module,file)
);
create table dakota.claim (
  module text not null,
  record_id text not null,
  entity_id uuid not null references identity.entity,
  field text not null,
  value text not null,
  source text not null default 'dakota' check(source='dakota'),
  as_of timestamptz not null,
  confidence text not null default 'medium',
  last_verified_by uuid not null references platform.app_user(id),
  replica_file text not null,
  primary key(module,record_id,field)
);
create index claim_entity_idx on dakota.claim(entity_id);
create table dakota.employment (
  contact_id text primary key references dakota.contact,
  affiliation_id uuid not null references identity.affiliation,
  edge_id uuid not null references network.edge
);
