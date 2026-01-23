import { HttpClient } from '../../http-client';
import { unwrap, type ApiResponseWrapper } from '../utils';

export interface TeeAttestRequest {
  nonce: string;
  applicationId?: string;
}

export interface QuoteHeader {
  version: number;
  attestationKeyType: number;
  teeType: number;
  qeVendorId: string;
  userData: string;
}

export interface QuoteBody {
  tdxVersion: string;
  teeTcbSvn: string;
  mrseam: string;
  mrsignerseam: string;
  seamattributes: string;
  tdattributes: string;
  xfam: string;
  mrtd: string;
  mrconfigid: string;
  mrowner: string;
  mrownerconfig: string;
  rtmr0: string;
  rtmr1: string;
  rtmr2: string;
  rtmr3: string;
  reportdata: string;
  teeTcbSvn2?: string;
  mrservicetd?: string;
}

export type CertificationData =
  | string
  | {
      qeReport: string;
      signature: string;
      qeAuthenticationData: string;
      certificationDataType: string;
      certificationData: string;
    };

export interface Quote {
  header: QuoteHeader;
  body: QuoteBody;
  signature: string;
  attestationKey: string;
  certificationData: CertificationData;
}

export interface TeeAttestResponse {
  quoteB64: string;
  quote: Quote;
}

export interface TeeInfoResponse {
  cloudProvider: string;
  osImage: string;
  mrtd: string;
}

export interface TeeVerifyQuoteRequest {
  quoteB64: string;
  nonce: string;
  expectedApplicationHash?: string;
}

export interface TeeVerifyQuoteResponse {
  quoteVerified: boolean;
  nonceVerified: boolean;
  applicationHashVerified?: boolean;
  quote: Quote;
}

export class TeeApiClient {
  constructor(private httpClient: HttpClient) {}

  async getTeeInfo(): Promise<TeeInfoResponse> {
    return unwrap(
      this.httpClient.get<ApiResponseWrapper<TeeInfoResponse>>('/admin-api/tee/info'),
    );
  }

  async attestTee(request: TeeAttestRequest): Promise<TeeAttestResponse> {
    return unwrap(
      this.httpClient.post<ApiResponseWrapper<TeeAttestResponse>>(
        '/admin-api/tee/attest',
        request,
      ),
    );
  }

  async verifyTeeQuote(
    request: TeeVerifyQuoteRequest,
  ): Promise<TeeVerifyQuoteResponse> {
    return unwrap(
      this.httpClient.post<ApiResponseWrapper<TeeVerifyQuoteResponse>>(
        '/admin-api/tee/verify-quote',
        request,
      ),
    );
  }
}
