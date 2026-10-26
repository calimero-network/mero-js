import { describe, it, expect } from 'vitest';
import { AdminApiClient } from './admin-client.js';
import type { HttpClient } from '../http-client/index.js';

const HOSTILE_IDS = ['../namespaces/x', 'a/b', 'a?b', 'a#b', '%2e%2e', 'a b'];
const DOT_SEGMENT_IDS = ['.', '..', ''];

type Seen = { method: string; path: string };

// Records every request path; answers with an empty object because only the
// requested URL matters here.
function recordingClient(): { http: HttpClient; seen: Seen[] } {
  const seen: Seen[] = [];
  const record = (method: string) => async (path: string) => {
    seen.push({ method, path });
    return {} as never;
  };
  const http = {
    get: record('GET'),
    post: record('POST'),
    put: record('PUT'),
    delete: record('DELETE'),
    patch: record('PATCH'),
    head: async (path: string) => {
      seen.push({ method: 'HEAD', path });
      return { headers: {}, status: 200 };
    },
    request: async (path: string, init?: { method?: string }) => {
      seen.push({ method: init?.method ?? 'GET', path });
      return {} as never;
    },
  } as unknown as HttpClient;
  return { http, seen };
}

const body = {} as never;

// One entry per route family and shape: the call, and the path it must hit
// with every id argument replaced by `e`, the encoded form of the id.
const ROUTES: Array<[string, (c: AdminApiClient, id: string) => Promise<unknown>, (e: string) => string]> = [
  ['applications get', (c, id) => c.getApplication(id), (e) => `GET /admin-api/applications/${e}`],
  ['applications uninstall', (c, id) => c.uninstallApplication(id), (e) => `DELETE /admin-api/applications/${e}`],
  ['applications versions', (c, id) => c.listApplicationVersions(id), (e) => `GET /admin-api/applications/${e}/versions`],
  ['applications abi', (c, id) => c.getApplicationAbi(id), (e) => `GET /admin-api/applications/${e}/abi`],
  ['contexts get', (c, id) => c.getContext(id), (e) => `GET /admin-api/contexts/${e}`],
  ['contexts delete', (c, id) => c.deleteContext(id), (e) => `DELETE /admin-api/contexts/${e}`],
  ['contexts for-application', (c, id) => c.getContextsForApplication(id), (e) => `GET /admin-api/contexts/for-application/${e}`],
  ['contexts identities', (c, id) => c.getContextIdentities(id), (e) => `GET /admin-api/contexts/${e}/identities`],
  ['contexts join', (c, id) => c.joinContext(id), (e) => `POST /admin-api/contexts/${e}/join`],
  ['contexts storage', (c, id) => c.getContextStorage(id), (e) => `GET /admin-api/contexts/${e}/storage`],
  ['contexts application', (c, id) => c.updateContextApplication(id, body), (e) => `POST /admin-api/contexts/${e}/application`],
  ['contexts leave', (c, id) => c.leaveContext(id), (e) => `POST /admin-api/contexts/${e}/leave`],
  ['contexts with-executors', (c, id) => c.getContextsWithExecutorsForApplication(id), (e) => `GET /admin-api/contexts/with-executors/for-application/${e}`],
  ['sync', (c, id) => c.syncContext(id), (e) => `POST /admin-api/contexts/sync/${e}`],
  ['sync resync', (c, id) => c.resyncContext(id), (e) => `POST /admin-api/contexts/${e}/resync`],
  ['blobs delete', (c, id) => c.deleteBlob(id), (e) => `DELETE /admin-api/blobs/${e}`],
  ['blobs info', (c, id) => c.getBlobInfo(id), (e) => `HEAD /admin-api/blobs/${e}`],
  ['intents perform', (c, id) => c.performIntent(id, body), (e) => `POST /admin-api/contexts/${e}/intents`],
  ['intents relay', (c, id) => c.getIntentRelay(id), (e) => `GET /admin-api/contexts/${e}/intents`],
  ['query', (c, id) => c.queryContext(id, body), (e) => `POST /admin-api/contexts/${e}/query`],
  ['namespaces get', (c, id) => c.getNamespace(id), (e) => `GET /admin-api/namespaces/${e}`],
  ['namespaces delete', (c, id) => c.deleteNamespace(id), (e) => `DELETE /admin-api/namespaces/${e}`],
  ['namespaces for-application', (c, id) => c.listNamespacesForApplication(id), (e) => `GET /admin-api/namespaces/for-application/${e}`],
  ['namespaces invite', (c, id) => c.createNamespaceInvitation(id), (e) => `POST /admin-api/namespaces/${e}/invite`],
  ['namespaces admit', (c, id) => c.admitJoin(id, body), (e) => `POST /admin-api/namespaces/${e}/admit`],
  ['namespaces join', (c, id) => c.joinNamespace(id, body), (e) => `POST /admin-api/namespaces/${e}/join`],
  ['namespaces groups create', (c, id) => c.createGroupInNamespace(id, body), (e) => `POST /admin-api/namespaces/${e}/groups`],
  ['namespaces groups list', (c, id) => c.listNamespaceGroups(id), (e) => `GET /admin-api/namespaces/${e}/groups`],
  ['namespaces admin', (c, id) => c.changeNamespaceAdmin(id, body), (e) => `POST /admin-api/namespaces/${e}/admin`],
  ['namespaces outbound list', (c, id) => c.listOutboundApprovals(id), (e) => `GET /admin-api/namespaces/${e}/outbound-approvals`],
  ['namespaces outbound set', (c, id) => c.setOutboundApproval(id, { applicationId: 'app', approve: [] }), (e) => `PUT /admin-api/namespaces/${e}/outbound-approvals`],
  ['namespaces leave', (c, id) => c.leaveNamespace(id), (e) => `POST /admin-api/namespaces/${e}/leave`],
  ['namespaces account revoke', (c, id) => c.revokeAccountDevice(id, body), (e) => `POST /admin-api/namespaces/${e}/account/revoke`],
  ['namespaces account link', (c, id) => c.linkAccountDevice(id, body), (e) => `POST /admin-api/namespaces/${e}/account/link-device`],
  ['namespaces migration', (c, id) => c.getMigrationStatus(id), (e) => `GET /admin-api/groups/${e}/migration-status`],
  ['namespaces cascade', (c, id) => c.getCascadeStatus(id), (e) => `GET /admin-api/groups/${e}/cascade-status`],
  ['namespaces migration abort', (c, id) => c.abortMigration(id), (e) => `POST /admin-api/groups/${e}/migration/abort`],
  ['account devices relink', (c, id) => c.relinkAccountDevice(id), (e) => `POST /admin-api/account/devices/${e}/relink`],
  ['account devices label', (c, id) => c.labelAccountDevice(id, body), (e) => `PUT /admin-api/account/devices/${e}/label`],
  ['account devices scope', (c, id) => c.rescopeAccountDevice(id, body), (e) => `PUT /admin-api/account/devices/${e}/scope`],
  ['accounts seal', (c, id) => c.sealToAccount(id, id, body), (e) => `POST /admin-api/groups/${e}/accounts/${e}/seal`],
  ['groups get', (c, id) => c.getGroupInfo(id), (e) => `GET /admin-api/groups/${e}`],
  ['groups delete', (c, id) => c.deleteGroup(id), (e) => `DELETE /admin-api/groups/${e}`],
  ['groups members list', (c, id) => c.listGroupMembers(id), (e) => `GET /admin-api/groups/${e}/members`],
  ['groups members add', (c, id) => c.addGroupMembers(id, body), (e) => `POST /admin-api/groups/${e}/members`],
  ['groups members remove', (c, id) => c.removeGroupMembers(id, body), (e) => `POST /admin-api/groups/${e}/members/remove`],
  ['groups member role', (c, id) => c.updateMemberRole(id, id, body), (e) => `PUT /admin-api/groups/${e}/members/${e}/role`],
  ['groups member capabilities', (c, id) => c.getMemberCapabilities(id, id), (e) => `GET /admin-api/groups/${e}/members/${e}/capabilities`],
  ['groups member metadata', (c, id) => c.getMemberMetadata(id, id), (e) => `GET /admin-api/groups/${e}/members/${e}/metadata`],
  ['groups member auto-follow', (c, id) => c.setMemberAutoFollow(id, id, body), (e) => `PUT /admin-api/groups/${e}/members/${e}/auto-follow`],
  ['groups member devices', (c, id) => c.listGroupMemberDevices(id), (e) => `GET /admin-api/groups/${e}/member-devices`],
  ['groups contexts', (c, id) => c.listGroupContexts(id), (e) => `GET /admin-api/groups/${e}/contexts`],
  ['groups context metadata', (c, id) => c.getContextMetadata(id, id), (e) => `GET /admin-api/groups/${e}/contexts/${e}/metadata`],
  ['groups context detach', (c, id) => c.detachContextFromGroup(id, id), (e) => `POST /admin-api/groups/${e}/contexts/${e}/remove`],
  ['groups metadata', (c, id) => c.getGroupMetadata(id), (e) => `GET /admin-api/groups/${e}/metadata`],
  ['groups settings', (c, id) => c.setDefaultCapabilities(id, body), (e) => `PUT /admin-api/groups/${e}/settings/default-capabilities`],
  ['groups tee policy', (c, id) => c.getTeeAdmissionPolicy(id), (e) => `GET /admin-api/groups/${e}/settings/tee-admission-policy`],
  ['groups upgrade status', (c, id) => c.getGroupUpgradeStatus(id), (e) => `GET /admin-api/groups/${e}/upgrade/status`],
  ['groups reparent', (c, id) => c.reparentGroup(id, body), (e) => `POST /admin-api/groups/${e}/reparent`],
  ['groups invite', (c, id) => c.createGroupInvitation(id, body), (e) => `POST /admin-api/groups/${e}/invite`],
  ['groups leave', (c, id) => c.leaveGroup(id), (e) => `POST /admin-api/groups/${e}/leave`],
  ['groups ownership proof', (c, id) => c.issueOwnershipProof(id, body), (e) => `POST /admin-api/groups/${e}/issue-ownership-proof`],
];

async function requested(call: (c: AdminApiClient) => Promise<unknown>): Promise<string[]> {
  const { http, seen } = recordingClient();
  // The empty responses make most methods throw after the request; only the
  // requested path is under test.
  await call(new AdminApiClient(http)).catch(() => undefined);
  return seen.map((s) => `${s.method} ${s.path}`);
}

describe('AdminApiClient path segments', () => {
  describe.each(HOSTILE_IDS)('id %j', (id) => {
    it.each(ROUTES)('%s keeps the id as one encoded segment', async (_name, call, expected) => {
      const paths = await requested((c) => call(c, id));
      expect(paths).toEqual([expected(encodeURIComponent(id))]);
    });
  });

  describe.each(DOT_SEGMENT_IDS)('id %j', (id) => {
    // syncContext('') means sync-all, which is its documented spelling.
    const routes = ROUTES.filter(([name]) => !(id === '' && name === 'sync'));
    it.each(routes)('%s refuses an id that is a dot segment or empty', async (_name, call) => {
      const { http, seen } = recordingClient();
      await expect(call(new AdminApiClient(http), id)).rejects.toThrow(/path segment/);
      expect(seen).toEqual([]);
    });
  });

  it('leaves hex ids unchanged', async () => {
    const id = 'ab'.repeat(32);
    expect(await requested((c) => c.getContext(id))).toEqual([`GET /admin-api/contexts/${id}`]);
  });
});
