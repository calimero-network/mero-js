import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  discoverLocalNodes,
  probeNodeHealth,
  localNodeUrl,
  nodeEndpoint,
  DEFAULT_LOCAL_NODE_PORTS,
} from './nodeDiscovery';

/**
 * Build a `fetch` stand-in where only the given base URLs answer their health
 * endpoint with `{ data: { status: "alive" } }`. Everything else rejects, the
 * way a closed local port does.
 */
function fetchRespondingFor(
  healthy: string[],
  opts: { status?: string; ok?: boolean } = {},
) {
  const healthySet = new Set(healthy);
  return vi.fn(async (input: string) => {
    const url = String(input);
    const base = url.replace(/\/admin-api\/.*$/, '');
    if (url.includes('/admin-api/health') && healthySet.has(base)) {
      return {
        ok: opts.ok ?? true,
        status: 200,
        json: async () => ({ data: { status: opts.status ?? 'alive' } }),
      } as Response;
    }
    throw new TypeError('Failed to fetch');
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('localNodeUrl', () => {
  it('builds a localhost base URL for a port', () => {
    expect(localNodeUrl(2428)).toBe('http://localhost:2428');
  });
});

describe('nodeEndpoint', () => {
  it('appends the path to a root base URL', () => {
    expect(nodeEndpoint('http://localhost:2428', 'admin-api/health')).toBe(
      'http://localhost:2428/admin-api/health',
    );
  });

  it('preserves a path prefix on the base URL (NODE_PATH_PREFIX)', () => {
    expect(nodeEndpoint('http://host/node1', 'admin-api/health')).toBe(
      'http://host/node1/admin-api/health',
    );
  });

  it('does not double up the slash when the base already ends with one', () => {
    expect(nodeEndpoint('http://host/node1/', 'admin-api/health')).toBe(
      'http://host/node1/admin-api/health',
    );
  });
});

describe('probeNodeHealth', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('returns true for a 2xx + status "alive"', async () => {
    vi.stubGlobal('fetch', fetchRespondingFor(['http://localhost:2428']));
    expect(await probeNodeHealth('http://localhost:2428')).toBe(true);
  });

  it('treats a 2xx with a non-JSON body as alive', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('not json');
        },
      })),
    );
    expect(await probeNodeHealth('http://localhost:2428')).toBe(true);
  });

  it('returns false when the reported status is not alive', async () => {
    vi.stubGlobal(
      'fetch',
      fetchRespondingFor(['http://localhost:2428'], { status: 'not_alive' }),
    );
    expect(await probeNodeHealth('http://localhost:2428')).toBe(false);
  });

  it('returns false for an explicit null status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: { status: null } }),
      })),
    );
    expect(await probeNodeHealth('http://localhost:2428')).toBe(false);
  });

  it('treats a 2xx with no status field as alive', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })),
    );
    expect(await probeNodeHealth('http://localhost:2428')).toBe(true);
  });

  it('returns false without fetching when the signal is already aborted', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();
    expect(
      await probeNodeHealth('http://localhost:2428', {
        signal: controller.signal,
      }),
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns false on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })),
    );
    expect(await probeNodeHealth('http://localhost:2428')).toBe(false);
  });

  it('returns false on a network error (closed port)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    expect(await probeNodeHealth('http://localhost:9999')).toBe(false);
  });

  it('hits the admin-api/health path of the base URL', async () => {
    const fetchMock = fetchRespondingFor(['http://localhost:2428']);
    vi.stubGlobal('fetch', fetchMock);
    await probeNodeHealth('http://localhost:2428');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:2428/admin-api/health',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});

describe('discoverLocalNodes', () => {
  it('returns only the healthy nodes, in ascending port order', async () => {
    vi.stubGlobal(
      'fetch',
      fetchRespondingFor(['http://localhost:2528', 'http://localhost:2428']),
    );
    const nodes = await discoverLocalNodes();
    expect(nodes).toEqual([
      'http://localhost:2428',
      'http://localhost:2528',
    ]);
  });

  it('returns an empty array when nothing local is running', async () => {
    vi.stubGlobal('fetch', fetchRespondingFor([]));
    expect(await discoverLocalNodes()).toEqual([]);
  });

  it('probes exactly the default ports', async () => {
    const fetchMock = fetchRespondingFor([]);
    vi.stubGlobal('fetch', fetchMock);
    await discoverLocalNodes();
    const probed = fetchMock.mock.calls.map((c) => String(c[0]));
    for (const port of DEFAULT_LOCAL_NODE_PORTS) {
      expect(probed).toContain(`http://localhost:${port}/admin-api/health`);
    }
    expect(fetchMock).toHaveBeenCalledTimes(DEFAULT_LOCAL_NODE_PORTS.length);
  });

  it('respects a custom port list', async () => {
    const fetchMock = fetchRespondingFor(['http://localhost:3000']);
    vi.stubGlobal('fetch', fetchMock);
    const nodes = await discoverLocalNodes({ ports: [3000, 3001] });
    expect(nodes).toEqual(['http://localhost:3000']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
