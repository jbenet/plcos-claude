import { randomUUID } from 'node:crypto';
import type { Agent, AgentRequest, AgentOutcome } from './index';

/**
 * The L13 path. The envelope, the policy check on each tool call, run-config pinning and
 * the regression harness all land there; none of it is built yet, so this refuses rather
 * than making a bare API call that would sidestep every one of those rules.
 */
export function claudeAgent(_apiKey: string): Agent {
  return {
    kind: 'claude',
    available: false,
    async propose<T>(req: AgentRequest<T>): Promise<AgentOutcome<T>> {
      return {
        status: 'refused',
        why:
          'An API key is present, but the agent runtime lands at L13: no work-envelope policy ' +
          'check, no run-config pinning, no regression harness. Running "' + req.envelope.task +
          '" without those would produce output nobody can audit.',
        runId: randomUUID(),
      };
    },
  };
}
