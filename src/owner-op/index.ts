// Root proofs for owner-level governance ops: what a nodeless or cold-root
// account signs offline so a stolen device alone cannot take a group.
export {
  OWNER_OP_KIND,
  transferOwnershipOp,
  groupDeleteOp,
  adminChangedOp,
  teeAuthoringPolicyOp,
  teeAdmissionPolicyOp,
  teeReleaseAdmissionPolicyOp,
  ownerOpDigest,
  ownerOpSigningPayload,
  signOwnerOpProof,
  rootGuardedOpBytes,
} from './owner-op.js';
export type {
  OwnerOp,
  OwnerOpKind,
  OwnerOpPlane,
  OwnerOpProofInput,
  TeeAdmissionPolicyOpInput,
  TeeReleaseAdmissionPolicyOpInput,
} from './owner-op.js';
