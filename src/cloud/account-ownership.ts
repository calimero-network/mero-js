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

/** The `ownership_proof` body for `POST /api/cloud/me/namespaces/{ns}/enable-ha`. */
export interface AccountOwnershipProof {
  kind: 'account';
  /** hex `AccountProof<DeviceCert>`, the account's credential. */
  credential: string;
  /** base64 UTF-8 JSON, the claim. */
  signed_payload: string;
  /** base64 ed25519 by the certified device key. */
  signature: string;
}

export interface AccountOwnershipClaimInput {
  /** The namespace, hex: the id `foundNamespace` returned. */
  namespaceId: string;
  /** The founding account, hex. */
  accountId: string;
  /** The salt `foundNamespace` returned, hex (32 bytes). */
  salt: string;
  /** The cloud login's email: the claim is for this login only. */
  subject: string;
  /** The account's credential, hex `AccountProof<DeviceCert>`. */
  credential: string;
  deviceSecret?: string;
  signer?: Signer;
  /** Lifetime in ms; default one minute, at most five. */
  ttlMs?: number;
  /** For tests. */
  now?: () => number;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

const hex32 = (value: string, what: string) => {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${what} must be 64 hex characters`);
  return value.toLowerCase();
};

export async function signAccountOwnershipClaim(input: AccountOwnershipClaimInput): Promise<AccountOwnershipProof> {
  const ttl = input.ttlMs ?? DEFAULT_TTL_MS;
  if (!(ttl > 0 && ttl <= MAX_TTL_MS)) throw new Error(`ttlMs must be in (0, ${MAX_TTL_MS}]`);
  if (!input.subject) throw new Error('subject must be the cloud login email');
  const signer = await resolveSigner(input.deviceSecret, input.signer, 'deviceSecret');
  const issued = (input.now ?? Date.now)();
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  const payload = new TextEncoder().encode(
    JSON.stringify({
      v: 1,
      audience: 'mdma:enable-ha-namespace',
      group_id: hex32(input.namespaceId, 'namespaceId'),
      account_id: hex32(input.accountId, 'accountId'),
      salt: hex32(input.salt, 'salt'),
      subject: input.subject,
      nonce,
      issued_at_ms: issued,
      expires_at_ms: issued + ttl,
    }),
  );
  const signature = await signer.sign(concat(DOMAIN, payload));
  return { kind: 'account', credential: input.credential, signed_payload: base64(payload), signature: base64(signature) };
}
