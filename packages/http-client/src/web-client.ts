// ErrorResponse import removed as it's not used
import { HttpClient, Transport, RequestOptions, ResponseParser } from './types';
import { combineSignals, createTimeoutSignal } from './signal-utils';

// Custom error class for HTTP errors
export class HTTPError extends Error {
  name = 'HTTPError' as const;

  constructor(
    public status: number,
    public statusText: string,
    public url: string,
    public headers: Headers,
    public bodyText?: string, // cap at ~64KB
  ) {
    super(`HTTP ${status} ${statusText}`);
  }

  toJSON(): {
    status: number;
    statusText: string;
    url: string;
    headers: Record<string, string>;
    bodyText?: string;
  } {
    return {
      status: this.status,
      statusText: this.statusText,
      url: this.url,
      headers: headersToRecord(this.headers),
      bodyText: this.bodyText,
    };
  }
}

// Generic error response (currently unused but kept for future use)
// const GENERIC_ERROR: ErrorResponse = {
//   code: 500,
//   message: 'Something went wrong',
// };

// Helper function to safely extract text from response with 64KB limit
async function safeText(res: Response): Promise<string | undefined> {
  try {
    const text = await res.text();
    // Cap at 64KB as per specification
    return text.length > 65536 ? text.substring(0, 65536) : text;
  } catch {
    return undefined;
  }
}

// Helper function to convert Headers to Record<string, string>
function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

export class WebHttpClient implements HttpClient {
  private transport: Transport;

  constructor(transport: Transport) {
    this.transport = {
      ...transport,
      baseUrl: transport.baseUrl.replace(/\/+$/, ''), // Remove trailing slashes
      timeoutMs: transport.timeoutMs ?? 30_000,
    };
  }

  private async makeRequest<T>(
    path: string,
    init: RequestOptions = {},
  ): Promise<T> {
    // Use URL constructor for proper URL handling
    const url = new URL(path, this.transport.baseUrl).toString();

    // Merge headers using Headers API for proper case-insensitive handling
    // Caller headers always win over default headers
    const headers = new Headers(this.transport.defaultHeaders);
    if (init.headers) {
      new Headers(init.headers).forEach((v, k) => headers.set(k, v));
    }

    // Delete content-type for FormData to let runtime set boundary
    if (init.body instanceof FormData) {
      headers.delete('content-type');
    }

    // Only add auth if caller didn't set it (case-insensitive check)
    if (this.transport.getAuthToken && !headers.has('authorization')) {
      try {
        const token = await this.transport.getAuthToken();
        if (token) {
          headers.set('authorization', `Bearer ${token}`);
        }
      } catch (error) {
        // If token retrieval fails, continue without auth
        console.warn('Failed to get auth token:', error);
      }
    }

    // Handle AbortSignal - combine user signal, default signal, and timeout
    const userSignal = init.signal || undefined; // Convert null to undefined
    const defaultSignal = this.transport.defaultAbortSignal;
    const timeoutMs = init.timeoutMs ?? this.transport.timeoutMs;

    // Create timeout signal
    const timeoutSignal = timeoutMs
      ? createTimeoutSignal(timeoutMs)
      : undefined;

    // Combine all signals
    const combinedSignal = combineSignals([
      defaultSignal,
      userSignal,
      timeoutSignal,
    ]);

    try {
      const response = await this.transport.fetch(url, {
        ...init,
        headers,
        signal: combinedSignal,
        credentials: init.credentials ?? this.transport.credentials,
      });

      // Handle HTTP errors by throwing HTTPError
      if (!response.ok) {
        const bodyText = await safeText(response);
        throw new HTTPError(
          response.status,
          response.statusText,
          url,
          response.headers,
          bodyText,
        );
      }

      // Handle successful responses with enhanced parsing
      const parseMode = init.parse || this.detectParseMode(response);
      return await this.parseResponse<T>(response, parseMode);
    } catch (error) {
      // Re-throw HTTPError as-is
      if (error instanceof HTTPError) {
        throw error;
      }

      // Handle abort and timeout errors
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw error; // Let withRetry handle this
        }

        if (error.name === 'TimeoutError') {
          throw error; // Let withRetry handle this
        }

        // Network errors (TypeError) should be re-thrown for withRetry
        throw error;
      }

      // Unknown error
      throw new Error('Unknown error occurred');
    }
  }

  private detectParseMode(response: Response): ResponseParser {
    const contentType =
      response.headers.get('content-type')?.toLowerCase() || '';

    if (contentType.includes('application/json')) {
      return 'json';
    }
    if (contentType.includes('text/')) {
      return 'text';
    }
    if (
      contentType.includes('application/octet-stream') ||
      contentType.includes('image/') ||
      contentType.includes('video/') ||
      contentType.includes('audio/')
    ) {
      return 'arrayBuffer';
    }

    // Default to JSON for most APIs
    return 'json';
  }

  private async parseResponse<T>(
    response: Response,
    parseMode: ResponseParser,
  ): Promise<T> {
    switch (parseMode) {
      case 'json':
        try {
          return (await response.json()) as T;
        } catch (error) {
          throw new Error(
            `Failed to parse JSON response: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      case 'text':
        return (await response.text()) as T;
      case 'blob':
        return (await response.blob()) as T;
      case 'arrayBuffer':
        return (await response.arrayBuffer()) as T;
      case 'response':
        return response as T;
      default:
        // Fallback to JSON with error handling
        try {
          return (await response.json()) as T;
        } catch {
          return (await response.text()) as T;
        }
    }
  }

  // HTTP method implementations
  async get<T>(path: string, init: RequestOptions = {}): Promise<T> {
    return this.makeRequest<T>(path, { ...init, method: 'GET' });
  }

  async post<T>(
    path: string,
    body?: unknown,
    init: RequestOptions = {},
  ): Promise<T> {
    return this.makeRequest<T>(path, {
      ...init,
      method: 'POST',
      headers:
        body instanceof FormData
          ? init.headers
          : {
              'Content-Type': 'application/json',
              ...(init.headers ?? {}),
            },
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
    });
  }

  async put<T>(
    path: string,
    body?: unknown,
    init: RequestOptions = {},
  ): Promise<T> {
    return this.makeRequest<T>(path, {
      ...init,
      method: 'PUT',
      headers:
        body instanceof FormData
          ? init.headers
          : {
              'Content-Type': 'application/json',
              ...(init.headers ?? {}),
            },
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
    });
  }

  async delete<T>(path: string, init: RequestOptions = {}): Promise<T> {
    return this.makeRequest<T>(path, { ...init, method: 'DELETE' });
  }

  async patch<T>(
    path: string,
    body?: unknown,
    init: RequestOptions = {},
  ): Promise<T> {
    return this.makeRequest<T>(path, {
      ...init,
      method: 'PATCH',
      headers:
        body instanceof FormData
          ? init.headers
          : {
              'Content-Type': 'application/json',
              ...(init.headers ?? {}),
            },
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
    });
  }

  async head(
    path: string,
    init: RequestOptions = {},
  ): Promise<{ headers: Record<string, string>; status: number }> {
    const response = await this.makeRequest<Response>(path, {
      ...init,
      method: 'HEAD',
      parse: 'response',
    });

    return {
      headers: headersToRecord(response.headers),
      status: response.status,
    };
  }

  // Generic request method (alias for the private makeRequest method)
  async request<T>(path: string, init: RequestOptions = {}): Promise<T> {
    return this.makeRequest<T>(path, init);
  }
}
