/**
 * The answers to the two challenges a node puts before a request it will only
 * take with a proof: the `412 CONFIRM_REQUIRED` passkey step-up and the
 * `428 OPERATOR_SIGNATURE_REQUIRED` operator signature (core
 * `crates/node/src/api/openapi.rs`, components `ConfirmRequired`, `Confirm`,
 * `OperatorSignatureRequired`, `OperatorProof`).
 *
 * Each is an `openapi-fetch` middleware: it keeps a copy of the request it
 * sees go out, and when the node answers the challenge it asks a callback the
 * caller supplied for the proof, then sends the same JSON body again with the
 * proof beside it (`confirm`, `operatorProof`) and answers that response in
 * place of the challenge. Without a callback (or when the callback is not
 * given for that request) the challenge reaches the caller as the
 * `{ error }` of the response.
 */

import type { Middleware } from 'openapi-fetch';

import type { components } from '../generated/api.js';
import { ConfirmCancelled, ConfirmPromptBlocked } from '../cloud-v2/errors.js';
import { fromB64url, type AssertionJSON, type PasskeyProvider, type PasskeyUserVerification } from '../cloud-v2/passkey.js';

/**
 * `details` of a `412 CONFIRM_REQUIRED`: the WebAuthn challenge to sign.
 * `userVerification` is read when a node names it (core does not today).
 */
export type ConfirmChallenge = components['schemas']['ConfirmRequired'] & { userVerification?: unknown };

/** `details` of a `428 OPERATOR_SIGNATURE_REQUIRED`: the statement and its exact bytes (`message`, base64). */
export type OperatorStatement = components['schemas']['OperatorSignatureRequired'];

/** The operator key's proof the retry carries: its Ed25519 signature (hex) over `message`, with the statement's nonce. */
export type OperatorProof = components['schemas']['OperatorProof'];

/** What a confirmation answers a `412` with: an assertion over the challenge. */
export type ConfirmCallback = (challenge: ConfirmChallenge, context: { request: Request }) => Promise<AssertionJSON>;

/** What a `428` is answered with: the operator key's signature over the statement. */
export type OperatorProofCallback = (statement: OperatorStatement, context: { request: Request }) => Promise<OperatorProof>;

/**
 * The user verification a confirmation asks the passkey for: what the node's
 * `412` details name, if it names one WebAuthn knows, else `fallback` (the
 * flow's own requirement: `required` for a step-up, which the node takes only
 * with the user verified; `preferred` for the sign-up confirmation, which it
 * takes with the user present).
 */
export function userVerificationOf(named: unknown, fallback: PasskeyUserVerification): PasskeyUserVerification {
  return named === 'required' || named === 'preferred' || named === 'discouraged' ? named : fallback;
}

/**
 * What a failed confirmation prompt means to the caller. The browser or a
 * password manager refusing to show the prompt (the page not focused because
 * an extension's popup still holds focus, or another prompt still open) is
 * {@link ConfirmPromptBlocked}; the user dismissing it (`NotAllowedError`, or
 * `AbortError` when it was aborted) is {@link ConfirmCancelled}; anything
 * else is a real failure, passed through.
 */
export function promptFailure(error: unknown): unknown {
  const e = error as { name?: unknown; message?: unknown } | null;
  const name = e?.name;
  const message = typeof e?.message === 'string' ? e.message : '';
  if (name === 'InvalidStateError' || /not focused|already pending/i.test(message)) {
    return new ConfirmPromptBlocked(error);
  }
  if (name === 'NotAllowedError' || name === 'AbortError') return new ConfirmCancelled(error);
  return error;
}

/** How {@link passkeyConfirm} prompts. */
export interface PasskeyConfirmOptions {
  /** The user verification asked for when the node names none. Default `required` (a step-up). */
  userVerification?: PasskeyUserVerification;
  /** Aborts the passkey prompt. */
  signal?: AbortSignal;
}

/**
 * `passkey`'s assertion over a `412` challenge: the {@link ConfirmCallback}
 * of a passkey. A prompt the user dismissed rejects with
 * {@link ConfirmCancelled}, one the browser would not show with
 * {@link ConfirmPromptBlocked}.
 */
export function passkeyConfirm(passkey: PasskeyProvider, options: PasskeyConfirmOptions = {}): ConfirmCallback {
  return async (challenge) => {
    try {
      // A step-up is taken only with the user verified (PIN or biometric);
      // `preferred` lets a password manager skip it, and the node then
      // refuses. Only the sign-up confirmation passes `preferred`. A
      // requirement the node names itself wins.
      return await passkey.get(fromB64url(challenge.challenge), challenge.rpId, challenge.allowCredentials, {
        userVerification: userVerificationOf(challenge.userVerification, options.userVerification ?? 'required'),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (declined) {
      throw promptFailure(declined);
    }
  };
}

/**
 * A middleware that answers a `status code` refusal: `answer` turns its
 * `details` into the fields to add to the JSON body, and the request goes out
 * again once with them.
 */
function challengeAnswer<D>(
  status: number,
  code: string,
  answer: (details: D, request: Request) => Promise<Record<string, unknown>>,
): Middleware {
  const sent = new Map<string, Request>();
  return {
    onRequest({ request, id }) {
      // Kept before the body is read: the retry is the same request. Only a
      // JSON body (or none) can carry the proof, so an upload is never copied.
      const type = request.headers.get('content-type');
      const json = type === null || type.startsWith('application/json');
      if (json && request.method !== 'GET' && request.method !== 'HEAD') sent.set(id, request.clone());
      return undefined;
    },
    async onResponse({ response, id, options }) {
      const original = sent.get(id);
      sent.delete(id);
      if (response.status !== status || !original) return undefined;
      const refusal = (await response
        .clone()
        .json()
        .catch(() => undefined)) as { error?: unknown; details?: unknown } | undefined;
      if (refusal?.error !== code) return undefined;
      const fields = await answer((refusal.details ?? {}) as D, original);
      const text = await original.text();
      const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      const headers = new Headers(original.headers);
      headers.set('content-type', 'application/json');
      const again = new Request(original.url, {
        method: original.method,
        headers,
        body: JSON.stringify({ ...body, ...fields }),
        signal: original.signal,
      });
      return options.fetch(again);
    },
    onError({ id }) {
      sent.delete(id);
      return undefined;
    },
  };
}

/**
 * The `412 CONFIRM_REQUIRED` step-up: `confirm` signs the node's challenge and
 * the same body goes again with `confirm: { challengeId, assertion }`. Add it
 * to a client (`api.use(stepUp(...))`) or to one request (`{ middleware:
 * [stepUp(passkeyConfirm(passkey))] }`).
 */
export function stepUp(confirm: ConfirmCallback): Middleware {
  return challengeAnswer<ConfirmChallenge>(412, 'CONFIRM_REQUIRED', async (challenge, request) => ({
    confirm: { challengeId: challenge.challengeId, assertion: await confirm(challenge, { request }) },
  }));
}

/**
 * The `428 OPERATOR_SIGNATURE_REQUIRED` operator signature: `sign` signs the
 * statement's `message` with the operator key and the same body goes again
 * with `operatorProof: { nonce, signature }`.
 */
export function operatorSignature(sign: OperatorProofCallback): Middleware {
  return challengeAnswer<OperatorStatement>(428, 'OPERATOR_SIGNATURE_REQUIRED', async (statement, request) => ({
    operatorProof: await sign(statement, { request }),
  }));
}
