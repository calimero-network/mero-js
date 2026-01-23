import { HttpClient } from '../../http-client';
import { unwrap, type ApiResponse } from '../utils';

export interface GenerateContextIdentityResponse {
  publicKey: string;
}

export class IdentityApiClient {
  constructor(private httpClient: HttpClient) {}

  async generateContextIdentity(): Promise<GenerateContextIdentityResponse> {
    return unwrap(
      this.httpClient.post<ApiResponse<GenerateContextIdentityResponse>>(
        '/admin-api/identity/context',
        {},
      ),
    );
  }
}
