/**
 * Verifying a TEE node's quote in the page, before trusting the key it binds.
 *
 * A quote proves what runs in a TD only once it has been checked: its
 * signatures against Intel's root, the TCB status of the platform, the
 * measurements of the image, and that its report data is the nonce and the
 * binding this client asked for. {@link createQuoteVerifier} does all of that
 * here, with nothing but the node: the node hands over the Intel-signed
 * collateral with its quote (`includeCollateral`), and a node cannot forge
 * collateral, only choose which valid collateral to serve.
 *
 * The DCAP verification itself — parsing the quote, checking its signature
 * chain and appraising its TCB level against the collateral — comes from a
 * library you pass in, normally `verify` from `@phala/dcap-qvl`, a pure
 * JavaScript implementation that runs in browsers, Node and React Native. It
 * is passed in rather than bundled so this SDK keeps no runtime dependencies,
 * and applications that never talk to a TEE node pay nothing for it.
 */

import { hex } from '../crypto/internal.js';
import type { VerifyTransportQuote } from './sealed.js';

/**
 * The collateral a quote is verified against — TCB info, QE identity, CRLs and
 * their chains — in dcap-qvl's form: byte fields are hex strings or byte
 * arrays. What `/admin-api/tee/attest` returns with `includeCollateral`, and
 * what `@phala/dcap-qvl`'s `getCollateral` fetches.
 */
export interface DcapCollateral {
  pck_crl_issuer_chain: string;
  root_ca_crl: number[] | string;
  pck_crl: number[] | string;
  tcb_info_issuer_chain: string;
  tcb_info: string;
  tcb_info_signature: number[] | string;
  qe_identity_issuer_chain: string;
  qe_identity: string;
  qe_identity_signature: number[] | string;
}

/** The fields of a TDX report this verifier reads. */
interface TdReport {
  mrTd: Uint8Array;
  rtMr0: Uint8Array;
  rtMr1: Uint8Array;
  rtMr2: Uint8Array;
  rtMr3: Uint8Array;
  reportData: Uint8Array;
}

/** What a DCAP verifier returns for a quote whose signature chain verified. */
export interface DcapVerifiedReport {
  status: string;
  advisory_ids?: string[];
  report: { type: string; data: unknown };
}

/**
 * Verify a quote's signature chain against `collateral` as of `nowSecs`, and
 * appraise its TCB level. Throws when it does not verify. `verify` from
 * `@phala/dcap-qvl` has exactly this shape.
 */
export type DcapVerify = (
  quote: Uint8Array,
  collateral: DcapCollateral,
  nowSecs: number,
) => DcapVerifiedReport;

export interface QuoteVerifierOptions {
  /** DCAP verification: `verify` from `@phala/dcap-qvl`. */
  dcapVerify: DcapVerify;
  /**
   * MRTDs (hex) of the images trusted. Required: the MRTD names the image a TD
   * booted, and a quote that proves only "some genuine TD" proves nothing
   * about which code reads the traffic.
   */
  allowedMrtd: string[];
  /** RTMR allowlists (hex); a register is not checked when its list is left out. */
  allowedRtmr0?: string[];
  allowedRtmr1?: string[];
  allowedRtmr2?: string[];
  allowedRtmr3?: string[];
  /**
   * TCB statuses accepted. Defaults to `['UpToDate']`. `Revoked` is refused
   * even when listed.
   */
  allowedTcbStatuses?: string[];
  /**
   * Where to get collateral when the node sends none (it predates
   * `includeCollateral`): for example
   * `(quote) => getCollateral(PHALA_PCCS_URL, quote)` from `@phala/dcap-qvl`.
   * Without it, such a node's quote is refused.
   */
  fetchCollateral?: (quote: Uint8Array) => Promise<DcapCollateral>;
  /** The current time in milliseconds; defaults to `Date.now`. For tests. */
  now?: () => number;
}

/** A verifier for {@link fetchAttestedTransportKey}, which asks the node for collateral. */
export type QuoteVerifier = VerifyTransportQuote & { readonly includeCollateral: true };

const MEASUREMENT_HEX = /^[0-9a-f]{96}$/;

/**
 * A verifier that checks a TEE node's quote here, in the page, and accepts it
 * only when every check passes:
 *
 * - its signatures verify against Intel's root, with collateral that is valid
 *   now;
 * - the platform's TCB status is one allowed (`UpToDate` by default), and
 *   never `Revoked`;
 * - the MRTD, and any RTMRs given, are ones allowed;
 * - its report data is the nonce followed by the binding the client computed.
 *
 * Any failure rejects with the reason; nothing is trusted from a quote that
 * does not pass. Mock quotes never pass: they carry no signature.
 *
 * ```ts
 * import { verify as dcapVerify } from '@phala/dcap-qvl';
 *
 * const verifier = createQuoteVerifier({ dcapVerify, allowedMrtd: [trustedMrtd] });
 * const fetch = createSealedFetch({
 *   baseUrl,
 *   transportPublicKey: () => fetchAttestedTransportKey(admin, verifier),
 * });
 * ```
 */
export function createQuoteVerifier(options: QuoteVerifierOptions): QuoteVerifier {
  const allowedMrtd = measurements(options.allowedMrtd, 'allowedMrtd');
  if (allowedMrtd.length === 0) {
    throw new Error('allowedMrtd is empty, so no quote would ever be accepted');
  }
  const allowedRtmr = [
    measurements(options.allowedRtmr0 ?? [], 'allowedRtmr0'),
    measurements(options.allowedRtmr1 ?? [], 'allowedRtmr1'),
    measurements(options.allowedRtmr2 ?? [], 'allowedRtmr2'),
    measurements(options.allowedRtmr3 ?? [], 'allowedRtmr3'),
  ];
  const allowedStatuses = options.allowedTcbStatuses ?? ['UpToDate'];
  const now = options.now ?? Date.now;

  const verifier = async ({
    quoteB64,
    nonce,
    reportDataSuffix,
    collateral,
  }: Parameters<VerifyTransportQuote>[0]): Promise<boolean> => {
    const quote = fromBase64(quoteB64);
    const against = collateral ?? (await options.fetchCollateral?.(quote));
    if (!against) {
      throw new Error(
        'The node sent no collateral for its quote, and no fetchCollateral was given to get it',
      );
    }

    let verified: DcapVerifiedReport;
    try {
      verified = options.dcapVerify(quote, against, Math.floor(now() / 1000));
    } catch (error) {
      throw new Error(`The quote did not verify: ${(error as Error)?.message ?? String(error)}`);
    }

    if (verified.status === 'Revoked' || !allowedStatuses.includes(verified.status)) {
      throw new Error(`The platform's TCB status is ${verified.status}, which is not accepted`);
    }
    const td = tdReport(verified.report);
    if (!allowedMrtd.includes(hex(td.mrTd))) {
      throw new Error(`MRTD ${hex(td.mrTd)} is not an image this verifier trusts`);
    }
    const registers = [td.rtMr0, td.rtMr1, td.rtMr2, td.rtMr3];
    registers.forEach((register, index) => {
      const allowed = allowedRtmr[index];
      if (allowed.length > 0 && !allowed.includes(hex(register))) {
        throw new Error(`RTMR${index} ${hex(register)} is not one this verifier trusts`);
      }
    });
    if (hex(td.reportData) !== `${nonce}${reportDataSuffix}`.toLowerCase()) {
      throw new Error('The quote does not commit to this nonce and binding');
    }
    return true;
  };
  return Object.assign(verifier, { includeCollateral: true as const });
}

function measurements(values: string[], label: string): string[] {
  return values.map((value) => {
    const normalized = value.trim().toLowerCase();
    if (!MEASUREMENT_HEX.test(normalized)) {
      throw new Error(`${label} holds ${JSON.stringify(value)}, which is not a 48-byte hex measurement`);
    }
    return normalized;
  });
}

/** The TD report of a TDX quote (1.0 or 1.5); anything else is refused. */
function tdReport(report: DcapVerifiedReport['report']): TdReport {
  const data = report.data as (TdReport & { base?: TdReport }) | undefined;
  if (report.type === 'td10' && data) return data;
  if (report.type === 'td15' && data?.base) return data.base;
  throw new Error(`The quote is a ${report.type} quote, not a TDX one`);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
