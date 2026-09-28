## Dakota — deterministic transaction rollback property

The rollback test counted 17 contact writes across transactions, but the 100 ms
work budget can commit a smaller batch first. It then incorrectly expected those
earlier committed records and their checkpoint to roll back too.

Inject the failure in the first contact transaction after its checkpoint update.
Assert that both writes executed, then verify zero persisted contacts and the
unchanged checkpoint. This exercises their atomic rollback regardless of batch
timing, while retaining the restart and uninterrupted-result comparisons.

Verified: 10 consecutive full `npm run props` runs on PGlite, each passing all
1,289 properties; `npx tsc --noEmit`; `npm run boundaries`. Invented contact
batches included a six-write batch, below the old failure threshold of 17.
