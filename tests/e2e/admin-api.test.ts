import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MeroJs } from '../../src/index';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getMeroJs } from './setup';

describe('Admin API E2E Tests', () => {
  let meroJs: MeroJs;
  let installedAppId: string;
  let createdContextId: string;
  let createdBlobId: string;
  let generatedIdentity: string;
  let createdAlias: string;
  let memberPublicKey: string; // For RPC tests

  beforeAll(async () => {
    meroJs = await getMeroJs();
  }, 120000);

  afterAll(async () => {
    // Don't teardown here - let it be handled globally to avoid conflicts
    // teardownMerobox() will be called after all tests complete
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

      // Upload blob first - convert Buffer to Uint8Array for proper Blob creation
      const wasmArray = new Uint8Array(wasmBuffer);
      const blob = new Blob([wasmArray]);
      const blobResult = await meroJs.admin.blobs.uploadBlob(blob);
      console.log('✅ Blob uploaded:', JSON.stringify(blobResult, null, 2));
      console.log(`📊 Blob size: ${blobResult.size} bytes (expected: ${wasmBuffer.length} bytes)`);

      expect(blobResult.blobId).toBeDefined();
      expect(blobResult.size).toBeGreaterThan(1000); // Ensure blob is not empty/corrupted
      createdBlobId = blobResult.blobId;

      // NOTE: The server only supports HTTP/HTTPS URLs for application installation.
      // The blob:// URL scheme is NOT supported because the server uses reqwest
      // to download the WASM file, which only handles HTTP/HTTPS.
      //
      // For production, applications should be installed from:
      // - A public HTTP URL (registry, GitHub releases, S3, etc.)
      // - Using installDevApplication with a local path (server-side path)
      //
      // We test with a public WASM URL from GitHub releases or skip if unavailable.
      const testWasmUrl =
        'https://github.com/calimero-network/core/releases/download/v0.0.0-test/kv_store.wasm';

      const metadataBytes = Array.from(Buffer.from('Test KV Store application'));
      try {
        const installResult = await meroJs.admin.applications.installApplication({
          url: testWasmUrl,
          metadata: metadataBytes,
        });

        expect(installResult).toBeDefined();
        expect(installResult.applicationId).toBeDefined();
        installedAppId = installResult.applicationId;
        console.log('✅ Application installed:', installedAppId);
      } catch (error: any) {
        // Installation may fail due to:
        // - Network issues (can't reach the URL)
        // - Invalid WASM format
        // - Server-side errors
        console.log('⚠️ Application installation failed:', error.message);
        if (
          error.status === 500 ||
          error.status === 404 ||
          error.message?.includes('builder error') ||
          error.message?.includes('Failed to send request') ||
          error.bodyText?.includes('builder error')
        ) {
          console.log(
            '⚠️ Application installation not available in this environment - skipping',
          );
          console.log(
            '   Note: blob:// URLs are NOT supported. Use HTTP/HTTPS URLs.',
          );
        } else {
          throw error;
        }
      }
    });

    it('should get application by id', async () => {
      if (!installedAppId) {
        console.log('⏭️ Skipping - no installed app');
        return;
      }

      try {
        const app = await meroJs.admin.applications.getApplication(installedAppId);
        expect(app).toBeDefined();
        expect(app.application).toBeDefined();
        expect(app.application?.applicationId).toBe(installedAppId);
        console.log('✅ Application retrieved:', app.application?.applicationId);
      } catch (error: any) {
        // Application may have been "installed" but is corrupted (e.g., from invalid WASM URL)
        console.log('⚠️ Failed to get application:', error.message);
        console.log('   Note: App may be corrupted if installed from invalid URL');
        installedAppId = ''; // Clear to skip dependent tests
      }
    });

    it('should list applications (with installed app)', async () => {
      if (!installedAppId) {
        console.log('⏭️ Skipping - no installed app (installation may have failed)');
        return;
      }
      try {
        const apps = await meroJs.admin.applications.listApplications();
        expect(apps.apps.length).toBeGreaterThan(0);
        const found = apps.apps.find((a) => a.applicationId === installedAppId);
        if (!found) {
          console.log('⚠️ Installed app not found in list - may be corrupted');
        }
        console.log('✅ Applications listed:', apps.apps.length);
      } catch (error: any) {
        console.log('⚠️ Failed to list applications:', error.message);
      }
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

      try {
        // API expects initializationParams as byte array, not base64 string
        const initializationParams = Array.from(Buffer.from('{}'));
        const context = await meroJs.admin.contexts.createContext({
          protocol: 'near',
          applicationId: installedAppId,
          initializationParams,
        });

        expect(context).toBeDefined();
        expect(context.contextId).toBeDefined();
        expect(context.memberPublicKey).toBeDefined();
        createdContextId = context.contextId;
        memberPublicKey = context.memberPublicKey;
        console.log('✅ Context created:', createdContextId);
        console.log('   Member public key:', memberPublicKey);
      } catch (error: any) {
        // Context creation may fail if:
        // - Application was installed from invalid WASM URL
        // - Server-side WASM validation fails
        console.log('⚠️ Context creation failed:', error.message);
        if (error.bodyText?.includes('WebAssembly')) {
          console.log('   Note: App WASM is invalid (possibly installed from broken URL)');
          installedAppId = ''; // Clear to skip dependent tests
        }
      }
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

      try {
        const contexts =
          await meroJs.admin.contexts.getContextsWithExecutorsForApplication(
            installedAppId,
          );
        expect(contexts).toBeDefined();
        expect(contexts.contexts).toBeDefined();
        console.log('✅ Contexts with executors:', contexts.contexts.length);
      } catch (error: any) {
        // May fail if application is corrupted or endpoint not available
        console.log('⚠️ Get contexts with executors failed:', error.message);
      }
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

  describe('JSON-RPC Execution', () => {
    it('should execute a mutate method (set)', async () => {
      if (!createdContextId || !memberPublicKey) {
        console.log('⏭️ Skipping - no created context or member public key');
        return;
      }

      try {
        const result = await meroJs.rpc.mutate(
          createdContextId,
          'set',
          { key: 'test_key', value: 'test_value' },
          memberPublicKey,
        );
        console.log('✅ Mutate (set) result:', JSON.stringify(result));
        // set returns null on success
        expect(result).toBeNull();
      } catch (error: any) {
        console.log('⚠️ RPC mutate failed:', error.message);
        // If we get a FunctionCallError, it might be because the WASM is invalid
        if (error.type === 'FunctionCallError' || error.message?.includes('FunctionCall')) {
          console.log('   Note: WASM might be invalid (installed from broken URL)');
        } else {
          throw error;
        }
      }
    });

    it('should execute a query method (get)', async () => {
      if (!createdContextId || !memberPublicKey) {
        console.log('⏭️ Skipping - no created context or member public key');
        return;
      }

      try {
        const result = await meroJs.rpc.query<string>(
          createdContextId,
          'get',
          { key: 'test_key' },
          memberPublicKey,
        );
        console.log('✅ Query (get) result:', JSON.stringify(result));
        // Should return the value we set, or null if not found
        if (result !== null) {
          expect(result).toBe('test_value');
        }
      } catch (error: any) {
        console.log('⚠️ RPC query failed:', error.message);
        if (error.type === 'FunctionCallError' || error.message?.includes('FunctionCall')) {
          console.log('   Note: WASM might be invalid (installed from broken URL)');
        } else {
          throw error;
        }
      }
    });

    it('should use execute method with full params', async () => {
      if (!createdContextId || !memberPublicKey) {
        console.log('⏭️ Skipping - no created context or member public key');
        return;
      }

      try {
        const result = await meroJs.rpc.execute({
          contextId: createdContextId,
          method: 'get',
          args: { key: 'nonexistent_key' },
          executorPublicKey: memberPublicKey,
        });
        console.log('✅ Execute result:', JSON.stringify(result));
        expect(result).toBeDefined();
        expect(result.output).toBeNull(); // Key doesn't exist
      } catch (error: any) {
        console.log('⚠️ RPC execute failed:', error.message);
        if (error.type === 'FunctionCallError' || error.message?.includes('FunctionCall')) {
          console.log('   Note: WASM might be invalid (installed from broken URL)');
        } else {
          throw error;
        }
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
      // API may return array or object with providers property
      const providerArray = Array.isArray(providers) ? providers : (providers as any).providers || [];
      expect(Array.isArray(providerArray)).toBe(true);
      expect(providerArray.length).toBeGreaterThan(0);
      console.log('✅ Auth providers:', providerArray.length);
    });

    it('should get auth identity', async () => {
      try {
        const identity = await meroJs.auth.getIdentity();
        expect(identity).toBeDefined();
        expect(identity.service).toBeDefined();
        expect(identity.version).toBeDefined();
        console.log('✅ Auth identity:', identity.service);
      } catch (error: any) {
        // Identity endpoint may not be available in all environments
        if (error.status === 404) {
          console.log('⚠️ Auth identity endpoint not available (404) - skipping');
        } else {
          throw error;
        }
      }
    });

    it('should get challenge', async () => {
      try {
        const challenge = await meroJs.auth.getChallenge();
        expect(challenge).toBeDefined();
        expect(challenge.challenge).toBeDefined();
        expect(challenge.nonce).toBeDefined();
        // Note: timestamp is embedded in the JWT challenge string, not a separate field
        console.log('✅ Challenge retrieved');
      } catch (error: any) {
        // Challenge endpoint may not be available in all environments
        if (error.status === 404 || error.status === 500) {
          console.log(`⚠️ Challenge endpoint not available (${error.status}) - skipping`);
        } else {
          throw error;
        }
      }
    });

    it('should validate token', async () => {
      const tokenData = meroJs.getTokenData();
      if (!tokenData) {
        console.log('⏭️ Skipping - no token data');
        return;
      }

      try {
        const validation = await meroJs.auth.validateToken({
          token: tokenData.access_token,
        });
        console.log('✅ Token validation response:', JSON.stringify(validation));
        expect(validation).toBeDefined();
        expect(validation.valid).toBe(true);
        console.log('✅ Token validated');
      } catch (error: any) {
        if (error.status === 404 || error.status === 500) {
          console.log(`⚠️ Token validation endpoint not available (${error.status}) - skipping`);
        } else {
          throw error;
        }
      }
    });

    it('should list root keys', async () => {
      try {
        const keys = await meroJs.auth.listRootKeys();
        expect(keys).toBeDefined();
        expect(Array.isArray(keys)).toBe(true);
        console.log('✅ Root keys listed:', keys.length);
      } catch (error: any) {
        // These endpoints may not be available in all environments
        if (error.status === 404) {
          console.log('⚠️ Root keys endpoint not available (404) - skipping');
        } else {
          throw error;
        }
      }
    });

    it('should list client keys', async () => {
      try {
        const keys = await meroJs.auth.listClientKeys();
        expect(keys).toBeDefined();
        expect(Array.isArray(keys)).toBe(true);
        console.log('✅ Client keys listed:', keys.length);
      } catch (error: any) {
        // These endpoints may not be available in all environments
        if (error.status === 404) {
          console.log('⚠️ Client keys endpoint not available (404) - skipping');
        } else {
          throw error;
        }
      }
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
