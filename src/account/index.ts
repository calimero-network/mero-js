// Account roots — minting one, restoring it from a phrase, and proving you hold it.
export {
  generateAccountRoot,
  accountRootFromPhrase,
  accountRootFromSecret,
  createAccountRootSigner,
  accountRootSignerFromPhrase,
  signAccountLink,
  signAccountLogin,
} from './account.js';
export type {
  AccountRoot,
  RecoverableAccountRoot,
  AccountRootSigner,
  NewAccountRootSigner,
  AccountLinkInput,
  AccountLoginInput,
} from './account.js';
export { resolveRoot } from './account.js';
export type { RootSource } from './account.js';
export { resolveRootPair } from './account.js';
export type { ResolvedRoot } from './account.js';
