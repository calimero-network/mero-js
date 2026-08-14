import type { Codec } from './types.js';

/** Default codec: JSON text as a byte array. The wire carries `state` as
 * `number[]`, not a string, so this encodes to bytes rather than to text. */
export function jsonCodec<T>(): Codec<T> {
  return {
    encode(value: T): number[] {
      return Array.from(new TextEncoder().encode(JSON.stringify(value)));
    },
    decode(bytes: number[]): T {
      return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes))) as T;
    },
  };
}
