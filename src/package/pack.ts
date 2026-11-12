/**
 * Building and signing a compute-only pipeline package (`.mpk`), byte-compatible
 * with core's `calimero-bundle`: the manifest, its RFC 8785 canonical form, the
 * domain-tagged signing payload and the archive layout are the ones core's
 * `scripts/pack-component.py` and `mero-sign` produce and its node verifies.
 *
 * A publisher key is an Ed25519 seed. Its backup ({@link exportPublisherKey})
 * is the JSON `mero-sign` reads as a key file: `{ private_key, public_key,
 * signer_id }`, the seed and public key base64url, the signer id a `did:key`.
 */

import { sha256 } from '@noble/hashes/sha2.js';

import { privateKey, buf, recoveryPublicKey } from '../client/recovery-key.js';
import { b64url, fromB64url } from '../runtime/passkey.js';

export const MAX_MANIFEST_BYTES = 1024 * 1024;
export const MAX_PIPELINES_PER_PACKAGE = 16;
export const MAX_PIPELINE_BYTES = 64 * 1024;

const MANIFEST_SIGNING_DOMAIN = new TextEncoder().encode('calimero.bundle.manifest.v1\0');
const MIN_RUNTIME_VERSION = '0.1.0';
const ED25519_PUB_MULTICODEC = [0xed, 0x01];
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const COMPONENT_HEADER = [0, 0x61, 0x73, 0x6d, 0x0d, 0, 0x01, 0]; // "\0asm" + component version 13, layer 1
const PIPELINE_PATH = /^pipelines\/[^/]+\.yaml$/;

export interface PublisherKey {
  /** The 32-byte Ed25519 seed. Keep it secret. */
  readonly seed: Uint8Array;
  /** The 32-byte Ed25519 public key. */
  readonly publicKey: Uint8Array;
}

export interface PackageMetadata {
  name: string;
  description?: string;
  author?: string;
  icon?: string;
  tags?: string[];
  license?: string;
  category?: string;
  guide?: string;
}

export interface ComputePackageInput {
  /** The package id, e.g. `com.example.pipeline`. */
  package: string;
  /** The release's version, e.g. `1.0.0`. */
  version: string;
  /** The compute component (a `calimero:app` WASM component). */
  compute: Uint8Array;
  /** Pipeline YAML files, each at `pipelines/<name>.yaml`. */
  pipelines: { path: string; source: string }[];
  metadata?: PackageMetadata;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const utf8 = (s: string) => new TextEncoder().encode(s);
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) (out.set(p, off), (off += p.length));
  return out;
};

async function keyOfSeed(seed: Uint8Array): Promise<PublisherKey> {
  if (seed.length !== 32) throw new Error('a publisher seed is 32 bytes');
  const publicKey = fromB64url(await recoveryPublicKey(seed));
  return { seed: Uint8Array.from(seed), publicKey };
}

export async function generatePublisherKey(): Promise<PublisherKey> {
  return keyOfSeed(crypto.getRandomValues(new Uint8Array(32)));
}

function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  for (; n > 0n; n /= 58n) out = BASE58[Number(n % 58n)] + out;
  return '1'.repeat(bytes.findIndex((b) => b !== 0) === -1 ? bytes.length : bytes.findIndex((b) => b !== 0)) + out;
}

/** The `did:key` of the key, as core's `derive_signer_id_did_key` derives it. */
export function signerIdOf(key: Pick<PublisherKey, 'publicKey'>): string {
  return `did:key:z${base58(concat(Uint8Array.from(ED25519_PUB_MULTICODEC), key.publicKey))}`;
}

/** The key's backup: UTF-8 JSON in `mero-sign`'s key-file shape. */
export function exportPublisherKey(key: PublisherKey): Uint8Array {
  return utf8(
    JSON.stringify({ private_key: b64url(key.seed), public_key: b64url(key.publicKey), signer_id: signerIdOf(key) }, null, 2),
  );
}

/** Restores a key from its backup; the public key and signer id, when present, must be the seed's. */
export async function importPublisherKey(bytes: Uint8Array): Promise<PublisherKey> {
  let file: { private_key?: unknown; public_key?: unknown; signer_id?: unknown };
  try {
    file = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('a publisher key backup is a JSON document');
  }
  if (typeof file?.private_key !== 'string') throw new Error('a publisher key backup has no private_key');
  const key = await keyOfSeed(fromB64url(file.private_key));
  if (file.public_key !== undefined && file.public_key !== b64url(key.publicKey)) {
    throw new Error('the backup public_key is not the seed\'s');
  }
  if (file.signer_id !== undefined && file.signer_id !== signerIdOf(key)) {
    throw new Error('the backup signer_id is not the seed\'s');
  }
  return key;
}

/** RFC 8785 canonical bytes of the manifest without `signature` and `_`-prefixed fields, as core's `canonicalize_manifest`. */
export function canonicalizeManifest(manifest: { [key: string]: Json }): Uint8Array {
  const signed = Object.fromEntries(Object.entries(manifest).filter(([k]) => k !== 'signature' && !k.startsWith('_')));
  return utf8(jcs(signed));
}

// Manifests hold only strings, safe integers, arrays and objects, where JSON.stringify's
// string and integer forms are RFC 8785's; keys sort by UTF-16 code unit, the default order.
function jcs(value: Json): string {
  if (typeof value === 'string') {
    if (/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(value)) {
      throw new Error('a lone surrogate cannot be canonicalized');
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('only safe integers can be canonicalized');
    return String(value);
  }
  if (value === null || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(jcs).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${jcs(k)}:${jcs(value[k])}`)
    .join(',')}}`;
}

/** What Ed25519 signs: `sha256(domain || canonical bytes)`, as core's `compute_signing_payload`. */
export async function signingPayload(manifest: { [key: string]: Json }): Promise<Uint8Array> {
  return sha256(concat(MANIFEST_SIGNING_DOMAIN, canonicalizeManifest(manifest)));
}

/** Checks a manifest's signature and that its `signerId` is the signing key's; returns the signer id. */
export async function verifyManifestSignature(manifest: { [key: string]: Json }): Promise<string> {
  const sig = manifest.signature as { algorithm?: string; publicKey?: string; signature?: string } | undefined;
  if (!sig) throw new Error("manifest is missing required 'signature' field");
  if (sig.algorithm !== 'ed25519') throw new Error(`unsupported signature algorithm: '${sig.algorithm}'`);
  const publicKey = fromB64url(sig.publicKey ?? '');
  const signature = fromB64url(sig.signature ?? '');
  if (publicKey.length !== 32 || signature.length !== 64) throw new Error('malformed signature field');
  const key = await crypto.subtle.importKey('raw', buf(publicKey), { name: 'Ed25519' }, false, ['verify']);
  const ok = await crypto.subtle.verify('Ed25519', key, buf(signature), buf(await signingPayload(manifest)));
  if (!ok) throw new Error('Ed25519 signature verification failed');
  const derived = signerIdOf({ publicKey });
  if (manifest.signerId !== derived) {
    throw new Error(`signerId mismatch: manifest declares '${manifest.signerId}' but signature public key derives to '${derived}'`);
  }
  return derived;
}

function checkPathComponent(value: string, field: string): void {
  if (!value) throw new Error(`${field} is empty`);
  if (value.includes('..')) throw new Error(`${field} contains path traversal sequence '..'`);
  if (value.includes('/') || value.includes('\\')) throw new Error(`${field} contains directory separator`);
  if (value.includes('\0')) throw new Error(`${field} contains null byte`);
  if (value.length >= 2 && value[1] === ':') throw new Error(`${field} appears to be an absolute path`);
}

// core's validate_artifact_path, then the layout a pipeline file must have.
function checkPipelinePath(value: string, field: string): void {
  if (!value) throw new Error(`${field} is empty`);
  if (value.includes('\0')) throw new Error(`${field} contains null byte`);
  if (value.includes('\\')) throw new Error(`${field} contains backslash (use forward slashes)`);
  if (value.startsWith('/')) throw new Error(`${field} is an absolute path`);
  if (value[1] === ':') throw new Error(`${field} appears to be an absolute Windows path`);
  if (value.split('/').includes('..')) throw new Error(`${field} contains path traversal component '..'`);
  if (!PIPELINE_PATH.test(value) || utf8(value).length > 100) {
    throw new Error(`${field} must be pipelines/<name>.yaml, at most 100 bytes`);
  }
}

const artifact = (path: string, bytes: Uint8Array) => ({ path, hash: hex(sha256(bytes)), size: bytes.length });

function tarEntry(name: string, data: Uint8Array): Uint8Array {
  const header = new Uint8Array(512);
  const put = (off: number, text: string) => header.set(utf8(text), off);
  put(0, name);
  put(100, '0000644\0');
  put(108, '0000000\0');
  put(116, '0000000\0');
  put(124, `${data.length.toString(8).padStart(11, '0')}\0`);
  put(136, '00000000000\0');
  put(148, '        ');
  put(156, '0');
  put(257, 'ustar\0');
  put(263, '00');
  put(148, `${header.reduce((n, b) => n + b, 0).toString(8).padStart(6, '0')}\0 `);
  return concat(header, data, new Uint8Array((512 - (data.length % 512)) % 512));
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([buf(bytes)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * A signed compute-only `.mpk`: `manifest.json`, `compute.wasm` and the pipelines, as a tar.gz.
 * Refuses what core's node refuses at install, with core's messages. It cannot check what the
 * node compiles: that the component declares compute methods and that the pipelines fit them.
 */
export async function packComputePackage(input: ComputePackageInput, key: PublisherKey): Promise<Uint8Array> {
  checkPathComponent(input.package, 'package');
  checkPathComponent(input.version, 'appVersion');
  if (!input.compute?.length) throw new Error('the package ships no WASM');
  if (COMPONENT_HEADER.some((b, i) => input.compute[i] !== b)) {
    throw new Error('compute: not a WASM component (an SDK 0.12 core module is refused by the node)');
  }
  if (input.pipelines.length > MAX_PIPELINES_PER_PACKAGE) {
    throw new Error(`bundle declares ${input.pipelines.length} pipelines, at most ${MAX_PIPELINES_PER_PACKAGE} are allowed`);
  }
  const files = input.pipelines.map((p, i) => {
    checkPipelinePath(p.path, `pipelines[${i}].path`);
    return { path: p.path, bytes: utf8(p.source) };
  });
  const big = files.find((f) => f.bytes.length > MAX_PIPELINE_BYTES);
  if (big) throw new Error(`pipeline '${big.path}' exceeds the ${MAX_PIPELINE_BYTES} byte cap`);
  if (new Set(files.map((f) => f.path)).size !== files.length) throw new Error('two pipelines have the same path');

  const manifest: { [key: string]: Json } = {
    version: '1.0',
    package: input.package,
    appVersion: input.version,
    minRuntimeVersion: MIN_RUNTIME_VERSION,
    ...(input.metadata ? { metadata: input.metadata as unknown as Json } : {}),
    compute: artifact('compute.wasm', input.compute),
    ...(files.length ? { pipelines: files.map((f) => artifact(f.path, f.bytes)) } : {}),
    signerId: signerIdOf(key),
  };
  const signature = await crypto.subtle.sign('Ed25519', await privateKey(key.seed, false), buf(await signingPayload(manifest)));
  manifest.signature = { algorithm: 'ed25519', publicKey: b64url(key.publicKey), signature: b64url(new Uint8Array(signature)) };

  const manifestBytes = utf8(JSON.stringify(manifest));
  if (manifestBytes.length > MAX_MANIFEST_BYTES) {
    throw new Error(`bundle manifest.json exceeds the ${MAX_MANIFEST_BYTES} byte cap`);
  }
  const tar = concat(
    tarEntry('manifest.json', manifestBytes),
    tarEntry('compute.wasm', input.compute),
    ...files.map((f) => tarEntry(f.path, f.bytes)),
    new Uint8Array(1024),
  );
  return gzip(tar);
}
