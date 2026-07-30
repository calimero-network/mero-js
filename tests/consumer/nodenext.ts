// Compiled by tsconfig.consumer.json as an external NodeNext consumer of the built
// dist/. The @ts-expect-error lines fail if unresolvable specifiers widen the API to any.
import { MeroJs, RpcError } from '@calimero-network/mero-js';
import type { MeroJsConfig } from '@calimero-network/mero-js';

const config: MeroJsConfig = {
  baseUrl: 'http://localhost:2428',
  onAuthRevoked: () => {},
};

export const client = new MeroJs(config);
export const error = new RpcError(-32000, 'boom');

// @ts-expect-error code is a number, not a string
new RpcError('not-a-number', 'boom');

// @ts-expect-error baseUrl is required
new MeroJs({ totallyNotAnOption: true });
