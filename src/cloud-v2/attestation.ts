/**
 * The check every cloud client runs before it sends anything: the node's quote
 * must be genuine (or, in development, an explicitly allowed mock), from an
 * image this client trusts, and its report data must bind this nonce, the
 * expected app and the transport key the sealed channel will be opened to.
 *
 * Report data, as core's `calimero-cloud-client::attest` builds it:
 * `nonce(32) || SHA-256("calimero.tee-attest.transport-key.v1" | app_hash | transport_key)`.
 *
 * A real quote is judged as the Rust client judges it (`attest::verify` with
 * `Measurements::Release`): the node names the mero-tee release it runs; that
 * release must be at least `minReleaseVersion`; its `published-mrtds.json` is
 * fetched and its Sigstore signature checked against the node release workflow;
 * the quote's signature chain and TCB status are checked against Intel's
 * collateral (fetched here: the node sends none, and cannot forge it); the TD
 * must not be a debug TD; and its registers must be the release's image for the
 * trusted profile, `locked-read-only` unless a debug profile is explicitly
 * allowed. Nothing here reads the environment: mock quotes pass only with
 * `allowMock`.
 */

import { fromHex, hex } from '../crypto/internal.js';
import {
  DEFAULT_RELEASE_MIRROR,
  cloudNodeReleaseUrl,
  compareReleaseVersions,
  fetchGithubNodeRelease,
  fetchNodeRelease,
  releaseVersion,
  trustSignedRelease,
  type SignedNodeRelease,
} from '../sealed/release.js';
import { transportKeyBinding, type VerifyTransportQuote } from '../sealed/sealed.js';
import { PRODUCTION_PROFILE, createQuoteVerifier, type DcapCollateral, type DcapVerify } from '../sealed/verify.js';

/** The mock quote format development clusters use. */
export const MOCK_QUOTE_HEADER = 'MOCK_TDX_QUOTE_V1';

/** How the signed release a node names is trusted (core's `Measurements::Release`). */
export interface CloudReleasePolicy {
  /**
   * The oldest mero-tee release trusted, e.g. `2.3.109`. Required: every
   * release ever signed stays validly signed, so without a floor a node could
   * name an old release with a flaw since fixed.
   */
  minReleaseVersion: string;
  /** The image profile trusted; defaults to `locked-read-only`. */
  profile?: string;
  /** Trust a debug profile. Its image is readable by the operator: testing only. */
  allowDebugProfile?: boolean;
  /**
   * Where the release's signed measurements come from: `'github'` (the release
   * assets, what core's Rust client reads; no CORS, so not in browsers), the
   * base URL of a mirror (default {@link DEFAULT_RELEASE_MIRROR}), or a function.
   * Untrusted either way: the Sigstore signature is checked here.
   */
  releaseSource?: 'github' | string | ((version: string) => Promise<SignedNodeRelease>);
  /** DCAP verification; defaults to `verify` from `@phala/dcap-qvl`, loaded on first use. */
  dcapVerify?: DcapVerify;
  /**
   * Intel's collateral for a quote; defaults to `@phala/dcap-qvl`'s
   * `getCollateralFromPcs` (Intel's PCS). Point it at a PCCS a browser can reach
   * if Intel's does not answer the page.
   */
  fetchCollateral?: (quote: Uint8Array) => Promise<DcapCollateral>;
  /** Override the release signer (defaults to the mero-tee node release workflow). */
  identity?: string;
  issuer?: string;
  /** The current time in milliseconds; defaults to `Date.now`. For tests. */
  now?: () => number;
}

export interface CloudPolicy {
  /** Accept mock quotes. Development clusters only; never set from the environment. */
  allowMock?: boolean;
  /** Trust real quotes from the signed release the node runs. */
  release?: CloudReleasePolicy;
  /**
   * Verify a real quote yourself instead (e.g. `createQuoteVerifier` with
   * pinned measurements). Takes precedence over `release`.
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

type DcapModule = {
  verify?: unknown;
  getCollateralFromPcs?: unknown;
  default?: { verify?: unknown; getCollateralFromPcs?: unknown };
};
let dcapModule: Promise<DcapModule> | undefined;

/** A function out of `@phala/dcap-qvl`, whatever shape the bundler gave the (CommonJS) module. */
async function dcap<T>(name: 'verify' | 'getCollateralFromPcs'): Promise<T> {
  dcapModule ??= import('@phala/dcap-qvl') as Promise<DcapModule>;
  const ns = await dcapModule;
  const f = typeof ns[name] === 'function' ? ns[name] : ns.default?.[name];
  if (typeof f !== 'function') throw new TypeError(`@phala/dcap-qvl loaded without ${name}`);
  return f as T;
}

/**
 * The release a node names, checked against the floor before anything is
 * fetched. Accepts `2.3.109` and the tag form `mero-tee-v2.3.109`.
 */
export function claimedRelease(doc: Pick<AttestationDoc, 'release'>, minReleaseVersion: string): string {
  const floor = releaseVersion(minReleaseVersion, 'minReleaseVersion');
  const raw = String(doc.release?.version ?? '').trim().replace(/^mero-tee-v/, '').replace(/^v/, '');
  const version = releaseVersion(raw, 'The release the node names');
  if (compareReleaseVersions(version, floor) < 0) {
    throw new Error(`mero-tee release ${version} is older than the minimum ${floor}`);
  }
  return version;
}

async function releaseFor(version: string, policy: CloudReleasePolicy, fetchImpl: typeof fetch) {
  const source = policy.releaseSource;
  if (typeof source === 'function') return source(version);
  if (source === 'github') return fetchGithubNodeRelease(version, { fetch: fetchImpl });
  return fetchNodeRelease(cloudNodeReleaseUrl(source ?? DEFAULT_RELEASE_MIRROR, version), { fetch: fetchImpl });
}

/** Judge a real quote as core's `Measurements::Release` does. */
async function verifyRelease(
  doc: AttestationDoc,
  args: Parameters<VerifyTransportQuote>[0],
  policy: CloudReleasePolicy,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  // Refuse what no release could admit before reaching for the network.
  const version = claimedRelease(doc, policy.minReleaseVersion);
  const trusted = await trustSignedRelease({
    release: await releaseFor(version, policy, fetchImpl),
    profile: policy.profile ?? PRODUCTION_PROFILE,
    allowDebugProfile: policy.allowDebugProfile,
    minReleaseVersion: policy.minReleaseVersion,
    identity: policy.identity,
    issuer: policy.issuer,
  });
  const fetchCollateral =
    policy.fetchCollateral ??
    (async (quote: Uint8Array) =>
      (await dcap<(q: Uint8Array) => Promise<DcapCollateral>>('getCollateralFromPcs'))(quote));
  const verifier = createQuoteVerifier({
    dcapVerify: policy.dcapVerify ?? (await dcap<DcapVerify>('verify')),
    fetchCollateral,
    now: policy.now,
    ...trusted,
  });
  return verifier(args);
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
  const args = { quoteB64: doc.quote, nonce, reportDataSuffix: hex(suffix) };
  let ok: boolean;
  if (policy.verifyQuote) {
    ok = await policy.verifyQuote(args);
  } else if (policy.release) {
    ok = await verifyRelease(doc, args, policy.release, fetchImpl);
  } else {
    throw new Error('real quote refused: this client trusts no TD image (set policy.release)');
  }
  if (!ok) throw new Error('The attestation did not verify, so its transport key is not trusted');
  return transportKey;
}
