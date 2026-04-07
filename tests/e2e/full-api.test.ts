/**
 * Full E2E tests for mero-js against a running Calimero node.
 *
 * Covers: Auth -> Applications -> Namespace -> Group -> Context -> RPC -> SSE
 *
 * Prerequisites:
 *   A merod node running on localhost:4001 with embedded auth and kv-store installed.
 *   CI starts this via Docker; locally run the node manually.
 *
 * Run:
 *   NODE_URL=http://localhost:4001 pnpm test:e2e
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { MeroJs } from '../../src/mero-js';
import { parseAuthCallback, buildAuthLoginUrl } from '../../src/auth';

const NODE_URL = process.env.NODE_URL || 'http://localhost:4001';
const USERNAME = 'dev';
const PASSWORD = 'dev';
const KV_STORE_PACKAGE = 'com.calimero.kv-store';

let mero: MeroJs;
let applicationId: string;
let namespaceId: string;
let groupId: string;
let contextId: string;
let executorPublicKey: string;

describe('MeroJs E2E — Full Flow', () => {
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

  // ---- Admin: Applications ----

  describe('Applications', () => {
    it('should list installed applications', async () => {
      const response = await mero.admin.listApplications();
      expect(response.apps.length).toBeGreaterThan(0);

      const kvApp = response.apps.find((a) => a.package === KV_STORE_PACKAGE);
      expect(kvApp).toBeTruthy();
      applicationId = kvApp!.id;
    });

    it('should get application by ID', async () => {
      const response = await mero.admin.getApplication(applicationId);
      expect(response.application).toBeDefined();
      expect(response.application!.id).toBe(applicationId);
      expect(response.application!.package).toBe(KV_STORE_PACKAGE);
    });

    it('should get latest package version', async () => {
      const response = await mero.admin.getLatestPackageVersion(KV_STORE_PACKAGE);
      expect(response.applicationId).toBeTruthy();
      expect(response.version).toBeTruthy();
    });
  });

  // ---- Admin: Namespace -> Group -> Context ----

  describe('Namespace & Context Creation', () => {
    it('should create a namespace for the application', async () => {
      const response = await mero.admin.createNamespace({
        applicationId,
        upgradePolicy: 'manual',
        alias: 'e2e-full',
      });
      expect(response.namespaceId).toBeTruthy();
      namespaceId = response.namespaceId;
      // The namespace ID is also the root group ID
      groupId = namespaceId;
    });

    it('should get namespace identity', async () => {
      const identity = await mero.admin.getNamespaceIdentity(namespaceId);
      expect(identity.publicKey).toBeTruthy();
    });

    it('should get group info for the namespace root group', async () => {
      const info = await mero.admin.getGroupInfo(groupId);
      expect(info.groupId).toBe(groupId);
      expect(info.targetApplicationId).toBe(applicationId);
      expect(info.memberCount).toBeGreaterThan(0);
    });

    it('should create a context in the group', async () => {
      const response = await mero.admin.createContext({
        applicationId,
        groupId,
      });
      expect(response.contextId).toBeTruthy();
      expect(response.memberPublicKey).toBeTruthy();
      contextId = response.contextId;
      executorPublicKey = response.memberPublicKey;
    });

    it('should list contexts and find the created one', async () => {
      const response = await mero.admin.getContexts();
      const found = response.contexts.find((c) => c.id === contextId);
      expect(found).toBeTruthy();
    });

    it('should get context by ID', async () => {
      const ctx = await mero.admin.getContext(contextId);
      expect(ctx.id).toBe(contextId);
      expect(ctx.applicationId).toBe(applicationId);
    });

    it('should get context identities', async () => {
      const response = await mero.admin.getContextIdentities(contextId);
      expect(response.identities.length).toBeGreaterThan(0);
      expect(response.identities).toContain(executorPublicKey);
    });

    it('should get context identities owned', async () => {
      const response = await mero.admin.getContextIdentitiesOwned(contextId);
      expect(response.identities.length).toBeGreaterThan(0);
      expect(response.identities).toContain(executorPublicKey);
    });
  });

  // ---- RPC ----

  describe('JSON-RPC', () => {
    it('should execute "entries" (read)', async () => {
      const result = await mero.rpc.execute({
        contextId,
        method: 'entries',
        argsJson: {},
        executorPublicKey,
      });
      expect(result).toBeDefined();
    });

    it('should execute "set" (write) and verify', async () => {
      await mero.rpc.execute({
        contextId,
        method: 'set',
        argsJson: { key: 'e2e-test', value: 'hello' },
        executorPublicKey,
      });

      const entries = await mero.rpc.execute<Record<string, string>>({
        contextId,
        method: 'entries',
        argsJson: {},
        executorPublicKey,
      });
      expect(entries).toHaveProperty('e2e-test', 'hello');
    });

    it('should execute "get" (read single)', async () => {
      const value = await mero.rpc.execute<string | null>({
        contextId,
        method: 'get',
        argsJson: { key: 'e2e-test' },
        executorPublicKey,
      });
      expect(value).toBe('hello');
    });

    it('should execute "remove" (write)', async () => {
      const result = await mero.rpc.execute({
        contextId,
        method: 'remove',
        argsJson: { key: 'e2e-test' },
        executorPublicKey,
      });
      expect(result).toBeDefined();
    });

    it('should throw RpcError on non-existent method', async () => {
      await expect(
        mero.rpc.execute({
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
    it('should connect to SSE and get session', async () => {
      const sse = mero.events;
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
      const sse = mero.events;
      await sse.subscribe([contextId]);
      // If no error thrown, subscription succeeded
    });

    it('should receive event on state mutation', async () => {
      const sse = mero.events;

      const eventPromise = new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Event timeout')), 10000);
        sse.on('event', (data: any) => {
          clearTimeout(timeout);
          resolve(data);
        });
      });

      // Trigger a state mutation
      await mero.rpc.execute({
        contextId,
        method: 'set',
        argsJson: { key: 'sse-test', value: 'event-trigger' },
        executorPublicKey,
      });

      const event = await eventPromise;
      expect(event).toBeTruthy();
      expect(event.contextId).toBe(contextId);

      // Cleanup SSE
      mero.events.close();
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

      // Wait for token to expire
      await new Promise((r) => setTimeout(r, REFRESH_WAIT));

      // The next call should trigger refresh automatically
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
    it('should delete context', async () => {
      if (!contextId) return;
      const result = await mero.admin.deleteContext(contextId);
      expect(result.isDeleted).toBe(true);
    });

    it('should delete namespace', async () => {
      if (!namespaceId) return;
      const result = await mero.admin.deleteNamespace(namespaceId);
      expect(result.isDeleted).toBe(true);
    });

    it('should close MeroJs', () => {
      mero.close();
    });
  });
});
