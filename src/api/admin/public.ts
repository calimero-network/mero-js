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

export interface HealthResponse {
  status: string;
}

export interface IsAuthedResponse {
  status: string;
}

export class PublicApiClient {
  constructor(private httpClient: HttpClient) {}

  async health(): Promise<HealthResponse> {
    return unwrap(
      this.httpClient.get<ApiResponse<HealthResponse>>('/admin-api/health'),
    );
  }

  async isAuthed(): Promise<IsAuthedResponse> {
    return unwrap(
      this.httpClient.get<ApiResponse<IsAuthedResponse>>(
        '/admin-api/is-authed',
      ),
    );
  }

  async getCertificate(): Promise<string> {
    return this.httpClient.get<string>('/admin-api/certificate', {
      parse: 'text',
    });
  }
}
