// Who signs — a key's capability, separated from its material, so a
// non-extractable `CryptoKey` can be used wherever a hex secret could.
export { signerFromSecret, signerFromCryptoKey } from './signer.js';
export type { Signer } from './signer.js';
