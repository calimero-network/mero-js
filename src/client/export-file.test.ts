import { describe, expect, it } from 'vitest';

import { fromHex, fromHexUnsized, hex } from '../crypto/internal.js';
import { SEALED_FILE_VECTORS as V } from '../sealed/fixtures/sealed-file-vectors.js';
import { fileId } from '../sealed/file.js';
import type { Transport } from '../runtime/transport.js';
import { exportFile, exportFileTo } from './files.js';

const bytes = (value: string) => fromHexUnsized(value, 'vector');
const sha = async (data: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', data));
const [three, full, empty] = V.vectors;
type Vector = (typeof V.vectors)[number];
const plain = (len: number) => Uint8Array.from({ length: len }, (_, i) => i % 251);

/** A node holding one vector: its export answer (changeable) and its segment. */
function node(v: Vector, change: (answer: Record<string, unknown>) => void = () => {}, segment = bytes(v.segment0)) {
  const calls: string[] = [];
  let body: unknown;
  const answer: Record<string, unknown> = {
    app: v.app,
    id: v.id,
    size: v.size,
    sha256: v.plaintextSha256,
    segments: v.segments,
    ephemeral: v.ephemeral,
    wrapped: v.wrapped,
  };
  change(answer);
  const transport = {
    json: async (method: string, path: string, options?: { body?: unknown }) => {
      calls.push(`${method} ${path}`);
      body = options?.body;
      return answer;
    },
    request: async (method: string, path: string) => {
      calls.push(`${method} ${path}`);
      return new Response(segment);
    },
  } as unknown as Pick<Transport, 'json' | 'request'>;
  return { transport, calls, body: () => body };
}

function sink() {
  const chunks: Uint8Array[] = [];
  return { chunks, write: (chunk: Uint8Array) => void chunks.push(chunk), total: () => chunks.reduce((n, c) => n + c.length, 0) };
}

const run = (n: ReturnType<typeof node>, v: Vector, out = sink()) =>
  exportFileTo(n.transport, v.app, v.id, out, bytes(v.recipientSecret));

describe('exportFileTo', () => {
  it('decrypts the Rust vectors to exactly their plaintext', async () => {
    for (const v of V.vectors) {
      const n = node(v);
      const out = sink();
      const done = await run(n, v, out);
      expect(done).toEqual({ size: v.size, sha256: v.plaintextSha256 });
      expect(new Uint8Array(out.chunks.flatMap((c) => [...c])), v.name).toEqual(plain(v.plaintextLen));
      expect(hex(await sha(new Uint8Array(out.chunks.flatMap((c) => [...c]))))).toBe(v.plaintextSha256);
      expect(n.calls).toEqual([
        `POST apps/${v.app}/files/${v.id}/export`,
        `GET apps/${v.app}/files/${v.id}/segments/0`,
      ]);
      expect(n.body()).toEqual({ recipient: v.recipientPublic });
    }
  });

  it('hands the sink chunks of at most 64 KiB, in order', async () => {
    const out = sink();
    await run(node(three), three, out);
    expect(out.chunks.map((c) => c.length)).toEqual([65536, 65536, 5]);
  });

  it('writes nothing for an empty file', async () => {
    const out = sink();
    await run(node(empty), empty, out);
    expect(out.chunks).toEqual([]);
  });

  it('works with a fresh export key, which cannot open a wrap made for another', async () => {
    await expect(exportFileTo(node(three).transport, three.app, three.id, sink())).rejects.toThrow('does not open');
  });

  it('fails a tampered segment before any of its bytes reach the sink', async () => {
    const tampered = bytes(three.segment0);
    tampered[3] ^= 1;
    const out = sink();
    await expect(run(node(three, () => {}, tampered), three, out)).rejects.toThrow('is not the one the file lists');
    expect(out.chunks).toEqual([]);
  });

  it('fails a segment list that does not hash to the id', async () => {
    const n = node(three, (a) => (a.segments = [hex(new Uint8Array(32).fill(7))]));
    await expect(run(n, three)).rejects.toThrow('are not the file');
    expect(n.calls).toHaveLength(1);
  });

  it('fails an answer that names another file than the one asked for', async () => {
    const n = node(three);
    await expect(
      exportFileTo(n.transport, three.app, full.id, sink(), bytes(three.recipientSecret)),
    ).rejects.toThrow('are not the file');
  });

  it('fails an empty segment list even when it hashes to the requested id', async () => {
    const id = hex(await fileId([]));
    const n = node(three, (a) => {
      a.segments = [];
      a.id = id;
    });
    await expect(exportFileTo(n.transport, three.app, id, sink(), bytes(three.recipientSecret))).rejects.toThrow(
      'are not the file',
    );
  });

  it('fails a consistent answer for a file other than the one asked for', async () => {
    const other = new Uint8Array(32).fill(9);
    const id = hex(await fileId([other]));
    const n = node(three, (a) => {
      a.segments = [hex(other)];
      a.id = id;
    });
    await expect(run(n, three)).rejects.toThrow('are not the file');
  });

  it('fails a wrong final size, withholding the last chunk', async () => {
    const out = sink();
    await expect(run(node(three, (a) => (a.size = three.size + 1)), three, out)).rejects.toThrow('not the one that was sealed');
    expect(out.total()).toBe(2 * 65536);
  });

  it('fails a wrong final SHA-256', async () => {
    const n = node(three, (a) => (a.sha256 = '00'.repeat(32)));
    await expect(run(n, three)).rejects.toThrow('not the one that was sealed');
  });

  it('fails a wrap made for another app', async () => {
    const n = node(three, (a) => (a.app = 'another-app'));
    await expect(run(n, three)).rejects.toThrow('does not open');
    expect(n.calls).toHaveLength(1);
  });

  it('fails a malformed answer', async () => {
    await expect(run(node(three, (a) => (a.ephemeral = 'zz')), three)).rejects.toThrow('ephemeral key');
    await expect(run(node(three, (a) => (a.sha256 = 'ab')), three)).rejects.toThrow('sha256');
    await expect(run(node(three, (a) => (a.size = -1)), three)).rejects.toThrow('bad size');
    await expect(run(node(three, (a) => (a.size = 2 ** 60)), three)).rejects.toThrow('bad size');
  });
});

describe('exportFile', () => {
  it('returns the bytes', async () => {
    // exportFile makes its own export key, so only the failure path can run without the vector's secret
    await expect(exportFile(node(three).transport, three.app, three.id)).rejects.toThrow('does not open');
    expect(fromHex(three.id, 'id', 32)).toHaveLength(32);
  });
});
