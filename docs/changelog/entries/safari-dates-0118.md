## Safari — dates read the same on the server and in the browser (issue 0118)

The pipeline reported a hydration mismatch in Safari. Its dates were formatted with
`toLocaleDateString('en-GB', { month: 'short' })`, and the server's ICU and Safari's disagree on
that: Node writes "8 Sept", Safari "8 Sep". Safari also writes "Wed, 2 Sep" and "2 Sep at 15:06"
where Node writes "Wed 2 Sep" and "2 Sep, 15:06". So every September date in a Client Component
(the pipeline's last touch, last met and its tooltip, due dates, the Today page's signals) differed
between the HTML and the first render in the browser.

- `formatDate` in `lib/time.ts` builds a short date from numbers and a fixed month list, so it
  reads the same everywhere. Every short-month format in `app/`, `components/`, `lib/` and
  `modules/` uses it. September now reads "Sep" on every page; other months are unchanged.
- Signals, approvals and the fit board format their dates in UTC like the rest of the tables,
  so a browser in another time zone than the server no longer renders a different day.
- The root layout turns off Safari's format detection (telephone, date, email, address), which
  can turn text into links before React hydrates.
- `npm run boundaries` refuses a short-month `toLocale*String` call outside `lib/time.ts`.

Verified in Playwright WebKit (Safari's engine) at 1366×892 against a demo server: the vehicle
and all-vehicle pipelines, selection, an LP page, Today, Approvals, Standup, the calendars,
close, status, fit, stats, meetings, routes and the other main pages hydrate without a warning,
with the browser in Los Angeles and in Tokyo time. Not verified on a real iPad.
