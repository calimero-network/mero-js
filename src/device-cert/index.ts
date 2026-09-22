// Offline device certification — the account-root half of the keyholder story.
export {
  signDeviceCert,
  mintDeviceId,
  deviceCertPayload,
  accountForRoot,
  accountForRootPublicKey,
  accountProofBytes,
  parseDeviceCredential,
  verifyDeviceCredential,
} from './device-cert.js';
export type { DeviceCertInput, DeviceCredential } from './device-cert.js';
