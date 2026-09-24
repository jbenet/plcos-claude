# data/

Everything the tool keeps on disk, one folder per profile. Git ignores all of it except this
file. See `docs/15-affinity-integration.md` for why, and **Developer → Data** in the app for
what is in force on the server you are looking at.

```
data/
  demo/                 fictional — npm run dev, port 3000
    database/           PGlite, seeded from fixtures/ when empty; npm run demo rebuilds it
    database.lock       the process that has it open
    props/              scratch copy for npm run props, rebuilt on every run
  real/                 the raise — npm run dev:real, port 3100 (on the LAN since 24 Sep 2026)
    database/           PGlite: the Affinity replica and every judgement recorded against it
    init.jsonc          who is on the team, which vehicles exist, which lists track them
    issues/             feedback filed from the real profile, pictures included
```

Nothing under `data/real/` goes into a commit, the changelog, a screenshot, the published
build log or `issues/`. `npm run demo`, `npm run db:reset`, `npm run db:seed` and
`npm run shots` all refuse the real profile.

Two processes must never open the same database. PGlite does not fail when that happens —
it corrupts the directory. The `.lock` file beside each database makes the second opener
refuse by name, usually with "stop the dev server first".
