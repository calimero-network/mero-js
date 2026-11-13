import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { fromHex, hex } from '../crypto/internal.js';
import { MOCK_QUOTE_HEADER, type NodePolicy } from '../runtime/attestation.js';
import type { Governance } from './approvals.js';
import { privateKey } from './recovery-key.js';
import { governanceCanonical, receiptKeyBinding } from '../recovery/backup-files.js';
import binding from '../recovery/rust-binding.json';
import { CalimeroClient } from './calimero-client.js';
import {
  verifyAppCluster,
  verifyPipelineReceipt,
  receiptMessage,
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
  /** Raw JSON of answers signed over params with floats, and with integers past 2^53. */
  floatAnswerText: string;
  bigNumberAnswerText: string;
}
const v = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/receipt-vectors.json', import.meta.url)), 'utf8'),
) as Vectors;

const MOCK: NodePolicy = { allowMock: true };
const APP = 'app-1';
const RUN = 'run-1';
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
    const receipt = await verifyPipelineReceipt(both(), APP, RUN, v.receiptAnswer, MOCK);
    expect(receipt.app).toBe(APP);
    expect(receipt.run).toBe('run-1');
  });

  it('refuses a receipt signed by a node that is not the one answering', async () => {
    await expect(verifyPipelineReceipt(both(), APP, RUN, { ...v.receiptAnswer, node: 2 }, MOCK)).rejects.toThrow('not signed by that key');
  });

  it('refuses a node that is not an attested replica', async () => {
    await expect(verifyPipelineReceipt(cluster([{ node: 2 }]), APP, RUN, v.receiptAnswer, MOCK)).rejects.toThrow('not an attested replica');
  });

  it('refuses a receipt with one byte changed', async () => {
    const receipt = { ...(v.receiptAnswer.receipt as object), state: 'succeedeD' };
    await expect(verifyPipelineReceipt(both(), APP, RUN, { ...v.receiptAnswer, receipt }, MOCK)).rejects.toThrow('not signed by that key');
  });

  it('refuses a signature that is not 64 bytes of hex', async () => {
    await expect(verifyPipelineReceipt(both(), APP, RUN, { ...v.receiptAnswer, signature: 'abcd' }, MOCK)).rejects.toThrow('signature');
  });

  it('accepts params holding floats as core canonicalizes them', async () => {
    const answer = JSON.parse(v.floatAnswerText) as ReceiptAnswer;
    const receipt = await verifyPipelineReceipt(both(), APP, RUN, answer, MOCK);
    expect(receipt.params).toMatchObject({ a: 0.1, b: 1e21, d: 5e-324, e: 1.5 });
  });

  it('accepts integers past 2^53 as core canonicalizes them (every number as f64)', async () => {
    const answer = JSON.parse(v.bigNumberAnswerText) as ReceiptAnswer;
    const receipt = await verifyPipelineReceipt(both(), APP, RUN, answer, MOCK);
    expect(receipt.params).toMatchObject({ a: 9007199254740992, b: 5e18, c: -9223372036854775808, d: 1e19, e: 1e19 });
  });

  it('refuses a receipt for another app', async () => {
    const attestedFor = cluster([{ node: 1 }]);
    await expect(verifyPipelineReceipt(attestedFor, 'app-2', RUN, v.receiptAnswer, MOCK)).rejects.toThrow('is for app app-1, not app-2');
  });

  it('refuses an unattested cluster before looking at the receipt', async () => {
    await expect(verifyPipelineReceipt(cluster([{ node: 1, unbound: true }]), APP, RUN, v.receiptAnswer, MOCK)).rejects.toThrow('replica 1');
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
    await expect(client.verifyPipelineReceipt(APP, RUN, v.receiptAnswer)).rejects.toThrow('no attestation policy');
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

/** An answer for `receipt`, signed by node 1's key (the Rust program's seed), as the node would. */
async function signed(receipt: unknown, node: unknown = 1): Promise<ReceiptAnswer> {
  const key = await privateKey(new Uint8Array(32).fill(11), false);
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', key, receiptMessage(receipt)));
  return { receipt, node, signature: hex(sig) };
}
const goodReceipt = () => JSON.parse(JSON.stringify(v.receiptAnswer.receipt)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Rejects with a plain `Error` carrying `message`, never a `TypeError` from poking at bad input. */
async function refuses(p: Promise<unknown>, message: string | RegExp) {
  const error = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(TypeError);
  expect((error as Error).message).toMatch(message);
}
const check = (answer: unknown, app = APP, run = RUN) =>
  verifyPipelineReceipt(cluster([{ node: 1 }, { node: 2 }]), app, run, answer as ReceiptAnswer, MOCK);

describe('the receipt is for this run', () => {
  it('refuses a receipt for another run of the same app', async () => {
    await refuses(check(v.receiptAnswer, APP, 'run-2'), 'is for run run-1, not run-2');
  });

  it('answers the cluster every quote bound', async () => {
    expect((await verifyAppCluster(cluster([{ node: 1 }]), APP, MOCK)).cluster).toBe(v.cluster);
  });
});

describe('the receipt keeps to core schema', () => {
  it('accepts a signed receipt with an absent or null optional field', async () => {
    const r = goodReceipt();
    r.costSoFar = null;
    expect((await check(await signed(r))).run).toBe(RUN);
  });

  const mutations: [string, (r: Record<string, any>) => void, RegExp][] = [ // eslint-disable-line @typescript-eslint/no-explicit-any
    ['an unknown field', (r) => (r.extra = 1), /receipt\.extra is not a known field/],
    ['a missing field', (r) => delete r.pipeline, /receipt\.pipeline is missing/],
    ['a wrong type', (r) => (r.state = 5), /receipt\.state is not a string/],
    ['a negative size', (r) => (r.inputs.data[0].size = -1), /inputs\.data\[0\]\.size is not an unsigned integer/],
    ['an unknown nested field', (r) => (r.steps.load.extra = 1), /steps\.load\.extra is not a known field/],
    ['a wrong nested type', (r) => (r.steps.load.runs[0].index = '0'), /steps\.load\.runs\[0\]/],
    ['a run that is neither cached nor a proof', (r) => (r.steps.load.runs[1] = { index: 1 }), /steps\.load\.runs\[1\]/],
    ['params that are not an object', (r) => (r.params = []), /receipt\.params is not an object/],
  ];
  for (const [name, mutate, message] of mutations) {
    it(`refuses ${name}, even under a valid signature`, async () => {
      const r = goodReceipt();
      mutate(r);
      await refuses(check(await signed(r)), message);
    });
  }
});

describe('node ids', () => {
  for (const node of ['1', true, [1], -1, 2 ** 53, 1.5, 1n, null, undefined]) {
    it(`refuses ${String(typeof node)} ${String(node)} as the answering node`, async () => {
      await refuses(check({ ...v.receiptAnswer, node }), 'not a node id');
    });
  }

  it('refuses a replica or document whose node is not a node id', async () => {
    const odd = (patch: (a: any) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const c = cluster([{ node: 1 }]);
      const ask = c.apps.attestation.bind(c.apps);
      c.apps.attestation = async (args) => {
        const a = (await ask(args)) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        patch(a);
        return a;
      };
      return verifyAppCluster(c, APP, MOCK);
    };
    await refuses(odd((a) => (a.replicas[0].node = '1')), 'not a node id');
    await refuses(odd((a) => (a.replicas[0].attestation.node = '1')), 'not a node id');
    await refuses(odd((a) => (a.replicas[0].node = 2 ** 53)), 'not a node id');
  });
});

describe('hex is read as core reads it', () => {
  it('accepts an upper-case signature', async () => {
    const answer = { ...v.receiptAnswer, signature: (v.receiptAnswer.signature as string).toUpperCase() };
    expect((await check(answer)).run).toBe(RUN);
  });

  it('refuses a padded signature, which fromHex would trim', async () => {
    await refuses(check({ ...v.receiptAnswer, signature: ` ${v.receiptAnswer.signature as string}\n` }), 'signature');
  });

  it('refuses a padded receipt key', async () => {
    const c = cluster([{ node: 1 }]);
    const ask = c.apps.attestation.bind(c.apps);
    c.apps.attestation = async (args) => {
      const a = (await ask(args)) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      a.replicas[0].attestation.receiptKey = ` ${a.replicas[0].attestation.receiptKey}`;
      return a;
    };
    await refuses(verifyAppCluster(c, APP, MOCK), 'receipt key');
  });
});

describe('what is returned is what was signed', () => {
  it('returns the receipt parsed from the verified bytes, whatever getters the input had', async () => {
    const r = goodReceipt();
    let reads = 0;
    Object.defineProperty(r, 'state', { enumerable: true, get: () => (reads++ === 0 ? 'succeeded' : 'failed') });
    const receipt = await check({ ...(await signed(goodReceipt())), receipt: r });
    expect(receipt.state).toBe('succeeded');
  });

  it('returns the governance from its canonical fields only', async () => {
    const c = cluster([{ node: 1 }]);
    const ask = c.apps.attestation.bind(c.apps);
    c.apps.attestation = async (args) => {
      const a = (await ask(args)) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      a.replicas[0].attestation.governance = { ...a.replicas[0].attestation.governance, evil: 1 };
      return a;
    };
    expect((await verifyAppCluster(c, APP, MOCK)).governance).toEqual(v.governance);
  });
});

describe('malformed input is an Error', () => {
  for (const [name, answer] of [
    ['a null answer', null],
    ['a non-string signature', { ...v.receiptAnswer, signature: 5 }],
    ['an undefined receipt', { ...v.receiptAnswer, receipt: undefined }],
    ['a receipt that is a string', { ...v.receiptAnswer, receipt: 'x' }],
  ] as [string, unknown][]) {
    it(`rejects ${name}`, async () => {
      await refuses(check(answer), /./);
    });
  }

  it('rejects replicas that are not an array, and a replica with neither an attestation nor an error', async () => {
    const answer = (replicas: unknown) => ({ apps: { attestation: async () => ({ appId: APP, cluster: v.cluster, replicas }) } }) as never;
    await refuses(verifyAppCluster(answer('x'), APP, MOCK), 'malformed attestation');
    await refuses(verifyAppCluster(answer([{ node: 1 }]), APP, MOCK), 'neither an attestation nor an error');
    await refuses(verifyAppCluster(answer([null]), APP, MOCK), 'not an object');
  });

  it('refuses a receipt nested deeper than the bound, cleanly', async () => {
    let deep: unknown = 1;
    for (let i = 0; i < 100; i++) deep = { a: deep };
    const r = goodReceipt();
    r.params = deep;
    await refuses(check({ ...v.receiptAnswer, receipt: r }), 'nested deeper than');
  });
});
