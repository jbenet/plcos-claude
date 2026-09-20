import { randomUUID } from 'node:crypto';
import type { Agent, AgentRequest, AgentOutcome } from './index';

/**
 * No key, no agent. The stub refuses by name instead of returning a plausible-looking
 * answer, because a fabricated proposal is worse than an empty queue.
 */
export function stubAgent(): Agent {
  return {
    kind: 'stub',
    available: false,
    async propose<T>(req: AgentRequest<T>): Promise<AgentOutcome<T>> {
      return {
        status: 'unavailable',
        why:
          `No ANTHROPIC_API_KEY is set, so "${req.envelope.task}" was not run. ` +
          'Nothing was drafted and nothing was inferred.',
        runId: randomUUID(),
      };
    },
  };
}
