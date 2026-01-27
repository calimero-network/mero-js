import { describe, it, expect } from 'vitest';
import { AdminApiClient } from '../client';
import { MockHttpClient } from './mock-http-client';

describe('AdminApiClient', () => {
  it('should compose all module clients', () => {
    const mockHttp = new MockHttpClient();
    const client = new AdminApiClient(mockHttp);

    expect(client.public).toBeDefined();
    expect(client.applications).toBeDefined();
    expect(client.contexts).toBeDefined();
    expect(client.proposals).toBeDefined();
    expect(client.capabilities).toBeDefined();
    expect(client.identity).toBeDefined();
    expect(client.network).toBeDefined();
    expect(client.blobs).toBeDefined();
    expect(client.aliases).toBeDefined();
    expect(client.tee).toBeDefined();
  });

  it('should use same http client for all modules', async () => {
    const mockHttp = new MockHttpClient();
    const client = new AdminApiClient(mockHttp);

    mockHttp.setMockResponse('GET', '/admin-api/health', {
      data: { status: 'alive' },
    });

    const health = await client.public.health();
    expect(health.status).toBe('alive');
  });
});
