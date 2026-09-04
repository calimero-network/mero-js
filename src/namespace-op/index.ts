// Signing a namespace governance op from the SDK — the membership op a keyholder
// presents to an admitter, which it could not produce before.
export {
  signMemberJoinOp,
  encodeSignedInvitation,
  SIGNED_NAMESPACE_OP_SCHEMA_VERSION,
} from './namespace-op.js';
export type { SignMemberJoinInput } from './namespace-op.js';
