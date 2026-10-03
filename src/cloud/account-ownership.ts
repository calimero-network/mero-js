/**
 * The ownership claim an account with no node presents to enable HA for a
 * namespace it founded through a relay (mdma#415).
 *
 * A node proves ownership with a proof signed by the namespace's group key,
 * which a nodeless account does not hold. The account instead proves it is the
 * FOUNDER: a namespace id is `domain_hash("calimero.namespace.id.v1",
 * [founder_account, salt])`, so only the founding account, with the salt its
 * founding returned, reproduces it. Its device key signs the claim, and its
 * certificate says whose device that is. The cloud also requires the login to
 * be linked to that account.
 *
 * Signature input: `"calimero.mdma.account-ownership-claim.v1\0" ‖ payload`,
 * where `payload` is the UTF-8 JSON sent (base64) as `signed_payload`.
 */
import { concat } from '../crypto/internal.js';
import { resolveSigner, type Signer } from '../signer/signer.js';

const DOMAIN = new TextEncoder().encode('calimero.mdma.account-ownership-claim.v1\0');
/** What the cloud accepts; it caps a claim's lifetime at five minutes. */
const DEFAULT_TTL_MS = 60_000;
const MAX_TTL_MS = 5 * 60_000;

/**
 * The `ownership_proof` body for `POST /api/cloud/me/namespaces/{ns}/enable-ha`
 * and for `POST /api/cloud/accounts/{account}/namespaces/{ns}/enable-ha`.
 */
export interface AccountOwnershipProof {
  kind: 'account';
  /** hex `AccountProof<DeviceCert>`, the account's credential. */
  credential: string;
  /** base64 UTF-8 JSON, the claim. */
  signed_payload: string;
  /** base64 ed25519 by the certified device key. */
  signature: string;
}

/** What every account claim needs; the audience and `subject` differ per route. */
interface AccountClaimBase {
  /** The namespace, hex: the id `foundNamespace` returned. */
  namespaceId: string;
  /** The founding account, hex. */
  accountId: string;
  /** The salt `foundNamespace` returned, hex (32 bytes). */
  salt: string;
  /** The account's credential, hex `AccountProof<DeviceCert>`. */
  credential: string;
  deviceSecret?: string;
  signer?: Signer;
  /** Lifetime in ms; default one minute, at most five. */
  ttlMs?: number;
  /** For tests. */
  now?: () => number;
}

export interface AccountOwnershipClaimInput extends AccountClaimBase {
  /** The cloud login's email: the claim is for this login only. */
  subject: string;
}

/**
 * Input for {@link signAccountHaClaim}: the same as the session claim, minus
 * `subject` — there is no login to bind it to.
 */
export interface AccountHaClaimInput extends AccountClaimBase {
  /**
   * The relay that founded the namespace (the delegated session's `relayUrl`).
   * Signed into the claim so nobody forwarding it can swap it: the cloud
   * resolves it to one of its own fleet relays and hands that relay's
   * addresses to the fleet node as its admitter. Leave it out when unknown.
   */
  relayUrl?: string;
}

/** The cloud's limit on `relay_url`. */
const MAX_RELAY_URL = 1024;

/** The audience of the session route's claim (`/api/cloud/me/...`). */
export const ACCOUNT_OWNERSHIP_AUDIENCE = 'mdma:enable-ha-namespace';
/** The audience of the anonymous account route's claim (`/api/cloud/accounts/...`). */
export const ACCOUNT_HA_AUDIENCE = 'mdma:enable-ha-namespace-as-account';

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

const hex32 = (value: string, what: string) => {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${what} must be 64 hex characters`);
  return value.toLowerCase();
};

/**
 * Sign one claim. `subject` is spliced in after `salt` only when given, so the
 * session claim keeps its exact field order and the account claim has no
 * `subject` key at all (not a null one: the cloud tells the two apart by it).
 */
async function signClaim(
  input: AccountClaimBase,
  audience: string,
  subject: string | undefined,
  relayUrl?: string,
): Promise<AccountOwnershipProof> {
  if (relayUrl !== undefined && !(relayUrl.length > 0 && relayUrl.length <= MAX_RELAY_URL)) {
    throw new Error(`relayUrl must be a non-empty string of at most ${MAX_RELAY_URL} characters`);
  }
  const ttl = input.ttlMs ?? DEFAULT_TTL_MS;
  if (!(ttl > 0 && ttl <= MAX_TTL_MS)) throw new Error(`ttlMs must be in (0, ${MAX_TTL_MS}]`);
  const groupId = hex32(input.namespaceId, 'namespaceId');
  const accountId = hex32(input.accountId, 'accountId');
  const salt = hex32(input.salt, 'salt');
  const signer = await resolveSigner(input.deviceSecret, input.signer, 'deviceSecret');
  const issued = (input.now ?? Date.now)();
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  const payload = new TextEncoder().encode(
    JSON.stringify({
      v: 1,
      audience,
      group_id: groupId,
      account_id: accountId,
      salt,
      ...(subject === undefined ? {} : { subject }),
      nonce,
      issued_at_ms: issued,
      expires_at_ms: issued + ttl,
      ...(relayUrl === undefined ? {} : { relay_url: relayUrl }),
    }),
  );
  const signature = await signer.sign(concat(DOMAIN, payload));
  return { kind: 'account', credential: input.credential, signed_payload: base64(payload), signature: base64(signature) };
}

/** The founder's claim for the SESSION route, bound to one cloud login (`subject`). */
export async function signAccountOwnershipClaim(input: AccountOwnershipClaimInput): Promise<AccountOwnershipProof> {
  if (!input.subject) throw new Error('subject must be the cloud login email');
  return signClaim(input, ACCOUNT_OWNERSHIP_AUDIENCE, input.subject);
}

/**
 * The founder's claim for the ANONYMOUS account route
 * (`POST /api/cloud/accounts/{account}/namespaces/{ns}/enable-ha`): no cloud
 * session, so no `subject`, and its own audience so a claim minted for one
 * route can never be replayed on the other. The cloud finds the user to bill
 * through the account's wallet link instead.
 */
export async function signAccountHaClaim(input: AccountHaClaimInput): Promise<AccountOwnershipProof> {
  return signClaim(input, ACCOUNT_HA_AUDIENCE, undefined, input.relayUrl);
}
