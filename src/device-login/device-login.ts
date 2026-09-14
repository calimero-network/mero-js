/**
 * Log in to a node with a device key the account root certified. (PoC)
 *
 * The node issues a single-use challenge, the device signs a domain-separated
 * digest over it, and presents the certificate for its key. No password is
 * involved, and the same key signs warrants for writes, so one credential covers
 * reading through a session and writing as the account.
 *
 * The key is reached through a `Signer`, never a hex seed, so it can be a
 * non-extractable WebCrypto key, a desktop keychain entry or a phone's secure
 * element.
 */
import { concat, domainHash, fromHex, hex } from '../crypto/internal.js';

/** Core's `DEVICE_LOGIN_SIGN_DOMAIN`. */
export const DEVICE_LOGIN_DOMAIN = new TextEncoder().encode('calimero.auth.pop.v1');

/** Something that can sign as a device without handing over its secret. */
export interface Signer {
  /** The device's Ed25519 public key, 32 bytes. */
  publicKey: Uint8Array;
  /** An Ed25519 signature over `message`, 64 bytes. */
  sign(message: Uint8Array): Promise<Uint8Array>;
}

/** A signer over a WebCrypto Ed25519 key pair whose private half need not be extractable. */
export async function signerFromCryptoKeyPair(pair: CryptoKeyPair): Promise<Signer> {
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return {
    publicKey,
    async sign(message) {
      return new Uint8Array(
        await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, message),
      );
    },
  };
}

/** The 32-byte digest a device signs to log in with `challenge`. */
export async function deviceLoginPayload(
  challenge: Uint8Array,
  devicePublicKey: Uint8Array,
): Promise<Uint8Array> {
  if (challenge.length !== 32) throw new Error('challenge must be 32 bytes');
  if (devicePublicKey.length !== 32) throw new Error('device public key must be 32 bytes');
  return domainHash(DEVICE_LOGIN_DOMAIN, [challenge, devicePublicKey]);
}

export interface DeviceLoginInput {
  /** The node's base URL, e.g. `http://127.0.0.1:3621`. */
  nodeUrl: string;
  signer: Signer;
  /** Hex borsh `AccountProof<DeviceCert>` certifying the signer's key. */
  credential: string;
  /** Sent as `client_name`; defaults to the node URL, which binds the token to it. */
  clientName?: string;
  fetchImpl?: typeof fetch;
}

export interface DeviceSession {
  accessToken: string;
  refreshToken: string;
}

function tokensFrom(body: unknown): DeviceSession {
  const record = (body ?? {}) as Record<string, unknown>;
  const data = (record.data ?? record) as Record<string, unknown>;
  const accessToken = data.access_token;
  const refreshToken = data.refresh_token;
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
    throw new Error('the node returned no tokens');
  }
  return { accessToken, refreshToken };
}

/** Challenge, sign, exchange: returns a node session for this device. */
export async function loginWithDevice(input: DeviceLoginInput): Promise<DeviceSession> {
  const doFetch = input.fetchImpl ?? fetch;
  const base = input.nodeUrl.replace(/\/+$/, '');

  const challengeResponse = await doFetch(`${base}/auth/challenge`, { method: 'POST' });
  if (!challengeResponse.ok) {
    throw new Error(`challenge refused: HTTP ${challengeResponse.status}`);
  }
  const { challenge } = (await challengeResponse.json()) as { challenge: string };
  const challengeBytes = fromHex(challenge, 'challenge', 32);

  const payload = await deviceLoginPayload(challengeBytes, input.signer.publicKey);
  const signature = await input.signer.sign(payload);

  const tokenResponse = await doFetch(`${base}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_method: 'device_key',
      public_key: hex(input.signer.publicKey),
      client_name: input.clientName ?? base,
      permissions: [],
      timestamp: Math.floor(Date.now() / 1000),
      provider_data: {
        challenge,
        signature: hex(signature),
        credential: input.credential,
      },
    }),
  });
  const body = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok) {
    const reason = (body as { error?: string }).error ?? `HTTP ${tokenResponse.status}`;
    throw new Error(`device login refused: ${reason}`);
  }
  return tokensFrom(body);
}

/** Exposed for tests. */
export const __internal = { concat, tokensFrom };
