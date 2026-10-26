/**
 * The check every cloud client runs before it sends anything: the node's quote
 * must be genuine (or, in development, an explicitly allowed mock), and its
 * report data must bind this nonce, the expected app and the transport key the
 * sealed channel will be opened to.
 *
 * Report data, as core's `calimero-cloud-client::attest` builds it:
 * `nonce(32) || SHA-256("calimero.tee-attest.transport-key.v1" | app_hash | transport_key)`.
 */

import { fromHex, hex } from '../crypto/internal.js';
import { transportKeyBinding, type VerifyTransportQuote } from '../sealed/sealed.js';

/** The mock quote format development clusters use. */
export const MOCK_QUOTE_HEADER = 'MOCK_TDX_QUOTE_V1';

export interface CloudPolicy {
  /** Accept mock quotes. Development clusters only. */
  allowMock?: boolean;
  /**
   * Verify a real TDX quote: typically `createQuoteVerifier` with the
   * Sigstore-verified release list. Required unless `allowMock` is set.
   */
  verifyQuote?: VerifyTransportQuote;
  /** The app bundle hash (hex) the quote must bind, when talking to one app. */
  appHash?: string;
}

export interface AttestationDoc {
  quote: string;
  transportKey: string;
  appHash: string;
  nonce: string;
  release: { version: string; profile: string };
  cluster: string;
  node: number;
  mock: boolean;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Fetch the node's attestation and return its transport key once it checks out. */
export async function fetchAttestedKey(
  baseUrl: string,
  policy: CloudPolicy,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<Uint8Array> {
  const nonce = hex(crypto.getRandomValues(new Uint8Array(32)));
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/attestation`);
  url.searchParams.set('nonce', nonce);
  if (policy.appHash) url.searchParams.set('appHash', policy.appHash);
  const response = await fetchImpl(url.toString());
  if (!response.ok) throw new Error(`The node refused to attest: HTTP ${response.status}`);
  const doc = (await response.json()) as AttestationDoc;
  const transportKey = fromHex(doc.transportKey, 'transportKey', 32);
  const inner = policy.appHash ? fromHex(policy.appHash, 'appHash', 32) : new Uint8Array(32);
  const suffix = await transportKeyBinding(inner, transportKey);
  const quote = base64ToBytes(doc.quote);
  const header = new TextEncoder().encode(MOCK_QUOTE_HEADER);
  if (equal(quote.slice(0, header.length), header)) {
    if (!policy.allowMock) {
      throw new Error('mock quote refused: this client only trusts real TEEs');
    }
    const report = quote.slice(header.length, header.length + 64);
    if (!equal(report.slice(0, 32), fromHex(nonce, 'nonce', 32)) || !equal(report.slice(32), suffix)) {
      throw new Error('the quote does not bind this transport key, app and nonce');
    }
    return transportKey;
  }
  if (!policy.verifyQuote) {
    throw new Error('no quote verifier configured; pass policy.verifyQuote');
  }
  const ok = await policy.verifyQuote({ quoteB64: doc.quote, nonce, reportDataSuffix: hex(suffix) });
  if (!ok) throw new Error('The attestation did not verify, so its transport key is not trusted');
  return transportKey;
}
