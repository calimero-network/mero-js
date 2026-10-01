/**
 * Learn a relay's node signing key from its TEE attestation.
 *
 * `login()` binds a session to the node key the client names, and that key must
 * never be taken from the node being logged in to on its word — the answering
 * party would choose what the device signs about. A TEE quote is different: the
 * node cannot put a key into it that the TEE did not bind. With `bindNodeKey`,
 * core commits the node's signing key into the quote's report data:
 *
 *   report_data = nonce (32)  ‖  SHA-256("calimero.tee-attest.key-binding.v1" ‖ 0^32 ‖ key)
 *
 * (the 32 zero bytes stand for "no application", core's `attest_key_binding`).
 * So the client sends a fresh nonce, reads the report data out of the RAW quote
 * bytes — never the server's parsed rendering of them — and accepts the returned
 * key only if both halves match.
 *
 * That proves the key came from whatever produced the quote. Whether that is a
 * genuine TDX guest running a trusted image is the quote's signature and
 * measurements, which this module does not judge: a real quote needs a
 * `verifyQuote` supplied by the caller, and a mock quote (a dev-only format with
 * no signature at all) is refused unless `allowMock` is set.
 */
import type { VerifyTransportQuote } from '../sealed/sealed.js';
import type { DcapCollateral } from '../sealed/verify.js';
import { hex } from '../crypto/internal.js';

/** Core's `ATTEST_KEY_BINDING_DOMAIN`. */
const KEY_BINDING_DOMAIN = new TextEncoder().encode('calimero.tee-attest.key-binding.v1');
/** Core's `MOCK_QUOTE_HEADER`: a mock quote is this, then the 64-byte report data. */
const MOCK_QUOTE_HEADER = new TextEncoder().encode('MOCK_TDX_QUOTE_V1');
/** A TDX v4 quote: 48-byte header, then the TD report body; report data at body offset 520. */
const TDX_REPORT_DATA_OFFSET = 48 + 520;

export interface AttestedNodeKey {
  /** The relay's node signing key, hex (32 bytes), as the quote binds it. */
  readonly nodeKey: string;
  /** True when the quote was a mock — no TEE vouched for anything. */
  readonly mock: boolean;
}

export interface AttestRelayNodeKeyOptions {
  readonly relayUrl: string;
  /**
   * Accept a mock quote. DEV/TEST ONLY: a mock quote carries no signature, so it
   * proves nothing about the hardware — only that the node bound this key into
   * something it produced for our nonce.
   */
  readonly allowMock?: boolean;
  /**
   * Verify a real quote's signature chain and measurements; throw to refuse.
   * Required for a non-mock quote: without it the binding would be checked
   * against bytes nothing has authenticated.
   */
  readonly verifyQuote?: (quote: Uint8Array) => Promise<void>;
  /**
   * Verify a real quote the way a sealed transport does: a
   * {@link VerifyTransportQuote}, such as `createSignedReleaseVerifier` (the
   * relay's signed mero-tee release, Intel's chain, every register of its
   * image). Called with our nonce and the node-key binding as the expected
   * report data, and with the relay's collateral when it asks for it. Takes
   * precedence over `verifyQuote`.
   */
  readonly verify?: VerifyTransportQuote;
  readonly fetch?: typeof fetch;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function fromHex32(value: unknown, label: string): Uint8Array {
  if (typeof value !== 'string' || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${label} must be 64 hex characters`);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Core's `attest_key_binding(None, key)`. */
export async function attestKeyBinding(nodeKey: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    concat(KEY_BINDING_DOMAIN, new Uint8Array(32), nodeKey),
  );
  return new Uint8Array(digest);
}

/** The 64 report-data bytes of a quote, read from the quote itself. */
export function reportDataOf(quote: Uint8Array): { reportData: Uint8Array; mock: boolean } {
  const mock =
    quote.length >= MOCK_QUOTE_HEADER.length &&
    equal(quote.subarray(0, MOCK_QUOTE_HEADER.length), MOCK_QUOTE_HEADER);
  const at = mock ? MOCK_QUOTE_HEADER.length : TDX_REPORT_DATA_OFFSET;
  if (quote.length < at + 64) {
    throw new Error(`the quote is too short to carry report data (${quote.length} bytes)`);
  }
  return { reportData: quote.slice(at, at + 64), mock };
}

/**
 * Ask a relay for a quote binding its node key to a fresh nonce, check the
 * binding, and return the key.
 */
export async function attestRelayNodeKey(opts: AttestRelayNodeKeyOptions): Promise<AttestedNodeKey> {
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const url = `${opts.relayUrl.replace(/\/+$/, '')}/admin-api/tee/attest`;
  const body = JSON.stringify({
    nonce: hex(nonce),
    bindNodeKey: true,
    ...(opts.verify?.includeCollateral ? { includeCollateral: true } : {}),
  });
  const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body };
  const response = opts.fetch ? await opts.fetch(url, init) : await globalThis.fetch(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`the relay would not attest (HTTP ${response.status})${text ? `: ${text}` : ''}`);
  }
  type Attested = { quoteB64?: string; boundPublicKey?: string; collateral?: DcapCollateral };
  const parsed = (await response.json()) as { data?: Attested };
  const data = parsed.data ?? (parsed as Attested);
  if (typeof data.quoteB64 !== 'string') throw new Error('the relay returned no quote');
  const nodeKey = fromHex32(data.boundPublicKey, 'boundPublicKey');

  const quote = fromBase64(data.quoteB64);
  const { reportData, mock } = reportDataOf(quote);
  if (mock) {
    if (!opts.allowMock) {
      throw new Error('the relay answered with a MOCK quote, which proves nothing about the hardware');
    }
  } else if (opts.verify) {
    const accepted = await opts.verify({
      quoteB64: data.quoteB64,
      nonce: hex(nonce),
      reportDataSuffix: hex(await attestKeyBinding(nodeKey)),
      ...(data.collateral ? { collateral: data.collateral } : {}),
    });
    if (!accepted) {
      throw new Error("the relay's quote did not verify: not a trusted image, or not bound to this request");
    }
  } else if (opts.verifyQuote) {
    await opts.verifyQuote(quote);
  } else {
    throw new Error('a real TDX quote needs a verify (or verifyQuote) to check its signature and measurements');
  }

  if (!equal(reportData.subarray(0, 32), nonce)) {
    throw new Error('the quote does not carry our nonce: it was not made for this request');
  }
  if (!equal(reportData.subarray(32, 64), await attestKeyBinding(nodeKey))) {
    throw new Error('the quote does not bind the key the relay named: refusing it');
  }
  return { nodeKey: hex(nodeKey), mock };
}
