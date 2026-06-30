// Cross-tab/instance refresh coordination.
//
// Per-instance single-flight (the `refreshPromise` in mero-js / web-client) only
// dedups within ONE MeroJs instance. With `LocalStorageTokenStore`, several
// browser tabs share the same persisted token and each fires its own refresh on
// a server-rotation 401 wave. Once refresh tokens rotate + reuse-detect on the
// server, that stampede is actively dangerous (every loser of the race replays a
// now-consumed token and trips family revocation).
//
// When the Web Locks API is available we serialize refresh across all same-origin
// tabs through a named lock; the winner rotates and the others, re-reading the
// store under the lock, simply adopt the freshly-rotated pair. Outside the
// browser (Node, Tauri without locks, older browsers) we fall back to the
// caller's per-instance single-flight plus a little jitter to de-correlate
// independent instances.

type LockTask<T> = () => Promise<T>;

interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

/**
 * Return the Web Locks manager if this runtime supports it, else `null`.
 * Safe in non-browser/Node contexts where `navigator` is undefined.
 */
export function getLockManager(): LockManagerLike | null {
  try {
    const nav = (globalThis as { navigator?: { locks?: LockManagerLike } }).navigator;
    if (nav && nav.locks && typeof nav.locks.request === 'function') {
      return nav.locks;
    }
  } catch {
    // Accessing navigator can throw in some sandboxes — treat as unavailable.
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Small random delay (ms) to de-correlate independent instances when no lock exists. */
function jitterMs(maxMs: number): number {
  return Math.floor(Math.random() * Math.max(0, maxMs));
}

/**
 * Run `task` while holding the cross-tab refresh lock named `name` when the Web
 * Locks API is available; otherwise run it after a small jitter. The task itself
 * is responsible for re-reading shared token state so it can adopt a rotation a
 * peer already performed.
 */
export async function withRefreshLock<T>(
  name: string,
  task: LockTask<T>,
  jitterMaxMs = 50,
): Promise<T> {
  const locks = getLockManager();
  if (locks) {
    return locks.request(name, () => task());
  }
  if (jitterMaxMs > 0) {
    await sleep(jitterMs(jitterMaxMs));
  }
  return task();
}
