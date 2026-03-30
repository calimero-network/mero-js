import { describe, it, expect } from 'vitest';
import { parseAuthCallback, buildAuthLoginUrl } from './index';

describe('parseAuthCallback', () => {
  it('parses a valid callback URL', () => {
    const url =
      'http://localhost:5173/#access_token=abc&refresh_token=def&application_id=Cfow1&context_id=YqEN&context_identity=2q9U&node_url=http%3A%2F%2Flocalhost%3A4001';

    const result = parseAuthCallback(url);
    expect(result).toEqual({
      accessToken: 'abc',
      refreshToken: 'def',
      applicationId: 'Cfow1',
      contextId: 'YqEN',
      contextIdentity: '2q9U',
      nodeUrl: 'http://localhost:4001',
    });
  });

  it('returns null when no hash', () => {
    expect(parseAuthCallback('http://localhost:5173/')).toBeNull();
  });

  it('returns null when access_token is missing', () => {
    expect(parseAuthCallback('http://localhost:5173/#refresh_token=def')).toBeNull();
  });

  it('handles missing optional fields', () => {
    const url = 'http://localhost:5173/#access_token=abc';
    const result = parseAuthCallback(url);
    expect(result).toEqual({
      accessToken: 'abc',
      refreshToken: '',
      applicationId: '',
      contextId: '',
      contextIdentity: '',
      nodeUrl: '',
    });
  });
  it('handles URL-encoded access tokens (URLSearchParams auto-decodes)', () => {
    // URLSearchParams.get() auto-decodes percent-encoded values
    const url = 'http://localhost:5173/#access_token=eyJ%2BdG9rZW4%3D&refresh_token=ref';
    const result = parseAuthCallback(url);
    expect(result).not.toBeNull();
    // URLSearchParams auto-decodes %2B → + and %3D → =
    expect(result!.accessToken).toBe('eyJ+dG9rZW4=');
  });

  it('handles empty hash fragment', () => {
    expect(parseAuthCallback('http://localhost:5173/#')).toBeNull();
  });

  it('handles hash with non-auth params', () => {
    expect(parseAuthCallback('http://localhost:5173/#tab=settings')).toBeNull();
  });
});

describe('buildAuthLoginUrl', () => {
  it('builds a login URL with package name', () => {
    const url = buildAuthLoginUrl('http://localhost:4001', {
      callbackUrl: 'http://localhost:5173/',
      packageName: 'com.calimero.kv-store',
      mode: 'single-context',
      permissions: ['context:execute'],
    });

    expect(url).toContain('http://localhost:4001/auth/login?');
    expect(url).toContain('callback-url=');
    expect(url).toContain('package-name=com.calimero.kv-store');
    expect(url).toContain('mode=single-context');
    expect(url).toContain('permissions=context%3Aexecute');
  });

  it('builds a login URL without package name (minimal params)', () => {
    const url = buildAuthLoginUrl('http://localhost:4001/', {
      callbackUrl: 'http://localhost:5173/',
      mode: 'single-context',
    });

    expect(url).not.toContain('package-name');
    expect(url).toContain('mode=single-context');
    // Trailing slash is trimmed
    expect(url.startsWith('http://localhost:4001/auth/login?')).toBe(true);
  });

  it('includes multiple permissions comma-separated', () => {
    const url = buildAuthLoginUrl('http://localhost:4001', {
      callbackUrl: 'http://localhost:5173/',
      mode: 'multi-context',
      permissions: ['context:create', 'context:list', 'context:execute'],
    });

    expect(url).toContain('permissions=context%3Acreate%2Ccontext%3Alist%2Ccontext%3Aexecute');
  });

  it('omits permissions when empty', () => {
    const url = buildAuthLoginUrl('http://localhost:4001', {
      callbackUrl: 'http://localhost:5173/',
      mode: 'single-context',
      permissions: [],
    });

    expect(url).not.toContain('permissions=');
  });

  it('includes registry URL and version with package name', () => {
    const url = buildAuthLoginUrl('http://localhost:4001', {
      callbackUrl: 'http://localhost:5173/',
      packageName: 'com.calimero.app',
      packageVersion: '1.2.3',
      registryUrl: 'https://registry.calimero.network',
      mode: 'single-context',
    });

    expect(url).toContain('package-version=1.2.3');
    expect(url).toContain('registry-url=');
  });
});
