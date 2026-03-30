/**
 * E2E tests for mero-js against a running Calimero node.
 *
 * Prerequisites:
 *   cd todo-app/test-nodes && bash start.sh
 *   # Installs todo-app + kv-store on node at localhost:4001
 *
 * Run:
 *   pnpm test:e2e
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { MeroJs } from '../../src/mero-js';
import { parseAuthCallback, buildAuthLoginUrl } from '../../src/auth';

const NODE_URL = process.env.NODE_URL || 'http://localhost:4001';
const USERNAME = 'dev';
const PASSWORD = 'dev';
const KV_STORE_PACKAGE = 'com.calimero.kv-store';
const DEV_SIGNER_ID = 'did:key:z6MknF3p5L5FDHJQ7FREUapuX4Wmp4MtF6WrHYaXS2B3eZQd';

let mero: MeroJs;
let applicationId: string;
let contextId: string;
let executorPublicKey: string;

describe('MeroJs E2E', () => {
  // ---- Auth ----

  describe('Authentication', () => {
    it('should authenticate with username/password', async () => {
      mero = new MeroJs({ baseUrl: NODE_URL });
      const tokenData = await mero.authenticate({ username: USERNAME, password: PASSWORD });

      expect(tokenData.access_token).toBeTruthy();
      expect(tokenData.refresh_token).toBeTruthy();
      expect(tokenData.expires_at).toBeGreaterThan(Date.now());
      expect(mero.isAuthenticated()).toBe(true);
    });

    it('should reject bad credentials', async () => {
      const badMero = new MeroJs({ baseUrl: NODE_URL });
      await expect(badMero.authenticate({ username: 'wrong', password: 'wrong' }))
        .rejects.toThrow();
    });

    it('should get auth providers', async () => {
      const response: any = await mero.auth.getProviders();
      const providers = response?.data?.providers ?? response?.providers ?? [];
      expect(providers.length).toBeGreaterThan(0);
      const hasUserPassword = providers.some((p: any) => p.name === 'user_password');
      expect(hasUserPassword).toBe(true);
    });

    it('should get auth health', async () => {
      const response = await mero.auth.getHealth();
      expect(response).toBeTruthy();
    });
  });

  // ---- Admin: Applications ----

  describe('Applications', () => {
    it('should list installed applications', async () => {
      const response = await mero.admin.listApplications();
      const apps = (response as any)?.apps ?? [];
      expect(apps.length).toBeGreaterThan(0);

      const kvApp = apps.find((a: any) => a.package === KV_STORE_PACKAGE);
      expect(kvApp).toBeTruthy();
      expect(kvApp.signer_id).toBe(DEV_SIGNER_ID);
      applicationId = kvApp.id;
    });

    it('should get application by ID', async () => {
      const response = await mero.admin.getApplication(applicationId);
      const app = (response as any)?.application ?? response;
      expect(app.id).toBe(applicationId);
      expect(app.package).toBe(KV_STORE_PACKAGE);
    });

    it('should get latest package version (requires auth)', async () => {
      const response = await mero.admin.getLatestPackageVersion(KV_STORE_PACKAGE);
      expect(response.applicationId).toBeTruthy();
      expect(response.version).toBeTruthy();
    });
  });

  // ---- Admin: Health ----

  describe('Health', () => {
    it('should return health status', async () => {
      const response = await mero.admin.healthCheck();
      expect(response.status).toBe('alive');
    });

    it('should return peers count', async () => {
      const response = await mero.admin.getPeersCount();
      expect(typeof response.count).toBe('number');
    });
  });

  // ---- Admin: Contexts ----

  describe('Contexts', () => {
    it('should create a context', async () => {
      const response = await mero.admin.createContext({
        applicationId,
        protocol: 'near',
        initializationParams: [],
      } as any);
      contextId = (response as any)?.contextId;
      expect(contextId).toBeTruthy();

      const memberKey = (response as any)?.memberPublicKey;
      expect(memberKey).toBeTruthy();
      executorPublicKey = memberKey;
    });

    it('should list contexts', async () => {
      const response = await mero.admin.getContexts();
      const contexts = (response as any)?.contexts ?? [];
      expect(contexts.length).toBeGreaterThan(0);
      expect(contexts.find((c: any) => c.id === contextId)).toBeTruthy();
    });

    it('should get context by ID', async () => {
      const response = await mero.admin.getContext(contextId);
      expect((response as any)?.id || (response as any)?.context?.id).toBeTruthy();
    });

    it('should get context identities (all)', async () => {
      const response = await mero.admin.getContextIdentities(contextId);
      const identities = (response as any)?.identities ?? [];
      expect(identities.length).toBeGreaterThan(0);
      expect(identities).toContain(executorPublicKey);
    });

    it('should get context identities owned (this node)', async () => {
      const response = await mero.admin.getContextIdentitiesOwned(contextId);
      const identities = (response as any)?.identities ?? [];
      expect(identities.length).toBeGreaterThan(0);
      expect(identities).toContain(executorPublicKey);
    });
  });

  // ---- RPC ----

  describe('JSON-RPC', () => {
    let clientMero: MeroJs;

    beforeAll(async () => {
      // Generate a client key scoped to the context
      const response = await fetch(`${NODE_URL}/admin/client-key`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${mero.getTokenData()!.access_token}`,
        },
        body: JSON.stringify({
          context_id: contextId,
          context_identity: executorPublicKey,
          permissions: [
            `context[${contextId},${executorPublicKey}]`,
            `context:execute[${applicationId}]`,
          ],
        }),
      });
      const json = await response.json();
      const clientToken = json.data;

      clientMero = new MeroJs({ baseUrl: NODE_URL });
      clientMero.setTokenData({
        access_token: clientToken.access_token,
        refresh_token: clientToken.refresh_token,
        expires_at: Date.now() + 3_600_000,
      });
    });

    it('should execute "entries" (read)', async () => {
      const result = await clientMero.rpc.execute({
        contextId,
        method: 'entries',
        argsJson: {},
        executorPublicKey,
      });
      expect(result).toBeDefined();
    });

    it('should execute "set" (write)', async () => {
      await clientMero.rpc.execute({
        contextId,
        method: 'set',
        argsJson: { key: 'e2e-test', value: 'hello' },
        executorPublicKey,
      });

      const entries = await clientMero.rpc.execute<Record<string, string>>({
        contextId,
        method: 'entries',
        argsJson: {},
        executorPublicKey,
      });
      expect(entries).toHaveProperty('e2e-test', 'hello');
    });

    it('should execute "get" (read single)', async () => {
      const value = await clientMero.rpc.execute<string | null>({
        contextId,
        method: 'get',
        argsJson: { key: 'e2e-test' },
        executorPublicKey,
      });
      expect(value).toBe('hello');
    });

    it('should execute "remove" (write)', async () => {
      const result = await clientMero.rpc.execute({
        contextId,
        method: 'remove',
        argsJson: { key: 'e2e-test' },
        executorPublicKey,
      });
      // remove returns the removed value or null
      expect(result).toBeDefined();
    });

    it('should throw RpcError on non-existent method', async () => {
      await expect(
        clientMero.rpc.execute({
          contextId,
          method: 'nonexistent_method',
          argsJson: {},
          executorPublicKey,
        }),
      ).rejects.toThrow();
    });
  });

  // ---- SSE ----

  describe('SSE Events', () => {
    let clientMero: MeroJs;

    beforeAll(async () => {
      const response = await fetch(`${NODE_URL}/admin/client-key`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${mero.getTokenData()!.access_token}`,
        },
        body: JSON.stringify({
          context_id: contextId,
          context_identity: executorPublicKey,
          permissions: [
            `context[${contextId},${executorPublicKey}]`,
            `context:execute[${applicationId}]`,
          ],
        }),
      });
      const json = await response.json();
      const clientToken = json.data;

      clientMero = new MeroJs({ baseUrl: NODE_URL });
      clientMero.setTokenData({
        access_token: clientToken.access_token,
        refresh_token: clientToken.refresh_token,
        expires_at: Date.now() + 3_600_000,
      });
    });

    it('should connect to SSE and get session', async () => {
      const sse = clientMero.events;
      const sessionId = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('SSE connect timeout')), 5000);
        sse.on('connect', (id: string) => {
          clearTimeout(timeout);
          resolve(id);
        });
        sse.connect().catch(reject);
      });

      expect(sessionId).toBeTruthy();
      expect(typeof sessionId).toBe('string');
    });

    it('should subscribe to context events', async () => {
      const sse = clientMero.events;
      await sse.subscribe([contextId]);
      // If no error thrown, subscription succeeded
    });

    it('should receive event on state mutation', async () => {
      const sse = clientMero.events;

      const eventPromise = new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Event timeout')), 10000);
        sse.on('event', (data: any) => {
          clearTimeout(timeout);
          resolve(data);
        });
      });

      // Trigger a state mutation
      await clientMero.rpc.execute({
        contextId,
        method: 'set',
        argsJson: { key: 'sse-test', value: 'event-trigger' },
        executorPublicKey,
      });

      const event = await eventPromise;
      expect(event).toBeTruthy();
      expect(event.contextId).toBe(contextId);

      // Cleanup
      clientMero.close();
    });
  });

  // ---- Auth Helpers ----

  describe('Auth Helpers', () => {
    it('parseAuthCallback extracts all fields from hash', () => {
      const url = 'http://localhost:5173/#access_token=abc&refresh_token=def&application_id=app1&context_id=ctx1&context_identity=id1&node_url=http%3A%2F%2Flocalhost%3A4001';
      const result = parseAuthCallback(url);
      expect(result).not.toBeNull();
      expect(result!.accessToken).toBe('abc');
      expect(result!.refreshToken).toBe('def');
      expect(result!.applicationId).toBe('app1');
      expect(result!.contextId).toBe('ctx1');
      expect(result!.contextIdentity).toBe('id1');
      expect(result!.nodeUrl).toBe('http://localhost:4001');
    });

    it('parseAuthCallback returns null for no tokens', () => {
      expect(parseAuthCallback('http://localhost:5173/')).toBeNull();
      expect(parseAuthCallback('http://localhost:5173/#foo=bar')).toBeNull();
    });

    it('buildAuthLoginUrl constructs correct URL', () => {
      const url = buildAuthLoginUrl('http://localhost:4001', {
        callbackUrl: 'http://localhost:5173/',
        mode: 'single-context',
        packageName: 'com.calimero.kv-store',
        permissions: ['context:execute'],
      });
      expect(url).toContain('http://localhost:4001/auth/login?');
      expect(url).toContain('callback-url=');
      expect(url).toContain('package-name=com.calimero.kv-store');
      expect(url).toContain('mode=single-context');
      expect(url).toContain('permissions=context%3Aexecute');
    });
  });

  // ---- Token Management ----

  describe('Token Management', () => {
    it('getTokenData returns current tokens', () => {
      const data = mero.getTokenData();
      expect(data).not.toBeNull();
      expect(data!.access_token).toBeTruthy();
      expect(data!.refresh_token).toBeTruthy();
      expect(data!.expires_at).toBeGreaterThan(Date.now());
    });

    it('setTokenData updates tokens', () => {
      const old = mero.getTokenData()!;
      mero.setTokenData({
        access_token: 'test-token',
        refresh_token: 'test-refresh',
        expires_at: Date.now() + 1000,
      });
      expect(mero.getTokenData()!.access_token).toBe('test-token');

      // Restore
      mero.setTokenData(old);
      expect(mero.getTokenData()!.access_token).toBe(old.access_token);
    });

    it('clearToken removes auth', () => {
      const old = mero.getTokenData()!;
      mero.clearToken();
      expect(mero.isAuthenticated()).toBe(false);
      expect(mero.getTokenData()).toBeNull();

      // Restore for subsequent tests
      mero.setTokenData(old);
    });
  });

  // ---- Token Refresh ----
  //
  // To test token refresh E2E, configure node with:
  //   access_token_expiry = 1
  // The jsonwebtoken crate has a 60s default leeway, so the token is actually
  // valid for ~61 seconds. Set TOKEN_REFRESH_WAIT_MS env var to override.
  //
  // Run: TOKEN_REFRESH_WAIT_MS=62000 pnpm test:e2e -- tests/e2e/full-api.test.ts

  const REFRESH_WAIT = parseInt(process.env.TOKEN_REFRESH_WAIT_MS || '0', 10);

  describe('Token Refresh', () => {
    it.skipIf(REFRESH_WAIT === 0)('should refresh token automatically after expiry', async () => {
      const shortMero = new MeroJs({ baseUrl: NODE_URL });
      await shortMero.authenticate({ username: USERNAME, password: PASSWORD });

      const originalToken = shortMero.getTokenData()!.access_token;
      expect(originalToken).toBeTruthy();

      // First call should work
      const contexts1 = await shortMero.admin.getContexts();
      expect(contexts1).toBeTruthy();

      // Wait for token to expire (expiry + 60s jsonwebtoken leeway + buffer)
      await new Promise((r) => setTimeout(r, REFRESH_WAIT));

      // The token is now expired. The next call should trigger refresh automatically.
      const contexts2 = await shortMero.admin.getContexts();
      expect(contexts2).toBeTruthy();

      // Token should have been refreshed
      const newToken = shortMero.getTokenData()!.access_token;
      expect(newToken).not.toBe(originalToken);

      shortMero.close();
    }, REFRESH_WAIT + 15000);
  });

  // ---- Cleanup ----

  describe('Cleanup', () => {
    it('should close MeroJs', () => {
      mero.close();
    });
  });
});
