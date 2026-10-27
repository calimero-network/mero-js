// mero-js: the JavaScript client for the Calimero cloud (merod-v2).

// The client: attest a node, open the sealed channel, sign in with a passkey, call apps.
export * from './cloud-v2/index.js';

// Sealed transport and quote verification — what the client builds on, for
// callers that verify releases themselves.
export * from './sealed/index.js';
