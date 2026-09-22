/**
 * What the package root actually exposes.
 *
 * A symbol exported from a subdirectory's `index.ts` but not from here is
 * unreachable to anyone installing the package — the failure is invisible in
 * this repo, where every internal import goes by relative path, and only shows
 * up as a consumer unable to name a type that plainly exists. These assertions
 * are cheap and the omission is not.
 */
import { describe, expect, it } from 'vitest';

import {
  resolveRoot,
  resolveRootPair,
  signerFromSecret,
  type ResolvedRoot,
  type RootSource,
} from './index.js';

describe('the package root', () => {
  it('exposes root resolution, which cloud entry points take as a parameter', async () => {
    // `RootSource` is the declared type of every `root` argument in the cloud
    // API, so a consumer writing a wrapper around one could not name it.
    const source: RootSource = '07'.repeat(32);
    const resolved: ResolvedRoot = await resolveRoot(source);

    expect(resolved.accountId).toHaveLength(64);
    expect(resolved.publicKey).toBe((await signerFromSecret(source)).publicKey);

    const pair = await resolveRootPair(undefined, resolved.signer);
    expect(pair.accountId).toBe(resolved.accountId);
  });
});
