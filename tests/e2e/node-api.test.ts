import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MeroJs } from '@calimero-network/mero-js';
import { readFileSync } from 'fs';
import { join } from 'path';

// Test configuration
// When using --auth-service, use the auth service URL (Traefik proxy)
// The auth service URL routes to both auth and node endpoints
const NODE_CONFIG = {
  baseUrl: process.env.NODE_API_BASE_URL || 'http://localhost',
  credentials: {
    username: 'admin',
    password: 'admin123',
  },
  timeoutMs: 10000,
};

describe('Node API E2E Tests - Full Flow', () => {
  let meroJs: MeroJs;
  let installedAppId: string;
  let createdContextId: string;

  beforeAll(async () => {
    console.log('🚀 Starting merobox environment...');

    // Start merobox with auth service
    const { spawn } = await import('child_process');

    console.log('🔧 Starting Calimero node with auth service...');
    const meroboxProcess = spawn('merobox', ['run', '--auth-service'], {
      stdio: 'pipe',
      cwd: process.cwd(),
    });

    // Add error handling for merobox process
    meroboxProcess.on('error', (error) => {
      console.error('❌ Merobox process error:', error);
    });

    meroboxProcess.stderr.on('data', (data) => {
      console.error('❌ Merobox stderr:', data.toString());
    });

    meroboxProcess.stdout.on('data', (data) => {
      console.log('📝 Merobox stdout:', data.toString());
    });

    // Wait for services to be ready
    console.log('⏳ Waiting for services to start...');
    await new Promise((resolve) => setTimeout(resolve, 60000)); // Wait 60 seconds

    console.log('🔧 Creating MeroJs SDK...');
    console.log('Node API URL:', NODE_CONFIG.baseUrl);

    // Create MeroJs SDK instance
    meroJs = new MeroJs(NODE_CONFIG);

    // Authenticate (this creates the root key on first use)
    console.log('🔑 Authenticating with MeroJs SDK...');
    const tokenData = await meroJs.authenticate();

    console.log('✅ Authentication successful!');
    console.log('🎫 Token expires at:', new Date(tokenData.expires_at));
  }, 120000); // 2 minute timeout for beforeAll

  afterAll(async () => {
    console.log('🧹 Cleaning up merobox environment...');

    try {
      const { spawn } = await import('child_process');

      console.log('🗑️ Running merobox nuke --force...');
      const nukeProcess = spawn('merobox', ['nuke', '--force'], {
        stdio: 'inherit',
        cwd: process.cwd(),
      });

      // Wait for nuke to complete with timeout
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          console.warn('⚠️ Merobox cleanup timeout, killing process...');
          nukeProcess.kill('SIGTERM');
          resolve(void 0);
        }, 90000); // 90 second timeout

        nukeProcess.on('close', (code) => {
          clearTimeout(timeout);
          if (code === 0) {
            console.log('✅ Merobox cleanup completed successfully');
            resolve(void 0);
          } else {
            console.warn('⚠️ Merobox cleanup completed with code:', code);
            resolve(void 0); // Don't fail the test for cleanup issues
          }
        });
        nukeProcess.on('error', (error) => {
          clearTimeout(timeout);
          console.warn('⚠️ Merobox cleanup failed:', error);
          resolve(void 0); // Don't fail the test for cleanup issues
        });
      });
    } catch (error) {
      console.warn('⚠️ Merobox cleanup failed:', error);
    }

    console.log('🧹 Test cleanup completed');
  }, 120000); // 2 minute timeout for afterAll

  describe('Application Management Flow', () => {
    it('should get installed applications', async () => {
      console.log('📋 Getting installed applications...');

      const applicationsResponse = await meroJs.node.getInstalledApplications();
      console.log(
        '✅ Installed applications:',
        JSON.stringify(applicationsResponse, null, 2),
      );

      expect(applicationsResponse).toBeDefined();
      expect(applicationsResponse.apps).toBeDefined();
      expect(Array.isArray(applicationsResponse.apps)).toBe(true);

      // If there are apps, try to get details for the first one
      if (applicationsResponse.apps.length > 0) {
        const firstApp = applicationsResponse.apps[0];
        installedAppId = firstApp.id;
        console.log('🆔 Found application ID:', installedAppId);
      }
    });

    it('should get installed application details', async () => {
      console.log('🔍 Getting installed application details...');

      if (!installedAppId) {
        console.log(
          '⚠️ No installed application ID available, skipping application details',
        );
        return;
      }

      if (!installedAppId) {
        console.log(
          '⚠️ No installed application ID available, skipping application details',
        );
        return;
      }

      const appDetails = await meroJs.node.getInstalledApplicationDetails(
        installedAppId,
      );
      console.log(
        '✅ Application details:',
        JSON.stringify(appDetails, null, 2),
      );

      expect(appDetails).toBeDefined();
      // appDetails can be null if app doesn't exist
      if (appDetails) {
        expect(appDetails.id).toBe(installedAppId);
        expect(appDetails.blob).toBeDefined();
        expect(appDetails.source).toBeDefined();
      }
    });

    it('should install an application', async () => {
      console.log('📦 Installing application...');

      // Use a valid WASM file URL or file:// protocol
      // For testing, we'll use a file:// URL pointing to the test WASM file
      const wasmPath = join(process.cwd(), 'tests/e2e/assets/kv_store.wasm');
      const installResult = await meroJs.node.installApplication(
        `file://${wasmPath}`,
      );

      console.log(
        '✅ Application installed successfully:',
        JSON.stringify(installResult, null, 2),
      );

      expect(installResult).toBeDefined();
      expect(installResult.applicationId).toBeDefined();
      installedAppId = installResult.applicationId;

      console.log('🆔 Installed application ID:', installedAppId);
    });

    it('should install an application with metadata', async () => {
      console.log('📦 Installing application with metadata...');

      const wasmPath = join(process.cwd(), 'tests/e2e/assets/kv_store.wasm');
      const metadata = new Uint8Array(
        Buffer.from('Test application metadata'),
      );
      const installResult = await meroJs.node.installApplication(
        `file://${wasmPath}`,
        metadata,
      );

      console.log(
        '✅ Application installed with metadata:',
        JSON.stringify(installResult, null, 2),
      );

      expect(installResult).toBeDefined();
      expect(installResult.applicationId).toBeDefined();
      
      // Update installedAppId if we don't have one yet
      if (!installedAppId) {
        installedAppId = installResult.applicationId;
      }
    });
  });

  describe('Context Management Flow', () => {
    it('should get all contexts', async () => {
      console.log('📋 Getting all contexts...');

      const contextsResponse = await meroJs.node.getContexts();
      console.log(
        '✅ Contexts list:',
        JSON.stringify(contextsResponse, null, 2),
      );

      expect(contextsResponse).toBeDefined();
      expect(contextsResponse.contexts).toBeDefined();
      expect(Array.isArray(contextsResponse.contexts)).toBe(true);

      if (contextsResponse.contexts.length > 0) {
        const firstContext = contextsResponse.contexts[0];
        console.log('🆔 Found context:', firstContext.id);
      }
    });

    it('should create a context', async () => {
      console.log('🏗️ Creating context...');

      if (!installedAppId) {
        console.log(
          '⚠️ No installed application ID available, skipping context creation',
        );
        return;
      }

      const contextResult = await meroJs.node.createContext(
        installedAppId,
        JSON.stringify({ test: 'data' }),
        'near',
      );

      console.log(
        '✅ Context created successfully:',
        JSON.stringify(contextResult, null, 2),
      );

      expect(contextResult).toBeDefined();
      expect(contextResult.contextId).toBeDefined();
      expect(contextResult.memberPublicKey).toBeDefined();
      createdContextId = contextResult.contextId;

      console.log('🆔 Created context ID:', createdContextId);
    });

    it('should create a context with empty params', async () => {
      console.log('🏗️ Creating context with empty params...');

      if (!installedAppId) {
        console.log(
          '⚠️ No installed application ID available, skipping context creation',
        );
        return;
      }

      const contextResult = await meroJs.node.createContext(
        installedAppId,
        '',
        'near',
      );

      console.log(
        '✅ Context created with empty params:',
        JSON.stringify(contextResult, null, 2),
      );

      expect(contextResult).toBeDefined();
      expect(contextResult.contextId).toBeDefined();
      expect(contextResult.memberPublicKey).toBeDefined();

      if (!createdContextId) {
        createdContextId = contextResult.contextId;
      }
    });

    it('should get specific context', async () => {
      console.log('🔍 Getting specific context...');

      if (!createdContextId) {
        console.log(
          '⚠️ No created context ID available, skipping context details',
        );
        return;
      }

      const contextDetails = await meroJs.node.getContext(createdContextId);
      console.log(
        '✅ Context details:',
        JSON.stringify(contextDetails, null, 2),
      );

      expect(contextDetails).toBeDefined();
      expect(contextDetails.id).toBe(createdContextId);
      expect(contextDetails.applicationId).toBeDefined();
      expect(contextDetails.rootHash).toBeDefined();
    });

    it('should fetch context identities', async () => {
      console.log('🔍 Fetching context identities...');

      if (!createdContextId) {
        console.log(
          '⚠️ No created context ID available, skipping context identities',
        );
        return;
      }

      const identitiesResponse =
        await meroJs.node.fetchContextIdentities(createdContextId);
      console.log(
        '✅ Context identities:',
        JSON.stringify(identitiesResponse, null, 2),
      );

      expect(identitiesResponse).toBeDefined();
      expect(identitiesResponse.identities).toBeDefined();
      expect(Array.isArray(identitiesResponse.identities)).toBe(true);
    });
  });

  describe('Cleanup Flow', () => {
    it('should delete the created context', async () => {
      console.log('🗑️ Deleting created context...');

      if (!createdContextId) {
        console.log(
          '⚠️ No created context ID available, skipping context deletion',
        );
        return;
      }

      const deleteResult = await meroJs.node.deleteContext(createdContextId);
      console.log(
        '✅ Context deleted successfully:',
        JSON.stringify(deleteResult, null, 2),
      );

      expect(deleteResult).toBeDefined();
      expect(deleteResult.isDeleted).toBe(true);
    });

    it('should uninstall application', async () => {
      console.log('🗑️ Uninstalling application...');

      if (!installedAppId) {
        console.log(
          '⚠️ No installed application ID available, skipping application uninstall',
        );
        return;
      }

      const uninstallResult = await meroJs.node.uninstallApplication(
        installedAppId,
      );
      console.log(
        '✅ Application uninstalled successfully:',
        JSON.stringify(uninstallResult, null, 2),
      );

      expect(uninstallResult).toBeDefined();
      expect(uninstallResult.applicationId).toBe(installedAppId);
    });
  });
});
