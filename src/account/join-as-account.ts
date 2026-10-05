import type {
  SignedGroupOpenInvitation,
} from '../admin-api/index.js';
import { bootstrapFromInvitation } from './bootstrap-from-invitation.js';
import { carryExecutorAccount, rememberRelay, type DelegatedSession } from './session.js';

/**
 * Redeem an invitation for an account, the way `useDelegatedBootstrap` does:
 * resolve the relay the invitation names, have it admit the account, add that
 * relay to the account's map and hand the session over to `onJoined`.
 *
 * It is what an account's `admin.joinNamespace` runs, so an app that joins with
 * the node call gets the account path with no code of its own. It works with no
 * relay yet: the join is how an account gets its first one.
 *
 * Rejects on a refused join with the refusal's reason, its `step`, and its HTTP
 * `status` when it has one, as the node call would; nothing is remembered or
 * switched then.
 */
export async function joinAsAccount(
  session: DelegatedSession,
  namespaceId: string,
  invitation: SignedGroupOpenInvitation,
  opts: {
    cloudBaseUrl?: string;
    onJoined: (session: DelegatedSession) => void;
    bootstrap?: typeof bootstrapFromInvitation;
  },
): Promise<{ namespaceId: string }> {
  const bootstrap = opts.bootstrap ?? bootstrapFromInvitation;
  const outcome = await bootstrap({
    namespaceId,
    invitation,
    credential: { account: session.account, credential: session.credential, deviceSecret: session.deviceSecret },
    cloudBaseUrl: opts.cloudBaseUrl,
  });
  if (outcome.ok === false) {
    throw Object.assign(new Error(outcome.reason), {
      step: outcome.step,
      ...(outcome.status !== undefined ? { status: outcome.status } : {}),
    });
  }
  if (outcome.session.relayUrl) rememberRelay(session.account, outcome.session.relayUrl, { namespaceId });
  opts.onJoined(carryExecutorAccount(session, outcome.session));
  return { namespaceId };
}
