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

/**
 * Parse an auth callback URL hash fragment.
 * Returns null if access_token is missing.
 */
export function parseAuthCallback(url: string): AuthCallbackResult | null {
  try {
    const hashIndex = url.indexOf('#');
    if (hashIndex === -1) return null;

    const hash = url.substring(hashIndex + 1);
    const params = new URLSearchParams(hash);

    const accessToken = params.get('access_token');
    if (!accessToken) return null;

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

/**
 * Build the auth login URL for redirecting users to the node's auth page.
 */
export function buildAuthLoginUrl(nodeUrl: string, opts: AuthLoginOptions): string {
  const params = new URLSearchParams();
  params.set('callback-url', opts.callbackUrl);

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
