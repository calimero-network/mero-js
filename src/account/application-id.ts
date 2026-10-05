/**
 * An application's id, computed the way merod computes it.
 *
 * core's `ApplicationId::for_bundle(package, signer_id)` is
 * `sha256(borsh((package, signer_id)))`: the package name and the publisher's
 * signing key together decide which app a bundle IS, and the version is not an
 * input, so every version a publisher ships under one package installs as the
 * same application. A node learns the id when it installs the bundle; an
 * account installs nothing, so it has to derive the id from the same two
 * inputs — both of which the registry's bundle listing carries.
 */

/** A bundle entry as `GET {registry}/api/v2/bundles?package=…` lists it. */
export interface RegistryBundle {
  package?: string;
  signerId?: string;
  appVersion?: string;
  yanked?: boolean;
  publishedAt?: string;
}

/** Borsh `String`: u32 little-endian byte length, then the UTF-8 bytes. */
function borshString(s: string): Uint8Array {
  const bytes = new TextEncoder().encode(s);
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length, true);
  out.set(bytes, 4);
  return out;
}

/**
 * `sha256(borsh((pkg, signerId)))` as lowercase hex: core's
 * `ApplicationId::for_bundle`. A borsh tuple is its fields concatenated.
 */
export async function applicationIdForBundle(pkg: string, signerId: string): Promise<string> {
  const a = borshString(pkg);
  const b = borshString(signerId);
  const tuple = new Uint8Array(a.length + b.length);
  tuple.set(a, 0);
  tuple.set(b, a.length);
  const digest = await crypto.subtle.digest('SHA-256', tuple);
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Whether `a` is a newer version string than `b` (numeric, dot/dash split). */
function newer(a: string, b: string): boolean {
  const [x, y] = [a, b].map((v) => v.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0));
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}

/**
 * The entry a package resolves to: its newest version that is not yanked. The
 * one rule for "latest", shared by the version lookup and the id derivation so
 * the two cannot disagree about which bundle an account is founding on.
 */
export function selectLatestBundle<B extends RegistryBundle>(bundles: readonly B[]): B | undefined {
  return bundles
    .filter((b) => !b.yanked && typeof b.appVersion === 'string' && b.appVersion.length > 0)
    .reduce<B | undefined>((best, b) => (!best || newer(b.appVersion!, best.appVersion!) ? b : best), undefined);
}

/** The registry's listing of `pkg`, every version. */
export async function fetchRegistryBundles(
  registryUrl: string,
  pkg: string,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<RegistryBundle[]> {
  const url = `${registryUrl.replace(/\/+$/, '')}/api/v2/bundles?package=${encodeURIComponent(pkg)}`;
  const response = await fetchFn(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`the registry has no ${pkg} (HTTP ${response.status})`);
  const body = (await response.json()) as unknown;
  return Array.isArray(body) ? (body as RegistryBundle[]) : [];
}

export interface ResolvedApplication {
  applicationId: string;
  signerId: string;
  version: string;
}

/**
 * The application id an account founds `pkg` on, learned from the registry.
 *
 * Refused when the non-yanked versions of `pkg` name more than one publisher:
 * that is two different applications under one package name (the id binds the
 * signer), and picking either silently would commit the founder — who signs
 * `TargetApplicationSet` naming the id — to an app it did not choose.
 */
export async function resolveApplicationIdFromRegistry(
  registryUrl: string,
  pkg: string,
  deps: { fetch?: typeof fetch } = {},
): Promise<ResolvedApplication> {
  const bundles = await fetchRegistryBundles(registryUrl, pkg, deps.fetch);
  const live = bundles.filter((b) => !b.yanked);
  const signers = [...new Set(live.map((b) => b.signerId).filter((s): s is string => typeof s === 'string' && s.length > 0))];
  if (signers.length > 1) {
    throw new Error(
      `the registry lists ${pkg} under more than one publisher (${signers.join(', ')}): refusing to guess which application it is`,
    );
  }
  const latest = selectLatestBundle(live);
  if (!latest) throw new Error(`the registry lists no version of ${pkg}`);
  const signerId = latest.signerId;
  if (!signerId) throw new Error(`the registry names no publisher for ${pkg} ${latest.appVersion}`);
  return { applicationId: await applicationIdForBundle(pkg, signerId), signerId, version: latest.appVersion! };
}
