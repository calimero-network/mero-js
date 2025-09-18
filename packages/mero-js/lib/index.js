"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  HTTPError: () => HTTPError,
  WebHttpClient: () => WebHttpClient,
  combineSignals: () => combineSignals,
  createBrowserHttpClient: () => createBrowserHttpClient,
  createHttpClient: () => createHttpClient,
  createNodeHttpClient: () => createNodeHttpClient,
  createRetryableMethod: () => createRetryableMethod,
  createTimeoutSignal: () => createTimeoutSignal,
  createUniversalHttpClient: () => createUniversalHttpClient,
  placeholder: () => placeholder,
  withRetry: () => withRetry
});
module.exports = __toCommonJS(index_exports);

// src/http/signal-utils.ts
function combineSignals(signals) {
  const list = signals.filter(Boolean);
  if (list.length === 0) return void 0;
  if (typeof AbortSignal.any === "function") {
    try {
      return AbortSignal.any(list);
    } catch {
    }
  }
  const controller = new AbortController();
  const onAbort = (evt) => {
    controller.abort(evt.target.reason);
    for (const s of list) s.removeEventListener("abort", onAbort);
  };
  for (const s of list) {
    if (s.aborted) return AbortSignal.abort(s.reason);
    s.addEventListener("abort", onAbort, { once: true });
  }
  return controller.signal;
}
function createTimeoutSignal(timeoutMs) {
  if (typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  const controller = new AbortController();
  setTimeout(() => {
    controller.abort(new DOMException("Timeout", "TimeoutError"));
  }, timeoutMs);
  return controller.signal;
}

// src/http/web-client.ts
var HTTPError = class extends Error {
  constructor(status, statusText, body, headers) {
    super(`HTTP ${status} ${statusText}`);
    this.status = status;
    this.statusText = statusText;
    this.body = body;
    this.headers = headers;
    this.name = "HTTPError";
  }
};
var GENERIC_ERROR = {
  code: 500,
  message: "Something went wrong"
};
async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return void 0;
  }
}
function headersToRecord(headers) {
  const record = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}
var WebHttpClient = class {
  constructor(transport) {
    this.isRefreshing = false;
    this.failedQueue = [];
    this.transport = {
      ...transport,
      baseUrl: transport.baseUrl.replace(/\/+$/, ""),
      // Remove trailing slashes
      timeoutMs: transport.timeoutMs ?? 3e4
    };
  }
  async makeRequest(path, init = {}) {
    const url = new URL(path, this.transport.baseUrl).toString();
    const headers = {
      ...this.transport.defaultHeaders ?? {}
    };
    if (init.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((value, key) => {
          headers[key] = value;
        });
      } else if (Array.isArray(init.headers)) {
        init.headers.forEach(([key, value]) => {
          headers[key] = value;
        });
      } else {
        Object.assign(headers, init.headers);
      }
    }
    if (this.transport.getAuthToken && !headers["Authorization"]) {
      try {
        const token = await this.transport.getAuthToken();
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }
      } catch (error) {
        console.warn("Failed to get auth token:", error);
      }
    }
    const userSignal = init.signal || void 0;
    const defaultSignal = this.transport.defaultAbortSignal;
    const timeoutMs = init.timeoutMs ?? this.transport.timeoutMs;
    const timeoutSignal = timeoutMs ? createTimeoutSignal(timeoutMs) : void 0;
    const combinedSignal = combineSignals([
      defaultSignal,
      userSignal,
      timeoutSignal
    ]);
    try {
      const response = await this.transport.fetch(url, {
        ...init,
        headers,
        signal: combinedSignal,
        credentials: init.credentials ?? this.transport.credentials ?? "same-origin"
      });
      if (!response.ok) {
        const text = await safeText(response);
        const authError = response.headers.get("x-auth-error");
        if (response.status === 401) {
          switch (authError) {
            case "missing_token":
              return {
                data: null,
                error: {
                  code: 401,
                  message: "No access token found."
                }
              };
            case "token_expired":
              try {
                return await this.handleTokenRefresh(path, init);
              } catch (refreshError) {
                return {
                  data: null,
                  error: {
                    code: 401,
                    message: "Session expired. Please log in again."
                  }
                };
              }
            case "token_revoked":
              return {
                data: null,
                error: {
                  code: 401,
                  message: "Session was revoked. Please log in again."
                }
              };
            case "invalid_token":
              return {
                data: null,
                error: {
                  code: 401,
                  message: "Invalid authentication. Please log in again."
                }
              };
            default:
              return {
                data: null,
                error: {
                  code: 401,
                  message: text || "Authentication failed"
                }
              };
          }
        }
        return {
          data: null,
          error: {
            code: response.status,
            message: text || response.statusText || "Request failed"
          }
        };
      }
      const parseMode = init.parse || this.detectParseMode(response);
      const data = await this.parseResponse(response, parseMode);
      return {
        data,
        error: null
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === "AbortError") {
          return {
            data: null,
            error: {
              code: 408,
              message: "Request timeout"
            }
          };
        }
        return {
          data: null,
          error: {
            code: 500,
            message: error.message || "Network error"
          }
        };
      }
      return {
        data: null,
        error: GENERIC_ERROR
      };
    }
  }
  detectParseMode(response) {
    const contentType = response.headers.get("content-type")?.toLowerCase() || "";
    if (contentType.includes("application/json")) {
      return "json";
    }
    if (contentType.includes("text/")) {
      return "text";
    }
    if (contentType.includes("application/octet-stream") || contentType.includes("image/") || contentType.includes("video/") || contentType.includes("audio/")) {
      return "arrayBuffer";
    }
    return "json";
  }
  async parseResponse(response, parseMode) {
    switch (parseMode) {
      case "json":
        try {
          return await response.json();
        } catch (error) {
          throw new Error(
            `Failed to parse JSON response: ${error instanceof Error ? error.message : "Unknown error"}`
          );
        }
      case "text":
        return await response.text();
      case "blob":
        return await response.blob();
      case "arrayBuffer":
        return await response.arrayBuffer();
      case "response":
        return response;
      default:
        try {
          return await response.json();
        } catch {
          return await response.text();
        }
    }
  }
  async handleTokenRefresh(path, init) {
    if (this.isRefreshing) {
      return new Promise((resolve, reject) => {
        this.failedQueue.push({
          resolve,
          reject,
          path,
          init
        });
      });
    }
    try {
      this.isRefreshing = true;
      const currentToken = await this.transport.getAuthToken?.();
      if (!currentToken) {
        throw new Error("No current token available for refresh");
      }
      this.processQueue(null);
      return this.makeRequest(path, init);
    } catch (error) {
      this.isRefreshing = false;
      this.processQueue(error);
      throw error;
    } finally {
      this.isRefreshing = false;
    }
  }
  processQueue(error) {
    this.failedQueue.forEach(({ resolve, reject, path, init }) => {
      if (error) {
        reject(error);
      } else {
        this.makeRequest(path, init).then(resolve).catch(reject);
      }
    });
    this.failedQueue = [];
  }
  // HTTP method implementations
  async get(path, init = {}) {
    return this.makeRequest(path, { ...init, method: "GET" });
  }
  async post(path, body, init = {}) {
    const headers = body instanceof FormData ? { ...init.headers ?? {} } : {
      "Content-Type": "application/json",
      ...init.headers ?? {}
    };
    return this.makeRequest(path, {
      ...init,
      method: "POST",
      headers,
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : void 0
    });
  }
  async put(path, body, init = {}) {
    const headers = body instanceof FormData ? { ...init.headers ?? {} } : {
      "Content-Type": "application/json",
      ...init.headers ?? {}
    };
    return this.makeRequest(path, {
      ...init,
      method: "PUT",
      headers,
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : void 0
    });
  }
  async delete(path, init = {}) {
    return this.makeRequest(path, { ...init, method: "DELETE" });
  }
  async patch(path, body, init = {}) {
    const headers = body instanceof FormData ? { ...init.headers ?? {} } : {
      "Content-Type": "application/json",
      ...init.headers ?? {}
    };
    return this.makeRequest(path, {
      ...init,
      method: "PATCH",
      headers,
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : void 0
    });
  }
  async head(path, init = {}) {
    const response = await this.makeRequest(path, {
      ...init,
      method: "HEAD"
    });
    if (response.data) {
      const headResponse = {
        headers: headersToRecord(new Headers(init.headers)),
        status: 200
        // This would need to be extracted from the actual response
      };
      return {
        data: headResponse,
        error: null
      };
    }
    return response;
  }
  // Generic request method (alias for the private makeRequest method)
  async request(path, init = {}) {
    return this.makeRequest(path, init);
  }
};

// src/http/factory.ts
function createHttpClient(transport) {
  return new WebHttpClient(transport);
}
function createBrowserHttpClient(options) {
  const transport = {
    fetch: globalThis.fetch,
    baseUrl: options.baseUrl,
    getAuthToken: options.getAuthToken,
    onTokenRefresh: options.onTokenRefresh,
    defaultHeaders: options.defaultHeaders,
    timeoutMs: options.timeoutMs,
    credentials: options.credentials ?? "same-origin",
    defaultAbortSignal: options.defaultAbortSignal
  };
  return createHttpClient(transport);
}
function createNodeHttpClient(options) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error(
      "No fetch implementation available. Please provide a fetch implementation (e.g., undici.fetch) or use Node.js 18+ which has native fetch support."
    );
  }
  const transport = {
    fetch: fetchImpl,
    baseUrl: options.baseUrl,
    getAuthToken: options.getAuthToken,
    onTokenRefresh: options.onTokenRefresh,
    defaultHeaders: options.defaultHeaders,
    timeoutMs: options.timeoutMs,
    credentials: options.credentials,
    // Node.js doesn't have default credentials
    defaultAbortSignal: options.defaultAbortSignal
  };
  return createHttpClient(transport);
}
function createUniversalHttpClient(options) {
  if (typeof window !== "undefined") {
    return createBrowserHttpClient(options);
  } else {
    return createNodeHttpClient(options);
  }
}

// src/http/retry.ts
function defaultRetryCondition(error, attempt) {
  if (attempt <= 0) return false;
  const name = error?.name;
  if (name === "TimeoutError") return true;
  if (name === "AbortError") return false;
  if ("status" in error && typeof error.status === "number") {
    return error.status >= 500;
  }
  if (name === "TypeError") return true;
  return false;
}
function calculateDelay(attempt, baseDelayMs, maxDelayMs, backoffFactor) {
  const delay = baseDelayMs * Math.pow(backoffFactor, attempt);
  const cappedDelay = Math.min(delay, maxDelayMs);
  const jitter = (Math.random() - 0.5) * 0.4 * cappedDelay;
  return Math.max(0, cappedDelay + jitter);
}
function getRetryAfterMs(response) {
  const retryAfter = response.headers.get("Retry-After");
  if (!retryAfter) return null;
  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds)) {
    return seconds * 1e3;
  }
  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }
  return null;
}
async function withRetry(fn, options = {}) {
  const {
    attempts = 3,
    baseDelayMs = 1e3,
    maxDelayMs = 1e4,
    backoffFactor = 2,
    retryCondition = defaultRetryCondition
  } = options;
  let lastError;
  for (let attempt = attempts - 1; attempt >= 0; attempt--) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!retryCondition(lastError, attempt)) {
        throw lastError;
      }
      let delayMs = calculateDelay(
        attempts - attempt - 1,
        baseDelayMs,
        maxDelayMs,
        backoffFactor
      );
      if ("response" in lastError && lastError.response instanceof Response) {
        const retryAfterMs = getRetryAfterMs(lastError.response);
        if (retryAfterMs !== null) {
          delayMs = Math.max(delayMs, retryAfterMs);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
function createRetryableMethod(method, retryOptions = {}) {
  return async (...args) => {
    return withRetry(() => method(...args), retryOptions);
  };
}

// src/index.ts
var placeholder = "Mero.js package - Web Standards HTTP client ready, other modules coming soon";
