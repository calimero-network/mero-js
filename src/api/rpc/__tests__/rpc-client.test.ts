import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RpcClient, JsonRpcError } from '../client';
import type { HttpClient } from '../../../http-client';

// Mock HTTP client
function createMockHttpClient(responses: Record<string, unknown> = {}): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn().mockImplementation(async (_url: string, body: unknown) => {
      const request = body as { id: number; params: { method: string } };
      const methodResponses = responses[request.params?.method];
      
      if (methodResponses && typeof methodResponses === 'object' && 'error' in methodResponses) {
        return {
          jsonrpc: '2.0',
          id: request.id,
          error: methodResponses.error,
        };
      }
      
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: methodResponses ?? { output: null },
      };
    }),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  } as unknown as HttpClient;
}

describe('RpcClient', () => {
  let rpcClient: RpcClient;
  let mockHttpClient: HttpClient;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient({
      get: { output: 'test-value' },
      set: { output: null },
    });
    rpcClient = new RpcClient(mockHttpClient);
  });

  describe('execute', () => {
    it('should send correct JSON-RPC request format', async () => {
      await rpcClient.execute({
        contextId: 'ctx_123',
        method: 'get',
        args: { key: 'testKey' },
        executorPublicKey: 'ed25519:abc123',
      });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        '/jsonrpc',
        expect.objectContaining({
          jsonrpc: '2.0',
          id: expect.any(Number),
          method: 'execute',
          params: {
            contextId: 'ctx_123',
            method: 'get',
            argsJson: { key: 'testKey' },
            executorPublicKey: 'ed25519:abc123',
            substitute: [],
          },
        }),
      );
    });

    it('should return the result output', async () => {
      const result = await rpcClient.execute<string>({
        contextId: 'ctx_123',
        method: 'get',
        args: { key: 'testKey' },
        executorPublicKey: 'ed25519:abc123',
      });

      expect(result).toEqual({ output: 'test-value' });
    });

    it('should handle null output', async () => {
      const result = await rpcClient.execute({
        contextId: 'ctx_123',
        method: 'set',
        args: { key: 'testKey', value: 'testValue' },
        executorPublicKey: 'ed25519:abc123',
      });

      expect(result).toEqual({ output: null });
    });

    it('should include substitute array when provided', async () => {
      await rpcClient.execute({
        contextId: 'ctx_123',
        method: 'get',
        args: { key: 'testKey' },
        executorPublicKey: 'ed25519:abc123',
        substitute: [{ alias: 'value' }],
      });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        '/jsonrpc',
        expect.objectContaining({
          params: expect.objectContaining({
            substitute: [{ alias: 'value' }],
          }),
        }),
      );
    });

    it('should throw JsonRpcError on error response', async () => {
      const errorClient = createMockHttpClient({
        get: {
          error: {
            type: 'FunctionCallError',
            data: 'Key not found',
          },
        },
      });
      const client = new RpcClient(errorClient);

      await expect(
        client.execute({
          contextId: 'ctx_123',
          method: 'get',
          args: { key: 'nonexistent' },
          executorPublicKey: 'ed25519:abc123',
        }),
      ).rejects.toThrow(JsonRpcError);
    });

    it('should throw JsonRpcError with correct properties', async () => {
      const errorClient = createMockHttpClient({
        get: {
          error: {
            type: 'FunctionCallError',
            data: 'Key not found',
          },
        },
      });
      const client = new RpcClient(errorClient);

      try {
        await client.execute({
          contextId: 'ctx_123',
          method: 'get',
          args: { key: 'nonexistent' },
          executorPublicKey: 'ed25519:abc123',
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(JsonRpcError);
        const rpcError = error as JsonRpcError;
        expect(rpcError.type).toBe('FunctionCallError');
        expect(rpcError.data).toBe('Key not found');
      }
    });
  });

  describe('query', () => {
    it('should return output directly', async () => {
      const result = await rpcClient.query<string>(
        'ctx_123',
        'get',
        { key: 'testKey' },
        'ed25519:abc123',
      );

      expect(result).toBe('test-value');
    });
  });

  describe('mutate', () => {
    it('should return output directly', async () => {
      const result = await rpcClient.mutate(
        'ctx_123',
        'set',
        { key: 'testKey', value: 'testValue' },
        'ed25519:abc123',
      );

      expect(result).toBeNull();
    });
  });
});

describe('JsonRpcError', () => {
  it('should create error with type and string data', () => {
    const error = new JsonRpcError('FunctionCallError', 'Something went wrong');
    expect(error.name).toBe('JsonRpcError');
    expect(error.type).toBe('FunctionCallError');
    expect(error.data).toBe('Something went wrong');
    expect(error.message).toBe('Something went wrong');
  });

  it('should create error with type and object data with message', () => {
    const error = new JsonRpcError('FunctionCallError', { message: 'Detailed error' });
    expect(error.message).toBe('Detailed error');
  });

  it('should fallback to type as message', () => {
    const error = new JsonRpcError('FunctionCallError', { code: 123 });
    expect(error.message).toBe('FunctionCallError');
  });

  it('should include requestId when provided', () => {
    const error = new JsonRpcError('FunctionCallError', 'Error', 12345);
    expect(error.requestId).toBe(12345);
  });
});
