import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdminApiClient } from './admin-client.js';
import { WebHttpClient, HTTPError } from '../http-client/index.js';
import type { Transport } from '../http-client/index.js';

/**
 * The device surface exercised through a real `WebHttpClient` over a stubbed
 * `fetch`, rather than through a mock that already speaks in objects.
 *
 * The mock-client tests next door prove the routes and the unwrapping; these
 * prove the bytes. The merod admin API serialises **camelCase** (serde
 * `rename_all`), and a snake_case body does not fail loudly there - `serde`
 * fills the missing field with its default and the node reports something
 * misleading about a field the caller believes it sent. The only way to catch
 * that class from this side is to read the JSON that actually left, which needs
 * the client's own serialisation in the loop.
 */
describe('account devices over the wire', () => {
  const NODE = 'https://node.example.invalid';
  const DEVICE = 'a'.repeat(64);
  const NAMESPACE = '5'.repeat(64);

  let fetchStub: ReturnType<typeof vi.fn>;
  let client: AdminApiClient;

  /** A JSON 200, the shape merod's `ApiResponse` puts on the wire. */
  function jsonOk(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** The URL and parsed body of the nth stubbed call. */
  function callAt(n: number): { url: string; method: string; body: unknown } {
    const [url, init] = fetchStub.mock.calls[n] as [string, RequestInit | undefined];
    const raw = init?.body;
    return {
      url,
      method: init?.method ?? 'GET',
      body: typeof raw === 'string' ? JSON.parse(raw) : raw,
    };
  }

  beforeEach(() => {
    fetchStub = vi.fn();
    const transport: Transport = { fetch: fetchStub, baseUrl: NODE };
    client = new AdminApiClient(new WebHttpClient(transport));
  });

  it('parses the camelCase device listing merod emits, revoked row included', async () => {
    // Written as a JSON string rather than an object literal so the casing under
    // test is the casing in the file: an object literal would be re-serialised
    // from whatever the test typed, which is exactly the assumption being checked.
    fetchStub.mockResolvedValueOnce(
      new Response(
        `{"devices":[
          {"deviceId":"${DEVICE}","signingKey":"${'b'.repeat(64)}","isSelf":true,
           "revoked":false,"applications":["${'c'.repeat(64)}"],
           "namespaces":["${NAMESPACE}"],"label":"this laptop"},
          {"deviceId":"${'d'.repeat(64)}","signingKey":"${'e'.repeat(64)}","isSelf":false,
           "revoked":true,"applications":[],"namespaces":[],"label":"old phone"}
        ]}`,
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const devices = await client.listAccountDevices();

    expect(callAt(0).url).toBe(`${NODE}/admin-api/account/devices`);
    // A revoked device is a row in the listing, not an omission. Both the state
    // and the scope are readable here, so telling an active device from a
    // withdrawn one - and knowing what each reaches - costs no second call.
    expect(devices).toHaveLength(2);
    expect(devices[0].revoked).toBe(false);
    expect(devices[0].applications).toEqual(['c'.repeat(64)]);
    expect(devices[1].revoked).toBe(true);
    expect(devices[1].deviceId).toBe('d'.repeat(64));
    // Reading the snake_case spelling instead yields undefined, which is how
    // this class of bug presents: a falsy "not revoked" for a revoked device.
    expect((devices[1] as unknown as Record<string, unknown>).is_self).toBeUndefined();
  });

  it('sends camelCase keys on the revoke body, not snake_case', async () => {
    fetchStub.mockResolvedValueOnce(
      jsonOk({
        data: {
          accountId: '1'.repeat(64),
          deviceId: DEVICE,
          keyRotated: false,
          revokedIn: [{ namespaceId: NAMESPACE, keyRotated: false }],
        },
      }),
    );

    const result = await client.revokeAccountDevice(NAMESPACE, { deviceId: DEVICE, proof: 'ab12' });

    const sent = callAt(0);
    expect(sent.method).toBe('POST');
    expect(sent.url).toBe(`${NODE}/admin-api/namespaces/${NAMESPACE}/account/revoke`);
    // Asserted as the exact key set: `device_id` reaches the same route and is
    // dropped to a default rather than refused, so the request looks accepted
    // and revokes nothing the caller named.
    expect(Object.keys(sent.body as object)).toEqual(['deviceId', 'proof']);
    expect(sent.body).toEqual({ deviceId: DEVICE, proof: 'ab12' });
    // `keyRotated: false` is the common case for a self-service revocation: the
    // device stops writing at once and can still READ until an admin rotates.
    // Revocation is forward-only either way - what it already authored stands.
    expect(result.revokedIn[0].keyRotated).toBe(false);
  });

  it('sends camelCase on the label body and reads camelCase back', async () => {
    fetchStub.mockResolvedValueOnce(
      jsonOk({
        data: {
          accountId: '1'.repeat(64),
          deviceId: DEVICE,
          label: 'work laptop',
          labelEpoch: 3,
        },
      }),
    );

    const result = await client.labelAccountDevice(DEVICE, { label: 'work laptop' });

    const sent = callAt(0);
    expect(sent.method).toBe('PUT');
    expect(sent.url).toBe(`${NODE}/admin-api/account/devices/${DEVICE}/label`);
    expect(sent.body).toEqual({ label: 'work laptop' });
    // `labelEpoch`, not `label_epoch`: it is what orders this rename against one
    // another device of the account made at the same time, so reading the wrong
    // spelling silently loses the tiebreak.
    expect(result.labelEpoch).toBe(3);
  });

  it('surfaces a refusal as an HTTPError carrying the status and the node message', async () => {
    // A node that holds no account answers the device listing with an error, and
    // so does one whose caller may not see the group. Either way the caller has
    // to be able to tell "no devices" from "not allowed to ask" - so the failure
    // must throw with its status rather than resolve to an empty list.
    fetchStub.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'node holds no account' }), {
        status: 404,
        statusText: 'Not Found',
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const failure = await client.listAccountDevices().catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(HTTPError);
    expect((failure as HTTPError).status).toBe(404);
    expect((failure as HTTPError).message).toContain('node holds no account');
  });

  it('puts paging in the query string of the member-devices listing', async () => {
    fetchStub.mockResolvedValueOnce(
      jsonOk({
        members: [
          { account: '1'.repeat(64), devices: [{ deviceId: DEVICE, signingKey: 'b'.repeat(64) }] },
        ],
      }),
    );

    const members = await client.listGroupMemberDevices('9'.repeat(64), { offset: 0, limit: 25 });

    expect(callAt(0).url).toBe(
      `${NODE}/admin-api/groups/${'9'.repeat(64)}/member-devices?offset=0&limit=25`,
    );
    // `offset: 0` is a real ask and must survive: dropping it on falsiness would
    // silently re-page a caller walking the list.
    expect(members[0].devices[0].signingKey).toBe('b'.repeat(64));
  });
});
