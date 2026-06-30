import { describe, it, expect, vi, afterEach } from 'vitest';
import { getLockManager, withRefreshLock } from './refresh-lock';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getLockManager', () => {
  it('returns null when navigator is undefined (Node)', () => {
    vi.stubGlobal('navigator', undefined);
    expect(getLockManager()).toBeNull();
  });

  it('returns null when navigator has no locks', () => {
    vi.stubGlobal('navigator', {});
    expect(getLockManager()).toBeNull();
  });

  it('returns the manager when navigator.locks.request exists', () => {
    const locks = { request: vi.fn() };
    vi.stubGlobal('navigator', { locks });
    expect(getLockManager()).toBe(locks);
  });
});

describe('withRefreshLock', () => {
  it('routes the task through navigator.locks.request when available', async () => {
    const request = vi.fn((_name: string, cb: () => Promise<unknown>) => cb());
    vi.stubGlobal('navigator', { locks: { request } });

    const result = await withRefreshLock('lock-A', async () => 'done');

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe('lock-A');
    expect(result).toBe('done');
  });

  it('serializes tasks holding the same lock (winner runs to completion first)', async () => {
    // Minimal in-memory mutual-exclusion mock of the Web Locks API.
    const chains = new Map<string, Promise<unknown>>();
    const request = vi.fn(async (name: string, cb: () => Promise<unknown>) => {
      const prev = chains.get(name) ?? Promise.resolve();
      const run = prev.then(() => cb());
      chains.set(
        name,
        run.then(
          () => undefined,
          () => undefined,
        ),
      );
      return run;
    });
    vi.stubGlobal('navigator', { locks: { request } });

    const order: string[] = [];
    const a = withRefreshLock('same', async () => {
      order.push('a-start');
      await new Promise((r) => setTimeout(r, 20));
      order.push('a-end');
    });
    const b = withRefreshLock('same', async () => {
      order.push('b-start');
      order.push('b-end');
    });

    await Promise.all([a, b]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('falls back to running the task directly (with jitter) when no lock API exists', async () => {
    vi.stubGlobal('navigator', undefined);
    const task = vi.fn(async () => 'fallback');
    const result = await withRefreshLock('lock-B', task, 0);
    expect(result).toBe('fallback');
    expect(task).toHaveBeenCalledTimes(1);
  });
});
