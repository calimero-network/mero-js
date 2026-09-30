/**
 * Scoping a device offline: which applications a device of an account may speak
 * for, signed by the account root.
 *
 * The certificate from {@link signDeviceCert} says *this key is a device of the
 * account*. It does not say where: that is this statement, and a namespace binds
 * a device only when both arrive together. A node that pairs a device signs the
 * scope for you; an account with **no node** has to sign it itself, next to the
 * certificate, and hand both to a relay's `linkAccountDevice`.
 *
 * Derived from core:
 *
 * - `DeviceScope` and `DeviceScope::signing_payload` — `crates/account/src/scope.rs`
 * - `DEVICE_SCOPE_SIGN_DOMAIN`                       — `crates/account/src/domain.rs`
 * - `AccountProof` / `AccountGenesis` borsh layout   — `crates/account/src/{signed,account}.rs`
 *
 * The unit tests pin vectors produced by core's own `DeviceScope::sign`.
 */
import { concat, domainHash, fromHex, hex, u32le } from '../crypto/internal.js';
import { resolveSigner, type Signer } from '../signer/signer.js';
import { accountForRootKey, ACCOUNT_GENESIS_VERSION } from './device-cert.js';

const SCOPE_DOMAIN = new TextEncoder().encode('calimero.device.scope.v1');

/** What a root scopes one device to. */
export interface DeviceScopeInput {
  /**
   * The account root's signing secret, 64 hex. Pass this or {@link signer}.
   */
  rootSecret?: string;
  /**
   * The account root as a {@link Signer} — for a root that cannot be exported.
   * Its `publicKey` is the genesis key the proof carries, and the account is
   * derived from it.
   */
  signer?: Signer;
  /** The device being scoped, 64 hex — the one its certificate names. */
  device: string;
  /**
   * Application ids the device may speak for, 64 hex each. **Empty means all of
   * them**, which is also what the default is.
   *
   * A namespace binds the device only when its application is listed here (or
   * the list is empty), so a scope naming the wrong application yields a relay
   * refusal of `400`, not a binding.
   */
  applications?: readonly string[];
  /**
   * Orders scopes for this device: only a higher one supersedes. 0 for a
   * device's first scope.
   */
  scopeEpoch?: number;
}

/**
 * The 32 bytes a root signs to scope a device: `domain_hash` over account,
 * device, `scope_epoch` (u32 LE), `key_epoch` (u32 LE), then each application id
 * as its own length-prefixed part.
 */
export async function deviceScopePayload(input: {
  account: string;
  device: string;
  applications: readonly string[];
  scopeEpoch: number;
  keyEpoch: number;
}): Promise<Uint8Array> {
  return domainHash(SCOPE_DOMAIN, [
    fromHex(input.account, 'account', 32),
    fromHex(input.device, 'device', 32),
    u32le(input.scopeEpoch),
    u32le(input.keyEpoch),
    ...input.applications.map((a, i) => fromHex(a, `applications[${i}]`, 32)),
  ]);
}

/**
 * Scope a device, returning the hex `AccountProof<DeviceScope>` a relay's
 * `linkAccountDevice` takes beside the credential.
 *
 * ```
 * AccountProof { genesis: AccountGenesis, chain: Vec<RootKeyHandoff>, statement: DeviceScope }
 *   AccountGenesis { version: u8, root_sign_pk: [u8; 32] }
 *   chain          → u32-LE count (0 here)
 *   DeviceScope    { account, device: [u8; 32] x2, applications: Vec<[u8; 32]>,
 *                    scope_epoch: u32, key_epoch: u32, signature: [u8; 64] }
 * ```
 *
 * `chain` is empty and `key_epoch` 0 for the reason they are in
 * {@link signDeviceCert}: a root that was never handed off signs directly.
 */
export async function signDeviceScope(input: DeviceScopeInput): Promise<string> {
  const signer = await resolveSigner(input.rootSecret, input.signer, 'rootSecret');
  const rootPublicKey = fromHex(signer.publicKey, 'signer.publicKey', 32);
  const account = await accountForRootKey(rootPublicKey);
  const applications = input.applications ?? [];
  const scopeEpoch = input.scopeEpoch ?? 0;
  // `u32le` would wrap a negative or oversized value into a different epoch
  // rather than refuse it, and the scope would then order itself wrongly.
  if (!Number.isInteger(scopeEpoch) || scopeEpoch < 0 || scopeEpoch > 0xffff_ffff) {
    throw new Error(`scopeEpoch must be a u32, got ${scopeEpoch}`);
  }
  const keyEpoch = 0;

  const payload = await deviceScopePayload({
    account,
    device: input.device,
    applications,
    scopeEpoch,
    keyEpoch,
  });
  const signature = await signer.sign(payload);
  if (signature.length !== 64) {
    throw new Error(`signer returned ${signature.length} bytes, expected a 64-byte Ed25519 signature`);
  }

  return hex(
    concat(
      new Uint8Array([ACCOUNT_GENESIS_VERSION]),
      rootPublicKey,
      u32le(0),
      fromHex(account, 'account', 32),
      fromHex(input.device, 'device', 32),
      u32le(applications.length),
      ...applications.map((a, i) => fromHex(a, `applications[${i}]`, 32)),
      u32le(scopeEpoch),
      u32le(keyEpoch),
      signature,
    ),
  );
}
