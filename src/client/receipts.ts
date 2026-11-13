/**
 * Checking a pipeline run's receipt as core's `calimero-client` does (`Client::verify_app_cluster`,
 * `attest::verify_receipt_key`, `Client::verify_receipt`): the receipt is signed by the answering
 * node's receipt key, and that key is one every replica's quote attests, bound to the cluster and
 * node the entry node names. A quote of the unbound `receipt-key.v2` form is never accepted.
 */

import { concat, fromHex, hex } from '../crypto/internal.js';
import { governanceCanonical, receiptKeyBinding } from '../recovery/backup-files.js';
import { jcs } from '../package/pack.js';
import { verifyQuoteBinding, type AttestationDoc, type NodePolicy } from '../runtime/attestation.js';
import type { AppsRoutes } from '../generated/methods.js';
import type { Governance } from './approvals.js';
import { buf } from './recovery-key.js';

const PIPELINE_RECEIPT_DOMAIN = 'calimero.pipeline.receipt.v1\0';
const utf8 = (s: string) => new TextEncoder().encode(s);

/** A receipt-key attestation: the quote binds the key, the governance, and the cluster and node asked for. */
export type ReceiptKeyDoc = AttestationDoc & { receiptKey?: string; governance?: Governance };

/** What `GET /apps/{app}/pipeline-runs/{run}/receipt` answers: the receipt as sent, the signing node, its signature (hex). */
export interface ReceiptAnswer {
  receipt: unknown;
  node: number | string;
  signature: string;
}

/** The fields a verified receipt is checked on here; the rest is the node's statement as sent. */
export interface PipelineReceipt {
  app: string;
  cluster: string;
  run: string;
  [field: string]: unknown;
}

/** Every replica of an app, attested: its receipt key by node id, and the governance they all attest. */
export interface AttestedCluster {
  keys: Map<number, Uint8Array>;
  governance: Governance;
}

type AttestationRoutes = Pick<AppsRoutes, 'attestation'>;

/**
 * Checks a receipt-key attestation as core's `verify_receipt_key` does: its quote binds the key, the
 * governance and the `cluster` and `node` the caller asked for (never the document's own fields, which
 * nothing signs). Answers the key and governance.
 */
export async function verifyReceiptKey(
  doc: ReceiptKeyDoc,
  nonce: Uint8Array,
  cluster: string,
  node: number,
  policy: NodePolicy,
): Promise<{ key: Uint8Array; governance: Governance }> {
  if (!doc.receiptKey) throw new Error('the attestation names no receipt key');
  if (!doc.governance) throw new Error('the attestation names no governance');
  const key = fromHex(doc.receiptKey, 'receiptKey', 32);
  const suffix = fromHex(await receiptKeyBinding(key, doc.governance, cluster, node), 'binding', 32);
  await verifyQuoteBinding(doc, nonce, suffix, policy, 'receipt key, governance, cluster and node', 'receipt key');
  return { key, governance: doc.governance };
}

/**
 * Verifies every replica of `app` (core's `Client::verify_app_cluster`): each one's quote over a fresh
 * nonce, held to `policy`, binding its receipt key, the cluster's governance, and the cluster and node
 * id the entry node names. Any replica error, a node id that differs from the document's, or replicas
 * that attest other governance fails the whole check.
 */
export async function verifyAppCluster(
  client: { apps: AttestationRoutes },
  app: string,
  policy: NodePolicy,
): Promise<AttestedCluster> {
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const answer = await client.apps.attestation({ app, nonce: hex(nonce) });
  const keys = new Map<number, Uint8Array>();
  let governance: Governance | undefined;
  let canonical: string | undefined;
  for (const replica of answer.replicas) {
    const { node } = replica;
    if ('error' in replica) throw new Error(`replica ${node} gave no attestation: ${replica.error}`);
    const doc = replica.attestation;
    if (doc.node !== node) throw new Error(`replica ${node} answered as node ${doc.node}`);
    let attested;
    try {
      attested = await verifyReceiptKey(doc, nonce, answer.cluster, node, policy);
    } catch (error) {
      throw new Error(`replica ${node}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const rules = hex(governanceCanonical(attested.governance));
    if (canonical !== undefined && canonical !== rules) throw new Error(`replica ${node} attests other governance`);
    canonical = rules;
    governance = attested.governance;
    keys.set(node, attested.key);
  }
  if (!governance) throw new Error(`no replica of ${app} attested`);
  return { keys, governance };
}

/** The bytes a receipt's signature covers: the domain, then the receipt's canonical JSON (RFC 8785). */
export function receiptMessage(receipt: unknown): Uint8Array {
  return concat(utf8(PIPELINE_RECEIPT_DOMAIN), utf8(jcs(receipt as Parameters<typeof jcs>[0], true)));
}

/** Whether `answer` is signed by `key` (core's `verify_pipeline_receipt`); answers the receipt it carries. */
export async function verifyReceiptSignature(answer: ReceiptAnswer, key: Uint8Array): Promise<PipelineReceipt> {
  const signature = fromHex(answer.signature, 'the signature', 64);
  const publicKey = await crypto.subtle.importKey('raw', buf(key), { name: 'Ed25519' }, false, ['verify']);
  if (!(await crypto.subtle.verify('Ed25519', publicKey, buf(signature), buf(receiptMessage(answer.receipt))))) {
    throw new Error('the receipt is not signed by that key');
  }
  return answer.receipt as PipelineReceipt;
}

/**
 * Checks that the node that answered holds a receipt key attested under `policy` ({@link verifyAppCluster})
 * and signed `answer` with it, and that the receipt is for `app` (core's `Client::verify_receipt`).
 * Answers the receipt.
 */
export async function verifyPipelineReceipt(
  client: { apps: AttestationRoutes },
  app: string,
  answer: ReceiptAnswer,
  policy: NodePolicy,
): Promise<PipelineReceipt> {
  const { keys } = await verifyAppCluster(client, app, policy);
  const key = keys.get(Number(answer.node));
  if (!key) throw new Error(`node ${answer.node} is not an attested replica of ${app}`);
  const receipt = await verifyReceiptSignature(answer, key);
  if (receipt.app !== app) throw new Error(`the receipt is for app ${receipt.app}, not ${app}`);
  return receipt;
}
