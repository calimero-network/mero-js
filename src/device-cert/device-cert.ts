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
  importSigningKey,
  u32le,
} from '../crypto/internal.js';

const CERT_DOMAIN = new TextEncoder().encode('calimero.device.cert.v1');
const ACCOUNT_ID_DOMAIN = new TextEncoder().encode('calimero.account.genesis.v1');
const DEVICE_ID_DOMAIN = new TextEncoder().encode('calimero.device.id.v1');

/** `AccountGenesis::version`, which the credential's borsh encoding leads with. */
const ACCOUNT_GENESIS_VERSION = 1;

/** What a root certifies about one device. */
export interface DeviceCertInput {
  /** The account root's signing secret, 64 hex. Signs the certificate. */
  rootSecret: string;
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
  const rootPublicKey = await derivePublicKey(input.rootSecret);
  const account = hex(
    await domainHash(ACCOUNT_ID_DOMAIN, [
      concat(new Uint8Array([ACCOUNT_GENESIS_VERSION]), rootPublicKey),
    ]),
  );

  const keyEpoch = 0;
  const payload = await deviceCertPayload({
    account,
    device: input.device,
    signPublicKey: input.signPublicKey,
    kemPublicKey: input.kemPublicKey,
    keyEpoch,
    deviceEpoch: input.deviceEpoch,
  });

  const key = await importSigningKey(input.rootSecret);
  const signature = new Uint8Array(
    await crypto.subtle.sign('Ed25519', key, payload),
  );

  const credential = concat(
    // AccountGenesis
    new Uint8Array([ACCOUNT_GENESIS_VERSION]),
    rootPublicKey,
    // chain: Vec<RootKeyHandoff>, empty
    u32le(0),
    // DeviceCert
    fromHex(account, 'account', 32),
    fromHex(input.device, 'device', 32),
    fromHex(input.signPublicKey, 'signPublicKey', 32),
    fromHex(input.kemPublicKey, 'kemPublicKey', 32),
    u32le(keyEpoch),
    u32le(input.deviceEpoch),
    signature,
  );

  return hex(credential);
}

/** The account this root owns — the content address of its genesis. */
export async function accountForRoot(rootSecret: string): Promise<string> {
  const rootPublicKey = await derivePublicKey(rootSecret);
  return hex(
    await domainHash(ACCOUNT_ID_DOMAIN, [
      concat(new Uint8Array([ACCOUNT_GENESIS_VERSION]), rootPublicKey),
    ]),
  );
}
