import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { privateKey, buf } from '../client/recovery-key.js';
import { b64url } from '../runtime/passkey.js';
import {
  MAX_MANIFEST_BYTES,
  MAX_PIPELINE_BYTES,
  MAX_PIPELINES_PER_PACKAGE,
  canonicalizeManifest,
  exportPublisherKey,
  generatePublisherKey,
  importPublisherKey,
  packComputePackage,
  signerIdOf,
  signingPayload,
  verifyManifestSignature,
} from './pack.js';

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const json = (name: string) => JSON.parse(fx(name).toString('utf8'));
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const SEED = Uint8Array.from({ length: 32 }, (_, i) => i);
const key = () => importSeed(Buffer.from(SEED).toString('hex'));

const compute = new Uint8Array(fx('compute.wasm'));
const pipelines = [
  { path: 'pipelines/double.yaml', source: fx('double.yaml').toString('utf8') },
  { path: 'pipelines/triple.yaml', source: fx('triple.yaml').toString('utf8') },
];
const base = { package: 'com.example.pipeline', version: '1.2.3', compute, pipelines };

/** The entries of a .mpk: gunzip, then walk the tar's 512-byte blocks. */
function entries(mpk: Uint8Array): Map<string, Buffer> {
  const tar = gunzipSync(mpk);
  const out = new Map<string, Buffer>();
  for (let off = 0; off + 512 <= tar.length && tar[off] !== 0; ) {
    const name = tar.subarray(off, off + 100).toString('utf8').replace(/\0.*$/, '');
    const size = parseInt(tar.subarray(off + 124, off + 136).toString('utf8').replace(/\0.*$/, '').trim(), 8);
    out.set(name, tar.subarray(off + 512, off + 512 + size));
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

const manifestOf = (mpk: Uint8Array) => JSON.parse(entries(mpk).get('manifest.json')!.toString('utf8'));

describe('conformance with core', () => {
  for (const [name, vectors, extra] of [
    ['a compute-only package', 'core-vectors.json', {}],
    ['a package with metadata', 'core-vectors-metadata.json', { metadata: json('core-vectors-metadata.json').unsignedManifest.metadata }],
  ] as const) {
    it(`signs ${name} exactly as core does`, async () => {
      const v = json(vectors);
      const k = await importSeed(v.seedHex);
      const mpk = await packComputePackage({ ...base, ...extra }, k);
      const manifest = manifestOf(mpk);
      expect(manifest).toEqual(v.signedManifest);
      const { signature: _s, ...signed } = manifest;
      expect(new TextDecoder().decode(canonicalizeManifest(signed))).toBe(v.canonicalUtf8);
      expect(hex(await signingPayload(signed))).toBe(v.payloadHex);
    });
  }

  it('derives the signer id core derives', async () => {
    expect(signerIdOf(await key())).toBe(json('core-vectors.json').signerId);
  });

  it('ships the compute component and each pipeline byte for byte', async () => {
    const e = entries(await packComputePackage(base, await key()));
    expect([...e.keys()]).toEqual(['manifest.json', 'compute.wasm', 'pipelines/double.yaml', 'pipelines/triple.yaml']);
    expect(Buffer.compare(e.get('compute.wasm')!, Buffer.from(compute))).toBe(0);
  });

  it('builds the archive core accepted (recorded verdict)', async () => {
    const recorded = entries(new Uint8Array(fx('js-built.mpk')));
    const built = entries(await packComputePackage(base, await key()));
    expect([...built.keys()]).toEqual([...recorded.keys()]);
    for (const [name, bytes] of recorded) expect(Buffer.compare(built.get(name)!, bytes), name).toBe(0);
    const verdicts = json('core-verdicts.json');
    expect(verdicts['js-built.mpk'].accepted).toBe(true);
    expect(verdicts['js-built.mpk'].detail.computeOnly).toBe(true);
    expect(verdicts['js-built.mpk'].detail.signerId).toBe(json('core-vectors.json').signerId);
  });

  // CORE_PACK_VERIFIER: the pack-vectors binary; runs core's real verifier on this build's output.
  it.skipIf(!process.env.CORE_PACK_VERIFIER)('is accepted by core live', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'mpk-')), 'x.mpk');
    writeFileSync(path, await packComputePackage(base, await key()));
    const r = spawnSync(process.env.CORE_PACK_VERIFIER!, ['verify', path], { encoding: 'utf8' });
    expect(JSON.parse(r.stdout).accepted, r.stdout).toBe(true);
  });
});

async function importSeed(seedHex: string) {
  const seed = Uint8Array.from(Buffer.from(seedHex, 'hex'));
  return importPublisherKey(new TextEncoder().encode(JSON.stringify({ private_key: Buffer.from(seed).toString('base64url') })));
}

describe('tampering', () => {
  it('fails the signature when a signed field changes', async () => {
    const manifest = manifestOf(await packComputePackage(base, await key()));
    expect(await verifyManifestSignature(manifest)).toBe(signerIdOfSync(manifest));
    for (const edit of [
      (m: any) => (m.appVersion = '9.9.9'),
      (m: any) => (m.pipelines[0].hash = 'f'.repeat(64)),
      (m: any) => (m.compute.size += 1),
      (m: any) => (m.extra = 1),
    ]) {
      const t = structuredClone(manifest);
      edit(t);
      await expect(verifyManifestSignature(t)).rejects.toThrow(/signature/);
    }
  });

  it('refuses a manifest whose signer id is not its key', async () => {
    const manifest = manifestOf(await packComputePackage(base, await key()));
    manifest.signerId = 'did:key:z6MknF3p5L5FDHJQ7FREUapuX4Wmp4MtF6WrHYaXS2B3eZQd';
    const payload = await signingPayload(manifest);
    const sig = await crypto.subtle.sign('Ed25519', await privateKey(SEED, false), buf(payload));
    manifest.signature.signature = b64url(new Uint8Array(sig));
    await expect(verifyManifestSignature(manifest)).rejects.toThrow(/signerId mismatch/);
  });

  it('ignores signature and underscore fields when canonicalizing, as core does', () => {
    const a = canonicalizeManifest({ b: 1, a: 'x', signature: { x: 1 }, _binary: 'y' });
    expect(new TextDecoder().decode(a)).toBe('{"a":"x","b":1}');
  });

  it('is refused by core when the manifest or an archive file is altered (recorded verdicts)', () => {
    const verdicts = json('core-verdicts.json');
    expect(verdicts['tampered-manifest.mpk'].accepted).toBe(false);
    expect(verdicts['tampered-manifest.mpk'].error).toMatch(/signature verification failed/);
    expect(verdicts['tampered-archive.mpk'].accepted).toBe(false);
    expect(verdicts['tampered-archive.mpk'].error).toMatch(/integrity check/);
  });
});

describe('limits', () => {
  const pack = (over: object, k?: Awaited<ReturnType<typeof key>>) => async () =>
    packComputePackage({ ...base, ...over } as never, k ?? (await key()));

  it('refuses a pipeline over the byte cap, and takes one at the cap', async () => {
    const at = { path: 'pipelines/big.yaml', source: 'a'.repeat(MAX_PIPELINE_BYTES) };
    await expect(pack({ pipelines: [at] })()).resolves.toBeInstanceOf(Uint8Array);
    const over = { path: 'pipelines/big.yaml', source: 'a'.repeat(MAX_PIPELINE_BYTES + 1) };
    await expect(pack({ pipelines: [over] })()).rejects.toThrow(
      `pipeline 'pipelines/big.yaml' exceeds the ${MAX_PIPELINE_BYTES} byte cap`,
    );
  });

  it('counts a pipeline in bytes, not characters', async () => {
    const source = '\u00e9'.repeat(MAX_PIPELINE_BYTES / 2 + 1);
    await expect(pack({ pipelines: [{ path: 'pipelines/u.yaml', source }] })()).rejects.toThrow(/byte cap/);
  });

  it('refuses more pipelines than a package may declare', async () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ path: `pipelines/p${i}.yaml`, source: 'a: 1' }));
    await expect(pack({ pipelines: many(MAX_PIPELINES_PER_PACKAGE) })()).resolves.toBeInstanceOf(Uint8Array);
    await expect(pack({ pipelines: many(MAX_PIPELINES_PER_PACKAGE + 1) })()).rejects.toThrow(
      `bundle declares ${MAX_PIPELINES_PER_PACKAGE + 1} pipelines, at most ${MAX_PIPELINES_PER_PACKAGE} are allowed`,
    );
  });

  it.each([
    ['', /pipelines\[0\]\.path is empty/],
    ['/pipelines/a.yaml', /is an absolute path/],
    ['pipelines\\a.yaml', /contains backslash/],
    ['pipelines/../a.yaml', /path traversal component '\.\.'/],
    ['C:/a.yaml', /absolute Windows path/],
    ['pipelines/a\0.yaml', /null byte/],
    ['a.yaml', /must be pipelines\/<name>\.yaml/],
    ['pipelines/a.txt', /must be pipelines\/<name>\.yaml/],
    ['pipelines/sub/a.yaml', /must be pipelines\/<name>\.yaml/],
    ['pipelines/manifest.json.yaml/', /must be pipelines\/<name>\.yaml/],
  ])('refuses the pipeline path %j', async (path, message) => {
    await expect(pack({ pipelines: [{ path, source: 'a: 1' }] })()).rejects.toThrow(message);
  });

  it('refuses two pipelines at one path', async () => {
    const p = { path: 'pipelines/a.yaml', source: 'a: 1' };
    await expect(pack({ pipelines: [p, p] })()).rejects.toThrow(/same path/);
  });

  it('refuses a missing compute component and a core module', async () => {
    await expect(pack({ compute: undefined })()).rejects.toThrow('the package ships no WASM');
    await expect(pack({ compute: new Uint8Array() })()).rejects.toThrow('the package ships no WASM');
    await expect(pack({ compute: Uint8Array.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]) })()).rejects.toThrow(
      /not a WASM component/,
    );
  });

  it.each([
    ['package', 'a/b', /package contains directory separator/],
    ['package', '', /package is empty/],
    ['version', '1..2', /appVersion contains path traversal sequence/],
    ['version', '', /appVersion is empty/],
  ])('refuses a bad %s %j', async (field, value, message) => {
    await expect(pack({ [field]: value })()).rejects.toThrow(message);
  });

  it('refuses a manifest over the byte cap', async () => {
    const metadata = { name: 'n', guide: 'g'.repeat(MAX_MANIFEST_BYTES) };
    await expect(pack({ metadata })()).rejects.toThrow(`bundle manifest.json exceeds the ${MAX_MANIFEST_BYTES} byte cap`);
  });

  it('refuses a non-integer number or a lone surrogate in the signed document', () => {
    expect(() => canonicalizeManifest({ a: 1.5 })).toThrow(/integer/);
    expect(() => canonicalizeManifest({ a: '\ud800' })).toThrow(/surrogate/);
  });
});

describe('the publisher key', () => {
  it('is generated fresh and signs', async () => {
    const [a, b] = [await generatePublisherKey(), await generatePublisherKey()];
    expect(hex(a.seed)).not.toBe(hex(b.seed));
    expect(signerIdOf(a)).toMatch(/^did:key:z6Mk/);
    await expect(packComputePackage(base, a)).resolves.toBeInstanceOf(Uint8Array);
  });

  it('round-trips through its backup, in the shape mero-sign reads', async () => {
    const k = await generatePublisherKey();
    const bytes = exportPublisherKey(k);
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    expect(Object.keys(parsed).sort()).toEqual(['private_key', 'public_key', 'signer_id']);
    expect(parsed.private_key).toBe(Buffer.from(k.seed).toString('base64url'));
    const back = await importPublisherKey(bytes);
    expect(hex(back.seed)).toBe(hex(k.seed));
    expect(signerIdOf(back)).toBe(parsed.signer_id);
  });

  it.each([
    ['not json', 'nope'],
    ['a short seed', JSON.stringify({ private_key: 'AAAA' })],
    ['a signer id that is not the seed\'s', JSON.stringify({ private_key: Buffer.alloc(32).toString('base64url'), signer_id: 'did:key:zX' })],
    ['a public key that is not the seed\'s', JSON.stringify({ private_key: Buffer.alloc(32).toString('base64url'), public_key: Buffer.alloc(32, 1).toString('base64url') })],
  ])('refuses a backup with %s', async (_n, text) => {
    await expect(importPublisherKey(new TextEncoder().encode(text))).rejects.toThrow();
  });
});

function signerIdOfSync(manifest: { signerId: string }) {
  return manifest.signerId;
}
