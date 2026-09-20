import { fileIssueSink } from '../lib/issues/file';

/** Rewrite every issue file through the serializer — used after a format change. */
async function main() {
  const sink = fileIssueSink('issues');
  const all = await sink.list();
  for (const i of all) await sink.update(i.id, {});
  console.log(`rewrote ${all.length} issue file${all.length === 1 ? '' : 's'}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
