# A vehicle added in the app, and prospects pushed up from the Mac · 5 Oct 2026

The real database now lives only on the cloud server, and the Mac cannot write it. Juan wants to add a new SPV
and fill it with researched LPs from the Mac. Two things stood in the way. A vehicle could be made only by the
init file, which sits on the server's volume where nobody edits it. And a push from the Mac took only W1, W1c and
W5 files.

**Settings → Vehicles** (`/settings/vehicles`, Admins only) lists every vehicle and has an **Add a vehicle** form:
- **Fields:** name; slug, derived from the name and editable; kind; exemption; phase (active by default);
  optional target, raise window and comma-separated aliases. Aliases carry the company's name for now.
- **Slug:** lowercase letters, digits and dashes. It must be unique and cannot be a page's own address
  (`settings`, `all`, …).
- **Exemption:** required and never defaulted silently. 506(c) is preselected with a note beside it, because
  every current vehicle is 506(c).
- **The row:** the same writer as the init file (`writeVehicle`, used by `loadInit` through `applyVehicles`), so
  the two make identical rows. It sorts after the last vehicle.
- **Init reload:** a reload that does not name the new slug leaves it alone, and one that does updates it.
- **Who and audit:** Admin only, by the action's rule (`admin`, `global`) and again in the service. One audit
  row (`vehicle.created`, subject `vehicle`) names who made it.
- **Shows at once:** the rail and every vehicle list read the table per request. The page caches key on the
  read revision, which the write moves. The action also drops Next's rendered pages, as an init reload does.
- **Read-only under the user switcher on real data,** as Settings → People is. Anyone on the network could pick
  an admin there.

**Prospects through the push** (`POST /api/sync/push`, workflow `prospects`, same `sync:push` scope):
- **Command:** `bash scripts/cloud-push.sh prospects <file.jsonl>`. The file travels as its text, so line
  numbers are the file's.
- **Checks:** the server checks every line with the importer's own row rules (now in
  `lib/enrich/prospect-rows.ts`, shared with `scripts/prospects-check.ts`). Every vehicle slug must be one the
  server has, and a Team member may name only vehicles they can change. One bad line refuses the whole push,
  by line number, and writes nothing.
- **Write:** an accepted file is written as `enrich/prospects/<date>-push-<run>-<name>.jsonl`. It never
  replaces a file, because a hard link fails on a taken name.
- **Import:** Add prospects is queued as the token's owner, so the new pursuits are theirs, as if they had
  clicked.
- **The two-minute settle guard stays** for files placed by hand. The push names its own files in the job
  (`input.settled`), and only names of that pushed form skip the wait. The server wrote them whole before
  queueing, and every other file waits as before. This was chosen over backdating the mtime, which would also
  have changed their rank in the importer's file-time tie-break.
- **Busy:** a running prospects import refuses a push (409) before anything is written.
- **Status:** `GET /api/sync/push?job=<id>` answers the pusher with the import's status and counts (added,
  existing, ambiguous, …) and how their own file's rows fared. It gives counts, never names; anyone else gets a
  404. The script waits up to two minutes and prints the counts; `cloud-push.sh status <id>` asks later.
- **Migration** platform 021 lets `sync_push.workflow` be `prospects`.

**Checking on the Mac:** `scripts/prospects-check.ts` now checks vehicle slugs against what the Mac knows,
without opening a database: the last research export (`enrich/vehicles.json`) and the init file. A vehicle
just added on the cloud is not there yet, so `--vehicle <slug>` (repeatable) treats that slug as known and
prints a note saying so.

Properties (`scripts/properties/cloud-vehicle-prospects.ts`, invented data and scratch folders) check:
- Admin-only creation, with Team and Viewer refused and the refusals audited.
- Slug and exemption validation.
- The audit row, the sort order, the listing and the read revision.
- Identical rows from the app and the init file, and reload compatibility.
- A push refused whole for a bad line, an unknown vehicle or a vehicle outside a Team member's reach.
- An accepted push imported as its owner, the settle guard intact for hand-placed files (even when a job
  names one), no overwrite, the status endpoint and the busy refusal.
- `cloud-push.sh prospects` and `status` end to end, and `prospects-check.ts --vehicle`.

No screenshots.
