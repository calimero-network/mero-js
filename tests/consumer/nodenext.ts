// Compiled by tsconfig.consumer.json as an external NodeNext consumer of the built
// dist/. The @ts-expect-error lines fail if unresolvable specifiers widen the API to any.
import { MeroJs, RpcError } from '@calimero-network/mero-js';
import type {
  GroupMembershipEventData,
  GroupMigrationEventData,
  MeroJsConfig,
} from '@calimero-network/mero-js';

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

// The migration union must narrow on `type` through dist/, not collapse to any.
export function cohortTotal(e: GroupMigrationEventData): number | null {
  return e.type === 'MigrationProgress' ? e.data.total : null;
}

export const memberAccount = (e: GroupMembershipEventData): string => e.data.memberAccount;

// Core dropped the `member` wire key so a stale consumer fails at a field it
// cannot find. The SDK type must deny it too, or that loud failure goes silent.
export function staleMemberRead(e: GroupMembershipEventData): string {
  // @ts-expect-error the account is `memberAccount`; `member` carried a bs58 signing key
  return e.data.member;
}

export function cascadeTotal(
  e: Extract<GroupMigrationEventData, { type: 'CascadeProgress' }>,
): number {
  // @ts-expect-error the per-subgroup count is localContextsTotal; a bare `total` is the cohort's
  return e.data.total;
}
