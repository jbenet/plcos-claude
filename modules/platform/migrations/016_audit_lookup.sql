-- Reading the audit log by who and by what (docs/26 §4, Juan 4 Oct 2026: "we will need to make sure all the
-- actions are logged for audits, feedback, improvement, etc."). Every MCP and outreach call is one `mcp.call`
-- row; Developer → Agent activity and the audit_recent tool read them by person and action, and the outreach
-- queue's change poll reads a pursuit's rows since a time. Indexes only; the log stays append-only and nothing
-- is deleted.
--
-- Append-only: 001–015 are applied in the real database and cannot change.

create index if not exists audit_log_actor_action_idx on platform.audit_log (actor_id, action, at desc);
create index if not exists audit_log_subject_idx on platform.audit_log (subject_type, subject_id, at desc);
