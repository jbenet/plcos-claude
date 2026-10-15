-- Affinity notes by the people and companies they are attached to (performance pass, 15 Oct 2026).
--
-- An LP page reads the Affinity notes attached to the LP or their firms (connectors/affinity/notes.ts). The test is
-- a containment on each note's personsPreview / companiesPreview, and nothing indexed it: every LP page read all
-- 9,900 notes (13 MB), about 27 ms. These partial indexes hold only Affinity notes (under 1 ms).

-- It indexes a large table, so it may take longer than the web's 20 s statement limit at boot.
set local statement_timeout = 0;
create index raw_record_note_persons_idx on sources.raw_record using gin ((payload->'personsPreview'->'data') jsonb_path_ops)
  where source = 'affinity' and kind = 'note';
create index raw_record_note_companies_idx on sources.raw_record using gin ((payload->'companiesPreview'->'data') jsonb_path_ops)
  where source = 'affinity' and kind = 'note';
