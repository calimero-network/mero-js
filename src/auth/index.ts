import { beginState, takeState } from '../cloud/link-state.js';

const PENDING_KEY = 'calimero.auth.login.pending';
const STATE_PARAM = 'auth_state';

export interface AuthCallbackResult {
  accessToken: string;
  refreshToken: string;
  applicationId: string;
  contextId: string;
  contextIdentity: string;
  nodeUrl: string;
}

export interface AuthLoginOptions {
  callbackUrl: string;
  packageName?: string;
  mode: string;
  permissions?: string[];
  registryUrl?: string;
  packageVersion?: string;
}

export interface ParseAuthCallbackOptions {
  /**
   * Accept tokens this browser did not ask for, for a host that injects them itself
   * (Calimero Desktop). Anyone who can open the page can then choose the session.
   */
  allowUnsolicited?: boolean;
}

/**
 * Parse an auth callback URL hash fragment.
 * Returns null if access_token is missing, or if the callback does not answer a
 * login begun here with {@link buildAuthLoginUrl} (single use, expires).
 */
export function parseAuthCallback(
  url: string,
  options: ParseAuthCallbackOptions = {},
): AuthCallbackResult | null {
  try {
    const hashIndex = url.indexOf('#');
    if (hashIndex === -1) return null;

    const hash = url.substring(hashIndex + 1);
    const params = new URLSearchParams(hash);

    const accessToken = params.get('access_token');
    if (!accessToken) return null;

    if (!options.allowUnsolicited && !takeState(PENDING_KEY, stateOf(url, hashIndex))) {
      console.warn(
        '[mero-js] ignoring auth callback tokens: they answer no login begun in this browser',
      );
      return null;
    }

    return {
      accessToken,
      refreshToken: params.get('refresh_token') ?? '',
      applicationId: params.get('application_id') ?? '',
      contextId: params.get('context_id') ?? '',
      contextIdentity: params.get('context_identity') ?? '',
      nodeUrl: params.get('node_url') ?? '',
    };
  } catch {
    return null;
  }
}

function stateOf(url: string, hashIndex: number): string | null {
  const queryIndex = url.indexOf('?');
  if (queryIndex === -1 || queryIndex > hashIndex) return null;
  return new URLSearchParams(url.substring(queryIndex + 1, hashIndex)).get(STATE_PARAM);
}

/**
 * Build the auth login URL for redirecting users to the node's auth page.
 * Remembers the login so {@link parseAuthCallback} can match the callback to it.
 */
export function buildAuthLoginUrl(nodeUrl: string, opts: AuthLoginOptions): string {
  const callback = new URL(opts.callbackUrl);
  callback.searchParams.set(STATE_PARAM, beginState(PENDING_KEY, {}));

  const params = new URLSearchParams();
  params.set('callback-url', callback.toString());

  if (opts.permissions && opts.permissions.length > 0) {
    params.set('permissions', opts.permissions.join(','));
  }

  params.set('mode', opts.mode);

  if (opts.packageName) {
    params.set('package-name', opts.packageName);
    if (opts.packageVersion) {
      params.set('package-version', opts.packageVersion);
    }
    if (opts.registryUrl) {
      params.set('registry-url', opts.registryUrl);
    }
  }

  // Trim trailing slash from nodeUrl
  const base = nodeUrl.replace(/\/+$/, '');
  return `${base}/auth/login?${params.toString()}`;
}
