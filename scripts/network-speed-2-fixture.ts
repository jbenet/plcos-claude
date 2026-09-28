import type { GraphSnapshot, Link } from '../modules/network/path-search';

/** Invented topology, not a reconstruction of any investor's relationships.
 * Counts other than the 5,418 target workload are stress-test guesses. */
export function networkHubFixture(targetCount = 5418, spokeCount = 18000, dense = false) {
  const adjacency = new Map<string, Link[]>();
  let edgeCount = 0;
  const edge = (a: string, b: string) => {
    const edgeId = String(++edgeCount).padStart(10, '0');
    for (const [node, other] of [[a, b], [b, a]]) {
      const links = adjacency.get(node!) ?? [];
      links.push({ edgeId, other: other! }); adjacency.set(node!, links);
    }
  };
  const sources = [...Array.from({ length: 7 }, (_, i) => `invented-team-${i}`), 'invented-pl-org'];
  const targets = Array.from({ length: targetCount }, (_, i) => `invented-target-${i}`);
  for(const source of sources)for(let h=0;h<3;h++)edge(source,`invented-hub-${h}`);
  for (let i = 0; i < spokeCount; i++) {
    const spoke = `invented-contact-${i}`;
    // Thousands of first hops from each source, overlapping across the team and PL.
    edge(sources[i % 7]!, spoke); edge(sources[(i + 1) % 7]!, spoke); edge(sources[7]!, spoke);
    for (let h = 0; h < 3; h++) edge(spoke, `invented-hub-${h}`);
  }
  // GUESS stress shape: a dense connector cluster creates expensive irrelevant
  // three-hop expansion. These contacts have no direct target tails.
  const clusterSize=Math.min(780,Math.floor(spokeCount/2));
  for(let i=spokeCount-clusterSize;i<spokeCount;i++)for(let j=i+1;j<spokeCount;j++)
    edge(`invented-contact-${i}`,`invented-contact-${j}`);
  for (const [i, target] of targets.entries()) {
    if (i % 19 === 0) {
      // An isolated high-degree tail has no supported path from any source.
      edge(target, 'invented-unreachable-hub');
    } else {
      if(dense)for (let h = 0; h < 3; h++) edge(target, `invented-hub-${h}`);
      else edge(target, `invented-contact-${i % spokeCount}`);
      // Direct and two-hop alternatives coexist with capped three-hop expansion.
      if (i % 5 === 0) edge(sources[i % 7]!, target);
      if (dense && i % 3 === 0) edge(`invented-contact-${i % spokeCount}`, target);
    }
  }
  for (let i = 0; i < spokeCount; i++) edge('invented-unreachable-hub', `invented-isolated-${i}`);
  const graph: GraphSnapshot = { adjacency, coverage: { edges: edgeCount, from: null, to: null }, tiers: [] };
  return { graph, sources, targets, sourceOnly: new Set(['invented-pl-org']), edgeCount, spokeCount };
}
