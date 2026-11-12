/**
 * Downloading a sealed file, as core's `Client::export_file_to` does: the node
 * answers only ciphertext and the file's data key wrapped to a key made here
 * for this call, and nothing it says is believed until it checks out.
 */

import { concat, fromHex, fromHexUnsized, hex } from '../crypto/internal.js';
import { SegmentReader, fileId, unwrapExport } from '../sealed/file.js';
import { x25519KeyPair } from '../sealed/noise.js';
import { routePath, type Transport } from '../runtime/transport.js';

/** Where an export writes the plaintext, in order. A `WritableStreamDefaultWriter` fits. */
export interface FileSink {
  write(chunk: Uint8Array): Promise<void> | void;
}

/** What an export wrote, as proven against the file's mark. */
export interface ExportedFile {
  size: number;
  /** SHA-256 of the plaintext, hex. */
  sha256: string;
}

interface ExportAnswer {
  app: string;
  id: string;
  size: number;
  sha256: string;
  segments: string[];
  ephemeral: string;
  wrapped: string;
}

/**
 * Write the plaintext of sealed file `id` (64 hex) of app `app` to `sink`, one
 * segment at a time. Each segment is checked against its hash before it is
 * opened, and the segment list, size and plaintext hash against the file's id
 * and mark at the end. Until this resolves, what `sink` got is authentic but
 * may be a prefix of the file. `recipientSecret` pins the export key, for the
 * published vectors only.
 */
export async function exportFileTo(
  transport: Pick<Transport, 'json' | 'request'>,
  app: string,
  id: string,
  sink: FileSink,
  recipientSecret?: Uint8Array,
): Promise<ExportedFile> {
  const recipient = await x25519KeyPair(recipientSecret);
  // shortcut: not in the generated routes until the next openapi sync; they move there then.
  const answer = await transport.json<ExportAnswer>('POST', routePath('apps/{app}/files/{id}/export', { app, id }), {
    body: { recipient: hex(recipient.publicKey) },
  });
  const segments = answer.segments.map((h) => fromHex(h, 'segment hash', 32));
  const named = fromHex(answer.id, 'file id', 32);
  if (segments.length === 0 || hex(await fileId(segments)) !== hex(named) || hex(named) !== id) {
    throw new Error(`the node answered segments that are not the file ${id}`);
  }
  if (!Number.isSafeInteger(answer.size) || answer.size < 0) throw new Error('the node answered a bad size');
  const sha256 = hex(fromHex(answer.sha256, 'sha256', 32));
  const dataKey = await unwrapExport(
    recipient,
    fromHex(answer.ephemeral, 'ephemeral key', 32),
    { appId: answer.app, fileId: id },
    fromHexUnsized(answer.wrapped, 'wrapped key'),
  );
  const reader = await SegmentReader.create(dataKey, segments);
  for (let k = 0; k < segments.length; k += 1) {
    const response = await transport.request('GET', routePath('apps/{app}/files/{id}/segments/{k}', { app, id, k }));
    await reader.push(new Uint8Array(await response.arrayBuffer()), (chunk) => sink.write(chunk));
  }
  const last = await reader.finishExpecting(answer.size, sha256);
  if (last.length > 0) await sink.write(last);
  return { size: answer.size, sha256 };
}

/** The plaintext of sealed file `id` of app `app`, in memory. Prefer {@link exportFileTo} for a large file. */
export async function exportFile(transport: Pick<Transport, 'json' | 'request'>, app: string, id: string): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  await exportFileTo(transport, app, id, { write: (chunk) => void chunks.push(chunk) });
  return concat(...chunks);
}
