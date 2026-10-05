import { describe, expect, it, vi } from 'vitest';
import { createNodeAdmin } from './node-admin.js';

const APP = 'ap'.repeat(32);

function rig(installed: string[], installs = APP) {
  const admin = {
    listApplications: vi.fn(async () => ({ apps: installed.map((id) => ({ id })) })),
    installApplication: vi.fn(async () => ({ applicationId: installs })),
    createNamespace: vi.fn(async () => ({ namespaceId: 'ns' })),
    listNamespaces: vi.fn(async () => []),
  };
  const latestVersion = vi.fn(async () => '1.2.3');
  const node = createNodeAdmin(
    { admin: admin as never, app: { packageName: 'com.calimero.chat', registryUrl: 'https://reg' } },
    { latestVersion },
  );
  return { node, admin, latestVersion };
}

describe('createNodeAdmin', () => {
  it('creates the namespace straight away when the app is installed', async () => {
    const { node, admin } = rig([APP]);
    await expect(node.createNamespace({ applicationId: APP, name: 'Team' })).resolves.toEqual({ namespaceId: 'ns' });
    expect(admin.installApplication).not.toHaveBeenCalled();
    expect(admin.createNamespace).toHaveBeenCalledWith({ applicationId: APP, name: 'Team' });
  });

  it('installs the app from the registry first when the node lacks it', async () => {
    const { node, admin } = rig([]);
    await node.createNamespace({ applicationId: APP, name: 'Team' });
    expect(admin.installApplication).toHaveBeenCalledWith({ package: 'com.calimero.chat', version: '1.2.3' });
    expect(admin.createNamespace).toHaveBeenCalledOnce();
  });

  it('refuses when the registry bundle is not the app asked for', async () => {
    const { node, admin } = rig([], 'ot'.repeat(32));
    await expect(node.createNamespace({ applicationId: APP })).rejects.toThrow(/installed .* not /);
    expect(admin.createNamespace).not.toHaveBeenCalled();
  });

  it('passes every other call through unchanged', async () => {
    const { node, admin } = rig([APP]);
    await node.listNamespaces();
    expect(admin.listNamespaces).toHaveBeenCalledOnce();
  });
});
