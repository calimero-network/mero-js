// Account roots — minting one, restoring it from a phrase, and proving you hold it.
export {
  generateAccountRoot,
  accountRootFromPhrase,
  accountRootFromSecret,
  signAccountLink,
  signAccountLogin,
} from './account.js';
export type {
  AccountRoot,
  RecoverableAccountRoot,
  AccountLinkInput,
  AccountLoginInput,
} from './account.js';
