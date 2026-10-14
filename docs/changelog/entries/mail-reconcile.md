# Reconcile sent mail: check parties, research on no vehicle, Affinity writes by batch · 14 Oct 2026

Juan, 14 Oct 2026: some of his sent mail never reached Affinity. He asked for a reconcile page that checks everyone he
emailed against PLC OS and Affinity and fixes what it can. The page lives in JuanMail, which holds all his mail. PLC OS
answers for its own records and writes to Affinity once he approves a batch ("C, also notes").

- `POST /api/outreach/parties` says, for each address emailed:
  - whether it is internal, and whether it is on file;
  - which pipelines it is in, and which raises the mail was about;
  - whether PLC OS's copy of Affinity has the person and the mail.
  It also suggests fixes. It is read-only and makes no Affinity request (docs/27 §4e).
- `POST /api/outreach/research` puts someone into the research set without adding them to any pipeline, and can be
  undone for a day (docs/27 §5a).
- `POST /api/outreach/affinity` proposes adding a missing person to Affinity, with a note of the dates and subjects of
  the mail. Items gather in one batch under **Approvals → Affinity writes**, where an admin writes the checked ones and
  rejects the rest. A batch may take at most 100 Affinity requests. Only `lib/connectors/affinity/write.ts` writes, and
  only a person or a note (docs/27 §5b).
