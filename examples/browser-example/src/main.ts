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
      const key = 'mero-test-key';
      const testData = new Uint8Array([1, 2, 3, 4, 5]);

      if (mero.tokenStorage) {
        await mero.tokenStorage.set(key, testData);
        const retrieved = await mero.tokenStorage.get(key);
        const success = retrieved && retrieved.length === testData.length;
        log('storage roundtrip: ' + (success ? '✅' : '❌'));
        if (success) {
          log('  - Data length: ' + retrieved.length + ' bytes');
        }
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
    const health = await mero.auth.getHealth();
    log('✅ Auth API health: ' + JSON.stringify(health, null, 2));
  } catch (error: any) {
    log('❌ Auth health test failed: ' + error.message);
  }
}

async function testAuthIdentity() {
  if (!mero) {
    log('❌ Mero not initialized. Click "Initialize" first.');
    return;
  }

  try {
    log('\n🔍 Testing Auth API Identity...');
    const identity = await mero.auth.getIdentity();
    log('✅ Service identity: ' + JSON.stringify(identity, null, 2));
  } catch (error: any) {
    log('❌ Auth identity test failed: ' + error.message);
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
(window as any).testAuthIdentity = testAuthIdentity;
(window as any).testAuthProviders = testAuthProviders;
(window as any).testAuthLogin = testAuthLogin;
(window as any).testAdminApplications = testAdminApplications;
(window as any).testAdminContexts = testAdminContexts;

// Initialize on load
initializeMero();
