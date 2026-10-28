/**
 * What the package root actually exposes.
 *
 * A symbol exported from a subdirectory's `index.ts` but not from here is
 * unreachable to anyone installing the package. The names below are the ones
 * consumers import today (mdma's console loads the package at run time and
 * checks for `CalimeroClient`), so dropping one fails here, not in their build.
 */
import { describe, expect, it } from 'vitest';

import * as root from './index.js';

describe('the package root', () => {
  it('exposes the Calimero 1.0 client and what its callers name', () => {
    for (const name of [
      'CalimeroClient',
      'browserPasskey',
      'fetchAttestedKey',
      'claimedRelease',
      'MOCK_QUOTE_HEADER',
      'b64url',
      'fromB64url',
      'errorFrom',
      'CalimeroError',
      'LoginRequired',
      'NotFound',
      'ConfirmRequired',
      'ConfirmCancelled',
      'ArgsTooLarge',
      'IdempotencyMismatch',
      'AppError',
      'TrapError',
      'UnavailableError',
      'ORG_CAPABILITIES',
      'orgCapabilities',
      'createSealedFetch',
      'transportKeyBinding',
      'createQuoteVerifier',
      'createSignedReleaseVerifier',
      'trustSignedRelease',
    ]) {
      expect(root, name).toHaveProperty(name);
    }
    expect(typeof root.CalimeroClient).toBe('function');
  });

  it('no longer carries the v1 client', () => {
    for (const name of ['MeroJs', 'createMeroJs', 'AdminApiClient', 'AuthApiClient', 'RpcClient', 'SseClient', 'CloudClient']) {
      expect(root, name).not.toHaveProperty(name);
    }
  });
});
