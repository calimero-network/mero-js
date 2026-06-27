import { describe, it, expect, vi } from 'vitest';
import { WebHttpClient, HTTPError, assertSecureBaseUrl } from './web-client';
import { Transport } from './http-types';

describe('assertSecureBaseUrl', () => {
  it('rejects cleartext http:// to a non-loopback host', () => {
    expect(() => assertSecureBaseUrl('http://node.example.com:2528')).toThrow(
      /cleartext/,
    );
  });

  it('rejects ws:// to a non-loopback host', () => {
    expect(() => assertSecureBaseUrl('ws://node.example.com')).toThrow();
  });

  it('allows loopback http (localhost / 127.0.0.1 / ::1)', () => {
    expect(() => assertSecureBaseUrl('http://localhost:2528')).not.toThrow();
    expect(() => assertSecureBaseUrl('http://127.0.0.1:2528')).not.toThrow();
    expect(() => assertSecureBaseUrl('http://[::1]:2528')).not.toThrow();
  });

  it('allows https:// to any host', () => {
    expect(() => assertSecureBaseUrl('https://node.example.com')).not.toThrow();
  });

  it('allows insecure remote when explicitly opted in', () => {
    expect(() =>
      assertSecureBaseUrl('http://node.example.com', true),
    ).not.toThrow();
  });
});

describe('HTTPError.toJSON redaction', () => {
  it('redacts credential-bearing headers but keeps others', () => {
    const headers = new Headers({
      authorization: 'Bearer secret-token',
      'set-cookie': 'session=abc',
      'content-type': 'application/json',
    });
    const json = new HTTPError(500, 'Server Error', '/x', headers).toJSON();
    expect(json.headers.authorization).toBe('[REDACTED]');
    expect(json.headers['set-cookie']).toBe('[REDACTED]');
    expect(json.headers['content-type']).toBe('application/json');
  });
});

describe('WebHttpClient - same-origin Authorization guard', () => {
  function clientWithCapture(): {
    client: WebHttpClient;
    lastHeaders: () => Record<string, string>;
  } {
    let captured: Record<string, string> = {};
    const mockFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      captured = (init?.headers as Record<string, string>) ?? {};
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const transport: Transport = {
      fetch: mockFetch as unknown as Transport['fetch'],
      baseUrl: 'https://api.example.com',
      getAuthToken: async () => 'secret-token',
    };
    return {
      client: new WebHttpClient(transport),
      lastHeaders: () => captured,
    };
  }

  it('attaches the token for a same-origin (relative) request', async () => {
    const { client, lastHeaders } = clientWithCapture();
    await client.get('/admin-api/contexts');
    expect(lastHeaders().Authorization).toBe('Bearer secret-token');
  });

  it('does NOT attach the token to a cross-origin absolute URL', async () => {
    const { client, lastHeaders } = clientWithCapture();
    await client.get('https://evil.example.net/steal');
    expect(lastHeaders().Authorization).toBeUndefined();
  });
});
