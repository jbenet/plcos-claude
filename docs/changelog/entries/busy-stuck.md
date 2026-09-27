# busy-stuck — A timed-out lookup can no longer take the app down

27 Sep 2026. After a restart, every page answered "The server is busy" at once, with the server idle. The feedback box's reporter lookup runs on a short budget; when it was the first thing to touch the database after a restart, the database's boot ran inside that budget, the budget ran out, and the failed boot was kept and shared with every later request.

Cancellation is now passed explicitly to the one call it belongs to, so shared work (the boot, the migration catch-up, shared page loads) never inherits it. If a query is refused as busy while nothing is running or waiting, the scheduler logs it once and runs the query. A migration catch-up refused as busy retries on the next check instead of marking itself applied. Properties cover each case, including the original failure.
