import Link from '@/components/ui/AppLink';

/**
 * A person or organisation, wherever their name appears.
 *
 * The name opens the summary in the right pane through a `?e=` search param, so a reader
 * never loses the list they were reading. The arrow goes to the full page. Two
 * affordances, because "tell me more about this one" and "take me to their record" are
 * different intentions and conflating them costs a back button every time.
 */
export function EntityLink({
  id, name, bold = true, keep,
}: {
  id: string;
  name: string;
  bold?: boolean;
  /** Search params the list is showing (a search, a page), kept when the summary opens. */
  keep?: Record<string, string | undefined>;
}) {
  const params = new URLSearchParams(Object.entries(keep ?? {}).filter((x): x is [string, string] => Boolean(x[1])));
  params.set('e', id);
  return (
    <span className="elink">
      <Link href={`?${params}`} scroll={false} aria-label={`Summarise ${name} in the detail pane`}>
        {bold ? <b>{name}</b> : name}
      </Link>
      <Link className="ego" href={`/orgs/${id}`} aria-label={`Open the page for ${name}`}>
        ↗
      </Link>
    </span>
  );
}
