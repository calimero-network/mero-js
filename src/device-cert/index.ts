// Offline device certification — the account-root half of the keyholder story.
export {
  signDeviceCert,
  mintDeviceId,
  deviceCertPayload,
  accountForRoot,
  accountForRootPublicKey,
  accountProofBytes,
} from './device-cert.js';
export type { DeviceCertInput } from './device-cert.js';
