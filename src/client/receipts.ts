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

/** What `GET /apps/{app}/pipeline-runs/{run}/receipt` answers: the receipt as sent, the signing node, its signature (hex). Checked at run time. */
export interface ReceiptAnswer {
  receipt: unknown;
  node: unknown;
  signature: unknown;
}

/** A file named by id, size and plaintext SHA-256 (hex). */
export interface FileRef {
  id: string;
  size: number;
  sha256: string;
}

/** What one step run's proof records: which job node ran which assignment, and what came out. */
export interface StepRunProof {
  run: string;
  step: string;
  index: number;
  outcome: string;
  attempt: number;
  node?: number | null;
  jobKey?: string | null;
  assignmentDigest?: string | null;
  reportSha256?: string | null;
  signature?: string | null;
  outputs: FileRef[];
  usage: { cpuMicros: string; gibMicros: string; fuel: string };
}

/** A run answered from the step cache: it ran nothing, so it has no proof. */
export interface CachedRun {
  index: number;
  cached: boolean;
  cacheKey: string;
}

export interface StepReceipt {
  status: string;
  reason?: string | null;
  runs: (CachedRun | StepRunProof)[];
}

/** What the node states about a finished pipeline run (core's `PipelineReceipt`). `cluster` is the cluster identity key, hex. */
export interface PipelineReceipt {
  version: number;
  cluster: string;
  app: string;
  run: string;
  pipeline: string;
  release: string;
  pipelineHash: string;
  modules: Record<string, string>;
  inputs: Record<string, FileRef[]>;
  params: Record<string, unknown>;
  state: string;
  startTsMs: number;
  endTsMs: number;
  steps: Record<string, StepReceipt>;
  costSoFar?: string | null;
}

/** Every replica of an app, attested: its receipt key by node id, the governance they all attest, and the cluster name every quote bound. */
export interface AttestedCluster {
  keys: Map<number, Uint8Array>;
  governance: Governance;
  cluster: string;
}

type AttestationRoutes = Pick<AppsRoutes, 'attestation'>;

// The receipt's schema, as core's serde types read it: `deny_unknown_fields`, required fields, typed values.
type Check = (value: unknown, path: string) => void;
const fail = (path: string, what: string): never => {
  throw new Error(`the receipt's ${path} ${what}`);
};
const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str: Check = (v, p) => typeof v === 'string' || fail(p, 'is not a string');
const bool: Check = (v, p) => typeof v === 'boolean' || fail(p, 'is not a boolean');
const any: Check = () => undefined;
const uint =
  (max: number): Check =>
  (v, p) =>
    (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max) || fail(p, 'is not an unsigned integer in range');
const u32 = uint(0xffffffff);
const u64 = uint(2 ** 64); // a u64 near its top rounds up to 2^64 once parsed
const list =
  (item: Check): Check =>
  (v, p) => {
    if (!Array.isArray(v)) fail(p, 'is not an array');
    (v as unknown[]).forEach((x, i) => item(x, `${p}[${i}]`));
  };
const map =
  (value: Check): Check =>
  (v, p) => {
    if (!isObject(v)) fail(p, 'is not an object');
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) value(x, `${p}.${k}`);
  };
const struct =
  (required: Record<string, Check>, optional: Record<string, Check> = {}): Check =>
  (v, p) => {
    if (!isObject(v)) return fail(p, 'is not an object');
    for (const k of Object.keys(v)) {
      if (!hasOwn(required, k) && !hasOwn(optional, k)) fail(`${p}.${k}`, 'is not a known field');
    }
    for (const [k, check] of Object.entries(required)) {
      if (!hasOwn(v, k)) fail(`${p}.${k}`, 'is missing');
      check(v[k], `${p}.${k}`);
    }
    for (const [k, check] of Object.entries(optional)) {
      if (hasOwn(v, k) && v[k] !== null) check(v[k], `${p}.${k}`);
    }
  };

const fileRef = struct({ id: str, size: u64, sha256: str });
const stepRun = struct(
  {
    run: str,
    step: str,
    index: u32,
    outcome: str,
    attempt: u32,
    outputs: list(fileRef),
    usage: struct({ cpuMicros: str, gibMicros: str, fuel: str }),
  },
  { node: u64, jobKey: str, assignmentDigest: str, reportSha256: str, signature: str },
);
const cachedRun = struct({ index: u32, cached: bool, cacheKey: str });
// Core's `RunEntry` is untagged: a cached run first, else a step run proof.
const runEntry: Check = (v, p) => {
  try {
    cachedRun(v, p);
  } catch {
    stepRun(v, p);
  }
};
const pipelineReceipt = struct(
  {
    version: u32,
    cluster: str,
    app: str,
    run: str,
    pipeline: str,
    release: str,
    pipelineHash: str,
    modules: map(str),
    inputs: map(list(fileRef)),
    params: map(any),
    state: str,
    startTsMs: u64,
    endTsMs: u64,
    steps: map(struct({ status: str, runs: list(runEntry) }, { reason: str })),
  },
  { costSoFar: str },
);

/** Hex as core's `hex::decode` reads it (either case), of exactly `bytes` bytes: no trimming, nothing else. */
function strictHex(value: unknown, label: string, bytes: number): Uint8Array {
  if (typeof value !== 'string' || value.length !== bytes * 2 || !/^[0-9a-fA-F]*$/.test(value)) {
    throw new Error(`${label} is not ${bytes} bytes of hex`);
  }
  return fromHex(value, label, bytes);
}

/** A node id: a non-negative safe integer, as a JSON number. */
function nodeId(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is not a node id`);
  return value;
}

/**
 * Checks a receipt-key attestation as core's `verify_receipt_key` does: its quote binds the key, the
 * governance and the `cluster` and `node` the caller asked for (never the document's own fields, which
 * nothing signs). Answers the key and the governance rebuilt from its canonical fields.
 */
export async function verifyReceiptKey(
  doc: ReceiptKeyDoc,
  nonce: Uint8Array,
  cluster: string,
  node: number,
  policy: NodePolicy,
): Promise<{ key: Uint8Array; governance: Governance }> {
  if (typeof doc.quote !== 'string') throw new Error('the attestation carries no quote');
  if (!doc.receiptKey) throw new Error('the attestation names no receipt key');
  if (!isObject(doc.governance)) throw new Error('the attestation names no governance');
  const key = strictHex(doc.receiptKey, 'the receipt key', 32);
  const suffix = fromHex(await receiptKeyBinding(key, doc.governance, cluster, node), 'binding', 32);
  await verifyQuoteBinding(doc, nonce, suffix, policy, 'receipt key, governance, cluster and node', 'receipt key');
  return { key, governance: JSON.parse(new TextDecoder().decode(governanceCanonical(doc.governance))) as Governance };
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
  const answer: unknown = await client.apps.attestation({ app, nonce: hex(nonce) });
  if (!isObject(answer) || typeof answer.cluster !== 'string' || !Array.isArray(answer.replicas)) {
    throw new Error('the node answered a malformed attestation');
  }
  const cluster = answer.cluster;
  const keys = new Map<number, Uint8Array>();
  let governance: Governance | undefined;
  let canonical: string | undefined;
  for (const replica of answer.replicas as unknown[]) {
    if (!isObject(replica)) throw new Error('a replica entry is not an object');
    const node = nodeId(replica.node, 'a replica');
    if (hasOwn(replica, 'error')) throw new Error(`replica ${node} gave no attestation: ${String(replica.error)}`);
    const doc = replica.attestation;
    if (!isObject(doc)) throw new Error(`replica ${node} gave neither an attestation nor an error`);
    if (nodeId(doc.node, `replica ${node}'s document`) !== node) throw new Error(`replica ${node} answered as node ${String(doc.node)}`);
    let attested;
    try {
      attested = await verifyReceiptKey(doc as unknown as ReceiptKeyDoc, nonce, cluster, node, policy);
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
  return { keys, governance, cluster };
}

/** The bytes a receipt's signature covers: the domain, then `canonical`, the receipt's canonical JSON (RFC 8785). */
const receiptBytes = (canonical: string) => concat(utf8(PIPELINE_RECEIPT_DOMAIN), utf8(canonical));

/** The receipt's canonical JSON; any finite number is allowed, as core canonicalizes every number as f64. */
export const canonicalReceipt = (receipt: unknown) => jcs(receipt as Parameters<typeof jcs>[0], true);

/** The bytes a receipt's signature covers (core's `receipt_message`). */
export const receiptMessage = (receipt: unknown): Uint8Array => receiptBytes(canonicalReceipt(receipt));

/**
 * Whether `answer` is signed by `key` (core's `verify_pipeline_receipt`). Answers the receipt as parsed
 * from the canonical bytes that were verified, checked against core's receipt schema.
 */
export async function verifyReceiptSignature(answer: ReceiptAnswer, key: Uint8Array): Promise<PipelineReceipt> {
  if (!isObject(answer)) throw new Error('the receipt answer is not an object');
  const signature = strictHex(answer.signature, 'the signature', 64);
  const canonical = canonicalReceipt(answer.receipt);
  const publicKey = await crypto.subtle.importKey('raw', buf(key), { name: 'Ed25519' }, false, ['verify']);
  if (!(await crypto.subtle.verify('Ed25519', publicKey, buf(signature), buf(receiptBytes(canonical))))) {
    throw new Error('the receipt is not signed by that key');
  }
  const receipt: unknown = JSON.parse(canonical);
  pipelineReceipt(receipt, 'receipt');
  return receipt as PipelineReceipt;
}

/**
 * Checks that the node that answered holds a receipt key attested under `policy` ({@link verifyAppCluster})
 * and signed `answer` with it, and that the receipt is for `app` and `run`. Stricter than core's
 * `Client::verify_receipt`, which does not look at the run. The receipt's own `cluster` is the cluster
 * identity key (hex), which no quote binds, so it is not compared with the attested cluster name.
 * Answers the receipt.
 */
export async function verifyPipelineReceipt(
  client: { apps: AttestationRoutes },
  app: string,
  run: string,
  answer: ReceiptAnswer,
  policy: NodePolicy,
): Promise<PipelineReceipt> {
  const { keys } = await verifyAppCluster(client, app, policy);
  if (!isObject(answer)) throw new Error('the receipt answer is not an object');
  const node = nodeId(answer.node, 'the receipt answer');
  const key = keys.get(node);
  if (!key) throw new Error(`node ${node} is not an attested replica of ${app}`);
  const receipt = await verifyReceiptSignature(answer, key);
  if (receipt.app !== app) throw new Error(`the receipt is for app ${receipt.app}, not ${app}`);
  if (receipt.run !== run) throw new Error(`the receipt is for run ${receipt.run}, not ${run}`);
  return receipt;
}
