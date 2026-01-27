/**
 * JSON-RPC Types
 * Based on OpenAPI spec: /jsonrpc endpoint
 */

export type JsonRpcVersion = '2.0';
export type JsonRpcId = string | number | null;

/**
 * Request to execute a method on a context
 */
export interface ExecutionRequest {
  /** Context ID to execute on */
  contextId: string;
  /** Method name to execute (e.g., 'set', 'get') */
  method: string;
  /** Method arguments as JSON object */
  argsJson: Record<string, unknown>;
  /** Public key of the executor */
  executorPublicKey: string;
  /** Alias substitutions (optional) */
  substitute?: Array<Record<string, unknown>>;
}

/**
 * JSON-RPC request wrapper
 */
export interface JsonRpcRequest {
  jsonrpc: JsonRpcVersion;
  id: JsonRpcId;
  method: 'execute';
  params: ExecutionRequest;
}

/**
 * Successful execution result
 */
export interface ExecutionResult<T = unknown> {
  output: T | null;
}

/**
 * JSON-RPC error object
 */
export interface JsonRpcError {
  type: string;
  data?: string | Record<string, unknown>;
}

/**
 * JSON-RPC response wrapper
 */
export interface JsonRpcResponse<T = unknown> {
  jsonrpc: JsonRpcVersion;
  id: JsonRpcId;
  result?: ExecutionResult<T>;
  error?: JsonRpcError;
}

/**
 * Simplified execute request for the client API
 */
export interface ExecuteParams {
  /** Context ID to execute on */
  contextId: string;
  /** Method name to execute */
  method: string;
  /** Method arguments */
  args: Record<string, unknown>;
  /** Public key of the executor */
  executorPublicKey: string;
  /** Alias substitutions (optional) */
  substitute?: Array<Record<string, unknown>>;
}

/**
 * Execute result with typed output
 */
export interface ExecuteResult<T = unknown> {
  output: T | null;
}
