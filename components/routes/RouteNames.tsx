import Link from '@/components/ui/AppLink';
import type { Route } from '@/modules/network';

export function routeNameLinks(route: Route, alternatives: Route[], fromName: string) {
  return route.hops.map((hop, i) => ({ name: hop.toName, href: `/orgs/${hop.toEntity}`,
    title: i === 0 && alternatives.length ? `${alternatives.length} alternatives via ${hop.toName}:\n${alternatives.slice(0, 12).map((r) => `${r.fromName ?? fromName} → ${r.hops.map((h) => h.toName).join(' → ')}`).join('\n')}${alternatives.length > 12 ? `\n${alternatives.length - 12} more in the alternatives disclosure.` : ''}\nOpen their page for connections.` : `Open ${hop.toName}’s page` }));
}

/** Entity links stay separate from route inspection. Hover text lists folded alternatives;
 * the adjacent disclosure carries the same alternatives for keyboard users.
 */
export function RouteNames({ route, alternatives, fromName }: { route: Route; alternatives: Route[]; fromName: string }) {
  return <b>{fromName}{routeNameLinks(route, alternatives, fromName).map((hop, i) => <span key={i}> → <Link href={hop.href} title={hop.title}>{hop.name}</Link></span>)}</b>;
}
