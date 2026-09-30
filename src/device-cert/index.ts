// Offline device certification — the account-root half of the keyholder story.
export {
  signDeviceCert,
  mintDeviceId,
  deviceCertPayload,
  accountForRoot,
  accountForRootKey,
  accountProofBytes,
} from './device-cert.js';
export type { DeviceCertInput } from './device-cert.js';
export { signDeviceScope, deviceScopePayload } from './device-scope.js';
export type { DeviceScopeInput } from './device-scope.js';
