import { describe, it, expect, vi } from 'vitest';
import { applicationIdForBundle, resolveApplicationIdFromRegistry, selectLatestBundle } from './application-id.js';

const KV_SIGNER = 'did:key:z6MkoWkrrFjwC4FXQfyGwwcgTPvRoJZenMEVm9Z332bdkz6B';
// What merod computed when installing kv-store 0.0.41 AND 0.0.54 on prod: the
// same id for two versions, from the same package and publisher.
const KV_ID = 'e810e86f443e8c1feb98bb83a266246478a34c75397a66a78bd5a790c6d72d0d';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('applicationIdForBundle — sha256(borsh((package, signerId))), as core computes it', () => {
  it('reproduces the id merod computed for kv-store on prod', async () => {
    await expect(applicationIdForBundle('com.calimero.kv-store', KV_SIGNER)).resolves.toBe(KV_ID);
  });

  it('encodes string lengths as UTF-8 byte counts, not character counts', async () => {
    // "café" is 17 characters and 18 bytes; a char-count prefix would hash differently.
    await expect(applicationIdForBundle('com.calimero.café', 'did:key:z6MkExample')).resolves.toBe(
      'cf9b180c7952ef0aa41fe73e9cb7ac2b4b19917099341e295534aa4a50861bd5',
    );
  });

  it('is version-stable: the version is not an input', async () => {
    const a = await applicationIdForBundle('com.calimero.kv-store', KV_SIGNER);
    const b = await applicationIdForBundle('com.calimero.kv-store', KV_SIGNER);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('selectLatestBundle — the one selection rule', () => {
  it('picks the highest non-yanked version', () => {
    const picked = selectLatestBundle([
      { appVersion: '0.0.54', yanked: true },
      { appVersion: '0.0.41' },
      { appVersion: '0.0.9' },
    ]);
    expect(picked?.appVersion).toBe('0.0.41');
  });

  it('returns undefined when nothing is listed or everything is yanked', () => {
    expect(selectLatestBundle([])).toBeUndefined();
    expect(selectLatestBundle([{ appVersion: '1.0.0', yanked: true }])).toBeUndefined();
  });
});

describe('resolveApplicationIdFromRegistry', () => {
  it('derives the id from the newest non-yanked entry', async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL) =>
      json([
        { package: 'com.calimero.kv-store', signerId: KV_SIGNER, appVersion: '0.0.41', yanked: false },
        { package: 'com.calimero.kv-store', signerId: KV_SIGNER, appVersion: '0.0.54', yanked: false },
      ]),
    );
    await expect(
      resolveApplicationIdFromRegistry('https://apps.calimero.network/', 'com.calimero.kv-store', { fetch: fetchFn }),
    ).resolves.toEqual({ applicationId: KV_ID, signerId: KV_SIGNER, version: '0.0.54' });
    expect(fetchFn.mock.calls[0][0]).toBe('https://apps.calimero.network/api/v2/bundles?package=com.calimero.kv-store');
  });

  it('refuses when non-yanked versions disagree on the publisher', async () => {
    const fetchFn = vi.fn(async () =>
      json([
        { package: 'com.calimero.kv-store', signerId: KV_SIGNER, appVersion: '0.0.41' },
        { package: 'com.calimero.kv-store', signerId: 'did:key:z6MkSomeoneElse', appVersion: '0.0.54' },
      ]),
    );
    await expect(
      resolveApplicationIdFromRegistry('https://apps.calimero.network', 'com.calimero.kv-store', { fetch: fetchFn }),
    ).rejects.toThrow(/more than one publisher/);
  });

  it('ignores a yanked entry from another publisher', async () => {
    const fetchFn = vi.fn(async () =>
      json([
        { package: 'com.calimero.kv-store', signerId: KV_SIGNER, appVersion: '0.0.41' },
        { package: 'com.calimero.kv-store', signerId: 'did:key:z6MkSomeoneElse', appVersion: '0.0.54', yanked: true },
      ]),
    );
    await expect(
      resolveApplicationIdFromRegistry('https://apps.calimero.network', 'com.calimero.kv-store', { fetch: fetchFn }),
    ).resolves.toMatchObject({ applicationId: KV_ID, version: '0.0.41' });
  });

  it('fails clearly on a registry error or an entry without a signer', async () => {
    await expect(
      resolveApplicationIdFromRegistry('https://r', 'com.x', { fetch: vi.fn(async () => json({}, 500)) }),
    ).rejects.toThrow(/HTTP 500/);
    await expect(
      resolveApplicationIdFromRegistry('https://r', 'com.x', { fetch: vi.fn(async () => json([{ appVersion: '1.0.0' }])) }),
    ).rejects.toThrow(/no publisher/);
  });
});
