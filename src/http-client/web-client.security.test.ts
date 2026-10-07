import { describe, it, expect, vi } from 'vitest';
import { WebHttpClient, HTTPError, AuthRevokedError, assertSecureBaseUrl } from './web-client.js';
import type { Transport } from './http-types.js';

describe('assertSecureBaseUrl', () => {
  it('rejects cleartext http:// and ws:// to a non-loopback host', () => {
    expect(() => assertSecureBaseUrl('http://node.example.com:2528')).toThrow(/cleartext/);
    expect(() => assertSecureBaseUrl('ws://node.example.com')).toThrow(/cleartext/);
  });

  it('does not treat lookalike hosts as loopback', () => {
    for (const url of ['http://app.localhost', 'http://localhost@evil.com', 'http://localhost.:2528']) {
      expect(() => assertSecureBaseUrl(url), url).toThrow(/cleartext/);
    }
  });

  it('allows loopback http, https anywhere, and an explicit opt-in', () => {
    for (const url of ['http://localhost:2528', 'http://127.0.0.1:2528', 'http://[::1]:2528']) {
      expect(() => assertSecureBaseUrl(url), url).not.toThrow();
    }
    expect(() => assertSecureBaseUrl('https://node.example.com')).not.toThrow();
    expect(() => assertSecureBaseUrl('http://node.example.com', true)).not.toThrow();
  });
});

describe('HTTPError.toJSON', () => {
  it('redacts credential headers and keeps the rest', () => {
    const headers = new Headers({
      authorization: 'Bearer secret-token',
      'set-cookie': 'session=abc',
      'content-type': 'application/json',
    });
    const json = new HTTPError(500, 'Server Error', '/x', headers).toJSON();
    expect(json.headers).toEqual({
      authorization: '[REDACTED]',
      'set-cookie': '[REDACTED]',
      'content-type': 'application/json',
    });
  });
});

describe('WebHttpClient credentials on absolute URLs', () => {
  function capture(extra: Partial<Transport> = {}) {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const client = new WebHttpClient({
      fetch: fetch as unknown as Transport['fetch'],
      baseUrl: 'https://api.example.com',
      getAuthToken: async () => 'secret-token',
      ...extra,
    });
    const sent = () => fetch.mock.calls.at(-1)![1]!.headers as Record<string, string>;
    return { client, sent };
  }

  it('sends the token to the node, by relative path or by its own absolute URL', async () => {
    const { client, sent } = capture();
    await client.get('/admin-api/contexts');
    expect(sent().Authorization).toBe('Bearer secret-token');
    await client.get('https://api.example.com/admin-api/contexts');
    expect(sent().Authorization).toBe('Bearer secret-token');
  });

  it('sends no token and no request authorization to another origin', async () => {
    const authorizeRequest = vi.fn(async () => ({ 'x-proof': 'p' }));
    const { client, sent } = capture({ authorizeRequest });
    await client.get('https://evil.example.net/steal');
    expect(sent().Authorization).toBeUndefined();
    expect(sent()['x-proof']).toBeUndefined();
    expect(authorizeRequest).not.toHaveBeenCalled();
  });
});

describe('WebHttpClient construction', () => {
  const make = (extra: Partial<Transport>) =>
    new WebHttpClient({ fetch: vi.fn() as unknown as Transport['fetch'], baseUrl: 'http://remote', ...extra });

  it('refuses a cleartext non-loopback baseUrl unless allowInsecureHttp is set', () => {
    expect(() => make({})).toThrow(/cleartext/);
    expect(() => make({ allowInsecureHttp: true })).not.toThrow();
  });
});

describe('WebHttpClient foreign-origin responses and headers', () => {
  function setup(response: Response, extra: Partial<Transport> = {}) {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => response.clone());
    const onAuthRevoked = vi.fn();
    const refreshToken = vi.fn(async () => 'fresh');
    const client = new WebHttpClient({
      fetch: fetch as unknown as Transport['fetch'],
      baseUrl: 'https://api.example.com',
      getAuthToken: async () => 'secret-token',
      defaultHeaders: { 'X-Tenant': 'acme' },
      onAuthRevoked,
      refreshToken,
      ...extra,
    });
    return { client, fetch, onAuthRevoked, refreshToken };
  }
  const denied = (authError: string) =>
    new Response('no', { status: 401, headers: { 'x-auth-error': authError } });

  it('ignores token_revoked from another origin: plain HTTPError, tokens kept', async () => {
    const { client, onAuthRevoked } = setup(denied('token_revoked'));
    const err = await client.get('https://evil.example.net/x').catch((e) => e);
    expect(err).toBeInstanceOf(HTTPError);
    expect(err).not.toBeInstanceOf(AuthRevokedError);
    expect(onAuthRevoked).not.toHaveBeenCalled();
  });

  it('still revokes on token_revoked from the node itself', async () => {
    const { client, onAuthRevoked } = setup(denied('token_revoked'));
    await expect(client.get('/x')).rejects.toBeInstanceOf(AuthRevokedError);
    expect(onAuthRevoked).toHaveBeenCalledTimes(1);
  });

  it('does not refresh and retry on token_expired from another origin', async () => {
    const { client, fetch, refreshToken } = setup(denied('token_expired'));
    await expect(client.get('https://evil.example.net/x')).rejects.toBeInstanceOf(HTTPError);
    expect(refreshToken).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('sends defaultHeaders to the node but not to another origin', async () => {
    const { client, fetch } = setup(new Response('{}', { status: 200 }));
    await client.get('/x');
    await client.get('https://other.example.net/x');
    expect((fetch.mock.calls[0][1]!.headers as Record<string, string>)['X-Tenant']).toBe('acme');
    expect((fetch.mock.calls[1][1]!.headers as Record<string, string>)['X-Tenant']).toBeUndefined();
  });

  describe('redirects', () => {
    const ok = () => new Response('{}', { status: 200 });
    const redirectOf = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls[0][1]!.redirect;

    it('does not follow redirects once a request authorization is attached', async () => {
      const { client, fetch } = setup(ok(), { authorizeRequest: async () => ({ 'x-proof': 'p' }) });
      await client.get('/x');
      expect(redirectOf(fetch)).toBe('manual');
    });

    it('does not follow redirects once a proof is attached', async () => {
      const { client, fetch } = setup(ok(), { getProof: async () => 'proof' });
      await client.get('/x');
      expect(redirectOf(fetch)).toBe('manual');
    });

    it('leaves redirect alone for an unsigned request, and honours an explicit one', async () => {
      const unsigned = setup(ok());
      await unsigned.client.get('/x');
      expect(redirectOf(unsigned.fetch)).toBeUndefined();

      const explicit = setup(ok(), { getProof: async () => 'proof' });
      await explicit.client.get('/x', { redirect: 'error' });
      expect(redirectOf(explicit.fetch)).toBe('error');
    });
  });
});
