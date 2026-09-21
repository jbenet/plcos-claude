-- Cost is three numbers, not one, and a queue is a decision.
--
-- `effort_days` conflated two things that behave completely differently. A person-day is
-- the scarcest thing this team has; an hour of model time is nearly free and still not
-- free, because somebody has to read the output and decide whether to believe it. Ranking
-- them against each other with one number buries the cheapest work under the loudest.
--
-- `automatable` is separate from "is it cheap". A search an agent can run is cheap *and*
-- repeatable, and the ranking is deliberately biased toward it — by a factor sitting in
-- the UI where it can be argued with, not in this schema.

alter table research.method add column human_days  numeric not null default 0;
alter table research.method add column ai_hours    numeric not null default 0;
alter table research.method add column automatable boolean not null default false;

-- Everything that was recorded as effort was person-time.
update research.method set human_days = effort_days;

-- A chosen queue is a decision somebody made, so it survives a reload and carries a name.
alter table research.method add column selected    boolean not null default false;
alter table research.method add column selected_at timestamptz;
alter table research.method add column selected_by uuid references platform.app_user(id);
