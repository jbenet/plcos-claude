# Admin the Astra runner from the page: Check, Update, Restart · 11 Oct 2026

Juan, 11 Oct 2026: "Maybe built some RC type thing for the runner on the Mac so you can help admin it". The runner
had kept old code after a pull, and restarting it took a person at the Mac.

- Developer → Astra shows which code the runner is on and has **Check**, **Update** and **Restart**. The runner takes
  each on its next poll and answers on the page. Update brings it to the latest master, runs `npm ci` when the
  dependencies changed, and restarts it. Update and Restart wait for running batches.
- An Admin token can send the same commands, so a Claude session can look after the runner without the Mac.
- The runner fetches over HTTPS (git's gh credential helper) when the SSH agent refuses, and restarts by itself when
  the checkout has moved past the code it started on, under the login item or the Astra app.

Notes: `docs/30-astra-runner.md` "Keeping the runner current, and admin from the page".
