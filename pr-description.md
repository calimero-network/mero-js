## Summary

This PR adds **automatic token refresh** functionality and removes all Tauri-specific workarounds from mero-js, making it a truly universal SDK. The root cause of Tauri issues was fixed in the Tauri proxy script (separate PR), so mero-js no longer needs platform-specific code.

## New Features

### 🔄 Automatic Token Refresh
- ✅ **Automatic 401 handling**: When a request returns `401` with `x-auth-error: token_expired`, the client automatically calls `refreshToken()` callback
- ✅ **Token update**: After successful refresh, calls `onTokenRefresh()` callback to update the stored token
- ✅ **Automatic retry**: Retries the original request with the new token
- ✅ **Error handling**: If refresh fails, throws the original 401 error
- ✅ **Smart detection**: Only triggers on `token_expired`, not other 401 errors (missing_token, token_revoked, invalid_token)
- ✅ **Comprehensive tests**: 16 new tests covering all scenarios (success, failure, concurrent requests, edge cases)

**Usage:**
```typescript
const client = createBrowserHttpClient({
  baseUrl: 'https://api.example.com',
  refreshToken: async () => {
    // Your refresh logic - return new token
    const response = await fetch('/refresh', { method: 'POST' });
    const data = await response.json();
    return data.accessToken;
  },
  onTokenRefresh: async (newToken) => {
    // Update your token storage
    await tokenStorage.set(newToken);
  },
});
```

## Changes

### mero-js
- ✅ **Added `refreshToken` callback** to `Transport` interface and all factory functions
- ✅ **Added `onTokenRefresh` callback** for token storage updates
- ✅ **Implemented automatic refresh logic** in `WebHttpClient.makeRequest()`
- ✅ Removed all Tauri detection logic (isTauri, __TAURI_INTERNALS__, etc.)
- ✅ Removed minimal RequestInit workaround path
- ✅ Removed credentials === 'omit' detection workaround
- ✅ Removed unnecessary proxy-ready check (proxy script runs before page loads via initialization_script)
- ✅ Consolidated to single, clean code path for all environments
- ✅ Added comprehensive token refresh tests (16 new tests covering all scenarios)

### Root Cause Fix (Tauri App - PR #16)
- ✅ Updated proxy script to properly handle AbortSignal with Promise.race()
- ✅ Proxy script now correctly forwards abort events to proxied requests

## Why This Works

The Tauri proxy script is injected via initialization_script **before** the page loads, so it's always ready when React/mero-js makes requests. No timing checks needed.

## Testing

- ✅ All unit tests pass (71/71)
- ✅ Build succeeds
- ✅ Tested in Tauri app - no HTTP 0 errors
- ✅ Authentication flow works
- ✅ **Token refresh works** - automatically handles expired tokens
- ✅ AbortSignal/timeout functionality works correctly

## Breaking Changes

**None** - This is a refactoring that maintains backward compatibility. The changes are internal and don't affect the public API. Token refresh is opt-in via the `refreshToken` callback.

## Related

- Adds automatic token refresh functionality
- Fixes issues with AbortSignal in Tauri environment
- Removes platform-specific code from universal SDK
- Improves code maintainability
- Separates concerns: mero-js is universal, Tauri handles platform-specific needs

## Checklist

- [x] All tests pass
- [x] Build succeeds
- [x] Tested in Tauri app
- [x] Token refresh tested and working
- [x] No breaking changes
- [x] Code follows project conventions
