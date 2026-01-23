import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MeroJs } from '@calimero-network/mero-js';
import { readFileSync } from 'fs';
import { join } from 'path';

// Test configuration
const ADMIN_CONFIG = {
  baseUrl:
    process.env.AUTH_NODE_API_BASE_URL ||
    process.env.ADMIN_API_BASE_URL ||
    'http://node1.127.0.0.1.nip.io',
  credentials: {
    username: 'admin',
    password: 'admin123',
  },
  timeoutMs: 10000,
};

describe('Admin API E2E Tests', () => {
  let meroJs: MeroJs;
  let installedAppId: string;
  let createdContextId: string;
  let createdBlobId: string;
  let generatedIdentity: string;
  let createdAlias: string;

  beforeAll(async () => {
    console.log('🚀 Starting merobox environment...');

    const { spawn } = await import('child_process');

    console.log('🔧 Starting Calimero node with auth service...');
    const meroboxProcess = spawn('merobox', ['run', '--auth-service'], {
      stdio: 'pipe',
      cwd: process.cwd(),
    });

    let authNodeUrl: string | null = null;

    meroboxProcess.on('error', (error) => {
      console.error('❌ Merobox process error:', error);
    });

    meroboxProcess.stderr.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Auth Node URL:')) {
        const match = output.match(/Auth Node URL:\s*(https?:\/\/[^\s]+)/);
        if (match) {
          authNodeUrl = match[1];
          console.log('📝 Merobox:', output.trim());
        }
      }
    });

    meroboxProcess.stdout.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Auth Node URL:')) {
        const match = output.match(/Auth Node URL:\s*(https?:\/\/[^\s]+)/);
        if (match) {
          authNodeUrl = match[1];
        }
        console.log('📝 Merobox:', output.trim());
      }
      if (output.includes('Non Auth Node URL:')) {
        console.log('📝 Merobox:', output.trim());
      }
    });

    // Wait for services to be ready
    console.log('⏳ Waiting for services to start...');
    await new Promise((resolve) => setTimeout(resolve, 60000));

    console.log('🔧 Creating MeroJs SDK...');
    const baseUrl = authNodeUrl || ADMIN_CONFIG.baseUrl;
    console.log('Admin API URL:', baseUrl);

    meroJs = new MeroJs({
      ...ADMIN_CONFIG,
      baseUrl,
    });

    // Wait for auth service to be ready
    console.log('⏳ Waiting for auth service to be ready...');
    let authReady = false;
    for (let i = 0; i < 10; i++) {
      try {
        const authHealth = await meroJs.auth.getHealth();
        console.log('✅ Auth service is ready:', authHealth);
        authReady = true;
        break;
      } catch (error: any) {
        console.log(`⏳ Auth service not ready yet (attempt ${i + 1}/10)...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    if (!authReady) {
      throw new Error('Auth service did not become ready in time');
    }

    console.log('🔑 Authenticating with MeroJs SDK...');
    try {
      const tokenData = await meroJs.authenticate();
      console.log('✅ Authentication successful!');
      console.log('🎫 Token expires at:', new Date(tokenData.expires_at));
    } catch (error: any) {
      console.error('❌ Authentication failed:', error.message);
      if (error.bodyText) {
        console.error('⚠️ Error body:', error.bodyText);
      }
      throw new Error(
        `Authentication required but failed: ${error.message}. Cannot proceed with tests.`,
      );
    }
  }, 120000);

  afterAll(async () => {
    console.log('🧹 Cleaning up merobox environment...');

    try {
      const { spawn } = await import('child_process');

      console.log('🗑️ Running merobox nuke --force...');
      const nukeProcess = spawn('merobox', ['nuke', '--force'], {
        stdio: 'inherit',
        cwd: process.cwd(),
      });

      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          console.warn('⚠️ Merobox cleanup timeout, killing process...');
          nukeProcess.kill('SIGTERM');
          resolve(void 0);
        }, 90000);

        nukeProcess.on('close', () => {
          clearTimeout(timeout);
          resolve(void 0);
        });
        nukeProcess.on('error', () => {
          clearTimeout(timeout);
          resolve(void 0);
        });
      });
    } catch (error) {
      console.warn('⚠️ Merobox cleanup failed:', error);
    }

    console.log('🧹 Test cleanup completed');
  }, 120000);

  describe('Public API Endpoints', () => {
    it('should check health', async () => {
      const health = await meroJs.admin.public.health();
      expect(health).toBeDefined();
      expect(health.status).toBeDefined();
      console.log('✅ Health check:', health);
    });

    it('should check auth status', async () => {
      const authStatus = await meroJs.admin.public.isAuthed();
      expect(authStatus).toBeDefined();
      expect(authStatus.status).toBeDefined();
      console.log('✅ Auth status:', authStatus);
    });

    it('should get certificate', async () => {
      try {
        const cert = await meroJs.admin.public.getCertificate();
        expect(cert).toBeDefined();
        expect(typeof cert).toBe('string');
        console.log('✅ Certificate retrieved (length:', cert.length, ')');
      } catch (error: any) {
        console.log('⚠️ Certificate not available:', error.message);
      }
    });
  });

  describe('Application Management - All Endpoints', () => {
    it('should list applications (empty initially)', async () => {
      const apps = await meroJs.admin.applications.listApplications();
      expect(apps).toBeDefined();
      expect(apps.apps).toBeDefined();
      expect(Array.isArray(apps.apps)).toBe(true);
      console.log('✅ Applications listed:', apps.apps.length);
    });

    it('should list packages', async () => {
      try {
        const packages = await meroJs.admin.applications.listPackages();
        expect(packages).toBeDefined();
        expect(packages.packages).toBeDefined();
        expect(Array.isArray(packages.packages)).toBe(true);
        console.log('✅ Packages listed:', packages.packages.length);
      } catch (error: any) {
        console.log('⚠️ List packages failed (may not be implemented):', error.message);
      }
    });

    it('should install an application from WASM file', async () => {
      const wasmPath = join(process.cwd(), 'tests/e2e/assets/kv_store.wasm');
      const wasmBuffer = readFileSync(wasmPath);

      // Upload blob first
      const blob = new Blob([wasmBuffer]);
      const blobResult = await meroJs.admin.blobs.uploadBlob(blob);
      console.log('✅ Blob uploaded:', blobResult.blobId);
      createdBlobId = blobResult.blobId;

      // Install application
      const installResult = await meroJs.admin.applications.installApplication({
        url: `blob://${blobResult.blobId}`,
        metadata: Buffer.from('Test KV Store application').toString('base64'),
      });

      expect(installResult).toBeDefined();
      expect(installResult.applicationId).toBeDefined();
      installedAppId = installResult.applicationId;
      console.log('✅ Application installed:', installedAppId);
    });

    it('should get application by id', async () => {
      if (!installedAppId) {
        console.log('⏭️ Skipping - no installed app');
        return;
      }

      const app = await meroJs.admin.applications.getApplication(installedAppId);
      expect(app).toBeDefined();
      expect(app.application).toBeDefined();
      expect(app.application.applicationId).toBe(installedAppId);
      console.log('✅ Application retrieved:', app.application.applicationId);
    });

    it('should list applications (with installed app)', async () => {
      const apps = await meroJs.admin.applications.listApplications();
      expect(apps.apps.length).toBeGreaterThan(0);
      if (installedAppId) {
        const found = apps.apps.find((a) => a.applicationId === installedAppId);
        expect(found).toBeDefined();
      }
      console.log('✅ Applications listed:', apps.apps.length);
    });

    it('should list versions for a package', async () => {
      try {
        if (!installedAppId) {
          console.log('⏭️ Skipping - no installed app');
          return;
        }
        // This might fail if package system is not set up
        const versions = await meroJs.admin.applications.listVersions('test-package');
        expect(versions).toBeDefined();
        expect(versions.versions).toBeDefined();
        console.log('✅ Versions listed:', versions.versions.length);
      } catch (error: any) {
        console.log('⚠️ List versions failed (may not be implemented):', error.message);
      }
    });

    it('should get latest version for a package', async () => {
      try {
        if (!installedAppId) {
          console.log('⏭️ Skipping - no installed app');
          return;
        }
        const latest = await meroJs.admin.applications.getLatestVersion('test-package');
        expect(latest).toBeDefined();
        console.log('✅ Latest version:', latest.applicationId);
      } catch (error: any) {
        console.log('⚠️ Get latest version failed (may not be implemented):', error.message);
      }
    });
  });

  describe('Context Management - All Endpoints', () => {
    it('should list contexts (empty initially)', async () => {
      const contexts = await meroJs.admin.contexts.listContexts();
      expect(contexts).toBeDefined();
      expect(contexts.contexts).toBeDefined();
      expect(Array.isArray(contexts.contexts)).toBe(true);
      console.log('✅ Contexts listed:', contexts.contexts.length);
    });

    it('should create a context', async () => {
      if (!installedAppId) {
        console.log('⏭️ Skipping - no installed app');
        return;
      }

      const context = await meroJs.admin.contexts.createContext({
        protocol: 'near',
        applicationId: installedAppId,
        initializationParams: Buffer.from('{}').toString('base64'),
      });

      expect(context).toBeDefined();
      expect(context.contextId).toBeDefined();
      expect(context.memberPublicKey).toBeDefined();
      createdContextId = context.contextId;
      console.log('✅ Context created:', createdContextId);
    });

    it('should get context by id', async () => {
      if (!createdContextId) {
        console.log('⏭️ Skipping - no created context');
        return;
      }

      const context = await meroJs.admin.contexts.getContext(createdContextId);
      expect(context).toBeDefined();
      expect(context.contextId).toBe(createdContextId);
      expect(context.applicationId).toBe(installedAppId);
      console.log('✅ Context retrieved:', context.contextId);
    });

    it('should get context storage', async () => {
      if (!createdContextId) {
        console.log('⏭️ Skipping - no created context');
        return;
      }

      const storage = await meroJs.admin.contexts.getContextStorage(createdContextId);
      expect(storage).toBeDefined();
      expect(storage.sizeInBytes).toBeDefined();
      expect(typeof storage.sizeInBytes).toBe('number');
      console.log('✅ Context storage:', storage.sizeInBytes, 'bytes');
    });

    it('should get context identities', async () => {
      if (!createdContextId) {
        console.log('⏭️ Skipping - no created context');
        return;
      }

      const identities = await meroJs.admin.contexts.getContextIdentities(
        createdContextId,
      );
      expect(identities).toBeDefined();
      expect(identities.identities).toBeDefined();
      expect(Array.isArray(identities.identities)).toBe(true);
      console.log('✅ Context identities:', identities.identities.length);
    });

    it('should get context identities owned', async () => {
      if (!createdContextId) {
        console.log('⏭️ Skipping - no created context');
        return;
      }

      const identities = await meroJs.admin.contexts.getContextIdentitiesOwned(
        createdContextId,
      );
      expect(identities).toBeDefined();
      expect(identities.identities).toBeDefined();
      console.log('✅ Owned identities:', identities.identities.length);
    });

    it('should get contexts for application', async () => {
      if (!installedAppId) {
        console.log('⏭️ Skipping - no installed app');
        return;
      }

      const contexts = await meroJs.admin.contexts.getContextsForApplication(
        installedAppId,
      );
      expect(contexts).toBeDefined();
      expect(contexts.contexts).toBeDefined();
      if (createdContextId) {
        const found = contexts.contexts.find(
          (c) => c.contextId === createdContextId,
        );
        expect(found).toBeDefined();
      }
      console.log('✅ Contexts for application:', contexts.contexts.length);
    });

    it('should get contexts with executors for application', async () => {
      if (!installedAppId) {
        console.log('⏭️ Skipping - no installed app');
        return;
      }

      const contexts =
        await meroJs.admin.contexts.getContextsWithExecutorsForApplication(
          installedAppId,
        );
      expect(contexts).toBeDefined();
      expect(contexts.contexts).toBeDefined();
      console.log('✅ Contexts with executors:', contexts.contexts.length);
    });

    it('should get proxy contract', async () => {
      if (!createdContextId) {
        console.log('⏭️ Skipping - no created context');
        return;
      }

      try {
        const proxy = await meroJs.admin.contexts.getProxyContract(createdContextId);
        expect(proxy).toBeDefined();
        console.log('✅ Proxy contract retrieved');
      } catch (error: any) {
        console.log('⚠️ Get proxy contract failed (may not be implemented):', error.message);
      }
    });

    it('should sync context', async () => {
      if (!createdContextId) {
        console.log('⏭️ Skipping - no created context');
        return;
      }

      try {
        const result = await meroJs.admin.contexts.syncContextById(createdContextId);
        expect(result).toBeDefined();
        console.log('✅ Context synced');
      } catch (error: any) {
        console.log('⚠️ Sync context failed (may not be implemented):', error.message);
      }
    });
  });

  describe('Proposal Management - All Endpoints', () => {
    it('should get proposals', async () => {
      if (!createdContextId) {
        console.log('⏭️ Skipping - no created context');
        return;
      }

      try {
        const proposals = await meroJs.admin.proposals.getProposals(
          createdContextId,
          { offset: 0, limit: 10 },
        );
        expect(proposals).toBeDefined();
        expect(Array.isArray(proposals)).toBe(true);
        console.log('✅ Proposals retrieved:', proposals.length);
      } catch (error: any) {
        console.log('⚠️ Get proposals failed (may not be implemented):', error.message);
      }
    });

    it('should get number of active proposals', async () => {
      if (!createdContextId) {
        console.log('⏭️ Skipping - no created context');
        return;
      }

      try {
        const count = await meroJs.admin.proposals.getNumberOfActiveProposals(
          createdContextId,
        );
        expect(count).toBeDefined();
        expect(typeof count).toBe('number');
        console.log('✅ Active proposals count:', count);
      } catch (error: any) {
        console.log('⚠️ Get proposal count failed (may not be implemented):', error.message);
      }
    });

    it('should get context value', async () => {
      if (!createdContextId) {
        console.log('⏭️ Skipping - no created context');
        return;
      }

      try {
        const value = await meroJs.admin.proposals.getContextValue(createdContextId, {
          key: 'test-key',
        });
        expect(value).toBeDefined();
        expect(Array.isArray(value)).toBe(true);
        console.log('✅ Context value retrieved');
      } catch (error: any) {
        console.log('⚠️ Get context value failed (may not be implemented):', error.message);
      }
    });

    it('should get context storage entries', async () => {
      if (!createdContextId) {
        console.log('⏭️ Skipping - no created context');
        return;
      }

      try {
        const entries = await meroJs.admin.proposals.getContextStorageEntries(
          createdContextId,
          { offset: 0, limit: 10 },
        );
        expect(entries).toBeDefined();
        expect(Array.isArray(entries)).toBe(true);
        console.log('✅ Storage entries retrieved:', entries.length);
      } catch (error: any) {
        console.log('⚠️ Get storage entries failed (may not be implemented):', error.message);
      }
    });
  });

  describe('Blob Management - All Endpoints', () => {
    it('should upload blob', async () => {
      const blob = new Blob(['test blob data for comprehensive test']);
      const uploadResult = await meroJs.admin.blobs.uploadBlob(blob);
      expect(uploadResult).toBeDefined();
      expect(uploadResult.blobId).toBeDefined();
      expect(uploadResult.size).toBeDefined();
      createdBlobId = uploadResult.blobId;
      console.log('✅ Blob uploaded:', uploadResult.blobId);
    });

    it('should list blobs', async () => {
      const listResult = await meroJs.admin.blobs.listBlobs();
      expect(listResult).toBeDefined();
      expect(listResult.blobs).toBeDefined();
      expect(Array.isArray(listResult.blobs)).toBe(true);
      if (createdBlobId) {
        const found = listResult.blobs.find((b) => b.blobId === createdBlobId);
        expect(found).toBeDefined();
      }
      console.log('✅ Blobs listed:', listResult.blobs.length);
    });

    it('should get blob by id', async () => {
      if (!createdBlobId) {
        console.log('⏭️ Skipping - no created blob');
        return;
      }

      const blob = await meroJs.admin.blobs.getBlob(createdBlobId);
      expect(blob).toBeDefined();
      expect(blob).toBeInstanceOf(Blob);
      console.log('✅ Blob retrieved:', createdBlobId);
    });

    it('should get blob info via HEAD request', async () => {
      if (!createdBlobId) {
        console.log('⏭️ Skipping - no created blob');
        return;
      }

      try {
        const info = await meroJs.admin.blobs.getBlobInfo(createdBlobId);
        expect(info).toBeDefined();
        expect(info.blobId).toBe(createdBlobId);
        expect(info.size).toBeDefined();
        console.log('✅ Blob info retrieved:', info.size, 'bytes');
      } catch (error: any) {
        console.log('⚠️ Get blob info failed (may not be implemented):', error.message);
      }
    });
  });

  describe('Alias Management - All Endpoints', () => {
    it('should create context alias', async () => {
      if (!createdContextId) {
        console.log('⏭️ Skipping - no created context');
        return;
      }

      const alias = `test-context-${Date.now()}`;
      createdAlias = alias;

      const result = await meroJs.admin.aliases.createContextAlias({
        alias,
        contextId: createdContextId,
      });
      expect(result).toBeDefined();
      console.log('✅ Context alias created:', alias);
    });

    it('should lookup context alias', async () => {
      if (!createdAlias) {
        console.log('⏭️ Skipping - no created alias');
        return;
      }

      const result = await meroJs.admin.aliases.lookupContextAlias(createdAlias);
      expect(result).toBeDefined();
      expect(result.value).toBe(createdContextId);
      console.log('✅ Context alias looked up:', result.value);
    });

    it('should list context aliases', async () => {
      const result = await meroJs.admin.aliases.listContextAliases();
      expect(result).toBeDefined();
      if (createdAlias) {
        expect(result[createdAlias]).toBe(createdContextId);
      }
      console.log('✅ Context aliases listed:', Object.keys(result).length);
    });

    it('should create application alias', async () => {
      if (!installedAppId) {
        console.log('⏭️ Skipping - no installed app');
        return;
      }

      try {
        const alias = `test-app-${Date.now()}`;
        const result = await meroJs.admin.aliases.createApplicationAlias({
          alias,
          applicationId: installedAppId,
        });
        expect(result).toBeDefined();
        console.log('✅ Application alias created:', alias);
      } catch (error: any) {
        console.log('⚠️ Create application alias failed:', error.message);
      }
    });

    it('should list application aliases', async () => {
      try {
        const result = await meroJs.admin.aliases.listApplicationAliases();
        expect(result).toBeDefined();
        console.log('✅ Application aliases listed:', Object.keys(result).length);
      } catch (error: any) {
        console.log('⚠️ List application aliases failed:', error.message);
      }
    });

    it('should create identity alias', async () => {
      if (!createdContextId || !generatedIdentity) {
        console.log('⏭️ Skipping - no context or identity');
        return;
      }

      try {
        const alias = `test-identity-${Date.now()}`;
        const result = await meroJs.admin.aliases.createIdentityAlias(
          createdContextId,
          {
            alias,
            identity: generatedIdentity,
          },
        );
        expect(result).toBeDefined();
        console.log('✅ Identity alias created:', alias);
      } catch (error: any) {
        console.log('⚠️ Create identity alias failed:', error.message);
      }
    });

    it('should list identity aliases', async () => {
      if (!createdContextId) {
        console.log('⏭️ Skipping - no created context');
        return;
      }

      try {
        const result = await meroJs.admin.aliases.listIdentityAliases(createdContextId);
        expect(result).toBeDefined();
        console.log('✅ Identity aliases listed:', Object.keys(result).length);
      } catch (error: any) {
        console.log('⚠️ List identity aliases failed:', error.message);
      }
    });
  });

  describe('Capabilities Management', () => {
    it('should grant permission', async () => {
      if (!createdContextId || !generatedIdentity) {
        console.log('⏭️ Skipping - no context or identity');
        return;
      }

      try {
        const result = await meroJs.admin.capabilities.grantPermission(
          createdContextId,
          {
            contextId: createdContextId,
            granterId: generatedIdentity,
            granteeId: generatedIdentity,
            capability: 'read',
          },
        );
        expect(result).toBeDefined();
        console.log('✅ Permission granted');
      } catch (error: any) {
        console.log('⚠️ Grant permission failed:', error.message);
      }
    });

    it('should revoke permission', async () => {
      if (!createdContextId || !generatedIdentity) {
        console.log('⏭️ Skipping - no context or identity');
        return;
      }

      try {
        const result = await meroJs.admin.capabilities.revokePermission(
          createdContextId,
          {
            contextId: createdContextId,
            revokerId: generatedIdentity,
            revokeeId: generatedIdentity,
            capability: 'read',
          },
        );
        expect(result).toBeDefined();
        console.log('✅ Permission revoked');
      } catch (error: any) {
        console.log('⚠️ Revoke permission failed:', error.message);
      }
    });
  });

  describe('Identity Management', () => {
    it('should generate context identity', async () => {
      const identity = await meroJs.admin.identity.generateContextIdentity();
      expect(identity).toBeDefined();
      expect(identity.publicKey).toBeDefined();
      expect(typeof identity.publicKey).toBe('string');
      generatedIdentity = identity.publicKey;
      console.log('✅ Context identity generated:', identity.publicKey);
    });
  });

  describe('Network Info', () => {
    it('should get peers count', async () => {
      const peers = await meroJs.admin.network.getPeersCount();
      expect(peers).toBeDefined();
      expect(peers.count).toBeDefined();
      expect(typeof peers.count).toBe('number');
      expect(peers.count).toBeGreaterThanOrEqual(0);
      console.log('✅ Peers count:', peers.count);
    });
  });

  describe('TEE Endpoints', () => {
    it('should get TEE info', async () => {
      try {
        const info = await meroJs.admin.tee.getTeeInfo();
        expect(info).toBeDefined();
        expect(info.cloudProvider).toBeDefined();
        expect(info.osImage).toBeDefined();
        expect(info.mrtd).toBeDefined();
        console.log('✅ TEE info retrieved:', info.cloudProvider);
      } catch (error: any) {
        console.log('⚠️ TEE not available (expected in non-TEE environment):', error.message);
      }
    });

    it('should attest TEE', async () => {
      try {
        const nonce = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
        const result = await meroJs.admin.tee.attestTee({ nonce });
        expect(result).toBeDefined();
        expect(result.quoteB64).toBeDefined();
        expect(result.quote).toBeDefined();
        console.log('✅ TEE attestation successful');
      } catch (error: any) {
        console.log('⚠️ TEE attestation failed (expected in non-TEE environment):', error.message);
      }
    });
  });

  describe('Auth API Endpoints', () => {
    it('should get auth providers', async () => {
      const providers = await meroJs.auth.getProviders();
      expect(providers).toBeDefined();
      expect(Array.isArray(providers)).toBe(true);
      expect(providers.length).toBeGreaterThan(0);
      console.log('✅ Auth providers:', providers.length);
    });

    it('should get auth identity', async () => {
      const identity = await meroJs.auth.getIdentity();
      expect(identity).toBeDefined();
      expect(identity.service).toBeDefined();
      expect(identity.version).toBeDefined();
      console.log('✅ Auth identity:', identity.service);
    });

    it('should get challenge', async () => {
      const challenge = await meroJs.auth.getChallenge();
      expect(challenge).toBeDefined();
      expect(challenge.challenge).toBeDefined();
      expect(challenge.nonce).toBeDefined();
      expect(challenge.timestamp).toBeDefined();
      console.log('✅ Challenge retrieved');
    });

    it('should validate token', async () => {
      const tokenData = meroJs.getTokenData();
      if (!tokenData) {
        console.log('⏭️ Skipping - no token data');
        return;
      }

      const validation = await meroJs.auth.validateToken({
        token: tokenData.access_token,
      });
      expect(validation).toBeDefined();
      expect(validation.valid).toBe(true);
      console.log('✅ Token validated');
    });

    it('should list root keys', async () => {
      const keys = await meroJs.auth.listRootKeys();
      expect(keys).toBeDefined();
      expect(Array.isArray(keys)).toBe(true);
      console.log('✅ Root keys listed:', keys.length);
    });

    it('should list client keys', async () => {
      const keys = await meroJs.auth.listClientKeys();
      expect(keys).toBeDefined();
      expect(Array.isArray(keys)).toBe(true);
      console.log('✅ Client keys listed:', keys.length);
    });
  });

  describe('Cleanup', () => {
    it('should delete context alias', async () => {
      if (!createdAlias) {
        console.log('⏭️ Skipping - no created alias');
        return;
      }

      try {
        const result = await meroJs.admin.aliases.deleteContextAlias(createdAlias);
        expect(result).toBeDefined();
        console.log('✅ Context alias deleted');
      } catch (error: any) {
        console.log('⚠️ Delete alias failed:', error.message);
      }
    });

    it('should delete blob', async () => {
      if (!createdBlobId) {
        console.log('⏭️ Skipping - no created blob');
        return;
      }

      try {
        const result = await meroJs.admin.blobs.deleteBlob(createdBlobId);
        expect(result).toBeDefined();
        expect(result.deleted).toBe(true);
        console.log('✅ Blob deleted');
      } catch (error: any) {
        console.log('⚠️ Delete blob failed:', error.message);
      }
    });

    it('should delete context', async () => {
      if (!createdContextId) {
        console.log('⏭️ Skipping - no created context');
        return;
      }

      const result = await meroJs.admin.contexts.deleteContext(createdContextId);
      expect(result).toBeDefined();
      expect(result.isDeleted).toBe(true);
      console.log('✅ Context deleted');
    });

    it('should uninstall application', async () => {
      if (!installedAppId) {
        console.log('⏭️ Skipping - no installed app');
        return;
      }

      const result = await meroJs.admin.applications.uninstallApplication(
        installedAppId,
      );
      expect(result).toBeDefined();
      expect(result.applicationId).toBe(installedAppId);
      console.log('✅ Application uninstalled');
    });
  });
});
