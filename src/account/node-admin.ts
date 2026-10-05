/**
 * A node's admin API, as an app writes against it: mero-js's `AdminApiClient`
 * with `createNamespace` made whole. On a node a namespace can only be created
 * for an application the node already holds, so this installs the provider's
 * package from the registry first when it is missing — the step an account
 * never sees, because founding through a relay names the package and the relay
 * fetches it. Same call, same result, on both.
 */
import type {
  AdminApiClient,
} from '../admin-api/index.js';
import { latestPublishedVersion } from './create-context.js';

export interface NodeAdminDeps {
  latestVersion?: (registryUrl: string, pkg: string) => Promise<string>;
}

export function createNodeAdmin(
  input: { admin: AdminApiClient; app: { packageName?: string; packageVersion?: string; registryUrl?: string } },
  deps: NodeAdminDeps = {},
): AdminApiClient {
  const { admin, app } = input;
  const latestVersion = deps.latestVersion ?? latestPublishedVersion;

  async function ensureInstalled(applicationId: string): Promise<void> {
    const { apps } = await admin.listApplications();
    if (apps.some((a) => a.id === applicationId)) return;
    if (!app.packageName) {
      throw new Error(`application ${applicationId} is not installed on this node, and no packageName is set to install it`);
    }
    const version = app.packageVersion ?? (await latestVersion(app.registryUrl ?? 'https://apps.calimero.network', app.packageName));
    const { applicationId: installed } = await admin.installApplication({ package: app.packageName, version });
    // A registry bundle signed by a different key is a different application:
    // creating against it would found a workspace for some other app.
    if (installed !== applicationId) {
      throw new Error(`installed ${app.packageName}@${version} as ${installed}, not ${applicationId}`);
    }
  }

  const overrides: Partial<AdminApiClient> = {
    async createNamespace(req) {
      await ensureInstalled(req.applicationId);
      return admin.createNamespace(req);
    },
  };

  return new Proxy(admin, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && prop in overrides) return overrides[prop as keyof AdminApiClient];
      return Reflect.get(target, prop, receiver);
    },
  });
}
