// Mero.js: the JavaScript client for Calimero 1.0, the confidential cloud.
//
// `CalimeroClient` verifies a node's TDX attestation, seals every request to
// it, and signs people in with passkeys and machines with API keys. Everything
// below it is the pieces it is built from, exported for callers who need one
// on its own.

// The client, its errors and its types
export * from './cloud-v2/index.js';

// Sealed transport: requests encrypted end to end to a TEE node's attested key,
// and the checks that decide whether a quote is trusted.
export * from './sealed/index.js';

// Private agents (mero-tee's agent gate): attest one, claim it with your key,
// give it its secrets sealed to its TD.
export * from './agent-gate/index.js';
