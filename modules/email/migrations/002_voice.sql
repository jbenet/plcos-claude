-- A sender's voice (Juan, 3 Oct 2026; docs/email-guidelines.md §Voice). Each person keeps short
-- notes on how they write and a few emails of their own as examples, in Preferences. Whoever drafts
-- for them reads it: the Email box beside the editor, and the W5 strategy writers through the
-- research export's us/voice.json.
--
-- Their own words only, chosen by them; kept in this database, never used for training, deletable:
-- deleting removes the row, and the audit log keeps only that it changed and how long it was.

create table email.voice (
  user_id     uuid primary key references platform.app_user(id),
  -- How they write: greeting, length, sign-off, words they use and avoid. Plain text.
  style       text not null default '' check (length(style) <= 4000),
  -- Three to five emails they sent, pasted or picked by them, each as plain text.
  samples     text[] not null default '{}' check (cardinality(samples) <= 5),
  updated_at  timestamptz not null default now()
);
