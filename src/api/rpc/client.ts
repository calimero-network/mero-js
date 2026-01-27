/**
 * JSON-RPC Client
 *
 * Handles execution of queries and mutations on Calimero contexts
 * via the /jsonrpc endpoint.
 */

import { HttpClient } from '../../http-client';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  ExecuteParams,
  ExecuteResult,
  JsonRpcId,
} from './types';

/**
 * Error thrown when JSON-RPC execution fails
 */
export class JsonRpcError extends Error {
  constructor(
    public readonly type: string,
    public readonly data?: string | Record<string, unknown>,
    public readonly requestId?: JsonRpcId,
  ) {
    const message =
      typeof data === 'string'
        ? data
        : data?.message
          ? String(data.message)
          : type;
    super(message);
    this.name = 'JsonRpcError';
  }
}

/**
 * JSON-RPC Client for executing queries and mutations
 */
export class RpcClient {
  private readonly path = '/jsonrpc';

  constructor(private httpClient: HttpClient) {}

  /**
   * Generate a random request ID
   */
  private generateRequestId(): number {
    return Math.floor(Math.random() * Math.pow(2, 32));
  }

  /**
   * Execute a method on a context
   *
   * @param params - Execution parameters
   * @returns The execution result
   * @throws JsonRpcError if execution fails
   *
   * @example
   * ```typescript
   * // Query (view) operation
   * const result = await rpc.execute({
   *   contextId: 'ctx_123',
   *   method: 'get',
   *   args: { key: 'myKey' },
   *   executorPublicKey: 'ed25519:...',
   * });
   * console.log(result.output); // "myValue"
   *
   * // Mutate operation
   * await rpc.execute({
   *   contextId: 'ctx_123',
   *   method: 'set',
   *   args: { key: 'myKey', value: 'myValue' },
   *   executorPublicKey: 'ed25519:...',
   * });
   * ```
   */
  async execute<T = unknown>(params: ExecuteParams): Promise<ExecuteResult<T>> {
    const requestId = this.generateRequestId();

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'execute',
      params: {
        contextId: params.contextId,
        method: params.method,
        argsJson: params.args,
        executorPublicKey: params.executorPublicKey,
        substitute: params.substitute ?? [],
      },
    };

    const response = await this.httpClient.post<JsonRpcResponse<T>>(
      this.path,
      request,
    );

    // Validate response ID matches request ID
    if (response.id !== requestId) {
      throw new JsonRpcError(
        'MismatchedRequestIdError',
        `Expected request ID ${requestId}, got ${response.id}`,
        response.id,
      );
    }

    // Check for error response
    if (response.error) {
      throw new JsonRpcError(
        response.error.type,
        response.error.data,
        response.id,
      );
    }

    // Return result
    return response.result ?? { output: null };
  }

  /**
   * Execute a query (view) method - convenience wrapper
   *
   * @param contextId - Context ID
   * @param method - Method name
   * @param args - Method arguments
   * @param executorPublicKey - Executor's public key
   */
  async query<T = unknown>(
    contextId: string,
    method: string,
    args: Record<string, unknown>,
    executorPublicKey: string,
  ): Promise<T | null> {
    const result = await this.execute<T>({
      contextId,
      method,
      args,
      executorPublicKey,
    });
    return result.output;
  }

  /**
   * Execute a mutate method - convenience wrapper
   *
   * @param contextId - Context ID
   * @param method - Method name
   * @param args - Method arguments
   * @param executorPublicKey - Executor's public key
   */
  async mutate<T = unknown>(
    contextId: string,
    method: string,
    args: Record<string, unknown>,
    executorPublicKey: string,
  ): Promise<T | null> {
    const result = await this.execute<T>({
      contextId,
      method,
      args,
      executorPublicKey,
    });
    return result.output;
  }
}
