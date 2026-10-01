/**
 * Does a device-key session actually let a keyholder *watch* a context?
 *
 * Every other leg of delegated execution has been exercised — certificate,
 * session, read, and a write attributed to the author's account. Subscription
 * never was, at any layer, and for a CRDT application it is the operation that
 * matters most: an app that can write but not observe convergence is not
 * usable. Both transports are checked because they authenticate differently —
 * WebSocket carries the token in the query string, SSE in an Authorization
 * header — so one working says nothing about the other.
 *
 * Live, and skipped unless `LIVE_NODE_URL` is set: it needs a running node with
 * `account_proof` enabled, and the account below admitted to a group owning the
 * context. See the README for the rig.
 */
import { execFile } from 'node:child_process';
import { describe, expect, it, beforeAll } from 'vitest';

import { login } from '../login/session.js';
import { signDeviceCert } from '../device-cert/device-cert.js';
import { signerFromSecret } from '../signer/signer.js';

const NODE = process.env.LIVE_NODE_URL;
const NODE_KEY = process.env.LIVE_NODE_KEY;
const CONTEXT = process.env.LIVE_CONTEXT;
/** Must match the node's `allowed_audiences`, byte for byte. */
const AUDIENCE = process.env.LIVE_AUDIENCE ?? 'http://localhost:5173';
/** A shell command that writes to the context, so delivery can be observed. */
const WRITE_CMD = process.env.LIVE_WRITE_CMD;

const ROOT_SECRET = 'aa'.repeat(32);
const DEVICE_SECRET = 'bb'.repeat(32);

const live = NODE && NODE_KEY && CONTEXT ? describe : describe.skip;

live('a device-key session can subscribe', () => {
  let token: string;

  beforeAll(async () => {
    const device = await signerFromSecret(DEVICE_SECRET);
    const accountProof = await signDeviceCert({
      rootSecret: ROOT_SECRET,
      device: 'cc'.repeat(32),
      signPublicKey: device.publicKey,
      kemPublicKey: 'dd'.repeat(32),
      deviceEpoch: 1,
    });

    const session = await login({
      nodeUrl: NODE!,
      node: NODE_KEY!,
      signer: device,
      accountProof,
      audience: { kind: 'webOrigin', origin: AUDIENCE },
    });
    token = session.accessToken;
    expect(token).toMatch(/^ey/);
  }, 30_000);

  it('opens a WebSocket and is accepted', async () => {
    const url = `${NODE!.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);

    const opened = await new Promise<string>((resolve) => {
      ws.addEventListener('open', () => resolve('open'));
      // A 401 closes rather than erroring, so the close code is the evidence.
      ws.addEventListener('close', (e) => resolve(`closed ${e.code}`));
      ws.addEventListener('error', () => resolve('error'));
      setTimeout(() => resolve('timeout'), 8000);
    });
    expect(opened).toBe('open');

    // Exactly what WsClient sends: no `jsonrpc` member. The node rejects one
    // with `invalid value: string "jsonrpc", expected "method" or "params"`,
    // which is how this test first failed — the library was right.
    ws.send(JSON.stringify({
      id: 1, method: 'subscribe',
      params: { contextIds: [CONTEXT] },
    }));

    const reply = await new Promise<string>((resolve) => {
      ws.addEventListener('message', (e) => resolve(String(e.data).slice(0, 200)));
      setTimeout(() => resolve('no reply'), 8000);
    });
    ws.close();
    expect(reply).not.toBe('no reply');
    // The subscription must be ACCEPTED, not merely answered. A ParseError or
    // an authorization refusal both arrive as a reply, so asserting on the
    // absence of `error` is what makes this a real check.
    expect(reply).not.toContain('error');
    console.log('WS reply:', reply);
  }, 30_000);

  it('opens an SSE stream and is accepted', async () => {
    const controller = new AbortController();
    const response = await fetch(`${NODE}/sse`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
      signal: controller.signal,
    });
    controller.abort();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
  }, 30_000);

  /**
   * The assertion that matters: an accepted subscription is not a delivered
   * event. A node can acknowledge `subscribe` and then never send anything —
   * wrong permission, wrong context, events routed elsewhere — and every check
   * above would still pass. So this waits for a real write to arrive.
   */
  it.runIf(WRITE_CMD)('receives an event when the context is written', async () => {
    const url = `${NODE!.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    await new Promise((r) => ws.addEventListener('open', r, { once: true }));
    ws.send(JSON.stringify({ id: 1, method: 'subscribe', params: { contextIds: [CONTEXT] } }));

    const events: string[] = [];
    ws.addEventListener('message', (e) => {
      const text = String(e.data);
      // The subscribe acknowledgement is not an event.
      if (!text.includes('"result":{"contextIds"')) events.push(text.slice(0, 300));
    });

    // Subscribe first, then write — the other order races and would pass or
    // fail depending on machine speed rather than on behaviour.
    await new Promise((r) => setTimeout(r, 500));
    await new Promise<void>((resolve, reject) => {
      execFile('/bin/sh', ['-c', WRITE_CMD!], (err) => (err ? reject(err) : resolve()));
    });

    const arrived = await new Promise<boolean>((resolve) => {
      const started = Date.now();
      const poll = setInterval(() => {
        if (events.length > 0) { clearInterval(poll); resolve(true); }
        else if (Date.now() - started > 15_000) { clearInterval(poll); resolve(false); }
      }, 100);
    });
    ws.close();

    console.log('events:', events.slice(0, 2));
    expect(arrived).toBe(true);
  }, 40_000);
});
