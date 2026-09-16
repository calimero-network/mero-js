// Account roots — minting one, restoring it from a phrase, and proving you hold it.
export {
  generateAccountRoot,
  accountRootFromPhrase,
  accountRootFromSecret,
  signAccountLink,
} from './account.js';
export type {
  AccountRoot,
  RecoverableAccountRoot,
  AccountLinkInput,
} from './account.js';
