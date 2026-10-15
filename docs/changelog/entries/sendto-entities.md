# Send-to addresses, and companies and people who are not LPs · 15 Oct 2026

JuanMail asked for both (its feedback 0173 and 0174) and Juan said yes. The API is in [docs/27 §5c](../../27-outreach-api.md).

- **Send-to.** An LP can have one address its mail goes To, such as an investments@ inbox, with the main contact
  cc'd. JuanMail sets it with `role: 'send-to'` on `POST /contacts`, and a new one replaces the old. It reads it back as
  `entity.sendTo` in the contacts and queue reads and in `lp_summary`.
- **Companies and people who are not LPs.** `POST /entities` records a portfolio company, a prospect company, a service
  provider or another organisation. It also records a person on a company's team or an LP's assistant. It matches what
  is already here first and never makes a second record. It can be undone within a day.
- **Search** now says what each entity is to us (an LP, a portfolio company, and so on) and lists a person's team and
  assistant links.
