import { describe, it, expect, vi } from 'vitest';
import { WebHttpClient, HTTPError, assertSecureBaseUrl } from './web-client.js';
import type { Transport } from './http-types.js';

describe('assertSecureBaseUrl', () => {
  it('rejects cleartext http:// and ws:// to a non-loopback host', () => {
    expect(() => assertSecureBaseUrl('http://node.example.com:2528')).toThrow(/cleartext/);
    expect(() => assertSecureBaseUrl('ws://node.example.com')).toThrow(/cleartext/);
  });

  it('allows loopback http, https anywhere, and an explicit opt-in', () => {
    for (const url of ['http://localhost:2528', 'http://app.localhost', 'http://127.0.0.1:2528', 'http://[::1]:2528']) {
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
