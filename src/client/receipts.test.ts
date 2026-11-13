import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { fromHex, hex } from '../crypto/internal.js';
import { MOCK_QUOTE_HEADER, type NodePolicy } from '../runtime/attestation.js';
import type { Governance } from './approvals.js';
import { governanceCanonical, receiptKeyBinding } from '../recovery/backup-files.js';
import binding from '../recovery/rust-binding.json';
import { CalimeroClient } from './calimero-client.js';
import {
  verifyAppCluster,
  verifyPipelineReceipt,
  verifyReceiptKey,
  type ReceiptAnswer,
  type ReceiptKeyDoc,
} from './receipts.js';

// fixtures/receipt-vectors.json comes from a throwaway Rust program (outside the core repo) that
// depends on core's `calimero-client` by path and prints what core computes: `receipt_key_binding`
// over several governances, clusters and nodes; a `ReceiptAnswer` signed with `receipt_message`;
// and mock-quote attestation docs under a fixed nonce. The program asserts core itself accepts the
// good doc (`verify_receipt_key`, mock allowed), refuses the unbound `receipt-key.v2` one, another
// node or cluster, and a policy without mock, and that `verify_pipeline_receipt` accepts the answer
// under node 1's key only. The two `*AnswerText` fields are raw JSON, as the node would send them.
interface Vectors {
  bindings: { receiptKey: string; governance: Governance; governanceCanonical: string; cluster: string; node: number; binding: string }[];
  nonce: string;
  cluster: string;
  governance: Governance;
  nodes: Record<string, string>;
  mockDoc: ReceiptKeyDoc;
  unboundMockDoc: ReceiptKeyDoc;
  receiptAnswer: ReceiptAnswer;
  /** Raw JSON of answers signed over params with floats, and with an integer past 2^53. */
  floatAnswerText: string;
  bigIntAnswerText: string;
}
const v = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/receipt-vectors.json', import.meta.url)), 'utf8'),
) as Vectors;

const MOCK: NodePolicy = { allowMock: true };
const APP = 'app-1';
const nonce = fromHex(v.nonce, 'nonce', 32);
const keyOf = (node: string) => fromHex(v.nodes[node], 'key', 32);

const mockQuote = (n: Uint8Array, suffix: string) => {
  const q = new Uint8Array([...new TextEncoder().encode(MOCK_QUOTE_HEADER), ...n, ...fromHex(suffix, 'suffix', 32)]);
  return btoa(String.fromCharCode(...q));
};

interface Replica {
  node: number;
  /** The node id the document claims; defaults to `node`. */
  docNode?: number;
  /** What the quote binds, defaulting to the right cluster, node and governance. */
  bind?: { cluster?: string; node?: number; governance?: Governance };
  governance?: Governance;
  error?: string;
  /** Use the unbound `receipt-key.v2` form. */
  unbound?: boolean;
}

/** A client whose `apps.attestation` answers with the replicas, quoting over the nonce it was asked with. */
function cluster(replicas: Replica[], entryCluster = v.cluster) {
  return {
    apps: {
      attestation: async ({ nonce: asked }: { app: string; nonce: string }) => ({
        appId: APP,
        cluster: entryCluster,
        replicas: await Promise.all(
          replicas.map(async (r) => {
            if (r.error) return { node: r.node, error: r.error };
            const key = keyOf(String(r.node));
            const governance = r.governance ?? v.governance;
            const bound = r.bind ?? {};
            const suffix = r.unbound
              ? await unboundBinding(key, governance)
              : await receiptKeyBinding(key, bound.governance ?? governance, bound.cluster ?? entryCluster, bound.node ?? r.node);
            return {
              node: r.node,
              attestation: {
                quote: mockQuote(fromHex(asked, 'nonce', 32), suffix),
                transportKey: hex(new Uint8Array(32)),
                appHash: hex(new Uint8Array(32)),
                nonce: asked,
                release: { version: '2.3.109', profile: 'locked-read-only' },
                cluster: bound.cluster ?? entryCluster,
                node: r.docNode ?? r.node,
                mock: true,
                receiptKey: hex(key),
                governance,
              },
            };
          }),
        ),
      }),
    },
  } as unknown as Parameters<typeof verifyAppCluster>[0];
}

async function unboundBinding(key: Uint8Array, governance: Governance): Promise<string> {
  const g = new Uint8Array(await crypto.subtle.digest('SHA-256', governanceCanonical(governance)));
  const all = new Uint8Array([...new TextEncoder().encode('calimero.tee-attest.receipt-key.v2'), ...key, ...g]);
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', all)));
}

describe('receiptKeyBinding (core receipt_key_binding)', () => {
  it('matches every vector core produced', async () => {
    for (const b of v.bindings) {
      expect(new TextDecoder().decode(governanceCanonical(b.governance))).toBe(b.governanceCanonical);
      expect(await receiptKeyBinding(fromHex(b.receiptKey, 'key', 32), b.governance, b.cluster, b.node)).toBe(b.binding);
    }
  });

  it('drops defaults and keeps field order whatever the node serialized', () => {
    const noisy = { signUp: 'open', outbound: 'owner', deployers: 'operator', releases: 'owner', deployments: 'open', appUpgrades: 'owner' };
    expect(new TextDecoder().decode(governanceCanonical(noisy as Governance))).toBe(
      '{"releases":"owner","appUpgrades":"owner","outbound":"owner"}',
    );
    expect(() => governanceCanonical({ ...noisy, releases: 'nobody' } as unknown as Governance)).toThrow('releases');
  });
});

describe('verifyReceiptKey over core mock documents', () => {
  it('accepts the document core accepts, and answers its key and governance', async () => {
    const got = await verifyReceiptKey(v.mockDoc, nonce, v.cluster, 1, MOCK);
    expect(hex(got.key)).toBe(v.nodes['1']);
    expect(got.governance).toEqual(v.governance);
  });

  it('refuses the unbound receipt-key.v2 quote', async () => {
    await expect(verifyReceiptKey(v.unboundMockDoc, nonce, v.cluster, 1, MOCK)).rejects.toThrow('does not bind');
  });

  it("refuses another node's or cluster's binding", async () => {
    await expect(verifyReceiptKey(v.mockDoc, nonce, v.cluster, 2, MOCK)).rejects.toThrow('does not bind');
    await expect(verifyReceiptKey(v.mockDoc, nonce, 'other', 1, MOCK)).rejects.toThrow('does not bind');
  });

  it('refuses a mock quote without allowMock', async () => {
    await expect(verifyReceiptKey(v.mockDoc, nonce, v.cluster, 1, {})).rejects.toThrow('mock quote refused');
  });

  it('refuses a document without a receipt key or governance', async () => {
    await expect(verifyReceiptKey({ ...v.mockDoc, receiptKey: undefined }, nonce, v.cluster, 1, MOCK)).rejects.toThrow('no receipt key');
    await expect(verifyReceiptKey({ ...v.mockDoc, governance: undefined }, nonce, v.cluster, 1, MOCK)).rejects.toThrow('no governance');
  });
});

describe('verifyAppCluster', () => {
  it('answers each replica key and the shared governance', async () => {
    const got = await verifyAppCluster(cluster([{ node: 1 }, { node: 2 }]), APP, MOCK);
    expect([...got.keys].map(([n, k]) => [n, hex(k)])).toEqual([
      [1, v.nodes['1']],
      [2, v.nodes['2']],
    ]);
    expect(got.governance).toEqual(v.governance);
  });

  it('refuses a quote bound to another node id than the one named', async () => {
    await expect(verifyAppCluster(cluster([{ node: 1, bind: { node: 2 } }]), APP, MOCK)).rejects.toThrow('replica 1');
  });

  it('refuses a quote bound to another cluster than the entry node names', async () => {
    await expect(verifyAppCluster(cluster([{ node: 1, bind: { cluster: 'other' } }]), APP, MOCK)).rejects.toThrow('replica 1');
  });

  it('refuses a document that answers as another node', async () => {
    await expect(verifyAppCluster(cluster([{ node: 1, docNode: 2 }]), APP, MOCK)).rejects.toThrow('answered as node 2');
  });

  it('refuses replicas that attest other governance', async () => {
    const other = { ...v.governance, releases: 'owner' } as Governance;
    await expect(verifyAppCluster(cluster([{ node: 1 }, { node: 2, governance: other }]), APP, MOCK)).rejects.toThrow(
      'replica 2 attests other governance',
    );
  });

  it('fails on any replica error', async () => {
    await expect(verifyAppCluster(cluster([{ node: 1 }, { node: 2, error: 'unreachable' }]), APP, MOCK)).rejects.toThrow(
      'replica 2 gave no attestation: unreachable',
    );
  });

  it('refuses the unbound quote of a pre-binding node', async () => {
    await expect(verifyAppCluster(cluster([{ node: 1, unbound: true }]), APP, MOCK)).rejects.toThrow('replica 1');
  });

  it('refuses mock quotes without allowMock, and an app with no replica', async () => {
    await expect(verifyAppCluster(cluster([{ node: 1 }]), APP, {})).rejects.toThrow('mock quote refused');
    await expect(verifyAppCluster(cluster([]), APP, MOCK)).rejects.toThrow('no replica of app-1 attested');
  });
});

describe('verifyPipelineReceipt', () => {
  const both = () => cluster([{ node: 1 }, { node: 2 }]);

  it('accepts the answer core signed under its node key and answers the receipt', async () => {
    const receipt = await verifyPipelineReceipt(both(), APP, v.receiptAnswer, MOCK);
    expect(receipt.app).toBe(APP);
    expect(receipt.run).toBe('run-1');
  });

  it('refuses a receipt signed by a node that is not the one answering', async () => {
    await expect(verifyPipelineReceipt(both(), APP, { ...v.receiptAnswer, node: 2 }, MOCK)).rejects.toThrow('not signed by that key');
  });

  it('refuses a node that is not an attested replica', async () => {
    await expect(verifyPipelineReceipt(cluster([{ node: 2 }]), APP, v.receiptAnswer, MOCK)).rejects.toThrow('not an attested replica');
  });

  it('refuses a receipt with one byte changed', async () => {
    const receipt = { ...(v.receiptAnswer.receipt as object), state: 'succeedeD' };
    await expect(verifyPipelineReceipt(both(), APP, { ...v.receiptAnswer, receipt }, MOCK)).rejects.toThrow('not signed by that key');
  });

  it('refuses a signature that is not 64 bytes of hex', async () => {
    await expect(verifyPipelineReceipt(both(), APP, { ...v.receiptAnswer, signature: 'abcd' }, MOCK)).rejects.toThrow('signature');
  });

  it('accepts params holding floats as core canonicalizes them', async () => {
    const answer = JSON.parse(v.floatAnswerText) as ReceiptAnswer;
    const receipt = await verifyPipelineReceipt(both(), APP, answer, MOCK);
    expect(receipt.params).toMatchObject({ a: 0.1, b: 1e21, d: 5e-324, e: 1.5 });
  });

  it('refuses params holding an integer past 2^53, which JSON.parse has already rounded', async () => {
    const answer = JSON.parse(v.bigIntAnswerText) as ReceiptAnswer;
    await expect(verifyPipelineReceipt(both(), APP, answer, MOCK)).rejects.toThrow('beyond 2^53');
  });

  it('refuses a receipt for another app', async () => {
    const attestedFor = cluster([{ node: 1 }]);
    await expect(verifyPipelineReceipt(attestedFor, 'app-2', v.receiptAnswer, MOCK)).rejects.toThrow('is for app app-1, not app-2');
  });

  it('refuses an unattested cluster before looking at the receipt', async () => {
    await expect(verifyPipelineReceipt(cluster([{ node: 1, unbound: true }]), APP, v.receiptAnswer, MOCK)).rejects.toThrow('replica 1');
  });
});

describe('governanceCanonical against the code it replaced', () => {
  // The old binding hashed `JSON.stringify(governance)` of the node's own JSON.
  const shapes: Governance[] = [binding.governance as Governance, v.governance, ...v.bindings.map((b) => b.governance)];

  it('is byte-identical for every governance the Rust fixtures hold', () => {
    for (const g of shapes) {
      expect(governanceCanonical(g)).toEqual(new TextEncoder().encode(JSON.stringify(g)));
    }
  });
});

describe('the client verifies under its own policy', () => {
  it('fails, never passes, when the client was built with no attestation policy', async () => {
    const client = new CalimeroClient({ baseUrl: 'http://node.test', policy: undefined as unknown as NodePolicy });
    await expect(client.verifyAppCluster(APP)).rejects.toThrow('no attestation policy');
    await expect(client.verifyPipelineReceipt(APP, v.receiptAnswer)).rejects.toThrow('no attestation policy');
  });

  it('uses the policy the client was built with: a mock quote needs allowMock there', async () => {
    const refused = new CalimeroClient({ baseUrl: 'http://node.test', policy: {} });
    // Routes answer through the sealed channel; stand in the attestation route directly.
    Object.assign(refused, { apps: cluster([{ node: 1 }]).apps });
    await expect(refused.verifyAppCluster(APP)).rejects.toThrow('mock quote refused');
    const allowed = new CalimeroClient({ baseUrl: 'http://node.test', policy: MOCK });
    Object.assign(allowed, { apps: cluster([{ node: 1 }]).apps });
    expect([...(await allowed.verifyAppCluster(APP)).keys.keys()]).toEqual([1]);
  });
});
