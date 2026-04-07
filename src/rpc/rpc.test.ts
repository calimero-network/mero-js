import { describe, it, expect, vi } from 'vitest';
import { RpcClient, RpcError } from './index';
import type { HttpClient } from '../http-client';

function createMockHttpClient(postResponse: unknown): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn().mockResolvedValue(postResponse),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    head: vi.fn(),
    request: vi.fn(),
  };
}

describe('RpcClient', () => {
  const defaultParams = {
    contextId: 'ctx-1',
    method: 'list',
    argsJson: {},
  };

  it('sends correct JSON-RPC request', async () => {
    const httpClient = createMockHttpClient({
      jsonrpc: '2.0',
      id: 1,
      result: { output: ['item1', 'item2'] },
    });

    const rpc = new RpcClient({ httpClient });
    await rpc.execute(defaultParams);

    expect(httpClient.post).toHaveBeenCalledWith('/jsonrpc', {
      jsonrpc: '2.0',
      id: 1,
      method: 'execute',
      params: {
        contextId: 'ctx-1',
        method: 'list',
        argsJson: {},
      },
    });
  });

  it('extracts output from result.output', async () => {
    const httpClient = createMockHttpClient({
      jsonrpc: '2.0',
      id: 1,
      result: { output: { key: 'val' } },
    });

    const rpc = new RpcClient({ httpClient });
    const result = await rpc.execute(defaultParams);
    expect(result).toEqual({ key: 'val' });
  });

  it('returns result directly when output is absent', async () => {
    const httpClient = createMockHttpClient({
      jsonrpc: '2.0',
      id: 1,
      result: { data: 42 },
    });

    const rpc = new RpcClient({ httpClient });
    const result = await rpc.execute(defaultParams);
    expect(result).toEqual({ data: 42 });
  });

  it('handles null output correctly', async () => {
    const httpClient = createMockHttpClient({
      jsonrpc: '2.0',
      id: 1,
      result: { output: null },
    });

    const rpc = new RpcClient({ httpClient });
    const result = await rpc.execute(defaultParams);
    expect(result).toBeNull();
  });

  it('throws RpcError on error response', async () => {
    const httpClient = createMockHttpClient({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32600, message: 'Invalid request', data: 'details' },
    });

    const rpc = new RpcClient({ httpClient });
    await expect(rpc.execute(defaultParams)).rejects.toThrow(RpcError);

    try {
      await rpc.execute(defaultParams);
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe(-32600);
      expect((e as RpcError).message).toBe('Invalid request');
      expect((e as RpcError).data).toBe('details');
    }
  });

  it('throws RpcError on server-format error (type/data, no code/message)', async () => {
    const httpClient = createMockHttpClient({
      jsonrpc: '2.0',
      id: 1,
      error: { type: 'MethodNotFound', data: { method: 'missing' } },
    });

    const rpc = new RpcClient({ httpClient });
    try {
      await rpc.execute(defaultParams);
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe(-1);
      expect((e as RpcError).message).toBe('MethodNotFound');
      expect((e as RpcError).type).toBe('MethodNotFound');
      expect((e as RpcError).data).toEqual({ method: 'missing' });
    }
  });

  it('defaults argsJson to empty object when not provided', async () => {
    const httpClient = createMockHttpClient({
      jsonrpc: '2.0',
      id: 1,
      result: { output: true },
    });

    const rpc = new RpcClient({ httpClient });
    await rpc.execute({
      contextId: 'ctx-1',
      method: 'test',
    });

    expect(httpClient.post).toHaveBeenCalledWith('/jsonrpc', expect.objectContaining({
      params: expect.objectContaining({
        argsJson: {},
      }),
    }));
  });
});
