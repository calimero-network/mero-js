// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { markContextNonceSpent, persistedNonces } from './session.js';

const RELAY = 'http://127.0.0.1:4480';
const GENERAL = '26217ce9e5d86264bd1194c9d880666caf4312619fa35c0463ecbadcc98e1c7b';
const LOUNGE = 'cd785b7f164dabffc79882d3f307ed71b64644c481644042731578b6032b169e';

beforeEach(() => localStorage.clear());

describe('persistedNonces', () => {
  it('draws one rising sequence however many clients the page builds', async () => {
    // A client is rebuilt whenever the chosen context changes, and every one of
    // them calls `execute` for any context. Two counters would hand the same
    // (context, device) ledger two sequences, and the lower one is a replay.
    const a = persistedNonces(RELAY);
    const b = persistedNonces(RELAY);
    const drawn = [await a.next(), await b.next(), await a.next(), await b.next()];
    expect(drawn).toEqual([...drawn].sort((x, y) => (x < y ? -1 : 1)));
    expect(new Set(drawn).size).toBe(4);
  });

  it('resumes above every counter an earlier build kept per context', async () => {
    localStorage.setItem(`calimero.nonce.${RELAY}.no-context`, '1770');
    localStorage.setItem(`calimero.nonce.${RELAY}.${LOUNGE}`, '466');
    localStorage.setItem('calimero.nonce.http://other-relay.no-context', '9000');
    expect(await persistedNonces(RELAY).next()).toBeGreaterThanOrEqual(1770n);
  });

  it('starts above a creation nonce spent in a new context', async () => {
    markContextNonceSpent(RELAY, GENERAL, 5000n);
    expect(await persistedNonces(RELAY).next()).toBeGreaterThan(5000n);
  });

  it('keeps relays apart', async () => {
    localStorage.setItem('calimero.nonce.http://other-relay.no-context', '9000');
    expect(await persistedNonces(RELAY).next()).toBeLessThan(9000n);
  });
});
