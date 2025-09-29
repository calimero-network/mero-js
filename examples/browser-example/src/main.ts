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

// Make functions available globally
(window as any).initializeMero = initializeMero;
(window as any).testAuthHealth = testAuthHealth;
(window as any).authenticateNow = testAuthLogin;
(window as any).testAuthProviders = testAuthProviders;
(window as any).testAuthLogin = testAuthLogin;
(window as any).testAdminApplications = testAdminApplications;
(window as any).testAdminContexts = testAdminContexts;
(window as any).testAdminIdentity = testAdminIdentity;

// Initialize on load
initializeMero();
