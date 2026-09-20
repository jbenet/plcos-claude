import { openFresh } from '../lib/db';
import { seed } from '../lib/seed';

async function main() {
  const db = await openFresh();
  const counts = await seed(db);
  console.log(`seeded · ${counts.users} users · ${counts.vehicles} vehicles · ${counts.sources} sources`);
  await db.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
