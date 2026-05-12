import { describe, it, expect } from 'vitest';
import { CAPABILITIES, hasCap, withCap, withoutCap } from './capabilities';

describe('capabilities', () => {
  it('exposes the expected capability bits as powers of two', () => {
    expect(CAPABILITIES).toEqual({
      CAN_CREATE_CONTEXT: 1,
      CAN_INVITE_MEMBERS: 2,
      CAN_JOIN_OPEN_SUBGROUPS: 4,
      MANAGE_MEMBERS: 8,
      MANAGE_APPLICATION: 16,
      CAN_CREATE_SUBGROUP: 32,
      CAN_DELETE_SUBGROUP: 64,
      CAN_MANAGE_VISIBILITY: 128,
      CAN_MANAGE_METADATA: 256,
    });
    expect(Object.keys(CAPABILITIES)).toHaveLength(9);
    for (const value of Object.values(CAPABILITIES)) {
      expect(value & (value - 1)).toBe(0); // exactly one bit set
    }
  });

  it('hasCap checks every bit of the requested mask is present', () => {
    expect(hasCap(0b101, 0b100)).toBe(true);
    expect(hasCap(0b101, 0b010)).toBe(false);
    expect(hasCap(0b101, 0b101)).toBe(true);
    expect(hasCap(0, CAPABILITIES.CAN_CREATE_CONTEXT)).toBe(false);
  });

  it('hasCap handles high bits like 1 << 31 (signed-int safety)', () => {
    const appBit = withCap(0, 1 << 31); // u32-normalized => 0x80000000
    expect(hasCap(appBit, 1 << 31)).toBe(true);
    expect(hasCap(appBit, appBit)).toBe(true);
    expect(hasCap(withCap(appBit, CAPABILITIES.CAN_CREATE_CONTEXT), 1 << 31)).toBe(true);
    expect(hasCap(CAPABILITIES.CAN_CREATE_CONTEXT, 1 << 31)).toBe(false);
  });

  it('withCap sets bits', () => {
    expect(withCap(0, CAPABILITIES.CAN_CREATE_SUBGROUP)).toBe(32);
    expect(withCap(0b001, 0b100)).toBe(0b101);
  });

  it('withoutCap clears bits', () => {
    expect(withoutCap(0b111, 0b010)).toBe(0b101);
    expect(withoutCap(0, CAPABILITIES.CAN_MANAGE_METADATA)).toBe(0);
  });

  it('withCap / withoutCap return u32-normalized non-negative numbers', () => {
    const a = withCap(-1, CAPABILITIES.CAN_CREATE_CONTEXT);
    const b = withoutCap(-1, CAPABILITIES.CAN_CREATE_CONTEXT);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(a).toBe(0xffffffff);
    expect(b).toBe(0xfffffffe);
  });
});
