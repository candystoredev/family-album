/**
 * Descriptor (de)serialization — a face's 128-d embedding stored as a compact
 * BLOB of little-endian Float32 (512 bytes) rather than JSON text. Pure and
 * cross-environment (no Buffer, no browser globals), so it runs in the server
 * routes, in scripts, and under the test runner unchanged.
 */

export const DESCRIPTOR_LENGTH = 128;

/** Pack a descriptor into the bytes stored in `media_faces.descriptor`. */
export function descriptorToBytes(descriptor: number[] | Float32Array): Uint8Array {
  const floats = descriptor instanceof Float32Array ? descriptor : Float32Array.from(descriptor);
  // Copy into a fresh, exactly-sized buffer so we never persist a Float32Array
  // that's a view onto a larger backing ArrayBuffer.
  return new Uint8Array(floats.buffer.slice(floats.byteOffset, floats.byteOffset + floats.byteLength));
}

/** Read a descriptor back from a `media_faces.descriptor` BLOB. */
export function bytesToDescriptor(bytes: Uint8Array | ArrayBuffer): number[] {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // Align to a standalone buffer — libSQL may hand back a Uint8Array view with a
  // non-zero byteOffset, which Float32Array's (buffer) ctor requires to be
  // 4-byte aligned; copying sidesteps that entirely.
  const aligned = new Uint8Array(u8.byteLength);
  aligned.set(u8);
  return Array.from(new Float32Array(aligned.buffer));
}
