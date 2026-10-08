-- A link a person pastes for a material (Juan, 8 Oct 2026, "Add link field"): typically a DocSend
-- or file link, so the mail desk can offer it next to the material. Capital OS stores the text and
-- never calls DocSend or opens the link. https only.
alter table content.asset add column if not exists link text
  check (link is null or (link ~ '^https://[^\s]+$' and length(link) <= 2000));
