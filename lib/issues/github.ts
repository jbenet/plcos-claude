import type { IssueSink } from './index';

/**
 * The D2 path. Not built (CLAUDE.md: issues live in this repo as markdown until D2).
 * Present so the seam has a second shape to type against and so a config flip fails with
 * a sentence rather than by silently dropping someone's bug report on the floor.
 */
export function unbuiltIssueSink(provider: 'github' | 'linear'): IssueSink {
  const refuse = (): never => {
    throw new Error(
      `config.issues.provider is "${provider}" but that sink is not built yet (D2). ` +
        'Set it back to "file". Feedback must never be accepted and then discarded.',
    );
  };
  return {
    kind: provider,
    destination: `${provider} (not built yet)`,
    create: refuse,
    list: refuse,
    get: refuse,
    update: refuse,
  };
}
