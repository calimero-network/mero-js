import { HttpClient } from '../../http-client';

// Helper to unwrap { data: T } responses
type ApiResponse<T> = { data: T };

async function unwrap<T>(
  response: Promise<ApiResponse<T>>,
): Promise<T> {
  const result = await response;
  if (!result.data) {
    throw new Error('Response data is null');
  }
  return result.data;
}

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
