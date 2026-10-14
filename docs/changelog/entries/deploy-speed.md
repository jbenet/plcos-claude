# Deploys go live sooner · 14 Oct 2026

Juan, 14 Oct 2026: "the deploy waits 5 clear minutes and then takes about 10 to go live". Measured on the Deploy
to Railway runs and Railway's GitHub deployments that day: the import wait took 5 min every time, even with nothing
importing, and Railway's build and start took 7–11.5 min.

- **The import wait is 1 minute, not 5.** It waited 5 clear minutes because `/api/health` showed nothing for a moment
  between two queued jobs, and on 8 Oct a deploy in that moment killed Affinity translate twice. The count now holds
  through it: a finished job counts until its follow-up has a worker, and the daily chain (Affinity slice, translate,
  Linear, SPV stance, calendars) counts from its first step to its last (`holdImports`, lib/import-jobs/server.ts).
  The Action polls every 15 s and needs 5 clear checks.
- **A smaller image.** The runtime stage no longer installs the AWS CLI and its Python: nothing on Railway uploads to
  S3 (docs/deploy/railway.md §8).
- **A faster start.** The entrypoint changed the owner of every file on the volume (tens of thousands of research files)
  on each start, before the server could answer Railway's health check; it now changes only files 10001 does not own.
- The Action checks for the new commit every 10 s (was 20 s).
