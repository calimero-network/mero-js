import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { verify as dcapVerify } from '@phala/dcap-qvl';
import { describe, expect, it, vi } from 'vitest';

import { hex } from '../crypto/internal.js';
import { fetchAttestedTransportKey, transportKeyBinding } from './sealed.js';
import { createQuoteVerifier, type DcapCollateral, type DcapVerifiedReport } from './verify.js';

// A real TDX quote and the Intel-signed collateral for it, from dcap-qvl's own
// samples, as core's calimero-tee-attestation tests them: the collateral is in
// the JSON form a node returns with `includeCollateral`.
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const QUOTE = new Uint8Array(readFileSync(fixture('tdx_quote.bin')));
const COLLATERAL = JSON.parse(readFileSync(fixture('tdx_quote_collateral.json'), 'utf8')) as DcapCollateral;
// A moment inside that collateral's validity window (2025-06-27).
const AT = 1_751_000_000_000;
const QUOTE_B64 = Buffer.from(QUOTE).toString('base64');

// The sample quote's own report data and MRTD, read once from the verified
// report, so the tests below say what they check rather than repeat hex.
const sample = dcapVerify(QUOTE, COLLATERAL, AT / 1000);
const sampleTd = sample.report.data as { mrTd: Uint8Array; reportData: Uint8Array; rtMr0: Uint8Array };
const MRTD = hex(sampleTd.mrTd);
const NONCE = hex(sampleTd.reportData.slice(0, 32));
const SUFFIX = hex(sampleTd.reportData.slice(32));

const real = (overrides: Partial<Parameters<typeof createQuoteVerifier>[0]> = {}) =>
  createQuoteVerifier({ dcapVerify, allowedMrtd: [MRTD], now: () => AT, ...overrides });

describe('createQuoteVerifier on a real quote', () => {
  it('accepts a genuine quote from a trusted image that commits to the binding', async () => {
    const verifier = real();
    await expect(
      verifier({ quoteB64: QUOTE_B64, nonce: NONCE, reportDataSuffix: SUFFIX, collateral: COLLATERAL }),
    ).resolves.toBe(true);
    expect(verifier.includeCollateral).toBe(true);
  });

  it('refuses a quote that commits to another binding', async () => {
    await expect(
      real()({ quoteB64: QUOTE_B64, nonce: NONCE, reportDataSuffix: '00'.repeat(32), collateral: COLLATERAL }),
    ).rejects.toThrow('does not commit to this nonce and binding');
  });

  it('refuses an image it does not trust', async () => {
    await expect(
      real({ allowedMrtd: ['ab'.repeat(48)] })({
        quoteB64: QUOTE_B64,
        nonce: NONCE,
        reportDataSuffix: SUFFIX,
        collateral: COLLATERAL,
      }),
    ).rejects.toThrow('is not an image this verifier trusts');
  });

  it('checks an RTMR only when asked to', async () => {
    const args = { quoteB64: QUOTE_B64, nonce: NONCE, reportDataSuffix: SUFFIX, collateral: COLLATERAL };
    await expect(real({ allowedRtmr0: [hex(sampleTd.rtMr0)] })(args)).resolves.toBe(true);
    await expect(real({ allowedRtmr0: ['cd'.repeat(48)] })(args)).rejects.toThrow('RTMR0');
  });

  it('refuses a tampered quote', async () => {
    const tampered = QUOTE.slice();
    tampered[200] ^= 0x01; // a byte of the signed TD report body
    await expect(
      real()({
        quoteB64: Buffer.from(tampered).toString('base64'),
        nonce: NONCE,
        reportDataSuffix: SUFFIX,
        collateral: COLLATERAL,
      }),
    ).rejects.toThrow('did not verify');
  });

  it('refuses collateral outside its validity window', async () => {
    await expect(
      real({ now: () => Date.UTC(2040, 0, 1) })({
        quoteB64: QUOTE_B64,
        nonce: NONCE,
        reportDataSuffix: SUFFIX,
        collateral: COLLATERAL,
      }),
    ).rejects.toThrow('did not verify');
  });

  it('gets collateral itself when the node sends none, and refuses without a way to', async () => {
    const fetchCollateral = vi.fn(async () => COLLATERAL);
    const args = { quoteB64: QUOTE_B64, nonce: NONCE, reportDataSuffix: SUFFIX };
    await expect(real({ fetchCollateral })(args)).resolves.toBe(true);
    expect(fetchCollateral).toHaveBeenCalledWith(QUOTE);
    await expect(real()(args)).rejects.toThrow('no collateral');
  });
});

describe('createQuoteVerifier policy', () => {
  const report = (status: string, type = 'td10'): DcapVerifiedReport => ({
    status,
    report: { type, data: { ...sampleTd, rtMr1: sampleTd.rtMr0, rtMr2: sampleTd.rtMr0, rtMr3: sampleTd.rtMr0 } },
  });
  const args = { quoteB64: QUOTE_B64, nonce: NONCE, reportDataSuffix: SUFFIX, collateral: COLLATERAL };

  it('accepts only up-to-date platforms by default', async () => {
    const outOfDate = createQuoteVerifier({ dcapVerify: () => report('OutOfDate'), allowedMrtd: [MRTD] });
    await expect(outOfDate(args)).rejects.toThrow('TCB status is OutOfDate');
    const allowed = createQuoteVerifier({
      dcapVerify: () => report('OutOfDate'),
      allowedMrtd: [MRTD],
      allowedTcbStatuses: ['UpToDate', 'OutOfDate'],
    });
    await expect(allowed(args)).resolves.toBe(true);
  });

  it('refuses a revoked platform even when told to accept it', async () => {
    const verifier = createQuoteVerifier({
      dcapVerify: () => report('Revoked'),
      allowedMrtd: [MRTD],
      allowedTcbStatuses: ['Revoked'],
    });
    await expect(verifier(args)).rejects.toThrow('Revoked');
  });

  it('refuses a quote that is not TDX', async () => {
    const verifier = createQuoteVerifier({ dcapVerify: () => report('UpToDate', 'sgx'), allowedMrtd: [MRTD] });
    await expect(verifier(args)).rejects.toThrow('not a TDX one');
  });

  it('passes the time now, in seconds', async () => {
    const dcap = vi.fn(() => report('UpToDate'));
    await createQuoteVerifier({ dcapVerify: dcap, allowedMrtd: [MRTD], now: () => 1_234_567_890 })(args);
    expect(dcap).toHaveBeenCalledWith(QUOTE, COLLATERAL, 1_234_567);
  });

  it('will not be built to accept nothing, or with a measurement that is not one', () => {
    expect(() => createQuoteVerifier({ dcapVerify, allowedMrtd: [] })).toThrow('allowedMrtd is empty');
    expect(() => createQuoteVerifier({ dcapVerify, allowedMrtd: ['aabb'] })).toThrow('allowedMrtd');
    expect(() => createQuoteVerifier({ dcapVerify, allowedMrtd: [MRTD], allowedRtmr2: ['zz'] })).toThrow(
      'allowedRtmr2',
    );
  });
});

describe('fetchAttestedTransportKey with a verifier that wants collateral', () => {
  const transportKey = new Uint8Array(32).fill(0x44);

  it('asks the node for collateral and hands it to the verifier', async () => {
    const teeAttest = vi.fn(async () => ({
      quoteB64: 'AA==',
      quote: {} as never,
      transportPublicKey: hex(transportKey),
      collateral: COLLATERAL,
    }));
    const verify = Object.assign(
      vi.fn(async ({ collateral, reportDataSuffix }: { collateral?: DcapCollateral; reportDataSuffix: string }) => {
        expect(collateral).toBe(COLLATERAL);
        expect(reportDataSuffix).toBe(hex(await transportKeyBinding(new Uint8Array(32), transportKey)));
        return true;
      }),
      { includeCollateral: true as const },
    );
    await expect(fetchAttestedTransportKey({ teeAttest }, verify)).resolves.toEqual(transportKey);
    expect(teeAttest).toHaveBeenCalledWith(expect.objectContaining({ includeCollateral: true }));
  });

  it('does not send the field to a verifier that has no use for it', async () => {
    // A node that predates `includeCollateral` refuses unknown fields.
    const teeAttest = vi.fn(async () => ({
      quoteB64: 'AA==',
      quote: {} as never,
      transportPublicKey: hex(transportKey),
    }));
    await fetchAttestedTransportKey({ teeAttest }, async () => true);
    expect(teeAttest.mock.calls[0][0]).not.toHaveProperty('includeCollateral');
  });
});
