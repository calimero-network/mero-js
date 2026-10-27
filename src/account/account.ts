/**
 * Creating an account root, and proving you hold one.
 *
 * `signDeviceCert` assumes an account root already exists and asks only what it
 * certifies. This is the step before that: where the root comes from, how a
 * person keeps it, and how they show a server they have it.
 *
 * Two things live here because they are the two halves of onboarding:
 *
 * - {@link generateAccountRoot} mints a root and hands back a 24-word recovery
 *   phrase. The phrase *is* the key — see the interop note on that function —
 *   so a holder who writes it down can restore the account on any device.
 * - {@link signAccountLink} signs a cloud-issued challenge with that root, which
 *   is how Calimero Cloud binds a billing login to a Calimero account.
 * - {@link signAccountLogin} signs a different cloud-issued challenge with the
 *   same root to claim the account outright and open a session as it — the
 *   password-free counterpart to signing in with Google.
 *
 * Both are offline and hold no state. Nothing here talks to a node or to the
 * cloud; `CloudClient.linkAccount` is the wrapper that does.
 *
 * Derived from:
 *
 * - `ACCOUNT_LINK_DOMAIN` / `ACCOUNT_LOGIN_DOMAIN`, and
 *   `verify_account_link_proof` / `verify_login_proof` — mdma's
 *   `manager/app/account_proof.py`
 * - the account derivation — `accountForRoot` in `../device-cert`, which is
 *   core's `AccountId` preimage
 */
import {
  concat,
  derivePublicKey,
  fromHex,
  hex,
} from '../crypto/internal.js';
import { accountForRoot, accountForRootPublicKey } from '../device-cert/index.js';
import { resolveSigner, signerFromSecret, type Signer } from '../signer/signer.js';
import { ENGLISH_WORDLIST } from './wordlist.js';

/**
 * mdma's `ACCOUNT_LINK_DOMAIN`, trailing NUL included.
 *
 * Prefixed raw rather than run through `domainHash`: mdma verifies
 * `ed25519_verify(root_pk, ACCOUNT_LINK_DOMAIN ‖ nonce_utf8)` over exactly these
 * bytes. The separator is what stops a signature gathered here being replayable
 * into any other protocol that has a root sign opaque bytes, so it is not
 * cosmetic — and the NUL is part of it.
 */
const ACCOUNT_LINK_DOMAIN = new TextEncoder().encode(
  'calimero.mdma.account-link.v1\0',
);

/**
 * mdma's `ACCOUNT_LOGIN_DOMAIN`, trailing NUL included.
 *
 * A separate domain from {@link ACCOUNT_LINK_DOMAIN} because the two
 * exchanges are otherwise byte-identical — both are a root signature over a
 * cloud-issued nonce — and a signature gathered while linking is gathered from
 * someone already signed in and trusting the page. Without the separation it
 * would be replayable as a login by whoever collected it.
 */
const ACCOUNT_LOGIN_DOMAIN = new TextEncoder().encode(
  'calimero.mdma.account-login.v1\0',
);

/** Entropy carried by a phrase. 256 bits — 32 bytes, an ed25519 seed exactly. */
const ENTROPY_BITS = 256;
/** BIP39's checksum length: one bit per 32 bits of entropy. */
const CHECKSUM_BITS = ENTROPY_BITS / 32;
/** 11 bits per word, so (256 + 8) / 11 = 24 words. */
const PHRASE_WORDS = (ENTROPY_BITS + CHECKSUM_BITS) / 11;

/** An account root: the secret, the key it derives, and the account it names. */
export interface AccountRoot {
  /**
   * The root signing secret, 64 hex.
   *
   * The whole account. It signs device certificates and cloud links, and there
   * is no recovery path that does not go through it or its phrase — so it is
   * never sent anywhere, and in a browser it does not belong in `localStorage`.
   */
  secret: string;
  /** The root's ed25519 public key, 64 hex. Safe to publish. */
  publicKey: string;
  /** The account this root names, 64 hex — the content address of its genesis. */
  accountId: string;
}

/** An account root together with the phrase that restores it. */
export interface RecoverableAccountRoot extends AccountRoot {
  /**
   * A 24-word BIP39 English recovery phrase, single-space separated.
   *
   * Show it once, have the holder write it down, and do not keep it: it is the
   * secret in a form a person can copy by hand without transcription errors.
   */
  phrase: string;
}

/**
 * Mint a brand-new account root from the platform CSPRNG.
 *
 * This is the "generate a new key" half of cloud registration — the other half
 * being a root the holder already has, on a desktop app or a hardware key, which
 * signs without this ever running.
 *
 * **Interop note, and it matters.** The phrase encodes the root secret as BIP39
 * *entropy*, not as a BIP39 *seed*. A tool restoring it must call the equivalent
 * of `mnemonicToEntropy(phrase)` — 32 bytes — and use those bytes as the ed25519
 * secret directly. `mnemonicToSeed(phrase)`, which most wallet libraries reach
 * for first, runs PBKDF2 and returns 64 different bytes; feeding those in names
 * a different account and fails as "wrong account", not as a decoding error.
 * There is no passphrase and no BIP32 derivation path: the 24 words are the key.
 */
export async function generateAccountRoot(): Promise<RecoverableAccountRoot> {
  const entropy = crypto.getRandomValues(new Uint8Array(ENTROPY_BITS / 8));
  return withPhrase(hex(entropy), await encodePhrase(entropy));
}

/**
 * Restore an account root from its recovery phrase.
 *
 * Whitespace and case are normalised, so a phrase pasted out of a text editor
 * with a trailing newline or a stray double space restores fine. A word outside
 * the list, a wrong word count, or a failed checksum throws rather than
 * returning some other account — a single mistyped word is the common case, and
 * BIP39's checksum catches all but 1 in 256 of them.
 */
export async function accountRootFromPhrase(
  phrase: string,
): Promise<RecoverableAccountRoot> {
  const words = normalisePhrase(phrase);
  return withPhrase(hex(await decodePhrase(words)), words.join(' '));
}

/** The public half of a root you already hold, without re-deriving it by hand. */
export async function accountRootFromSecret(
  secret: string,
): Promise<AccountRoot> {
  // Validates the length and alphabet before anything derives from it, so a
  // truncated paste fails here rather than naming an unrelated account.
  fromHex(secret, 'secret', 32);
  return {
    secret,
    publicKey: hex(await derivePublicKey(secret)),
    accountId: await accountForRoot(secret),
  };
}

/** An account root held as a key this page may use and cannot read. */
export interface AccountRootSigner {
  /** The root's ed25519 public key, 64 hex. Safe to publish. */
  readonly publicKey: string;
  /** The account this root names, 64 hex. */
  readonly accountId: string;
  /**
   * Signs for the root. Pass it to `signDeviceCert({ signer })`.
   *
   * There is deliberately no `secret` beside this: the point of the shape is
   * that nothing downstream of here can be handed the account.
   */
  readonly signer: Signer;
}

/** A freshly minted root, with the phrase that is its only backup. */
export interface NewAccountRootSigner extends AccountRootSigner {
  /**
   * The 24-word phrase. Show it **once**, and store it nowhere.
   *
   * Unlike {@link RecoverableAccountRoot.phrase} this is the only copy that will
   * ever exist: the signer beside it cannot be exported, so a holder who does
   * not write these words down has no path back to the account from another
   * browser — and neither does anyone else, which is the trade.
   */
  readonly phrase: string;
}

/**
 * Mint a root that stays in this page and hand back its recovery phrase.
 *
 * The enrolment-time counterpart to {@link generateAccountRoot}: same BIP39
 * entropy, same account derivation, but the secret never leaves as a string a
 * caller could persist. What survives a reload is the `CryptoKey` inside the
 * signer — structured-clone it into IndexedDB — and what survives losing the
 * browser is the phrase.
 *
 * **On scrubbing.** The entropy is zeroed and the seed is imported
 * unexportable, but deriving the public half needs the seed as hex for an
 * instant, and a JS string cannot be wiped. So this narrows the window from
 * "for as long as the account exists" to "during this call" — a real
 * improvement, and not the same claim as "the secret never exists".
 */
export async function createAccountRootSigner(): Promise<NewAccountRootSigner> {
  const entropy = crypto.getRandomValues(new Uint8Array(ENTROPY_BITS / 8));
  // Encoded before the entropy is scrubbed, since the phrase is derived from it.
  const phrase = await encodePhrase(entropy);
  return { ...(await rootSignerFromEntropy(entropy)), phrase };
}

/**
 * Restore the same root in another browser from its phrase.
 *
 * This is what makes the design portable: the phrase names the entropy, the
 * entropy names the root, and the root names the account — so the same 24 words
 * reach the same account id on any device, with no server involved and nothing
 * to migrate.
 *
 * Throws on a bad word count, an unknown word, or a failed checksum rather than
 * returning some other account — see {@link accountRootFromPhrase}.
 */
export async function accountRootSignerFromPhrase(
  phrase: string,
): Promise<AccountRootSigner> {
  return rootSignerFromEntropy(await decodePhrase(normalisePhrase(phrase)));
}

async function rootSignerFromEntropy(
  entropy: Uint8Array,
): Promise<AccountRootSigner> {
  const signer = await signerFromSecret(hex(entropy), 'rootSecret');
  entropy.fill(0);
  return {
    publicKey: signer.publicKey,
    accountId: await accountForRootPublicKey(signer.publicKey),
    signer,
  };
}

/**
 * The account root, in either form a caller may hold it.
 *
 * Exists because the cloud entry points take the root **positionally** — the
 * whole argument is "the root" — so the two forms cannot be separate optional
 * fields the way {@link AccountLinkInput} has them.
 *
 * A `string` is the 64-hex secret. A {@link Signer} is a root this process may
 * use and cannot read: pass the `signer` from
 * {@link accountRootSignerFromPhrase}.
 */
export type RootSource = string | Signer;

/** A root's identity and how it signs, however the caller supplied it. */
export interface ResolvedRoot {
  signer: Signer;
  /** The root's ed25519 public key, 64 hex. */
  publicKey: string;
  /** The account it names, 64 hex. */
  accountId: string;
}

/** What a root is, however it was supplied: who it is, and how it signs. */
export async function resolveRoot(source: RootSource): Promise<ResolvedRoot> {
  const signer =
    typeof source === 'string'
      ? await signerFromSecret(source, 'rootSecret')
      : source;
  return identify(signer);
}

/**
 * The same, for entry points that take the two forms as separate optional
 * fields. Exactly one must be present — see {@link resolveSigner}.
 */
export async function resolveRootPair(
  rootSecret: string | undefined,
  signer: Signer | undefined,
): Promise<ResolvedRoot> {
  return identify(await resolveSigner(rootSecret, signer, 'rootSecret'));
}

async function identify(signer: Signer): Promise<ResolvedRoot> {
  return {
    signer,
    publicKey: signer.publicKey,
    accountId: await accountForRootPublicKey(signer.publicKey),
  };
}

/** What {@link signAccountLink} needs. */
export interface AccountLinkInput {
  /**
   * The account root's signing secret, 64 hex.
   *
   * Mutually exclusive with {@link AccountLinkInput.signer}. Prefer the signer
   * in a browser: this is the account, and nothing above it can revoke it.
   */
  rootSecret?: string;
  /** The root's signer — use instead of {@link AccountLinkInput.rootSecret}. */
  signer?: Signer;
  /**
   * The challenge from `GET /api/cloud/me/accounts/challenge`, verbatim.
   *
   * Signed as its UTF-8 bytes, not decoded first: mdma seals it as an opaque
   * string and verifies over the same string it issued.
   */
  nonce: string;
}

/**
 * Sign a cloud link challenge with the account root. Returns base64.
 *
 * Standard base64, not base64url — mdma decodes it with `validate=True`, so the
 * `-`/`_` alphabet is rejected outright rather than silently mis-decoded.
 *
 * Root-signed rather than device-signed on purpose: this is the credential
 * someone still holds after losing a device, which is the case linking exists to
 * serve.
 */
export async function signAccountLink(
  input: AccountLinkInput,
): Promise<string> {
  if (!input.nonce) throw new Error('nonce is required to sign an account link');
  const signer = await resolveSigner(input.rootSecret, input.signer, 'rootSecret');
  const signature = await signer.sign(
    concat(ACCOUNT_LINK_DOMAIN, new TextEncoder().encode(input.nonce)),
  );
  return base64(signature);
}

/** What {@link signAccountLogin} needs. */
export interface AccountLoginInput {
  /**
   * The account root's signing secret, 64 hex.
   *
   * Mutually exclusive with {@link AccountLoginInput.signer}.
   */
  rootSecret?: string;
  /** The root's signer — use instead of {@link AccountLoginInput.rootSecret}. */
  signer?: Signer;
  /** The challenge from `GET /api/auth/account/challenge`, verbatim UTF-8. */
  nonce: string;
}

/**
 * Sign a cloud login challenge with the account root. Returns base64.
 *
 * The statement this makes is *"I hold the root of account X"*, and it is the
 * one statement a device credential can never make. A routing read proves the
 * caller holds a device the root certified — the credential carries the root's
 * signature over that device — but a certificate is public and travels in the
 * clear inside every device-link op, so anyone who has seen one can say "a
 * device of X is asking". Only the root can say the account is theirs.
 *
 * Which is why this is worth doing **once**: the cloud records the claim, and
 * from then on it knows the account behind a device proof was proven by its
 * owner. The session it also mints is the ordinary MDMA session token, accepted
 * everywhere a Google-issued one is.
 *
 * Standard base64, not base64url — mdma decodes with `validate=True`.
 */
export async function signAccountLogin(
  input: AccountLoginInput,
): Promise<string> {
  if (!input.nonce) throw new Error('nonce is required to sign an account login');
  const signer = await resolveSigner(input.rootSecret, input.signer, 'rootSecret');
  const signature = await signer.sign(
    concat(ACCOUNT_LOGIN_DOMAIN, new TextEncoder().encode(input.nonce)),
  );
  return base64(signature);
}

async function withPhrase(
  secret: string,
  phrase: string,
): Promise<RecoverableAccountRoot> {
  return { ...(await accountRootFromSecret(secret)), phrase };
}

function normalisePhrase(phrase: string): string[] {
  // NFKD per BIP39. A no-op for the English list, which is ASCII, but the
  // normalisation is what the spec pins and costs nothing to honour.
  const words = phrase.normalize('NFKD').toLowerCase().trim().split(/\s+/);
  const count = words[0] === '' ? 0 : words.length;
  if (count !== PHRASE_WORDS) {
    throw new Error(
      `recovery phrase must be ${PHRASE_WORDS} words, got ${count}`,
    );
  }
  return words;
}

/** Entropy then checksum, chopped into 11-bit indices. */
async function encodePhrase(entropy: Uint8Array): Promise<string> {
  const bits = bitsOf(entropy) + (await checksumBits(entropy));
  const words: string[] = [];
  for (let i = 0; i < PHRASE_WORDS; i += 1) {
    const index = Number.parseInt(bits.slice(i * 11, i * 11 + 11), 2);
    words.push(ENGLISH_WORDLIST[index]);
  }
  return words.join(' ');
}

async function decodePhrase(words: string[]): Promise<Uint8Array> {
  let bits = '';
  for (const word of words) {
    const index = ENGLISH_WORDLIST.indexOf(word);
    if (index < 0) {
      throw new Error(`"${word}" is not a word in the recovery phrase list`);
    }
    bits += index.toString(2).padStart(11, '0');
  }

  const entropy = new Uint8Array(ENTROPY_BITS / 8);
  for (let i = 0; i < entropy.length; i += 1) {
    entropy[i] = Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  if (bits.slice(ENTROPY_BITS) !== (await checksumBits(entropy))) {
    throw new Error(
      'recovery phrase checksum failed — check for a mistyped or transposed word',
    );
  }
  return entropy;
}

/** The leading `CHECKSUM_BITS` of SHA-256 over the entropy, as a bit string. */
async function checksumBits(entropy: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', entropy));
  return bitsOf(digest).slice(0, CHECKSUM_BITS);
}

function bitsOf(bytes: Uint8Array): string {
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  return bits;
}

function base64(bytes: Uint8Array): string {
  // Built a character at a time rather than spreading into `String.fromCharCode`:
  // the spread is fine for a 64-byte signature but blows the argument limit on
  // anything larger, and this has no such cliff to remember.
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
