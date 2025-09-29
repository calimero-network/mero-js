import { createMero } from '@mero/browser';

const out = document.getElementById('out');
if (!out) throw new Error('Output element not found');

const log = (m: string) => (out.textContent += `\n${m}`);

// Global mero instance
let mero: any = null;

// Initialize the Mero connection
async function initializeMero() {
  try {
    log('🌐 Connecting to Calimero node...');
    log('Node URL: http://node1.127.0.0.1.nip.io');

    mero = createMero({
      baseUrl: 'http://node1.127.0.0.1.nip.io',
      credentials: {
        username: 'admin',
        password: 'admin123',
      },
      timeoutMs: 10000,
    });

    log('✅ Mero instance created');

    // Debug: Check if the HTTP client has the correct base URL
    if (mero.config) {
      log('🔍 Debug: Mero config baseUrl: ' + mero.config.baseUrl);
    }

    // Test browser capabilities
    log('\n🔧 Browser Capabilities:');
    log('crypto.subtle: ' + (crypto?.subtle ? 'available ✅' : 'missing ❌'));
    log(
      'indexedDB: ' +
        (typeof indexedDB !== 'undefined' ? 'available ✅' : 'missing ❌')
    );
    log(
      'localStorage: ' +
        (typeof localStorage !== 'undefined' ? 'available ✅' : 'missing ❌')
    );

    // Test storage roundtrip
    log('\n💾 Storage Test:');
    try {
      if (mero.tokenStorage) {
        // Test token storage with proper interface
        const testToken = {
          access_token: 'test-token',
          refresh_token: 'test-refresh',
          expires_at: Date.now() + 3600000, // 1 hour
        };

        await mero.tokenStorage.setToken(testToken);
        const retrieved = await mero.tokenStorage.getToken();
        const success =
          retrieved && retrieved.access_token === testToken.access_token;
        log('storage roundtrip: ' + (success ? '✅' : '❌'));
        if (success) {
          log('  - Token stored and retrieved successfully');
        }

        // Clean up test token
        await mero.tokenStorage.clearToken();
      } else {
        log('storage: not available (using in-memory)');
      }
    } catch (storageError) {
      log('storage roundtrip: ❌ ' + String(storageError));
    }

    log(
      '\n🎉 Initialization complete! Use the buttons below to test API calls.'
    );
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    log('❌ Initialization error: ' + errorMessage);
    console.error(e);
  }
}

// Auth API Tests (replicating e2e/auth-api.test.ts)
async function testAuthHealth() {
  if (!mero) {
    log('❌ Mero not initialized. Click "Initialize" first.');
    return;
  }

  try {
    log('\n🏥 Testing Auth API Health...');
    log('🔍 Debug: Making request to: ' + mero.config.baseUrl + '/auth/health');
    const health = await mero.auth.getHealth();
    log('✅ Auth API health: ' + JSON.stringify(health, null, 2));
  } catch (error: any) {
    log('❌ Auth health test failed: ' + error.message);
    log('Error details: ' + JSON.stringify(error, null, 2));
  }
}

async function testAdminIdentity() {
  if (!mero) {
    log('❌ Mero not initialized. Click "Initialize" first.');
    return;
  }

  try {
    log('\n🪪 Testing Admin Identity...');
    // Ensure authenticated first
    await mero.authenticate();
    const identity = await mero.auth.getIdentity();
    log('✅ Admin identity: ' + JSON.stringify(identity, null, 2));
  } catch (error: any) {
    log('❌ Admin identity test failed: ' + error.message);
  }
}

async function testAuthProviders() {
  if (!mero) {
    log('❌ Mero not initialized. Click "Initialize" first.');
    return;
  }

  try {
    log('\n🔌 Testing Auth API Providers...');
    const providers = await mero.auth.getProviders();
    log('✅ Available providers: ' + JSON.stringify(providers, null, 2));
  } catch (error: any) {
    log('❌ Auth providers test failed: ' + error.message);
  }
}

async function testAuthLogin() {
  if (!mero) {
    log('❌ Mero not initialized. Click "Initialize" first.');
    return;
  }

  try {
    log('\n🔑 Testing Auth Login...');
    const tokenData = await mero.authenticate();
    log('✅ Authentication successful!');
    log('🎫 Token expires at: ' + new Date(tokenData.expires_at));
    log('🔍 Token data: ' + JSON.stringify(tokenData, null, 2));
  } catch (error: any) {
    log('❌ Auth login test failed: ' + error.message);
  }
}

// Admin API Tests (replicating e2e/admin-api.test.ts)
async function testAdminApplications() {
  if (!mero) {
    log('❌ Mero not initialized. Click "Initialize" first.');
    return;
  }

  try {
    log('\n📋 Testing Admin API - List Applications...');
    const applications = await mero.admin.listApplications();
    log('✅ Applications: ' + JSON.stringify(applications, null, 2));
  } catch (error: any) {
    log('❌ Admin applications test failed: ' + error.message);
  }
}

async function testAdminContexts() {
  if (!mero) {
    log('❌ Mero not initialized. Click "Initialize" first.');
    return;
  }

  try {
    log('\n📝 Testing Admin API - List Contexts...');
    const contexts = await mero.admin.getContexts();
    log('✅ Contexts: ' + JSON.stringify(contexts, null, 2));
  } catch (error: any) {
    log('❌ Admin contexts test failed: ' + error.message);
  }
}

// Application Management Tests
async function testInstallApplication() {
  if (!mero) {
    log('❌ Mero not initialized. Click "Reinitialize Mero" first.');
    return;
  }

  try {
    log('\n📦 Testing Admin API - Install Application...');
    log(
      '🔍 Debug: Making request to: ' +
        mero.config.baseUrl +
        '/admin-api/install-application'
    );

    // First authenticate to get the token
    log('🔑 Authenticating first...');
    await mero.authenticate();
    log('✅ Authentication successful');

    // Debug: Check if token is available
    const tokenData = await mero.getTokenData();
    log('🔍 Debug: Token available: ' + (tokenData ? 'Yes' : 'No'));
    if (tokenData) {
      log(
        '🔍 Debug: Token expires at: ' +
          new Date(tokenData.expires_at).toLocaleString()
      );
    }

    // Try to install a test application
    const installRequest = {
      url: 'https://example.com/test-app',
      metadata: btoa(JSON.stringify({ name: 'Test App', version: '1.0.0' })),
    };

    const result = await mero.admin.installApplication(installRequest);
    log('✅ Application installed: ' + JSON.stringify(result, null, 2));
  } catch (error: any) {
    log('❌ Install application test failed: ' + error.message);
    log('Error details: ' + JSON.stringify(error, null, 2));
  }
}

async function testInstallDevApplication() {
  if (!mero) {
    log('❌ Mero not initialized. Click "Reinitialize Mero" first.');
    return;
  }

  try {
    log('\n📦 Testing Admin API - Install Dev Application...');
    log(
      '🔍 Debug: Making request to: ' +
        mero.config.baseUrl +
        '/admin-api/install-dev-application'
    );

    // First authenticate to get the token
    log('🔑 Authenticating first...');
    await mero.authenticate();
    log('✅ Authentication successful');

    // Try to install a dev application
    const installRequest = {
      path: '/tmp/test-app',
      metadata: btoa(JSON.stringify({ name: 'Dev App', version: '1.0.0' })),
    };

    const result = await mero.admin.installDevApplication(installRequest);
    log('✅ Dev application installed: ' + JSON.stringify(result, null, 2));
  } catch (error: any) {
    log('❌ Install dev application test failed: ' + error.message);
    log('Error details: ' + JSON.stringify(error, null, 2));
  }
}

async function uploadWasmFile() {
  if (!mero) {
    log('❌ Mero not initialized. Click "Reinitialize Mero" first.');
    return;
  }

  // Create file input element
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.wasm';
  fileInput.style.display = 'none';
  document.body.appendChild(fileInput);

  fileInput.onchange = async event => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) {
      log('❌ No file selected');
      return;
    }

    try {
      log('\n📦 Uploading WASM file: ' + file.name);
      log(
        '🔍 Debug: Making request to: ' +
          mero.config.baseUrl +
          '/admin-api/blobs'
      );

      // First authenticate to get the token
      log('🔑 Authenticating first...');
      await mero.authenticate();
      log('✅ Authentication successful');

      // Read file as base64
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64Data = (reader.result as string).split(',')[1]; // Remove data:application/octet-stream;base64, prefix

          const uploadRequest = {
            data: base64Data,
            metadata: { filename: file.name, size: file.size },
          };

          const result = await mero.admin.uploadBlob(uploadRequest);
          log('✅ WASM file uploaded: ' + JSON.stringify(result, null, 2));
        } catch (error: any) {
          log('❌ WASM upload failed: ' + error.message);
          log('Error details: ' + JSON.stringify(error, null, 2));
        }
      };
      reader.readAsDataURL(file);
    } catch (error: any) {
      log('❌ WASM upload failed: ' + error.message);
      log('Error details: ' + JSON.stringify(error, null, 2));
    } finally {
      document.body.removeChild(fileInput);
    }
  };

  fileInput.click();
}

async function testCreateContext() {
  if (!mero) {
    log('❌ Mero not initialized. Click "Reinitialize Mero" first.');
    return;
  }

  try {
    log('\n📝 Testing Admin API - Create Context...');
    log(
      '🔍 Debug: Making request to: ' +
        mero.config.baseUrl +
        '/admin-api/contexts'
    );

    // First authenticate to get the token
    log('🔑 Authenticating first...');
    await mero.authenticate();
    log('✅ Authentication successful');

    // Try to create a test context
    const createRequest = {
      name: 'Test Context',
      description: 'A test context created via API',
      metadata: { test: true },
    };

    const result = await mero.admin.createContext(createRequest);
    log('✅ Context created: ' + JSON.stringify(result, null, 2));
  } catch (error: any) {
    log('❌ Create context test failed: ' + error.message);
    log('Error details: ' + JSON.stringify(error, null, 2));
  }
}

async function testGenerateIdentity() {
  if (!mero) {
    log('❌ Mero not initialized. Click "Reinitialize Mero" first.');
    return;
  }

  try {
    log('\n🔐 Testing Admin API - Generate Context Identity...');
    log(
      '🔍 Debug: Making request to: ' +
        mero.config.baseUrl +
        '/admin-api/identity/context'
    );

    // First authenticate to get the token
    log('🔑 Authenticating first...');
    await mero.authenticate();
    log('✅ Authentication successful');

    // Try to generate a context identity
    const result = await mero.admin.generateContextIdentity({});
    log('✅ Identity generated: ' + JSON.stringify(result, null, 2));
  } catch (error: any) {
    log('❌ Generate identity test failed: ' + error.message);
    log('Error details: ' + JSON.stringify(error, null, 2));
  }
}

// Additional Admin API Tests
async function testAdminBlobs() {
  if (!mero) {
    log('❌ Mero not initialized. Click "Reinitialize Mero" first.');
    return;
  }

  try {
    log('\n📦 Testing Admin API - List Blobs...');
    log(
      '🔍 Debug: Making request to: ' + mero.config.baseUrl + '/admin-api/blobs'
    );

    // First authenticate to get the token
    log('🔑 Authenticating first...');
    await mero.authenticate();
    log('✅ Authentication successful');

    const blobs = await mero.admin.listBlobs();
    log('✅ Blobs: ' + JSON.stringify(blobs, null, 2));
  } catch (error: any) {
    log('❌ Admin blobs test failed: ' + error.message);
    log('Error details: ' + JSON.stringify(error, null, 2));
  }
}

async function testAdminContextAliases() {
  if (!mero) {
    log('❌ Mero not initialized. Click "Reinitialize Mero" first.');
    return;
  }

  try {
    log('\n🔗 Testing Admin API - List Context Aliases...');
    log(
      '🔍 Debug: Making request to: ' +
        mero.config.baseUrl +
        '/admin-api/alias/list/context'
    );

    // First authenticate to get the token
    log('🔑 Authenticating first...');
    await mero.authenticate();
    log('✅ Authentication successful');

    const aliases = await mero.admin.listContextAliases();
    log('✅ Context Aliases: ' + JSON.stringify(aliases, null, 2));
  } catch (error: any) {
    log('❌ Admin context aliases test failed: ' + error.message);
    log('Error details: ' + JSON.stringify(error, null, 2));
  }
}

async function testAdminApplicationAliases() {
  if (!mero) {
    log('❌ Mero not initialized. Click "Reinitialize Mero" first.');
    return;
  }

  try {
    log('\n🔗 Testing Admin API - List Application Aliases...');
    log(
      '🔍 Debug: Making request to: ' +
        mero.config.baseUrl +
        '/admin-api/alias/list/application'
    );

    // First authenticate to get the token
    log('🔑 Authenticating first...');
    await mero.authenticate();
    log('✅ Authentication successful');

    const aliases = await mero.admin.listApplicationAliases();
    log('✅ Application Aliases: ' + JSON.stringify(aliases, null, 2));
  } catch (error: any) {
    log('❌ Admin application aliases test failed: ' + error.message);
    log('Error details: ' + JSON.stringify(error, null, 2));
  }
}

async function testAdminPeers() {
  if (!mero) {
    log('❌ Mero not initialized. Click "Reinitialize Mero" first.');
    return;
  }

  try {
    log('\n🌐 Testing Admin API - Get Peers Count...');
    log(
      '🔍 Debug: Making request to: ' + mero.config.baseUrl + '/admin-api/peers'
    );

    // First authenticate to get the token
    log('🔑 Authenticating first...');
    await mero.authenticate();
    log('✅ Authentication successful');

    const peers = await mero.admin.getPeersCount();
    log('✅ Peers count: ' + JSON.stringify(peers, null, 2));
  } catch (error: any) {
    log('❌ Admin peers test failed: ' + error.message);
    log('Error details: ' + JSON.stringify(error, null, 2));
  }
}

async function testAdminCertificate() {
  if (!mero) {
    log('❌ Mero not initialized. Click "Reinitialize Mero" first.');
    return;
  }

  try {
    log('\n🔐 Testing Admin API - Get Certificate...');
    log(
      '🔍 Debug: Making request to: ' +
        mero.config.baseUrl +
        '/admin-api/certificate'
    );

    // First authenticate to get the token
    log('🔑 Authenticating first...');
    await mero.authenticate();
    log('✅ Authentication successful');

    const certificate = await mero.admin.getCertificate();
    log('✅ Certificate: ' + JSON.stringify(certificate, null, 2));
  } catch (error: any) {
    log('❌ Admin certificate test failed: ' + error.message);
    log('Error details: ' + JSON.stringify(error, null, 2));
  }
}

// Make functions available globally
(window as any).initializeMero = initializeMero;
(window as any).testAuthHealth = testAuthHealth;
(window as any).authenticateNow = testAuthLogin;
(window as any).testAuthProviders = testAuthProviders;
(window as any).testAuthLogin = testAuthLogin;
(window as any).testAdminApplications = testAdminApplications;
(window as any).testAdminContexts = testAdminContexts;
(window as any).testAdminIdentity = testAdminIdentity;
(window as any).testInstallApplication = testInstallApplication;
(window as any).testInstallDevApplication = testInstallDevApplication;
(window as any).uploadWasmFile = uploadWasmFile;
(window as any).testCreateContext = testCreateContext;
(window as any).testGenerateIdentity = testGenerateIdentity;
(window as any).testAdminBlobs = testAdminBlobs;
(window as any).testAdminContextAliases = testAdminContextAliases;
(window as any).testAdminApplicationAliases = testAdminApplicationAliases;
(window as any).testAdminPeers = testAdminPeers;
(window as any).testAdminCertificate = testAdminCertificate;

// Initialize on load
initializeMero();
