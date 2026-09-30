/**
 * Minting and certifying a device offline, with a key that never reaches a node.
 *
 * This is the second half of the keyholder story. `signWarrant` lets an account
 * with no node *write*; this lets one exist in the first place — an account root
 * certifies a device, and the resulting credential is what a joiner presents.
 *
 * As with the warrant signer, the risk is that this reproduces core's encoding
 * and has to keep doing so. The answer is the same: a golden vector here, and an
 * e2e that diffs this output against `merod account sign-cert` byte for byte.
 *
 * Everything below is derived from core:
 *
 * - `DeviceCert::signing_payload` — `crates/account/src/device.rs`
 * - `DeviceId::mint`              — `crates/primitives/src/identity.rs`
 * - `AccountProof` / `AccountGenesis` borsh layout — `crates/account/src/{signed,account}.rs`
 */
import {
  concat,
  derivePublicKey,
  domainHash,
  fromHex,
  hex,
  u32le,
  verifySignature,
} from '../crypto/internal.js';
import { resolveSigner, type Signer } from '../signer/signer.js';

const CERT_DOMAIN = new TextEncoder().encode('calimero.device.cert.v1');
const ACCOUNT_ID_DOMAIN = new TextEncoder().encode('calimero.account.genesis.v1');
const DEVICE_ID_DOMAIN = new TextEncoder().encode('calimero.device.id.v1');

/** `AccountGenesis::version`, which the credential's borsh encoding leads with. */
/**
 * Core's `ACCOUNT_GENESIS_VERSION`. It is part of the `AccountId` preimage, so
 * this value decides which account a root key names — a mismatch does not fail
 * as a version error at the edge, it silently derives a different account and
 * core refuses the credential as unverifiable.
 *
 * `2` since the genesis dropped its per-namespace nonce. This was `1`, which
 * produced credentials current core rejects outright; the shape was already v2,
 * only the tag was stale.
 */
const ACCOUNT_GENESIS_VERSION = 2;

/** Byte length of an `AccountProof<DeviceCert>` with an empty handoff chain. */
const ACCOUNT_PROOF_BYTES = 237;

/** What a root certifies about one device. */
export interface DeviceCertInput {
  /**
   * The account root's signing secret, 64 hex. Signs the certificate.
   *
   * Mutually exclusive with {@link DeviceCertInput.signer}, and the weaker of
   * the two in a browser: this is the one key in the system with nothing above
   * it to revoke it, so a page that can read it can take the account for good.
   * Prefer `signer` anywhere the root is held rather than loaded.
   */
  rootSecret?: string;
  /**
   * The account root's signer — use instead of {@link DeviceCertInput.rootSecret}
   * when the root is a key this page may use and cannot read.
   *
   * This is what lets the certifying page keep its root as a non-extractable
   * `CryptoKey`: {@link accountRootSignerFromPhrase} hands one back, and script
   * injected into the page can then mint certificates only while the page is
   * open, rather than walking off with the account.
   */
  signer?: Signer;
  /** The device being certified, 64 hex — see {@link mintDeviceId}. */
  device: string;
  /** The key that device signs with, 64 hex. */
  signPublicKey: string;
  /** The key the group key is delivered to, 64 hex (X25519). */
  kemPublicKey: string;
  /**
   * Must strictly exceed any epoch already folded for this device.
   *
   * The projection refuses a link that does not advance it, so a re-issued
   * certificate reusing an epoch is inert rather than a rollback.
   */
  deviceEpoch: number;
}

/**
 * Mint a device id: `H(DEVICE_ID_DOMAIN, account ‖ nonce)`.
 *
 * Derived from the account and a fresh nonce rather than from the device's keys,
 * so rotating a keypair keeps the replica identity — and with it the counter
 * slots and HLC lineage — intact.
 */
export async function mintDeviceId(
  account: string,
  nonce: Uint8Array,
): Promise<string> {
  if (nonce.length !== 16) {
    throw new Error(`nonce must be 16 bytes, got ${nonce.length}`);
  }
  const accountBytes = fromHex(account, 'account', 32);
  return hex(await domainHash(DEVICE_ID_DOMAIN, [accountBytes, nonce]));
}

/**
 * The 32 bytes a root signs to certify a device.
 *
 * Both keys are covered, so neither the signing key nor the delivery key can be
 * substituted into a certificate that otherwise verifies — which is what stops a
 * relay carrying someone's credential from making itself the reader.
 */
export async function deviceCertPayload(input: {
  account: string;
  device: string;
  signPublicKey: string;
  kemPublicKey: string;
  keyEpoch: number;
  deviceEpoch: number;
}): Promise<Uint8Array> {
  return domainHash(CERT_DOMAIN, [
    fromHex(input.account, 'account', 32),
    fromHex(input.device, 'device', 32),
    fromHex(input.signPublicKey, 'signPublicKey', 32),
    fromHex(input.kemPublicKey, 'kemPublicKey', 32),
    u32le(input.keyEpoch),
    u32le(input.deviceEpoch),
  ]);
}

/**
 * Borsh-encode an `AccountProof<DeviceCert>` — what core calls a
 * `JoinAccountCredential`.
 *
 * Extracted so the device-cert path and the namespace-op signer encode this from
 * one implementation. Two copies of a borsh layout drift silently: the encoding
 * is only checked by a peer rejecting a signature, which points at the signature
 * rather than at whichever copy went stale.
 *
 * Layout is `AccountProof { genesis, chain, statement }`:
 * `AccountGenesis` (version u8 + root pk 32) + `chain` (empty Vec, u32 len) +
 * `DeviceCert` (account 32 + device 32 + sign pk 32 + kem pk 32 + key_epoch u32
 * + device_epoch u32 + signature 64) = 237 bytes with an empty chain.
 */
export function accountProofBytes(input: {
  rootPublicKey: Uint8Array;
  account: string;
  device: string;
  signPublicKey: string;
  kemPublicKey: string;
  keyEpoch: number;
  deviceEpoch: number;
  signature: Uint8Array;
}): Uint8Array {
  return concat(
    new Uint8Array([ACCOUNT_GENESIS_VERSION]),
    input.rootPublicKey,
    u32le(0),
    fromHex(input.account, 'account', 32),
    fromHex(input.device, 'device', 32),
    fromHex(input.signPublicKey, 'signPublicKey', 32),
    fromHex(input.kemPublicKey, 'kemPublicKey', 32),
    u32le(input.keyEpoch),
    u32le(input.deviceEpoch),
    input.signature,
  );
}

/**
 * Certify a device, returning the hex credential `merod account sign-cert`
 * prints — a borsh-encoded `AccountProof<DeviceCert>`.
 *
 * The layout, field for field, is core's:
 *
 * ```
 * AccountProof { genesis: AccountGenesis, chain: Vec<RootKeyHandoff>, statement: DeviceCert }
 *   AccountGenesis { version: u8, root_sign_pk: [u8; 32] }
 *   chain          → u32-LE count, then that many handoffs
 *   DeviceCert     { account, device, sign_pk, kem_pk: [u8; 32] x4,
 *                    key_epoch: u32, device_epoch: u32, signature: [u8; 64] }
 * ```
 *
 * Borsh for plain fixed-width data is concatenation; the only variable part is
 * the chain's length prefix. `chain` is empty here for the same reason it is in
 * `sign-cert`: a root that has never been handed off signs directly, and a
 * handoff chain is only needed once it has.
 *
 * `keyEpoch` is 0 for the same reason — it names the root epoch that signed, and
 * an un-rotated root is at 0. Re-signing after a handoff is a separate flow that
 * needs the chain, so this deliberately does not take it as an argument rather
 * than accepting a value it would then have to ignore.
 */
export async function signDeviceCert(input: DeviceCertInput): Promise<string> {
  const signer = await resolveSigner(input.rootSecret, input.signer, 'rootSecret');
  // The signer names its own key, so the account is read off it rather than
  // derived from material this function may not have.
  const rootPublicKey = fromHex(signer.publicKey, 'signer.publicKey', 32);
  const account = await accountForRootPublicKey(signer.publicKey);

  const keyEpoch = 0;
  const payload = await deviceCertPayload({
    account,
    device: input.device,
    signPublicKey: input.signPublicKey,
    kemPublicKey: input.kemPublicKey,
    keyEpoch,
    deviceEpoch: input.deviceEpoch,
  });

  const signature = await signer.sign(payload);

  const credential = accountProofBytes({
    rootPublicKey,
    account,
    device: input.device,
    signPublicKey: input.signPublicKey,
    kemPublicKey: input.kemPublicKey,
    keyEpoch,
    deviceEpoch: input.deviceEpoch,
    signature,
  });

  return hex(credential);
}

/** A credential read back apart, field for field. */
export interface DeviceCredential {
  /** The account root that signed, 64 hex — `AccountGenesis::root_sign_pk`. */
  rootPublicKey: string;
  /** The account the certificate names, 64 hex. */
  account: string;
  /** The device it certifies, 64 hex. */
  device: string;
  /** That device's ed25519 signing key, 64 hex. */
  signPublicKey: string;
  /** That device's X25519 key-delivery key, 64 hex. */
  kemPublicKey: string;
  keyEpoch: number;
  deviceEpoch: number;
  /** The root's signature over {@link deviceCertPayload}, 128 hex. */
  signature: string;
}

/**
 * Read an `AccountProof<DeviceCert>` back apart — the inverse of
 * {@link accountProofBytes}, and deliberately in the same file as it.
 *
 * A decoder that lives away from its encoder drifts: the layout is only checked
 * by a peer rejecting a signature, which points at the signature rather than at
 * whichever copy went stale.
 *
 * This checks the *shape* and nothing else — it says what the bytes claim, not
 * whether the claim is true. {@link verifyDeviceCredential} is the one that
 * answers that, and it is the one a caller acting on a credential from another
 * origin wants.
 *
 * @throws on a wrong genesis version, a non-empty handoff chain, or trailing
 * bytes. A non-empty chain is refused rather than skipped: verifying a handed-off
 * root means walking the chain, and a decoder that returned the statement while
 * ignoring who was entitled to sign it would hand a verifier the wrong root.
 */
export function parseDeviceCredential(credential: string): DeviceCredential {
  const bytes = fromHex(
    credential,
    'credential',
    // Fixed-width with an empty chain: 1 + 32 + 4 + 32*4 + 4 + 4 + 64.
    ACCOUNT_PROOF_BYTES,
  );

  if (bytes[0] !== ACCOUNT_GENESIS_VERSION) {
    throw new Error(
      `this credential has account genesis version ${bytes[0]}, not ` +
        `${ACCOUNT_GENESIS_VERSION} — it names a different account than its root ` +
        'key derives here, and core would refuse it',
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chainLength = view.getUint32(33, true);
  if (chainLength !== 0) {
    throw new Error(
      `this credential carries a ${chainLength}-handoff root chain, which this ` +
        'SDK cannot verify yet — the signing root is not the genesis root, so ' +
        'checking it means walking the chain',
    );
  }

  const at = (offset: number, length: number) =>
    hex(bytes.subarray(offset, offset + length));

  return {
    rootPublicKey: at(1, 32),
    account: at(37, 32),
    device: at(69, 32),
    signPublicKey: at(101, 32),
    kemPublicKey: at(133, 32),
    keyEpoch: view.getUint32(165, true),
    deviceEpoch: view.getUint32(169, true),
    signature: at(173, 64),
  };
}

/**
 * Check that a credential says what it claims: the root signed it, and the
 * account it names is the one that root derives.
 *
 * Both halves matter and neither implies the other. The signature says the
 * genesis root consented to these exact keys; the account derivation says the
 * certificate cannot have been re-pointed at a different account while keeping a
 * signature that verifies. A caller that checked only the first would accept a
 * certificate naming an account whose root never signed anything.
 *
 * What it does **not** establish is that the account is one the caller wanted.
 * Anyone can mint a root offline and certify any public key with it, so a
 * credential arriving from elsewhere proves a *consistent* account, not *your*
 * account — see `cloud/enrol-redirect.ts` for the binding that closes that.
 *
 * @throws with which check failed, rather than returning false — every failure
 * here is a credential that must not be stored, and a boolean gets ignored.
 */
export async function verifyDeviceCredential(
  credential: string,
): Promise<DeviceCredential> {
  const parsed = parseDeviceCredential(credential);

  const derived = await accountForRootPublicKey(parsed.rootPublicKey);
  if (derived !== parsed.account) {
    throw new Error(
      `this credential names account ${parsed.account}, but its root key ` +
        `derives ${derived} — the certificate was re-pointed at another account`,
    );
  }

  const signed = await verifySignature(
    parsed.rootPublicKey,
    fromHex(parsed.signature, 'signature', 64),
    await deviceCertPayload(parsed),
  );
  if (!signed) {
    throw new Error(
      `the root key of account ${parsed.account} did not sign this certificate`,
    );
  }

  return parsed;
}

/** The account this root owns — the content address of its genesis. */
export async function accountForRoot(rootSecret: string): Promise<string> {
  return accountForRootPublicKey(hex(await derivePublicKey(rootSecret)));
}

/**
 * The same account id, from the root's **public** half.
 *
 * The form a root that cannot be exported needs. It is also the honest shape of
 * the derivation: an account id is a function of the public key, and asking for
 * the secret only ever meant "let me derive the public key first".
 *
 * @param rootPublicKey the root's ed25519 public key, 64 hex
 */
export async function accountForRootPublicKey(
  rootPublicKey: string,
): Promise<string> {
  return hex(
    await domainHash(ACCOUNT_ID_DOMAIN, [
      concat(
        new Uint8Array([ACCOUNT_GENESIS_VERSION]),
        fromHex(rootPublicKey, 'rootPublicKey', 32),
      ),
    ]),
  );
}
