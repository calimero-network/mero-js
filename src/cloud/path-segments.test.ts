import { describe, it, expect } from 'vitest';
import { CloudClient } from './cloud-client.js';

const SESSION = { session_token: 's', expires_at: 1_800_000_000, user: { email: 'a@b.c', name: 'A' } };

function recorder() {
  const urls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    const body = urls.length === 1 ? SESSION : {};
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { cloud: new CloudClient({ cloudBaseUrl: 'https://cloud.example', fetch: fetchImpl }), urls };
}

const ROUTES: Array<[string, (c: CloudClient, id: string) => Promise<unknown>]> = [
  ['getRoutingChallenge', (c, id) => c.getRoutingChallenge(id)],
  ['getAccountRelaysChallenge', (c, id) => c.getAccountRelaysChallenge(id)],
  ['getNamespaceRelays', (c, id) => c.getNamespaceRelays(id)],
  ['enableNamespaceHa', (c, id) => c.enableNamespaceHa(id)],
  ['enableFoundedNamespaceHa', (c, id) => c.enableFoundedNamespaceHa(id, {} as never)],
  ['disableNamespaceHa', (c, id) => c.disableNamespaceHa(id)],
];

describe('cloud request path segments', () => {
  it.each(ROUTES)('%s refuses dot segments and the empty id before any request', async (_n, call) => {
    for (const id of ['.', '..', '']) {
      const { cloud, urls } = recorder();
      await cloud.signInWithGoogle('t');
      urls.length = 0;
      await expect(call(cloud, id)).rejects.toThrow(TypeError);
      expect(urls).toEqual([]);
    }
  });

  it.each(ROUTES)('%s keeps a hostile id as one encoded segment', async (_n, call) => {
    const { cloud, urls } = recorder();
    await cloud.signInWithGoogle('t');
    urls.length = 0;
    await call(cloud, 'a/b?c').catch(() => undefined);
    expect(urls[0]).toContain('/a%2Fb%3Fc/');
  });
});
