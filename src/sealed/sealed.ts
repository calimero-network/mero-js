/**
 * Sealed transport: requests encrypted to a TEE node's attested key.
 *
 * A node speaks plain HTTP and any TLS in front of it ends outside the enclave,
 * at whatever proxy or relay the operator runs, so everything crossing that hop
 * (the bearer token, JSON-RPC arguments, results) is readable there. Sealing
 * encrypts each request to an X25519 key the node's quote commits to, so only
 * the attested TD can read it, and only the TD can produce a response the
 * client accepts.
 *
 * The node's side, and the wire format this implements byte for byte, are in
 * core's `crates/server/src/sealed.rs`:
 *
 * ```text
 * shared    = X25519(secret, peer public)            all-zero result refused
 * prk       = HKDF-SHA256-Extract(salt = transport_pk || client_pk, ikm = shared)
 * req key   = HKDF-Expand(prk, "calimero/sealed-http/v1/request",  32)
 * resp key  = HKDF-Expand(prk, "calimero/sealed-http/v1/response", 32)
 * request   = 0x01 || transport_pk || client_pk || nonce(12)
 *             || AES-256-GCM(req key, nonce, aad = the 77 bytes before it, inner request)
 * response  = 0x01 || nonce(12)
 *             || AES-256-GCM(resp key, nonce, aad = 0x01 || transport_pk || client_pk, inner response)
 * inner     = u32 BE head length || head (JSON) || body
 * ```
 *
 * Use it by attesting once ({@link fetchAttestedTransportKey}) and handing
 * {@link createSealedFetch} to `MeroJsConfig.fetch`. Server-sent events and
 * WebSockets are streams and cannot be sealed; the node refuses a sealed SSE
 * request with a 501 rather than hang.
 */

import { concat, fromHex, hex } from '../crypto/internal.js';
import type { TeeAttestRequest, TeeAttestResponseData } from '../admin-api/admin-types.js';

/** Where sealed requests are posted, relative to the node's base URL. */
export const SEALED_PATH = '/sealed/v1';
/** Content type of both sealed bodies. */
export const SEALED_CONTENT_TYPE = 'application/vnd.calimero.sealed';

const VERSION = 1;
const NONCE_LEN = 12;
const REQUEST_DOMAIN = 'calimero/sealed-http/v1/request';
const RESPONSE_DOMAIN = 'calimero/sealed-http/v1/response';
const TRANSPORT_BINDING_DOMAIN = 'calimero.tee-attest.transport-key.v1';
/** PKCS#8 wrapping of a raw X25519 private key (RFC 8410). */
const PKCS8_X25519_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04,
  0x22, 0x04, 0x20,
]);

const utf8 = new TextEncoder();

/** The node no longer holds the key this client sealed to (it restarted). */
export class StaleTransportKeyError extends Error {
  name = 'StaleTransportKeyError';

  constructor() {
    super(
      'The node no longer holds the transport key this request was sealed to; attest again for the current one',
    );
  }
}

/** The node refused the envelope itself, before anything inside it ran. */
export class SealedTransportError extends Error {
  name = 'SealedTransportError';

  constructor(
    public status: number,
    public code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

/**
 * What the attest endpoint puts in report data bytes `32..64` when asked to
 * bind its transport key. `inner` is what would have been there otherwise: the
 * expected application hash, or 32 zero bytes when none was asked for.
 * Mirrors core's `attest_transport_binding`.
 */
export async function transportKeyBinding(
  inner: Uint8Array,
  transportKey: Uint8Array,
): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    concat(utf8.encode(TRANSPORT_BINDING_DOMAIN), inner, transportKey),
  );
  return new Uint8Array(digest);
}

export interface VerifyTransportQuote {
  /**
   * Verify `quoteB64` with a verifier you trust — never the node being
   * attested — and check that its report data is `nonce || reportDataSuffix`
   * (both hex). `AdminApiClient.teeVerifyQuote` on a node of your own does both
   * when given `expectedApplicationHash: reportDataSuffix`. Resolve true only
   * when the quote is genuine, its measurements are ones you accept, and the
   * report data matches.
   */
  (args: { quoteB64: string; nonce: string; reportDataSuffix: string }): Promise<boolean>;
}

/**
 * Ask a node for its transport key and accept it only if a quote you verified
 * commits to it.
 *
 * `applicationHash` (hex), when given, is the bytecode hash you expect the
 * attested application to have; the node is asked to bind that application,
 * and the quote only verifies if it runs that exact bytecode.
 */
export async function fetchAttestedTransportKey(
  admin: { teeAttest(request: TeeAttestRequest): Promise<TeeAttestResponseData> },
  verify: VerifyTransportQuote,
  options: { applicationId?: string; applicationHash?: string } = {},
): Promise<Uint8Array> {
  if ((options.applicationId === undefined) !== (options.applicationHash === undefined)) {
    throw new Error('applicationId and applicationHash are given together or not at all');
  }
  const nonce = hex(crypto.getRandomValues(new Uint8Array(32)));
  const attested = await admin.teeAttest({
    nonce,
    applicationId: options.applicationId,
    bindTransportKey: true,
  });
  if (!attested.transportPublicKey) {
    throw new Error('The node did not report a transport key; it predates sealed transport');
  }
  const transportKey = fromHex(attested.transportPublicKey, 'transportPublicKey', 32);
  const inner = options.applicationHash
    ? fromHex(options.applicationHash, 'applicationHash', 32)
    : new Uint8Array(32);
  const reportDataSuffix = hex(await transportKeyBinding(inner, transportKey));
  if (!(await verify({ quoteB64: attested.quoteB64, nonce, reportDataSuffix }))) {
    throw new Error('The attestation did not verify, so its transport key is not trusted');
  }
  return transportKey;
}

export interface SealedFetchOptions {
  /** The node's base URL, as given to `MeroJsConfig.baseUrl`. */
  baseUrl: string;
  /** The node's transport key, from {@link fetchAttestedTransportKey}. */
  transportPublicKey: Uint8Array;
  /** Fetch that carries the sealed envelope. Defaults to global `fetch`. */
  fetch?: typeof fetch;
}

/**
 * A `fetch` that seals every request to the node's transport key. Pass it as
 * `MeroJsConfig.fetch`.
 *
 * A request for any URL outside `baseUrl` is refused rather than sent in the
 * clear: falling back to plaintext would silently undo the point of sealing.
 */
export function createSealedFetch(options: SealedFetchOptions): typeof fetch {
  const base = new URL(options.baseUrl);
  const basePath = base.pathname.replace(/\/+$/, '');
  const sealedUrl = `${base.origin}${basePath}${SEALED_PATH}`;
  const transportKey = options.transportPublicKey;
  if (transportKey.length !== 32) {
    throw new Error('transportPublicKey must be 32 bytes');
  }
  const baseFetch = options.fetch ?? ((input, init) => fetch(input, init));

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== base.origin || !url.pathname.startsWith(`${basePath}/`)) {
      throw new Error(`Refusing to send ${url.href} outside the sealed node at ${options.baseUrl}`);
    }
    const headers: Array<[string, string]> = [];
    request.headers.forEach((value, name) => headers.push([name, value]));
    const head: RequestHead = {
      method: request.method,
      path: url.pathname.slice(basePath.length) + url.search,
      headers,
      ts: Math.floor(Date.now() / 1000),
    };
    const body = new Uint8Array(await request.arrayBuffer());

    const exchange = await sealRequest(transportKey, head, body);
    const response = await baseFetch(sealedUrl, {
      method: 'POST',
      headers: { 'content-type': SEALED_CONTENT_TYPE },
      body: exchange.envelope,
      signal: request.signal,
    });
    if (response.headers.get('content-type') !== SEALED_CONTENT_TYPE) {
      throw await envelopeRefusal(response);
    }
    const opened = await exchange.open(new Uint8Array(await response.arrayBuffer()));
    const nullBody = [101, 204, 205, 304].includes(opened.head.status);
    return new Response(nullBody ? null : opened.body, {
      status: opened.head.status,
      headers: opened.head.headers,
    });
  };
}

async function envelopeRefusal(response: Response): Promise<Error> {
  let code: string | undefined;
  let message = `Sealed request refused: HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    code = body?.error?.code;
    if (body?.error?.message) message = `Sealed request refused: ${body.error.message}`;
  } catch {
    // Not the node's JSON refusal — a proxy's page, most likely. The status is
    // all that can honestly be reported.
  }
  if (code === 'stale_transport_key') return new StaleTransportKeyError();
  return new SealedTransportError(response.status, code, message);
}

export interface RequestHead {
  method: string;
  path: string;
  headers: Array<[string, string]>;
  ts: number;
}

export interface ResponseHead {
  status: number;
  headers: Array<[string, string]>;
}

export interface SealedExchange {
  envelope: Uint8Array;
  open(sealed: Uint8Array): Promise<{ head: ResponseHead; body: Uint8Array }>;
}

/**
 * Seal one request, keeping what is needed to open its response.
 *
 * `fixed` pins the client's one-time secret and the nonce, for the published
 * test vectors only; leave it out.
 */
export async function sealRequest(
  transportKey: Uint8Array,
  head: RequestHead,
  body: Uint8Array,
  fixed?: { clientSecret: Uint8Array; nonce: Uint8Array },
): Promise<SealedExchange> {
  const { privateKey, publicKey } = await clientKeyPair(fixed?.clientSecret);
  const transport = await crypto.subtle.importKey('raw', transportKey, { name: 'X25519' }, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'X25519', public: transport } as EcdhKeyDeriveParams, privateKey, 256),
  );
  // A low-order point yields an all-zero secret that anybody can compute.
  if (shared.every((byte) => byte === 0)) {
    throw new Error('The transport key is a low-order point');
  }
  const salt = concat(transportKey, publicKey);
  const requestKey = await exchangeKey(shared, salt, REQUEST_DOMAIN, 'encrypt');
  const responseKey = await exchangeKey(shared, salt, RESPONSE_DOMAIN, 'decrypt');

  const nonce = fixed?.nonce ?? crypto.getRandomValues(new Uint8Array(NONCE_LEN));
  const header = concat(new Uint8Array([VERSION]), transportKey, publicKey, nonce);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: header },
    requestKey,
    joinInner(head, body),
  );
  const responseAad = concat(new Uint8Array([VERSION]), salt);

  return {
    envelope: concat(header, new Uint8Array(ciphertext)),
    async open(sealed) {
      if (sealed.length < 1 + NONCE_LEN + 16 || sealed[0] !== VERSION) {
        throw new Error('The sealed response is malformed');
      }
      let plaintext: Uint8Array;
      try {
        plaintext = new Uint8Array(
          await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: sealed.slice(1, 1 + NONCE_LEN), additionalData: responseAad },
            responseKey,
            sealed.slice(1 + NONCE_LEN),
          ),
        );
      } catch {
        throw new Error('The sealed response did not open: it was not sealed by the attested node');
      }
      const view = new DataView(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength);
      const len = view.getUint32(0, false);
      const head = JSON.parse(new TextDecoder().decode(plaintext.slice(4, 4 + len))) as ResponseHead;
      return { head, body: plaintext.slice(4 + len) };
    },
  };
}

function joinInner(head: RequestHead, body: Uint8Array): Uint8Array {
  const encoded = utf8.encode(JSON.stringify(head));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, encoded.length, false);
  return concat(len, encoded, body);
}

async function exchangeKey(
  shared: Uint8Array,
  salt: Uint8Array,
  domain: string,
  usage: 'encrypt' | 'decrypt',
): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8.encode(domain) },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}

async function clientKeyPair(
  secret?: Uint8Array,
): Promise<{ privateKey: CryptoKey; publicKey: Uint8Array }> {
  if (!secret) {
    const pair = (await crypto.subtle.generateKey({ name: 'X25519' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair;
    const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    return { privateKey: pair.privateKey, publicKey };
  }
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    concat(PKCS8_X25519_PREFIX, secret),
    { name: 'X25519' },
    true,
    ['deriveBits'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', privateKey);
  return { privateKey, publicKey: base64UrlDecode(jwk.x as string) };
}

function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
