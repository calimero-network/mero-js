import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryTokenStore, LocalStorageTokenStore } from './index';
import type { TokenData } from '../mero-js';

const sampleToken: TokenData = {
  access_token: 'abc123',
  refresh_token: 'def456',
  expires_at: Date.now() + 3600000,
};

describe('MemoryTokenStore', () => {
  let store: MemoryTokenStore;

  beforeEach(() => {
    store = new MemoryTokenStore();
  });

  it('returns null initially', () => {
    expect(store.getTokens()).toBeNull();
  });

  it('stores and retrieves tokens', () => {
    store.setTokens(sampleToken);
    expect(store.getTokens()).toEqual(sampleToken);
  });

  it('clears tokens', () => {
    store.setTokens(sampleToken);
    store.clear();
    expect(store.getTokens()).toBeNull();
  });
});

describe('LocalStorageTokenStore', () => {
  let store: LocalStorageTokenStore;
  const mockStorage: Record<string, string> = {};

  beforeEach(() => {
    // Clear mock storage
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);

    // Mock localStorage
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, value: string) => { mockStorage[key] = value; },
      removeItem: (key: string) => { delete mockStorage[key]; },
    });

    store = new LocalStorageTokenStore('test-mero-tokens');
  });

  it('returns null when storage is empty', () => {
    expect(store.getTokens()).toBeNull();
  });

  it('stores and retrieves tokens as JSON', () => {
    store.setTokens(sampleToken);
    expect(store.getTokens()).toEqual(sampleToken);
    expect(mockStorage['test-mero-tokens']).toBeDefined();

    // Verify it's valid JSON
    const parsed = JSON.parse(mockStorage['test-mero-tokens']);
    expect(parsed.access_token).toBe('abc123');
  });

  it('clears tokens', () => {
    store.setTokens(sampleToken);
    store.clear();
    expect(store.getTokens()).toBeNull();
    expect(mockStorage['test-mero-tokens']).toBeUndefined();
  });

  it('returns null for invalid JSON in storage', () => {
    mockStorage['test-mero-tokens'] = 'not-json';
    expect(store.getTokens()).toBeNull();
  });

  it('returns null for incomplete token data', () => {
    mockStorage['test-mero-tokens'] = JSON.stringify({ access_token: 'abc' });
    expect(store.getTokens()).toBeNull();
  });

  it('defaults expires_at when missing from stored data', () => {
    const before = Date.now();
    mockStorage['test-mero-tokens'] = JSON.stringify({
      access_token: 'abc',
      refresh_token: 'def',
    });
    const tokens = store.getTokens();
    expect(tokens).not.toBeNull();
    expect(tokens!.access_token).toBe('abc');
    // Should default to ~1h from now
    expect(tokens!.expires_at).toBeGreaterThanOrEqual(before + 3500_000);
    expect(tokens!.expires_at).toBeLessThanOrEqual(Date.now() + 3600_001);
  });

  it('uses default key when none provided', () => {
    const defaultStore = new LocalStorageTokenStore();
    defaultStore.setTokens(sampleToken);
    expect(mockStorage['mero-tokens']).toBeDefined();
  });
});
