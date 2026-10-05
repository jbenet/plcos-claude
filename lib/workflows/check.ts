/**
 * Does an Anthropic key work? One GET of the models list, which costs no tokens (Settings → Connections →
 * Check). The answer names the status, never the key; `send` lets the properties answer without a network.
 */
export async function checkAnthropicKey(key: string, send: typeof fetch = fetch): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    const res = await send('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { ok: true, message: 'The key works: Anthropic listed its models.' };
    if (res.status === 401 || res.status === 403) return { ok: false, error: `Anthropic refused the key (${res.status}).` };
    return { ok: false, error: `Anthropic answered ${res.status}. Try again later.` };
  } catch {
    return { ok: false, error: 'Anthropic could not be reached from this server.' };
  }
}
