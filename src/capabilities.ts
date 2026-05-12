// Member capability bitmask constants — mirrors core's `MemberCapabilities`
// (crates/context/config/src/lib.rs). The value stored per-member is a u32
// bitmask. Core currently assigns bits 0..=8; bits 9 and above are unassigned
// and may be claimed by future core versions, so an application MUST NOT
// assume any particular bit is safe for its own use unless core documents it
// as reserved for applications.

/**
 * Capability bits as defined by core's `MemberCapabilities`.
 *
 * The per-member value is a u32 bitmask. Core currently assigns bits 0..=8
 * (the entries below); bits 9 and above are unassigned — do not repurpose
 * them for application data, as a future core release may claim them.
 */
export const CAPABILITIES = {
  CAN_CREATE_CONTEXT: 1 << 0,
  CAN_INVITE_MEMBERS: 1 << 1,
  CAN_JOIN_OPEN_SUBGROUPS: 1 << 2,
  MANAGE_MEMBERS: 1 << 3,
  MANAGE_APPLICATION: 1 << 4,
  CAN_CREATE_SUBGROUP: 1 << 5,
  CAN_DELETE_SUBGROUP: 1 << 6,
  CAN_MANAGE_VISIBILITY: 1 << 7,
  CAN_MANAGE_METADATA: 1 << 8,
} as const;

export type CapabilityName = keyof typeof CAPABILITIES;
export type CapabilityBit = (typeof CAPABILITIES)[CapabilityName];

/**
 * Returns true if `mask` has every bit of `cap` set. Both operands are
 * coerced to unsigned 32-bit (`>>> 0`) before comparing so a high bit such
 * as `1 << 31` doesn't fall foul of `&` yielding a signed result.
 */
export function hasCap(mask: number, cap: number): boolean {
  const capU32 = cap >>> 0;
  return ((mask & capU32) >>> 0) === capU32;
}

/** Returns `mask` with every bit of `cap` set (u32-normalized). */
export function withCap(mask: number, cap: number): number {
  return (mask | cap) >>> 0;
}

/** Returns `mask` with every bit of `cap` cleared (u32-normalized). */
export function withoutCap(mask: number, cap: number): number {
  return (mask & ~cap) >>> 0;
}
