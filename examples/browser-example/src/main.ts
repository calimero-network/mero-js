import { createMero } from '@mero/browser';

const out = document.getElementById('out');
if (!out) throw new Error('Output element not found');

const log = (m: string) => (out.textContent += `\n${m}`);

(async () => {
  out.textContent = '';
  try {
    const mero = createMero({
      baseUrl: 'https://api.example.com',
      credentials: {
        username: 'demo',
        password: 'demo123',
      },
      timeoutMs: 10000,
    });
    log('created mero ✅');

    // Test WebCrypto availability
    log('crypto.subtle: ' + (crypto?.subtle ? 'available ✅' : 'missing ❌'));

    // Test IndexedDB availability
    log(
      'indexedDB: ' +
        (typeof indexedDB !== 'undefined' ? 'available ✅' : 'missing ❌')
    );

    // Test storage roundtrip (if storage is available)
    try {
      const key = 'test-key';
      const testData = new Uint8Array([1, 2, 3, 4]);

      // Try to use the token storage from mero
      if (mero.tokenStorage) {
        await mero.tokenStorage.set(key, testData);
        const retrieved = await mero.tokenStorage.get(key);
        log(
          'storage roundtrip: ' +
            (retrieved && retrieved.length === testData.length ? '✅' : '❌')
        );
      } else {
        log('storage: not available (using in-memory)');
      }
    } catch (storageError) {
      log('storage roundtrip: ❌ ' + String(storageError));
    }

    // Test API clients
    log('auth client: ' + (mero.auth ? 'available ✅' : 'missing ❌'));
    log('admin client: ' + (mero.admin ? 'available ✅' : 'missing ❌'));
    log('config: ' + JSON.stringify(mero.config, null, 2));
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    log('error ❌ ' + errorMessage);
    console.error(e);
  }
})();
