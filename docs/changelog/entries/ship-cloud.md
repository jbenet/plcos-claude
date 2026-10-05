# Shipping once the data is in the cloud · 5 Oct 2026

After the move to Railway, the Mac no longer serves real data (`data/real/moved-to-cloud`), so `scripts/ship.sh`
could no longer restart and smoke-test it: every ship would have rolled itself back.
- With the moved-to-cloud marker present, `ship.sh` still runs the gate and fast-forwards the Mac checkout (its
  scripts push and pull), and skips the Mac restart and the local smoke test.
- `ship.sh --deploy` then pushes master to `deploy`, which Railway builds. It waits until Railway's
  `/api/health` names the pushed commit (up to 25 minutes, a guess) and `/signin` answers 200. There is no
  automatic rollback in the cloud: on failure it says to redeploy the previous deployment in Railway.
- `/api/health` now names the commit a deployed image was built from (`.image-commit`, written by the
  Dockerfile). Elsewhere it is unchanged: `{ ok: true }`.
- The cloud's address comes from `PLCOS_CLOUD_URL` or `~/.plcos-helpers/cloud-url`.
