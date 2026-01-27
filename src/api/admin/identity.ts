import { HttpClient } from '../../http-client';
import { unwrap, type ApiResponseWrapper } from '../utils';

export interface GenerateContextIdentityResponse {
  publicKey: string;
}

export class IdentityApiClient {
  constructor(private httpClient: HttpClient) {}

  async generateContextIdentity(): Promise<GenerateContextIdentityResponse> {
    return unwrap(
      this.httpClient.post<ApiResponseWrapper<GenerateContextIdentityResponse>>(
        '/admin-api/identity/context',
        {},
      ),
    );
  }
}
