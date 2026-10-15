import { buildCache } from '@/lib/build-cache';
import { listEntities, type Entity } from '@/modules/identity';
import { pipelineEntityIds } from '@/modules/strategy';

/** The LPs on any pipeline, as entities, kept per read revision (pursuits and entities move it): the materials page
 * read all 5,000 on every visit (15 Oct 2026: 25 ms). Shared: never change one. */
const cached = buildCache(async () => listEntities(await pipelineEntityIds()));
export async function pipelineEntities(): Promise<Entity[]> {
  return [...await cached()];
}
